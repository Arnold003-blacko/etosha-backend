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
  constructor(private readonly prisma: PrismaService) {}

  /* =====================================================
   * GET DASHBOARD STATISTICS
   * ===================================================== */
  async getDashboardStats() {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    
    // Get all successful payments (exclude legacy settlements)
    const allPayments = await this.prisma.payment.aggregate({
      where: {
        status: PaymentStatus.SUCCESS,
        method: {
          not: 'LEGACY_SETTLEMENT',
        },
      },
      _sum: {
        amount: true,
      },
      _count: {
        id: true,
      },
    });

    // Get today's successful payments (exclude legacy settlements)
    const todayPayments = await this.prisma.payment.aggregate({
      where: {
        status: PaymentStatus.SUCCESS,
        method: {
          not: 'LEGACY_SETTLEMENT',
        },
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

    // Get burials scheduled for this week (based on burialDate or expectedBurial)
    // Calculate start and end of current week (Monday to Sunday)
    const dayOfWeek = now.getDay(); // 0 = Sunday, 1 = Monday, etc.
    const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1; // Convert to Monday-based
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - daysFromMonday);
    startOfWeek.setHours(0, 0, 0, 0);
    
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 6);
    endOfWeek.setHours(23, 59, 59, 999);

    // Match calendar logic: check both burialDate and expectedBurial, exclude PENDING_WAIVER_APPROVAL
    const burialsThisWeek = await this.prisma.deceased.count({
      where: {
        OR: [
          { burialDate: { gte: startOfWeek, lte: endOfWeek } },
          { expectedBurial: { gte: startOfWeek, lte: endOfWeek } },
        ],
        status: {
          not: BurialStatus.PENDING_WAIVER_APPROVAL, // Only show confirmed burials (match calendar logic)
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

    // Get recent successful payments (exclude legacy settlements)
    const recentPayments = await this.prisma.payment.findMany({
      where: {
        status: PaymentStatus.SUCCESS,
        method: {
          not: 'LEGACY_SETTLEMENT',
        },
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
    const purchases = await this.prisma.purchase.findMany({
      where: {
        balance: { gt: 0 },
        yearPlanId: { not: null },
        purchaseType: PurchaseType.FUTURE,
        status: {
          in: [PurchaseStatus.PENDING_PAYMENT, PurchaseStatus.PARTIALLY_PAID],
        },
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

    // Get all successful payments for the month (exclude legacy settlements)
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
}
