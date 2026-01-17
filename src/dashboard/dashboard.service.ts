import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  PaymentStatus,
  PurchaseStatus,
  PurchaseType,
} from '@prisma/client';

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
    };
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
}
