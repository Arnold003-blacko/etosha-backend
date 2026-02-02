import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import {
  PurchaseStatus,
  PaymentStatus,
} from '@prisma/client';
import { DashboardGateway } from '../dashboard/dashboard.gateway';

/**
 * UUID validation regex pattern
 */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validateUUID(id: string, fieldName: string = 'ID'): void {
  if (!id || typeof id !== 'string') {
    throw new BadRequestException(`Invalid ${fieldName}: must be a string`);
  }
  if (!UUID_REGEX.test(id)) {
    throw new BadRequestException(`Invalid ${fieldName}: must be a valid UUID format`);
  }
}

@Injectable()
export class CheckoutService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => DashboardGateway))
    private readonly dashboardGateway: DashboardGateway,
  ) {}

  /* =====================================================
   * CANCEL CHECKOUT SESSION
   * =====================================================
   * When a session closes, we:
   * 1. Cancel all INITIATED payments (set to EXPIRED)
   * 2. Cancel the purchase if it's PENDING_PAYMENT with no successful payments
   * This prevents orphaned records
   */
  async cancelCheckoutSession(
    purchaseId: string,
    memberId: string,
  ) {
    validateUUID(purchaseId, 'Purchase ID');

    const purchase = await this.prisma.purchase.findUnique({
      where: { id: purchaseId },
      include: {
        payments: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!purchase) {
      throw new NotFoundException('Purchase not found');
    }

    if (purchase.memberId !== memberId) {
      throw new ForbiddenException('Not your purchase');
    }

    // If purchase is already cancelled, paid, or partially paid, nothing to do
    if (
      purchase.status === PurchaseStatus.CANCELLED ||
      purchase.status === PurchaseStatus.PAID ||
      purchase.status === PurchaseStatus.PARTIALLY_PAID
    ) {
      return { message: 'Purchase already finalized', status: purchase.status };
    }

    // Check if there are any successful payments
    const hasSuccessfulPayment = purchase.payments.some(
      (p) => p.status === PaymentStatus.SUCCESS,
    );

    // Cancel all INITIATED payments
    const cancelledPayments = await this.prisma.payment.updateMany({
      where: {
        purchaseId: purchase.id,
        status: PaymentStatus.INITIATED,
      },
      data: {
        status: PaymentStatus.EXPIRED,
      },
    });

    // If purchase is PENDING_PAYMENT with no successful payments, cancel it
    // This prevents orphaned records
    if (
      purchase.status === PurchaseStatus.PENDING_PAYMENT &&
      !hasSuccessfulPayment
    ) {
      await this.prisma.purchase.update({
        where: { id: purchase.id },
        data: {
          status: PurchaseStatus.CANCELLED,
        },
      });

      // Emit real-time update
      this.dashboardGateway.broadcastDashboardUpdate();

      return {
        message: 'Checkout session cancelled',
        cancelledPayments: cancelledPayments.count,
        purchaseCancelled: true,
      };
    }

    // Emit real-time update
    this.dashboardGateway.broadcastDashboardUpdate();

    return {
      message: 'Pending payments cancelled',
      cancelledPayments: cancelledPayments.count,
      purchaseCancelled: false,
    };
  }

  /* =====================================================
   * CLEANUP STALE CHECKOUT SESSIONS
   * =====================================================
   * Runs every hour to clean up orphaned records:
   * - Purchases that are PENDING_PAYMENT with no successful payments
   *   and were created more than 24 hours ago
   * - Payments that are INITIATED and were created more than 24 hours ago
   * 
   * This prevents orphaned records from abandoned checkout sessions
   */
  @Cron(CronExpression.EVERY_HOUR)
  async cleanupStaleSessions() {
    const twentyFourHoursAgo = new Date();
    twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24);

    try {
      // Find purchases that are PENDING_PAYMENT, older than 24 hours,
      // and have no successful payments
      const stalePurchases = await this.prisma.purchase.findMany({
        where: {
          status: PurchaseStatus.PENDING_PAYMENT,
          createdAt: {
            lt: twentyFourHoursAgo,
          },
          payments: {
            none: {
              status: PaymentStatus.SUCCESS,
            },
          },
        },
        include: {
          payments: {
            where: {
              status: PaymentStatus.INITIATED,
            },
          },
        },
      });

      let cancelledPurchases = 0;
      let expiredPayments = 0;

      for (const purchase of stalePurchases) {
        // Cancel all INITIATED payments for this purchase
        const cancelled = await this.prisma.payment.updateMany({
          where: {
            purchaseId: purchase.id,
            status: PaymentStatus.INITIATED,
          },
          data: {
            status: PaymentStatus.EXPIRED,
          },
        });
        expiredPayments += cancelled.count;

        // Cancel the purchase
        await this.prisma.purchase.update({
          where: { id: purchase.id },
          data: {
            status: PurchaseStatus.CANCELLED,
          },
        });
        cancelledPurchases++;
      }

      // Also expire any standalone INITIATED payments older than 24 hours
      const expiredStandalone = await this.prisma.payment.updateMany({
        where: {
          status: PaymentStatus.INITIATED,
          createdAt: {
            lt: twentyFourHoursAgo,
          },
        },
        data: {
          status: PaymentStatus.EXPIRED,
        },
      });

      if (cancelledPurchases > 0 || expiredPayments > 0 || expiredStandalone.count > 0) {
        console.log(
          `[CHECKOUT CLEANUP] Cleaned up stale sessions: ${cancelledPurchases} purchases cancelled, ${expiredPayments + expiredStandalone.count} payments expired`,
        );
        
        // Emit real-time update
        this.dashboardGateway.broadcastDashboardUpdate();
      }
    } catch (error) {
      console.error('[CHECKOUT CLEANUP] Error cleaning up stale sessions:', error);
    }
  }
}
