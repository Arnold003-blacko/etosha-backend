// src/reconciliation/reconciliation.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentsService } from '../payments/payments.service';
import { PaymentStatus } from '@prisma/client';

@Injectable()
export class ReconciliationService {
  private readonly logger = new Logger(ReconciliationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: PaymentsService,
  ) {}

  /**
   * 🔁 Reconcile stuck payments
   * Safe, idempotent, non-blocking
   */
  @Cron('*/10 * * * *') // every 10 minutes
  async reconcile() {
    try {
      const stuckPayments = await this.prisma.payment.findMany({
        where: {
          status: PaymentStatus.INITIATED,
          pollUrl: { not: null },
          createdAt: {
            lt: new Date(Date.now() - 2 * 60 * 1000),
          },
        },
        select: {
          id: true,
          memberId: true,
        },
      });

      if (stuckPayments.length === 0) return;

      for (const payment of stuckPayments) {
        try {
          // ✅ SINGLE SOURCE OF TRUTH
          await this.payments.pollPayNowPayment(
            payment.id,
            payment.memberId,
          );
        } catch (err) {
          this.logger.warn(
            `Failed to reconcile payment ${payment.id}`,
            err,
          );
        }
      }
    } catch (err) {
      this.logger.error('Reconciliation cycle failed', err);
    }
  }
}
