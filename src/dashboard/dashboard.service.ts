import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  PaymentStatus,
  PurchaseStatus,
  PurchaseType,
  BurialStatus,
  CommissionStatus,
} from '@prisma/client';
import { resolveMatrixPrice } from '../pricing/pricing.service';

@Injectable()
export class DashboardService {
  // ✅ PERFORMANCE: Cache dashboard stats for 30 seconds to reduce database load
  private dashboardStatsCache: {
    data: any;
    timestamp: number;
  } | null = null;
  private readonly CACHE_TTL = 30000; // 30 seconds

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Invalidate dashboard stats cache
   * Call this when payments, purchases, or burials are updated
   */
  invalidateDashboardCache() {
    this.dashboardStatsCache = null;
  }

  /* =====================================================
   * GET DASHBOARD STATISTICS
   * ===================================================== */
  async getDashboardStats() {
    // ✅ PERFORMANCE: Return cached data if still valid
    const now = Date.now();
    if (
      this.dashboardStatsCache &&
      now - this.dashboardStatsCache.timestamp < this.CACHE_TTL
    ) {
      return this.dashboardStatsCache.data;
    }

    const currentDate = new Date();
    const startOfToday = new Date(
      currentDate.getFullYear(),
      currentDate.getMonth(),
      currentDate.getDate(),
    );
    
    // Calculate start and end of current week (Monday to Sunday)
    const dayOfWeek = currentDate.getDay(); // 0 = Sunday, 1 = Monday, etc.
    const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1; // Convert to Monday-based
    const startOfWeek = new Date(currentDate);
    startOfWeek.setDate(currentDate.getDate() - daysFromMonday);
    startOfWeek.setHours(0, 0, 0, 0);
    
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 6);
    endOfWeek.setHours(23, 59, 59, 999);

    // ✅ OPTIMIZED: Run all queries in parallel instead of sequentially
    const [
      allPayments,
      todayPayments,
      todaySales,
      burialsThisWeek,
      duePayments,
    ] = await Promise.all([
      // Get all successful payments (exclude legacy settlements and payments from cancelled purchases)
      this.prisma.payment.aggregate({
        where: {
          status: PaymentStatus.SUCCESS,
          method: {
            not: 'LEGACY_SETTLEMENT',
          },
          purchase: {
            status: {
              not: PurchaseStatus.CANCELLED,
            },
          },
        },
        _sum: {
          amount: true,
        },
        _count: {
          id: true,
        },
      }),

      // Get today's successful payments (exclude legacy settlements and payments from cancelled purchases)
      this.prisma.payment.aggregate({
        where: {
          status: PaymentStatus.SUCCESS,
          method: {
            not: 'LEGACY_SETTLEMENT',
          },
          paidAt: {
            gte: startOfToday,
          },
          purchase: {
            status: {
              not: PurchaseStatus.CANCELLED,
            },
          },
        },
        _sum: {
          amount: true,
        },
        _count: {
          id: true,
        },
      }),

      // Get today's sales (purchases fully paid today: IMMEDIATE+PAID or FUTURE+PAID)
      this.prisma.purchase.aggregate({
        where: {
          status: PurchaseStatus.PAID,
          purchaseType: {
            in: [PurchaseType.IMMEDIATE, PurchaseType.FUTURE],
          },
          paidAt: {
            gte: startOfToday,
          },
          // Exclude cancelled purchases - they are stale
          NOT: {
            status: PurchaseStatus.CANCELLED,
          },
        },
        _sum: {
          totalAmount: true,
        },
        _count: {
          id: true,
        },
      }),

      // Get burials scheduled for this week
      this.prisma.deceased.count({
        where: {
          OR: [
            { burialDate: { gte: startOfWeek, lte: endOfWeek } },
            { expectedBurial: { gte: startOfWeek, lte: endOfWeek } },
          ],
          status: {
            not: BurialStatus.PENDING_WAIVER_APPROVAL,
          },
        },
      }),

      // Calculate due payments for payment plans
      this.calculateDuePayments(currentDate),
    ]);

    // Ensure duePayments is a valid number (not NaN or undefined)
    const safeDuePayments = 
      duePayments != null && 
      !isNaN(duePayments) && 
      isFinite(duePayments)
        ? Number(duePayments)
        : 0;

    const result = {
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

    // ✅ PERFORMANCE: Cache the result
    this.dashboardStatsCache = {
      data: result,
      timestamp: now,
    };

    return result;
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

    // ✅ OPTIMIZED: Get purchases with balance > 0 and a payment plan (yearPlanId)
    // Use select instead of include for better performance
    // Limit to active payment plans only
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
      select: {
        id: true,
        balance: true,
        createdAt: true,
        yearPlanId: true,
        status: true,
        member: {
          select: {
            dateOfBirth: true,
          },
        },
        product: {
          select: {
            pricingSection: true,
            amount: true,
            category: true,
          },
        },
        yearPlan: {
          select: {
            id: true,
            months: true,
            muhacha_under60: true,
            muhacha_over60: true,
            lawn_under60: true,
            lawn_over60: true,
            donhodzo_under60: true,
            donhodzo_over60: true,
            family_under60: true,
            family_over60: true,
          },
        },
      },
      // ✅ OPTIMIZED: Add limit to prevent loading too many records at once
      // If you have more than 1000 active payment plans, consider pagination
      take: 1000,
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
        // Type assertion: resolveMatrixPrice only needs the pricing matrix fields, which we've selected
        const monthlyAmount = resolveMatrixPrice(
          purchase.product,
          purchase.yearPlan as any, // Type assertion: selected fields contain all needed pricing matrix data
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
   * Optimized to use database aggregation instead of loading all payments
   * ===================================================== */
  async getRevenueData(period: 'week' | 'month' | 'year') {
    const now = new Date();

    if (period === 'week') {
      // Last 7 days - use database aggregation for each day
      const today = new Date(now);
      today.setHours(0, 0, 0, 0);

      // Fetch all days in parallel for better performance
      const dayPromises: Promise<{ period: string; revenue: number; date: Date }>[] = [];
      for (let i = 6; i >= 0; i--) {
        const date = new Date(today);
        date.setDate(today.getDate() - i);
        const nextDate = new Date(date);
        nextDate.setDate(date.getDate() + 1);

        dayPromises.push(
          this.prisma.payment.aggregate({
            where: {
              status: PaymentStatus.SUCCESS,
              method: {
                not: 'LEGACY_SETTLEMENT',
              },
              paidAt: {
                gte: date,
                lt: nextDate,
              },
            },
            _sum: {
              amount: true,
            },
          }).then((result) => ({
            period: date.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short' }),
            revenue: Number(result._sum.amount || 0),
            date,
          }))
        );
      }

      const results = await Promise.all(dayPromises);
      // Sort by date to ensure correct order
      results.sort((a, b) => a.date.getTime() - b.date.getTime());
      return results.map(({ period, revenue }) => ({ period, revenue }));
    }

    if (period === 'month') {
      // Last 12 months - use database aggregation for each month
      const today = new Date(now);
      today.setDate(1); // First day of current month
      today.setHours(0, 0, 0, 0);

      // Fetch all months in parallel for better performance
      const monthPromises: Promise<{ period: string; revenue: number; date: Date }>[] = [];
      for (let i = 11; i >= 0; i--) {
        const date = new Date(today);
        date.setMonth(today.getMonth() - i);
        const nextDate = new Date(date);
        nextDate.setMonth(date.getMonth() + 1);

        monthPromises.push(
          this.prisma.payment.aggregate({
            where: {
              status: PaymentStatus.SUCCESS,
              method: {
                not: 'LEGACY_SETTLEMENT',
              },
              paidAt: {
                gte: date,
                lt: nextDate,
              },
              purchase: {
                status: {
                  not: PurchaseStatus.CANCELLED,
                },
              },
            },
            _sum: {
              amount: true,
            },
          }).then((result) => ({
            period: date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
            revenue: Number(result._sum.amount || 0),
            date,
          }))
        );
      }

      const results = await Promise.all(monthPromises);
      // Sort by date to ensure correct order
      results.sort((a, b) => a.date.getTime() - b.date.getTime());
      return results.map(({ period, revenue }) => ({ period, revenue }));
    }

    if (period === 'year') {
      // Last 5 years - use database aggregation for each year
      const today = new Date(now);
      const currentYear = today.getFullYear();

      // Fetch all years in parallel for better performance
      const yearPromises: Array<Promise<{ period: string; revenue: number; year: number }>> = [];
      for (let i = 4; i >= 0; i--) {
        const year = currentYear - i;
        const startDate = new Date(year, 0, 1);
        const endDate = new Date(year + 1, 0, 1);

        const promise = this.prisma.payment.aggregate({
          where: {
            status: PaymentStatus.SUCCESS,
            method: {
              not: 'LEGACY_SETTLEMENT',
            },
            paidAt: {
              gte: startDate,
              lt: endDate,
            },
          },
          _sum: {
            amount: true,
          },
        }).then((result) => ({
          period: year.toString(),
          revenue: Number(result._sum.amount || 0),
          year,
        }));
        
        yearPromises.push(promise);
      }

      const results = await Promise.all(yearPromises);
      // Sort by year to ensure correct order
      results.sort((a, b) => a.year - b.year);
      return results.map(({ period, revenue }) => ({ period, revenue }));
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

    // Get recent successful payments (exclude legacy settlements and payments from cancelled purchases)
    const recentPayments = await this.prisma.payment.findMany({
      where: {
        status: PaymentStatus.SUCCESS,
        method: {
          not: 'LEGACY_SETTLEMENT',
        },
        paidAt: {
          not: null,
        },
        purchase: {
          status: {
            not: PurchaseStatus.CANCELLED,
          },
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
    } else {
      // Only exclude legacy settlements if no specific method filter is applied
      where.method = {
        not: 'LEGACY_SETTLEMENT',
      };
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

  /* =====================================================
   * GET DEBT CONTROL - Monthly debt calculation
   * ===================================================== */
  async getDebtControl() {
    const now = new Date();
    const currentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    currentMonth.setHours(0, 0, 0, 0);

    // Get all purchases with installment plans and balance > 0
    // Only include PARTIALLY_PAID purchases (exclude PENDING_PAYMENT and CANCELLED)
    // PENDING_PAYMENT purchases haven't started payments yet, so they're not debtors
    const purchases = await this.prisma.purchase.findMany({
      where: {
        balance: { gt: 0 },
        yearPlanId: { not: null },
        purchaseType: PurchaseType.FUTURE,
        status: PurchaseStatus.PARTIALLY_PAID, // Only show purchases that have started payments
      },
      include: {
        member: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            dateOfBirth: true,
            phone: true,
          },
        },
        product: {
          select: {
            id: true,
            title: true,
            category: true,
            pricingSection: true,
          },
        },
        yearPlan: true,
        payments: {
          where: {
            status: PaymentStatus.SUCCESS,
            paidAt: { not: null },
          },
          select: {
            id: true,
            amount: true,
            paidAt: true,
          },
          orderBy: { paidAt: 'asc' },
        },
      },
    });

    const debtRecords: any[] = [];

    for (const purchase of purchases) {
      if (!purchase.yearPlan || !purchase.product.pricingSection) {
        continue;
      }

      try {
        // Calculate monthly installment
        const totalMonths = purchase.yearPlan.months;
        const monthlyInstallment = Number(purchase.totalAmount) / totalMonths;

        // Determine purchase start month
        const purchaseDate = new Date(purchase.createdAt);
        const purchaseMonth = new Date(
          purchaseDate.getFullYear(),
          purchaseDate.getMonth(),
          1,
        );
        purchaseMonth.setHours(0, 0, 0, 0);

        // Calculate which month number we're checking (0-indexed from purchase start)
        const monthsDiff =
          (currentMonth.getFullYear() - purchaseMonth.getFullYear()) * 12 +
          (currentMonth.getMonth() - purchaseMonth.getMonth());
        
        // Current month number (0 = first month, 1 = second month, etc.)
        const currentMonthNumber = Math.max(0, monthsDiff);

        // Get all successful payments (already filtered by Prisma query)
        const successfulPayments = purchase.payments;

        // Track which months are covered by payments
        const paidAmountTracker = Number(purchase.paidAmount);
        let monthsCovered = 0;

        // Calculate how many months are covered based on total paid amount
        // Each month costs monthlyInstallment
        monthsCovered = Math.floor(paidAmountTracker / monthlyInstallment);

        // Check if current month is covered
        // If monthsCovered > currentMonthNumber, current month is paid
        const isCurrentMonthPaid = monthsCovered > currentMonthNumber;

        // Calculate months behind (negative means ahead, 0 means current, positive means behind)
        const monthsBehind = currentMonthNumber - monthsCovered;
        const isThreeMonthsLapsed = monthsBehind >= 3;

        // Calculate amount owed for current month (0 if paid ahead or current)
        const amountPaidInCurrentMonth = paidAmountTracker % monthlyInstallment;
        const amountOwedForCurrentMonth = isCurrentMonthPaid
          ? 0
          : monthlyInstallment - amountPaidInCurrentMonth;

        // Include ALL members, not just those who owe this month
        debtRecords.push({
          purchaseId: purchase.id,
          member: {
            id: purchase.member.id,
            firstName: purchase.member.firstName,
            lastName: purchase.member.lastName,
            phone: purchase.member.phone,
          },
          product: {
            id: purchase.product.id,
            title: purchase.product.title,
            category: purchase.product.category,
          },
          yearPlan: {
            id: purchase.yearPlan.id,
            name: purchase.yearPlan.name,
            months: purchase.yearPlan.months,
          },
          totalAmount: Number(purchase.totalAmount),
          paidAmount: Number(purchase.paidAmount),
          balance: Number(purchase.balance),
          monthlyInstallment: Math.round(monthlyInstallment * 100) / 100,
          amountOwedThisMonth:
            Math.round(amountOwedForCurrentMonth * 100) / 100,
          monthsCovered,
          currentMonthNumber,
          monthsBehind,
          isThreeMonthsLapsed,
          purchaseDate: purchase.createdAt.toISOString(),
          lastPaymentDate:
            successfulPayments.length > 0
              ? (successfulPayments[successfulPayments.length - 1].paidAt as Date).toISOString()
              : null,
        });
      } catch (error) {
        console.error(
          `Error calculating debt for purchase ${purchase.id}:`,
          error,
        );
        continue;
      }
    }

    // Sort by amount owed (descending) - highest debts first
    debtRecords.sort((a, b) => b.amountOwedThisMonth - a.amountOwedThisMonth);

    return debtRecords;
  }

  /* =====================================================
   * GET MEMBER FINANCIAL STATEMENT
   * Returns a complete financial statement for a member
   * including all purchases and payments
   * ===================================================== */
  async getMemberFinancialStatement(memberId: string) {
    // Get member info
    const member = await this.prisma.member.findUnique({
      where: { id: memberId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        country: true,
        city: true,
        address: true,
        nationalId: true,
        dateOfBirth: true,
        createdAt: true,
      },
    });

    if (!member) {
      throw new NotFoundException('Member not found');
    }

    // Get all purchases for this member
    const purchases = await this.prisma.purchase.findMany({
      where: { memberId },
      include: {
        product: {
          select: {
            id: true,
            title: true,
            category: true,
            pricingSection: true,
            amount: true,
            currency: true,
          },
        },
        payments: {
          where: {
            status: PaymentStatus.SUCCESS,
            method: {
              not: 'LEGACY_SETTLEMENT', // Exclude legacy settlements from financial statement
            },
          },
          orderBy: { paidAt: 'asc' },
          select: {
            id: true,
            amount: true,
            currency: true,
            method: true,
            reference: true,
            paidAt: true,
            createdAt: true,
          },
        },
        yearPlan: {
          select: {
            id: true,
            name: true,
            months: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Calculate totals
    let totalPurchases = 0;
    let totalPaid = 0;
    let totalBalance = 0;

    const purchaseStatements = purchases.map((purchase) => {
      const totalAmount = Number(purchase.totalAmount);
      const paidAmount = Number(purchase.paidAmount);
      const balance = Number(purchase.balance);

      totalPurchases += totalAmount;
      totalPaid += paidAmount;
      totalBalance += balance;

      // Create transaction entries for this purchase
      const transactions: any[] = [];

      // Add purchase entry (debit)
      transactions.push({
        type: 'PURCHASE',
        description: `Purchase: ${purchase.product.title}`,
        date: purchase.createdAt,
        debit: totalAmount,
        credit: 0,
        reference: purchase.id,
        purchaseId: purchase.id,
      });

      // Add payment entries (credits)
      purchase.payments.forEach((payment) => {
        transactions.push({
          type: 'PAYMENT',
          description: `Payment - ${payment.method}`,
          date: payment.paidAt || payment.createdAt,
          debit: 0,
          credit: Number(payment.amount),
          reference: payment.reference,
          purchaseId: purchase.id,
          paymentId: payment.id,
        });
      });

      return {
        purchaseId: purchase.id,
        product: {
          title: purchase.product.title,
          category: purchase.product.category,
          pricingSection: purchase.product.pricingSection,
        },
        purchaseType: purchase.purchaseType,
        purchaseDate: purchase.createdAt,
        totalAmount,
        paidAmount,
        balance,
        status: purchase.status,
        paidAt: purchase.paidAt,
        yearPlan: purchase.yearPlan,
        transactions,
      };
    });

    // Sort all transactions chronologically
    const allTransactions = purchaseStatements
      .flatMap((ps) => ps.transactions)
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    // Calculate running balance
    let runningBalance = 0;
    const transactionsWithBalance = allTransactions.map((txn) => {
      runningBalance += txn.debit - txn.credit;
      return {
        ...txn,
        balance: runningBalance,
      };
    });

    return {
      member: {
        ...member,
        dateOfBirth: member.dateOfBirth.toISOString(),
        createdAt: member.createdAt.toISOString(),
      },
      statementDate: new Date().toISOString(),
      summary: {
        totalPurchases,
        totalPaid,
        totalBalance,
        totalTransactions: allTransactions.length,
        totalPurchasesCount: purchases.length,
      },
      purchases: purchaseStatements,
      transactions: transactionsWithBalance,
    };
  }

  /* =====================================================
   * GET MONTHLY INCOME STATEMENT
   * Returns a complete income statement for a specific month
   * including revenue, expenses (commissions), and net income
   * ===================================================== */
  async getMonthlyIncomeStatement(year: number, month: number) {
    // Validate month (1-12)
    if (month < 1 || month > 12) {
      throw new BadRequestException('Month must be between 1 and 12');
    }

    // Calculate start and end of the month
    const startOfMonth = new Date(year, month - 1, 1);
    startOfMonth.setHours(0, 0, 0, 0);
    
    const endOfMonth = new Date(year, month, 0);
    endOfMonth.setHours(23, 59, 59, 999);

    // Get all successful payments for the month (exclude legacy settlements and payments from cancelled purchases)
    const payments = await this.prisma.payment.findMany({
      where: {
        status: PaymentStatus.SUCCESS,
        method: {
          not: 'LEGACY_SETTLEMENT',
        },
        paidAt: {
          gte: startOfMonth,
          lte: endOfMonth,
        },
        purchase: {
          status: {
            not: PurchaseStatus.CANCELLED,
          },
        },
      },
      include: {
        purchase: {
          include: {
            product: {
              select: {
                title: true,
                category: true,
                pricingSection: true,
              },
            },
          },
        },
      },
      orderBy: { paidAt: 'asc' },
    });

    // Calculate total revenue
    const totalRevenue = payments.reduce((sum, p) => sum + Number(p.amount), 0);

    // Breakdown by payment method
    const revenueByMethod = payments.reduce((acc, p) => {
      const method = p.method || 'UNKNOWN';
      if (!acc[method]) {
        acc[method] = { method, amount: 0, count: 0 };
      }
      acc[method].amount += Number(p.amount);
      acc[method].count += 1;
      return acc;
    }, {} as Record<string, { method: string; amount: number; count: number }>);

    // Breakdown by product category
    const revenueByCategory = payments.reduce((acc, p) => {
      const category = p.purchase.product.category;
      if (!acc[category]) {
        acc[category] = { category, amount: 0, count: 0 };
      }
      acc[category].amount += Number(p.amount);
      acc[category].count += 1;
      return acc;
    }, {} as Record<string, { category: string; amount: number; count: number }>);

    // Breakdown by purchase type
    const revenueByPurchaseType = payments.reduce((acc, p) => {
      const purchaseType = p.purchase.purchaseType;
      if (!acc[purchaseType]) {
        acc[purchaseType] = { purchaseType, amount: 0, count: 0 };
      }
      acc[purchaseType].amount += Number(p.amount);
      acc[purchaseType].count += 1;
      return acc;
    }, {} as Record<string, { purchaseType: string; amount: number; count: number }>);

    // Get commissions issued for the month (these are expenses)
    const commissions = await this.prisma.commission.findMany({
      where: {
        status: CommissionStatus.ISSUED,
        approvedAt: {
          gte: startOfMonth,
          lte: endOfMonth,
        },
      },
      include: {
        purchase: {
          include: {
            product: {
              select: {
                title: true,
                category: true,
              },
            },
          },
        },
      },
      orderBy: { approvedAt: 'asc' },
    });

    // Calculate total commissions (expenses)
    const totalCommissions = commissions.reduce(
      (sum, c) => sum + Number(c.commissionAmount),
      0,
    );

    // Breakdown commissions by agent/company
    const commissionsByAgent = commissions.reduce((acc, c) => {
      const key = c.company || 'UNKNOWN';
      if (!acc[key]) {
        acc[key] = { company: key, amount: 0, count: 0 };
      }
      acc[key].amount += Number(c.commissionAmount);
      acc[key].count += 1;
      return acc;
    }, {} as Record<string, { company: string; amount: number; count: number }>);

    // Calculate net income
    const netIncome = totalRevenue - totalCommissions;

    return {
      period: {
        year,
        month,
        monthName: new Date(year, month - 1, 1).toLocaleDateString('en-US', {
          month: 'long',
          year: 'numeric',
        }),
        startDate: startOfMonth.toISOString(),
        endDate: endOfMonth.toISOString(),
      },
      revenue: {
        total: totalRevenue,
        transactionCount: payments.length,
        byMethod: Object.values(revenueByMethod),
        byCategory: Object.values(revenueByCategory),
        byPurchaseType: Object.values(revenueByPurchaseType),
      },
      expenses: {
        total: totalCommissions,
        transactionCount: commissions.length,
        commissions: {
          total: totalCommissions,
          byAgent: Object.values(commissionsByAgent),
        },
      },
      netIncome,
      generatedAt: new Date().toISOString(),
    };
  }

  /* =====================================================
   * GET SALES ANALYTICS
   * Returns comprehensive sales analytics including summary metrics,
   * section breakdowns, and graves sold information
   * ===================================================== */
  async getSalesAnalytics(dateRange?: { from: Date; to: Date }) {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfWeek = new Date(now);
    const dayOfWeek = now.getDay();
    const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    startOfWeek.setDate(now.getDate() - daysFromMonday);
    startOfWeek.setHours(0, 0, 0, 0);
    
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    startOfMonth.setHours(0, 0, 0, 0);

    // Helper function to get sales metrics for a date range
    const getSalesMetrics = async (start: Date, end: Date) => {
      const [sales, gravesSold] = await Promise.all([
        this.prisma.purchase.aggregate({
          where: {
            status: PurchaseStatus.PAID,
            purchaseType: {
              in: [PurchaseType.IMMEDIATE, PurchaseType.FUTURE],
            },
            paidAt: {
              gte: start,
              lte: end,
            },
            NOT: {
              status: PurchaseStatus.CANCELLED,
            },
          },
          _sum: {
            totalAmount: true,
          },
          _count: {
            id: true,
          },
        }),
        // Count purchases with status PAID for SERENITY_GROUND products (graves)
        // A grave is deemed sold when fully paid, not when assigned
        // paidAt date is required - must be set when marking purchase as PAID
        this.prisma.purchase.count({
          where: {
            status: PurchaseStatus.PAID,
            purchaseType: {
              in: [PurchaseType.IMMEDIATE, PurchaseType.FUTURE],
            },
            paidAt: {
              gte: start,
              lte: end,
            },
            product: {
              category: 'SERENITY_GROUND',
            },
            NOT: {
              status: PurchaseStatus.CANCELLED,
            },
          },
        }),
      ]);

      return {
        amount: Number(sales._sum.totalAmount || 0),
        count: sales._count.id || 0,
        gravesSold: gravesSold,
      };
    };

    // Get metrics for different periods
    const [today, thisWeek, thisMonth, customRange] = await Promise.all([
      getSalesMetrics(startOfToday, now),
      getSalesMetrics(startOfWeek, now),
      getSalesMetrics(startOfMonth, now),
      dateRange ? getSalesMetrics(dateRange.from, dateRange.to) : Promise.resolve(null),
    ]);

    // Get section breakdown for the selected period (or this month if no range)
    const sectionBreakdownStart = dateRange ? dateRange.from : startOfMonth;
    const sectionBreakdownEnd = dateRange ? dateRange.to : now;

    const purchasesForBreakdown = await this.prisma.purchase.findMany({
      where: {
        status: PurchaseStatus.PAID,
        purchaseType: {
          in: [PurchaseType.IMMEDIATE, PurchaseType.FUTURE],
        },
        paidAt: {
          gte: sectionBreakdownStart,
          lte: sectionBreakdownEnd,
        },
        NOT: {
          status: PurchaseStatus.CANCELLED,
        },
        product: {
          pricingSection: { not: null },
          category: 'SERENITY_GROUND',
        },
      },
      include: {
        product: {
          select: {
            pricingSection: true,
            title: true,
          },
        },
      },
    });

    // Group by section
    const sectionBreakdown = purchasesForBreakdown.reduce((acc, purchase) => {
      const section = purchase.product.pricingSection || 'UNKNOWN';
      if (!acc[section]) {
        acc[section] = { section, revenue: 0, count: 0 };
      }
      acc[section].revenue += Number(purchase.totalAmount);
      acc[section].count += 1;
      return acc;
    }, {} as Record<string, { section: string; revenue: number; count: number }>);

    // Get recent sales (last 10)
    const recentSales = await this.prisma.purchase.findMany({
      where: {
        status: PurchaseStatus.PAID,
        purchaseType: {
          in: [PurchaseType.IMMEDIATE, PurchaseType.FUTURE],
        },
        NOT: {
          status: PurchaseStatus.CANCELLED,
        },
      },
      include: {
        member: {
          select: {
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
          },
        },
        product: {
          select: {
            title: true,
            pricingSection: true,
          },
        },
        graveSlot: {
          select: {
            grave: {
              select: {
                graveNumber: true,
                section: true,
              },
            },
            slotNo: true,
          },
        },
      },
      orderBy: { paidAt: 'desc' },
      take: 10,
    });

    // Get graves sold details for the selected period
    const gravesSoldStart = dateRange ? dateRange.from : startOfMonth;
    const gravesSoldEnd = dateRange ? dateRange.to : now;

    const gravesSold = await this.prisma.graveSlot.findMany({
      where: {
        purchaseId: { not: null },
        createdAt: {
          gte: gravesSoldStart,
          lte: gravesSoldEnd,
        },
      },
      include: {
        grave: true,
        purchase: {
          include: {
            member: {
              select: {
                firstName: true,
                lastName: true,
                email: true,
                phone: true,
              },
            },
            product: {
              select: {
                title: true,
                pricingSection: true,
              },
            },
          },
        },
        deceased: {
          select: {
            fullName: true,
            dateOfDeath: true,
            burialDate: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 50, // Limit to recent 50 graves sold
    });

    // Calculate KPIs for the selected period (or this month if no range)
    const kpiPeriodStart = dateRange ? dateRange.from : startOfMonth;
    const kpiPeriodEnd = dateRange ? dateRange.to : now;
    const kpiMetrics = dateRange && customRange ? customRange : thisMonth;
    
    // Calculate simple KPIs
    const averageSaleValue = kpiMetrics && kpiMetrics.count > 0 
      ? kpiMetrics.amount / kpiMetrics.count 
      : 0;
    
    // Calculate previous period for growth comparison
    let previousPeriod: { revenue: number; count: number; gravesSold: number; period: string } | null = null;
    let revenueGrowth = 0;
    let salesCountGrowth = 0;
    let gravesSoldGrowth = 0;
    
    if (dateRange) {
      // Custom range: calculate same length period before
      const periodLength = dateRange.to.getTime() - dateRange.from.getTime();
      const previousStart = new Date(dateRange.from.getTime() - periodLength);
      const previousEnd = dateRange.from;
      const previousMetrics = await getSalesMetrics(previousStart, previousEnd);
      
      previousPeriod = {
        revenue: previousMetrics.amount,
        count: previousMetrics.count,
        gravesSold: previousMetrics.gravesSold,
        period: `${previousStart.toLocaleDateString()} - ${previousEnd.toLocaleDateString()}`,
      };
      
      // Calculate growth percentages
      if (previousMetrics.amount > 0) {
        revenueGrowth = ((kpiMetrics.amount - previousMetrics.amount) / previousMetrics.amount) * 100;
      } else if (kpiMetrics.amount > 0) {
        revenueGrowth = 100; // Infinite growth from zero
      }
      
      if (previousMetrics.count > 0) {
        salesCountGrowth = ((kpiMetrics.count - previousMetrics.count) / previousMetrics.count) * 100;
      } else if (kpiMetrics.count > 0) {
        salesCountGrowth = 100;
      }
      
      if (previousMetrics.gravesSold > 0) {
        gravesSoldGrowth = ((kpiMetrics.gravesSold - previousMetrics.gravesSold) / previousMetrics.gravesSold) * 100;
      } else if (kpiMetrics.gravesSold > 0) {
        gravesSoldGrowth = 100;
      }
    } else {
      // Compare this month to last month
      const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      lastMonthStart.setHours(0, 0, 0, 0);
      const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
      const lastMonthMetrics = await getSalesMetrics(lastMonthStart, lastMonthEnd);
      
      previousPeriod = {
        revenue: lastMonthMetrics.amount,
        count: lastMonthMetrics.count,
        gravesSold: lastMonthMetrics.gravesSold,
        period: 'Last Month',
      };
      
      if (lastMonthMetrics.amount > 0) {
        revenueGrowth = ((thisMonth.amount - lastMonthMetrics.amount) / lastMonthMetrics.amount) * 100;
      } else if (thisMonth.amount > 0) {
        revenueGrowth = 100;
      }
      
      if (lastMonthMetrics.count > 0) {
        salesCountGrowth = ((thisMonth.count - lastMonthMetrics.count) / lastMonthMetrics.count) * 100;
      } else if (thisMonth.count > 0) {
        salesCountGrowth = 100;
      }
      
      if (lastMonthMetrics.gravesSold > 0) {
        gravesSoldGrowth = ((thisMonth.gravesSold - lastMonthMetrics.gravesSold) / lastMonthMetrics.gravesSold) * 100;
      } else if (thisMonth.gravesSold > 0) {
        gravesSoldGrowth = 100;
      }
    }
    
    // Get sales by type (IMMEDIATE vs FUTURE) for the selected period
    const salesByTypeStart = dateRange ? dateRange.from : startOfMonth;
    const salesByTypeEnd = dateRange ? dateRange.to : now;
    
    const [immediateSales, futureSales] = await Promise.all([
      this.prisma.purchase.aggregate({
        where: {
          status: PurchaseStatus.PAID,
          purchaseType: PurchaseType.IMMEDIATE,
          paidAt: {
            gte: salesByTypeStart,
            lte: salesByTypeEnd,
          },
          NOT: {
            status: PurchaseStatus.CANCELLED,
          },
        },
        _sum: { totalAmount: true },
        _count: { id: true },
      }),
      this.prisma.purchase.aggregate({
        where: {
          status: PurchaseStatus.PAID,
          purchaseType: PurchaseType.FUTURE,
          paidAt: {
            gte: salesByTypeStart,
            lte: salesByTypeEnd,
          },
          NOT: {
            status: PurchaseStatus.CANCELLED,
          },
        },
        _sum: { totalAmount: true },
        _count: { id: true },
      }),
    ]);
    
    const immediateRevenue = Number(immediateSales._sum.totalAmount || 0);
    const futureRevenue = Number(futureSales._sum.totalAmount || 0);
    const totalTypeRevenue = immediateRevenue + futureRevenue;
    const immediateCount = immediateSales._count.id || 0;
    const futureCount = futureSales._count.id || 0;
    const totalTypeCount = immediateCount + futureCount;
    
    // Get sales by period (daily, weekly, monthly) for the selected range
    const periodStart = dateRange ? dateRange.from : startOfMonth;
    const periodEnd = dateRange ? dateRange.to : now;
    
    // Daily breakdown - optimized: fetch all sales and group by date
    const allPeriodSales = await this.prisma.purchase.findMany({
      where: {
        status: PurchaseStatus.PAID,
        purchaseType: { in: [PurchaseType.IMMEDIATE, PurchaseType.FUTURE] },
        paidAt: { gte: periodStart, lte: periodEnd },
        NOT: { status: PurchaseStatus.CANCELLED },
      },
      select: {
        totalAmount: true,
        paidAt: true,
      },
    });
    
    const allPeriodGraves = await this.prisma.graveSlot.findMany({
      where: {
        purchaseId: { not: null },
        createdAt: { gte: periodStart, lte: periodEnd },
      },
      select: {
        createdAt: true,
      },
    });
    
    // Group by date
    const dailyMap = new Map<string, { sales: number; revenue: number; gravesSold: number }>();
    
    // Initialize all dates in range
    const currentDate = new Date(periodStart);
    while (currentDate <= periodEnd) {
      const dateKey = currentDate.toISOString().split('T')[0];
      dailyMap.set(dateKey, { sales: 0, revenue: 0, gravesSold: 0 });
      currentDate.setDate(currentDate.getDate() + 1);
    }
    
    // Aggregate sales by date
    allPeriodSales.forEach((sale) => {
      if (sale.paidAt) {
        const dateKey = new Date(sale.paidAt).toISOString().split('T')[0];
        const day = dailyMap.get(dateKey);
        if (day) {
          day.sales += 1;
          day.revenue += Number(sale.totalAmount);
        }
      }
    });
    
    // Aggregate graves by date
    allPeriodGraves.forEach((grave) => {
      const dateKey = new Date(grave.createdAt).toISOString().split('T')[0];
      const day = dailyMap.get(dateKey);
      if (day) {
        day.gravesSold += 1;
      }
    });
    
    // Convert to array and sort
    const dailySales = Array.from(dailyMap.entries())
      .map(([date, data]) => ({ date, ...data }))
      .sort((a, b) => a.date.localeCompare(b.date));
    
    // Weekly breakdown (group daily sales by week)
    const weeklySales: Array<{ week: string; sales: number; revenue: number; gravesSold: number }> = [];
    const weeklyMap = new Map<string, { sales: number; revenue: number; gravesSold: number }>();
    
    dailySales.forEach((day) => {
      const date = new Date(day.date);
      const weekStart = new Date(date);
      const dayOfWeek = date.getDay();
      const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
      weekStart.setDate(date.getDate() - daysFromMonday);
      const weekKey = `Week of ${weekStart.toLocaleDateString()}`;
      
      if (!weeklyMap.has(weekKey)) {
        weeklyMap.set(weekKey, { sales: 0, revenue: 0, gravesSold: 0 });
      }
      
      const week = weeklyMap.get(weekKey)!;
      week.sales += day.sales;
      week.revenue += day.revenue;
      week.gravesSold += day.gravesSold;
    });
    
    weeklyMap.forEach((data, week) => {
      weeklySales.push({ week, ...data });
    });
    weeklySales.sort((a, b) => a.week.localeCompare(b.week));
    
    // Monthly breakdown (group by month)
    const monthlySales: Array<{ month: string; sales: number; revenue: number; gravesSold: number }> = [];
    const monthlyMap = new Map<string, { sales: number; revenue: number; gravesSold: number }>();
    
    dailySales.forEach((day) => {
      const date = new Date(day.date);
      const monthKey = date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
      
      if (!monthlyMap.has(monthKey)) {
        monthlyMap.set(monthKey, { sales: 0, revenue: 0, gravesSold: 0 });
      }
      
      const month = monthlyMap.get(monthKey)!;
      month.sales += day.sales;
      month.revenue += day.revenue;
      month.gravesSold += day.gravesSold;
    });
    
    monthlyMap.forEach((data, month) => {
      monthlySales.push({ month, ...data });
    });
    monthlySales.sort((a, b) => new Date(a.month).getTime() - new Date(b.month).getTime());

    return {
      summary: {
        today,
        thisWeek,
        thisMonth,
        ...(customRange && { customRange }),
      },
      // NEW: Simple KPIs
      kpis: {
        averageSaleValue,
        totalSales: kpiMetrics?.count || 0,
        totalRevenue: kpiMetrics?.amount || 0,
      },
      // NEW: Growth Analytics
      growth: {
        revenueGrowth: Math.round(revenueGrowth * 100) / 100,
        salesCountGrowth: Math.round(salesCountGrowth * 100) / 100,
        gravesSoldGrowth: Math.round(gravesSoldGrowth * 100) / 100,
        previousPeriod: previousPeriod || {
          revenue: 0,
          count: 0,
          gravesSold: 0,
          period: 'N/A',
        },
      },
      // NEW: Sales by Period
      salesByPeriod: {
        daily: dailySales,
        weekly: weeklySales,
        monthly: monthlySales,
      },
      // NEW: Sales by Type
      salesByType: {
        immediate: {
          count: immediateCount,
          revenue: immediateRevenue,
          percentage: totalTypeCount > 0 ? Math.round((immediateCount / totalTypeCount) * 100) : 0,
        },
        future: {
          count: futureCount,
          revenue: futureRevenue,
          percentage: totalTypeCount > 0 ? Math.round((futureCount / totalTypeCount) * 100) : 0,
        },
      },
      sectionBreakdown: Object.values(sectionBreakdown),
      recentSales: recentSales.map((p) => ({
        id: p.id,
        totalAmount: Number(p.totalAmount),
        paidAt: p.paidAt,
        createdAt: p.createdAt,
        member: {
          name: `${p.member.firstName} ${p.member.lastName}`,
          email: p.member.email,
          phone: p.member.phone,
        },
        product: {
          title: p.product.title,
          section: p.product.pricingSection,
        },
        grave: p.graveSlot?.[0]
          ? {
              graveNumber: p.graveSlot[0].grave.graveNumber,
              section: p.graveSlot[0].grave.section,
              slotNo: p.graveSlot[0].slotNo,
            }
          : null,
      })),
      gravesSold: gravesSold.map((slot) => ({
        id: slot.id,
        graveNumber: slot.grave.graveNumber,
        section: slot.grave.section,
        slotNo: slot.slotNo,
        purchaseId: slot.purchaseId,
        member: slot.purchase
          ? {
              name: `${slot.purchase.member.firstName} ${slot.purchase.member.lastName}`,
              email: slot.purchase.member.email,
              phone: slot.purchase.member.phone,
            }
          : null,
        product: slot.purchase?.product
          ? {
              title: slot.purchase.product.title,
              section: slot.purchase.product.pricingSection,
            }
          : null,
        amount: slot.priceAtPurchase ? Number(slot.priceAtPurchase) : slot.purchase ? Number(slot.purchase.totalAmount) : 0,
        soldDate: slot.createdAt,
        deceased: slot.deceased
          ? {
              fullName: slot.deceased.fullName,
              dateOfDeath: slot.deceased.dateOfDeath,
              burialDate: slot.deceased.burialDate,
            }
          : null,
      })),
    };
  }

  /* =====================================================
   * GET SALES LIST (PAGINATED)
   * Returns paginated list of sales with optional filters
   * ===================================================== */
  async getSalesList(params: {
    from?: Date;
    to?: Date;
    section?: string;
    page?: number;
    limit?: number;
  }) {
    const page = params.page || 1;
    const limit = params.limit || 50;
    const skip = (page - 1) * limit;

    const where: any = {
      status: PurchaseStatus.PAID,
      purchaseType: {
        in: [PurchaseType.IMMEDIATE, PurchaseType.FUTURE],
      },
      NOT: {
        status: PurchaseStatus.CANCELLED,
      },
    };

    if (params.from || params.to) {
      where.paidAt = {};
      if (params.from) {
        where.paidAt.gte = params.from;
      }
      if (params.to) {
        where.paidAt.lte = params.to;
      }
    }

    if (params.section) {
      where.product = {
        pricingSection: params.section,
      };
    }

    const [purchases, total] = await Promise.all([
      this.prisma.purchase.findMany({
        where,
        include: {
          member: {
            select: {
              firstName: true,
              lastName: true,
              email: true,
              phone: true,
            },
          },
          product: {
            select: {
              title: true,
              pricingSection: true,
              category: true,
            },
          },
          graveSlot: {
            select: {
              grave: {
                select: {
                  graveNumber: true,
                  section: true,
                },
              },
              slotNo: true,
            },
          },
          payments: {
            where: {
              status: PaymentStatus.SUCCESS,
            },
            select: {
              amount: true,
              method: true,
              paidAt: true,
            },
            orderBy: { paidAt: 'desc' },
            take: 1,
          },
        },
        orderBy: { paidAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.purchase.count({ where }),
    ]);

    return {
      sales: purchases.map((p) => ({
        id: p.id,
        totalAmount: Number(p.totalAmount),
        paidAmount: Number(p.paidAmount),
        paidAt: p.paidAt,
        createdAt: p.createdAt,
        member: {
          id: p.memberId,
          name: `${p.member.firstName} ${p.member.lastName}`,
          email: p.member.email,
          phone: p.member.phone,
        },
        product: {
          title: p.product.title,
          section: p.product.pricingSection,
          category: p.product.category,
        },
        grave: p.graveSlot?.[0]
          ? {
              graveNumber: p.graveSlot[0].grave.graveNumber,
              section: p.graveSlot[0].grave.section,
              slotNo: p.graveSlot[0].slotNo,
            }
          : null,
        lastPayment: p.payments[0]
          ? {
              amount: Number(p.payments[0].amount),
              method: p.payments[0].method,
              paidAt: p.payments[0].paidAt,
            }
          : null,
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
