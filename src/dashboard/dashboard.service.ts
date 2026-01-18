import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  PaymentStatus,
  PurchaseStatus,
  PurchaseType,
} from '@prisma/client';
import { resolveMatrixPrice } from '../pricing/pricing.service';

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  /* =====================================================
   * GET DASHBOARD STATISTICS
   * ===================================================== */
  async getDashboardStats() {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    
    // Get all successful payments
    const allPayments = await this.prisma.payment.aggregate({
      where: {
        status: PaymentStatus.SUCCESS,
      },
      _sum: {
        amount: true,
      },
      _count: {
        id: true,
      },
    });

    // Get today's successful payments
    const todayPayments = await this.prisma.payment.aggregate({
      where: {
        status: PaymentStatus.SUCCESS,
        paidAt: {
          gte: startOfToday,
        },
      },
      _sum: {
        amount: true,
      },
      _count: {
        id: true,
      },
    });

    // Get today's sales (purchases fully paid today: IMMEDIATE+PAID or FUTURE+PAID)
    const todaySales = await this.prisma.purchase.aggregate({
      where: {
        status: PurchaseStatus.PAID,
        purchaseType: {
          in: [PurchaseType.IMMEDIATE, PurchaseType.FUTURE],
        },
        paidAt: {
          gte: startOfToday,
        },
      },
      _sum: {
        totalAmount: true,
      },
      _count: {
        id: true,
      },
    });

    // Get burials scheduled for this week (based on expectedBurial date)
    // Calculate start and end of current week (Monday to Sunday)
    const dayOfWeek = now.getDay(); // 0 = Sunday, 1 = Monday, etc.
    const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1; // Convert to Monday-based
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - daysFromMonday);
    startOfWeek.setHours(0, 0, 0, 0);
    
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 6);
    endOfWeek.setHours(23, 59, 59, 999);

    const burialsThisWeek = await this.prisma.deceased.count({
      where: {
        expectedBurial: {
          gte: startOfWeek,
          lte: endOfWeek,
        },
      },
    });

    // Calculate due payments for payment plans
    const duePayments = await this.calculateDuePayments(now);

    // Ensure duePayments is a valid number (not NaN or undefined)
    const safeDuePayments = 
      duePayments != null && 
      !isNaN(duePayments) && 
      isFinite(duePayments)
        ? Number(duePayments)
        : 0;

    return {
      total: {
        amount: Number(allPayments._sum.amount || 0),
        count: allPayments._count.id || 0,
      },
      today: {
        amount: Number(todayPayments._sum.amount || 0),
        count: todayPayments._count.id || 0,
      },
      todaySales: {
        amount: Number(todaySales._sum.totalAmount || 0),
        count: todaySales._count.id || 0,
      },
      burialsScheduled: burialsThisWeek,
      duePayments: safeDuePayments,
    };
  }

  /* =====================================================
   * CALCULATE DUE PAYMENTS FOR PAYMENT PLANS
   * 
   * This calculates the total amount due from ALL members
   * by summing each member's monthly payment × months elapsed.
   * Returns a single compiled balance for the dashboard.
   * ===================================================== */
  private async calculateDuePayments(currentDate: Date): Promise<number> {
    // Get the 1st of the current month (payments are credited on the 1st)
    const firstOfCurrentMonth = new Date(
      currentDate.getFullYear(),
      currentDate.getMonth(),
      1,
    );
    firstOfCurrentMonth.setHours(0, 0, 0, 0);

    // Get ALL purchases with balance > 0 and a payment plan (yearPlanId)
    // This gets purchases from ALL members who haven't finished paying
    // Note: We only look at purchases with yearPlanId (payment plans)
    const purchasesWithPlans = await this.prisma.purchase.findMany({
      where: {
        balance: {
          gt: 0,
        },
        yearPlanId: {
          not: null,
        },
        status: {
          in: [PurchaseStatus.PENDING_PAYMENT, PurchaseStatus.PARTIALLY_PAID],
        },
      },
      include: {
        member: {
          select: {
            dateOfBirth: true,
          },
        },
        product: {
          select: {
            pricingSection: true,
          },
        },
        yearPlan: true,
      },
    });

    // Debug: Log how many purchases were found
    console.log(`[Dashboard] Found ${purchasesWithPlans.length} purchases with payment plans`);
    
    // Debug: Log sample purchase data to understand structure
    if (purchasesWithPlans.length > 0) {
      const sample = purchasesWithPlans[0];
      console.log(`[Dashboard] Sample purchase:`, {
        id: sample.id,
        balance: Number(sample.balance),
        yearPlanId: sample.yearPlanId,
        hasYearPlan: !!sample.yearPlan,
        hasPricingSection: !!sample.product?.pricingSection,
        pricingSection: sample.product?.pricingSection,
        status: sample.status,
      });
    }

    // Initialize total due - will accumulate all members' due payments
    let totalDue = 0;
    let processedCount = 0;
    let skippedCount = 0;

    // Loop through each purchase (each member) and calculate their due amount
    for (const purchase of purchasesWithPlans) {
      if (!purchase.yearPlan || !purchase.product.pricingSection) {
        skippedCount++;
        console.log(`[Dashboard] Skipping purchase ${purchase.id}: missing yearPlan (${!!purchase.yearPlan}) or pricingSection (${!!purchase.product?.pricingSection})`);
        continue;
      }

      try {
        // Calculate member age at purchase time (or current time for consistency)
        const dob = new Date(purchase.member.dateOfBirth);
        if (isNaN(dob.getTime())) {
          console.error(
            `Invalid date of birth for purchase ${purchase.id}`,
          );
          continue;
        }

        let age = currentDate.getFullYear() - dob.getFullYear();
        if (
          currentDate.getMonth() < dob.getMonth() ||
          (currentDate.getMonth() === dob.getMonth() &&
            currentDate.getDate() < dob.getDate())
        ) {
          age--;
        }

        // Validate age is a valid number
        if (isNaN(age) || age < 0) {
          console.error(`Invalid age calculated for purchase ${purchase.id}: ${age}`);
          continue;
        }

        // Calculate monthly payment amount
        const monthlyAmount = resolveMatrixPrice(
          purchase.product,
          purchase.yearPlan,
          age,
        );

        // Validate monthly amount is a valid number
        if (!monthlyAmount || isNaN(monthlyAmount) || monthlyAmount <= 0) {
          console.error(
            `Invalid monthly amount for purchase ${purchase.id}: ${monthlyAmount}`,
          );
          continue;
        }

        // Calculate months from purchase creation to 1st of current month
        const purchaseDate = new Date(purchase.createdAt);
        if (isNaN(purchaseDate.getTime())) {
          console.error(`Invalid purchase date for purchase ${purchase.id}`);
          continue;
        }

        const purchaseMonth = new Date(
          purchaseDate.getFullYear(),
          purchaseDate.getMonth(),
          1,
        );
        purchaseMonth.setHours(0, 0, 0, 0);

        // Calculate difference in months
        const monthsDiff =
          (firstOfCurrentMonth.getFullYear() -
            purchaseMonth.getFullYear()) *
            12 +
          (firstOfCurrentMonth.getMonth() - purchaseMonth.getMonth());

        // Only count months that have elapsed (at least 1 month)
        // If purchase was created this month, they owe for this month (1 month)
        const monthsElapsed = Math.max(1, monthsDiff + 1);

        // Validate monthsElapsed is a valid number
        if (isNaN(monthsElapsed) || monthsElapsed <= 0) {
          console.error(
            `Invalid months elapsed for purchase ${purchase.id}: ${monthsElapsed}`,
          );
          continue;
        }

        // Calculate due amount for THIS member: monthly amount * months elapsed
        const dueAmount = monthlyAmount * monthsElapsed;

        // Debug: Log calculation details for first few purchases
        if (processedCount < 3) {
          console.log(`[Dashboard] Purchase ${purchase.id} calculation:`, {
            monthlyAmount,
            monthsElapsed,
            dueAmount,
            purchaseMonth: purchaseMonth.toISOString().split('T')[0],
            currentMonth: firstOfCurrentMonth.toISOString().split('T')[0],
          });
        }

        // Validate dueAmount is a valid number before adding
        if (isNaN(dueAmount) || dueAmount <= 0) {
          skippedCount++;
          console.error(
            `Invalid due amount for purchase ${purchase.id}: ${dueAmount} (monthly: ${monthlyAmount}, months: ${monthsElapsed})`,
          );
          continue;
        }

        // Add this member's due amount to the total (compiling all members)
        totalDue += dueAmount;
        processedCount++;
      } catch (error) {
        // Skip purchases where we can't calculate monthly amount
        // (e.g., missing pricing section or age data)
        skippedCount++;
        console.error(
          `[Dashboard] Error calculating due payment for purchase ${purchase.id}:`,
          error,
        );
        continue;
      }
    }

    // Debug: Log summary
    console.log(
      `[Dashboard] Due payments calculation: ${processedCount} processed, ${skippedCount} skipped, total: ${totalDue}`,
    );

    // Return the compiled total - sum of ALL members' due payments
    // Ensure we return a valid number (not NaN)
    if (isNaN(totalDue) || !isFinite(totalDue)) {
      console.error('Total due calculation resulted in NaN or Infinity');
      return 0;
    }

    return Math.round(totalDue * 100) / 100; // Round to 2 decimal places
  }

  /* =====================================================
   * GET REVENUE DATA FOR CHART
   * ===================================================== */
  async getRevenueData(period: 'week' | 'month' | 'year') {
    const now = new Date();
    const payments = await this.prisma.payment.findMany({
      where: {
        status: PaymentStatus.SUCCESS,
        paidAt: {
          not: null,
        },
      },
      select: {
        amount: true,
        paidAt: true,
      },
      orderBy: {
        paidAt: 'asc',
      },
    });

    if (period === 'week') {
      // Last 7 days
      const data: { period: string; revenue: number }[] = [];
      const today = new Date(now);
      today.setHours(0, 0, 0, 0);

      for (let i = 6; i >= 0; i--) {
        const date = new Date(today);
        date.setDate(today.getDate() - i);
        const nextDate = new Date(date);
        nextDate.setDate(date.getDate() + 1);

        const dayRevenue = payments
          .filter((p) => {
            const paidAt = p.paidAt ? new Date(p.paidAt) : null;
            return paidAt && paidAt >= date && paidAt < nextDate;
          })
          .reduce((sum, p) => sum + Number(p.amount), 0);

        data.push({
          period: date.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short' }),
          revenue: dayRevenue,
        });
      }

      return data;
    }

    if (period === 'month') {
      // Last 12 months
      const data: { period: string; revenue: number }[] = [];
      const today = new Date(now);
      today.setDate(1); // First day of current month
      today.setHours(0, 0, 0, 0);

      for (let i = 11; i >= 0; i--) {
        const date = new Date(today);
        date.setMonth(today.getMonth() - i);
        const nextDate = new Date(date);
        nextDate.setMonth(date.getMonth() + 1);

        const monthRevenue = payments
          .filter((p) => {
            const paidAt = p.paidAt ? new Date(p.paidAt) : null;
            return paidAt && paidAt >= date && paidAt < nextDate;
          })
          .reduce((sum, p) => sum + Number(p.amount), 0);

        data.push({
          period: date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
          revenue: monthRevenue,
        });
      }

      return data;
    }

    if (period === 'year') {
      // Last 5 years
      const data: { period: string; revenue: number }[] = [];
      const today = new Date(now);
      const currentYear = today.getFullYear();

      for (let i = 4; i >= 0; i--) {
        const year = currentYear - i;
        const startDate = new Date(year, 0, 1);
        const endDate = new Date(year + 1, 0, 1);

        const yearRevenue = payments
          .filter((p) => {
            const paidAt = p.paidAt ? new Date(p.paidAt) : null;
            return paidAt && paidAt >= startDate && paidAt < endDate;
          })
          .reduce((sum, p) => sum + Number(p.amount), 0);

        data.push({
          period: year.toString(),
          revenue: yearRevenue,
        });
      }

      return data;
    }

    return [];
  }

  /* =====================================================
   * GET RECENT ACTIVITIES
   * ===================================================== */
  async getRecentActivities(limit: number = 10) {
    const activities: Array<{
      type: string;
      title: string;
      description: string;
      timestamp: Date;
      color: string;
    }> = [];

    // Get recent successful payments
    const recentPayments = await this.prisma.payment.findMany({
      where: {
        status: PaymentStatus.SUCCESS,
        paidAt: {
          not: null,
        },
      },
      include: {
        member: {
          select: {
            firstName: true,
            lastName: true,
          },
        },
      },
      orderBy: {
        paidAt: 'desc',
      },
      take: limit,
    });

    // Get recent member registrations
    const recentMembers = await this.prisma.member.findMany({
      select: {
        firstName: true,
        lastName: true,
        createdAt: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: limit,
    });

    // Get upcoming burials (scheduled)
    const upcomingBurials = await this.prisma.deceased.findMany({
      where: {
        expectedBurial: {
          not: null,
          gte: new Date(), // Only future burials
        },
      },
      include: {
        purchase: {
          include: {
            member: {
              select: {
                firstName: true,
                lastName: true,
              },
            },
          },
        },
      },
      orderBy: {
        expectedBurial: 'asc',
      },
      take: limit,
    });

    // Add payment activities
    recentPayments.forEach((payment) => {
      if (payment.paidAt) {
        activities.push({
          type: 'payment',
          title: 'New payment received',
          description: `${payment.member.firstName} ${payment.member.lastName} - ${Number(payment.amount).toFixed(2)} ${payment.currency}`,
          timestamp: payment.paidAt,
          color: 'from-green-500 to-emerald-600',
        });
      }
    });

    // Add member registration activities
    recentMembers.forEach((member) => {
      activities.push({
        type: 'member',
        title: 'User registered',
        description: `New member: ${member.firstName} ${member.lastName}`,
        timestamp: member.createdAt,
        color: 'from-blue-500 to-blue-600',
      });
    });

    // Add burial scheduled activities
    upcomingBurials.forEach((deceased) => {
      if (deceased.expectedBurial) {
        const burialDate = new Date(deceased.expectedBurial);
        const formattedDate = burialDate.toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        });
        activities.push({
          type: 'burial',
          title: 'Burial scheduled',
          description: `${deceased.fullName} - ${formattedDate}`,
          timestamp: deceased.expectedBurial,
          color: 'from-purple-500 to-purple-600',
        });
      }
    });

    // Sort all activities by timestamp (most recent first)
    activities.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    // Return limited results
    return activities.slice(0, limit).map((activity) => ({
      ...activity,
      timestamp: activity.timestamp.toISOString(),
    }));
  }

  /* =====================================================
   * GET ALL PAYMENTS (ADMIN)
   * ===================================================== */
  async getAllPayments(
    page: number = 1,
    limit: number = 50,
    status?: string,
    method?: string,
  ) {
    const skip = (page - 1) * limit;

    const where: any = {};
    if (status) {
      where.status = status as PaymentStatus;
    }
    if (method) {
      where.method = method;
    }

    const [payments, total] = await Promise.all([
      this.prisma.payment.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          amount: true,
          currency: true,
          method: true,
          status: true,
          reference: true,
          createdAt: true,
          paidAt: true,
          member: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
          purchase: {
            select: {
              id: true,
              product: {
                select: {
                  title: true,
                  category: true,
                },
              },
            },
          },
        },
      }),
      this.prisma.payment.count({ where }),
    ]);

    return {
      payments: payments.map((p) => ({
        ...p,
        amount: Number(p.amount),
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }
}
