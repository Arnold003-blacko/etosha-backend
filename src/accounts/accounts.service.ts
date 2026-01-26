import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentStatus, PurchaseStatus } from '@prisma/client';

export interface StatementEntry {
  date: Date;
  type: 'PURCHASE' | 'PAYMENT';
  description: string;
  reference: string;
  debit: number;
  credit: number;
  balance: number;
  purchaseId?: string;
  paymentId?: string;
  productTitle?: string;
  status?: string;
}

export interface FinancialStatement {
  member: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
  };
  statementPeriod: {
    from: Date;
    to: Date;
  };
  openingBalance: number;
  closingBalance: number;
  totalDebits: number;
  totalCredits: number;
  entries: StatementEntry[];
}

@Injectable()
export class AccountsService {
  constructor(private prisma: PrismaService) {}

  /**
   * Generate a financial statement for a member
   * Similar to a bank statement showing all transactions
   */
  async getFinancialStatement(
    memberId: string,
    startDate?: Date,
    endDate?: Date,
  ): Promise<FinancialStatement> {
    // Get member details
    const member = await this.prisma.member.findUnique({
      where: { id: memberId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
      },
    });

    if (!member) {
      throw new NotFoundException('Member not found');
    }

    // Set default date range (all time if not specified)
    const fromDate = startDate || new Date(0); // Beginning of time
    const toDate = endDate || new Date(); // Now

    // Get all purchases for this member
    const purchases = await this.prisma.purchase.findMany({
      where: {
        memberId,
        createdAt: {
          gte: fromDate,
          lte: toDate,
        },
      },
      include: {
        product: {
          select: {
            title: true,
            category: true,
            pricingSection: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    // Get all successful payments for this member
    const payments = await this.prisma.payment.findMany({
      where: {
        memberId,
        status: PaymentStatus.SUCCESS,
        paidAt: {
          gte: fromDate,
          lte: toDate,
        },
      },
      include: {
        purchase: {
          include: {
            product: {
              select: {
                title: true,
              },
            },
          },
        },
      },
      orderBy: { paidAt: 'asc' },
    });

    // Build statement entries
    const entries: StatementEntry[] = [];
    let runningBalance = 0;

    // Add purchase entries (debits)
    for (const purchase of purchases) {
      const purchaseDate = purchase.createdAt;
      const amount = Number(purchase.totalAmount);
      
      entries.push({
        date: purchaseDate,
        type: 'PURCHASE',
        description: `Purchase: ${purchase.product.title}${purchase.purchaseType === 'FUTURE' ? ' (Future Plan)' : ''}`,
        reference: purchase.id.substring(0, 8).toUpperCase(),
        debit: amount,
        credit: 0,
        balance: runningBalance + amount,
        purchaseId: purchase.id,
        productTitle: purchase.product.title,
        status: purchase.status,
      });

      runningBalance += amount;
    }

    // Add payment entries (credits)
    for (const payment of payments) {
      const paymentDate = payment.paidAt || payment.createdAt;
      const amount = Number(payment.amount);
      
      entries.push({
        date: paymentDate,
        type: 'PAYMENT',
        description: `Payment for: ${payment.purchase.product.title}`,
        reference: payment.reference,
        debit: 0,
        credit: amount,
        balance: runningBalance - amount,
        purchaseId: payment.purchaseId,
        paymentId: payment.id,
        productTitle: payment.purchase.product.title,
        status: payment.status,
      });

      runningBalance -= amount;
    }

    // Sort all entries by date (chronological order)
    entries.sort((a, b) => a.date.getTime() - b.date.getTime());

    // Recalculate running balance correctly after sorting
    let currentBalance = 0;
    const sortedEntries = entries.map((entry) => {
      if (entry.type === 'PURCHASE') {
        currentBalance += entry.debit;
      } else {
        currentBalance -= entry.credit;
      }
      return {
        ...entry,
        balance: currentBalance,
      };
    });

    // Calculate totals
    const totalDebits = sortedEntries.reduce((sum, e) => sum + e.debit, 0);
    const totalCredits = sortedEntries.reduce((sum, e) => sum + e.credit, 0);
    const openingBalance = 0; // Starting from zero for now
    const closingBalance = currentBalance;

    return {
      member,
      statementPeriod: {
        from: fromDate,
        to: toDate,
      },
      openingBalance,
      closingBalance,
      totalDebits,
      totalCredits,
      entries: sortedEntries,
    };
  }
}
