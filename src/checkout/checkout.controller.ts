import {
  Controller,
  Get,
  Param,
  Req,
  UseGuards,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import {
  PurchaseStatus,
  PurchaseType,
  PaymentStatus,
  ItemCategory,
} from '@prisma/client';

@Controller('checkout')
@UseGuards(JwtAuthGuard)
export class CheckoutController {
  constructor(private readonly prisma: PrismaService) {}

  @Get(':purchaseId')
  async getCheckout(
    @Param('purchaseId') purchaseId: string,
    @Req() req: any,
  ) {
    // ✅ OPTIMIZED: Single query with select to fetch only needed fields
    const [purchase, lastPayment] = await Promise.all([
      this.prisma.purchase.findUnique({
        where: { id: purchaseId },
        select: {
          id: true,
          memberId: true,
          status: true,
          redeemedAt: true,
          purchaseType: true,
          totalAmount: true,
          paidAmount: true,
          balance: true,
          product: {
            select: {
              id: true,
              title: true,
              category: true,
              currency: true,
            },
          },
          yearPlan: {
            select: {
              id: true,
              months: true,
            },
          },
        },
      }),
      this.prisma.payment.findFirst({
        where: { purchaseId },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          status: true,
        },
      }),
    ]);

    if (!purchase) {
      throw new NotFoundException('Purchase not found');
    }

    if (purchase.memberId !== req.user.id) {
      throw new ForbiddenException('Not your purchase');
    }

    const lastPaymentStatus =
      lastPayment?.status ?? PaymentStatus.INITIATED;

    /* =====================================================
       PAYMENT COMPLETION (CATEGORY-AWARE)
    ===================================================== */

    let isPaymentComplete = false;

    if (purchase.product.category === ItemCategory.SERENITY_GROUND) {
      isPaymentComplete =
        lastPaymentStatus === PaymentStatus.SUCCESS ||
        purchase.status === PurchaseStatus.PARTIALLY_PAID ||
        purchase.status === PurchaseStatus.PAID;
    }

    if (purchase.product.category === ItemCategory.SERVICE) {
      isPaymentComplete =
        purchase.status === PurchaseStatus.PAID;
    }

    /* =====================================================
       TERMINAL — CANCELLED
    ===================================================== */

    if (purchase.status === PurchaseStatus.CANCELLED) {
      return {
        purchaseId: purchase.id,
        itemCategory: purchase.product.category, // ✅ ADDED
        status: purchase.status,
        redeemedAt: purchase.redeemedAt,
        purchaseType: purchase.purchaseType,
        section: purchase.product.title,
        currency: purchase.product.currency,
        planMonths: purchase.yearPlan?.months ?? null,
        amountToPay: 0,
        totalAmount: Number(purchase.totalAmount),
        balance: Number(purchase.balance),
        lastPaymentStatus,
        lastPaymentId: lastPayment?.id ?? null,
        isPaymentComplete,
      };
    }

    /* =====================================================
       TERMINAL — PAID + REDEEMED
    ===================================================== */

    if (
      purchase.status === PurchaseStatus.PAID &&
      purchase.redeemedAt
    ) {
      return {
        purchaseId: purchase.id,
        itemCategory: purchase.product.category, // ✅ ADDED
        status: purchase.status,
        redeemedAt: purchase.redeemedAt,
        purchaseType: purchase.purchaseType,
        section: purchase.product.title,
        currency: purchase.product.currency,
        planMonths: purchase.yearPlan?.months ?? null,
        amountToPay: 0,
        totalAmount: Number(purchase.totalAmount),
        balance: Number(purchase.balance),
        lastPaymentStatus,
        lastPaymentId: lastPayment?.id ?? null,
        isPaymentComplete,
      };
    }

    /* =====================================================
       AMOUNT TO PAY
    ===================================================== */

    let amountToPay = Number(purchase.balance);

    if (
      purchase.purchaseType === PurchaseType.FUTURE &&
      purchase.yearPlan
    ) {
      const totalMonths = purchase.yearPlan.months;

      const paidRatio =
        Number(purchase.paidAmount) /
        Number(purchase.totalAmount || 1);

      const monthsPaid = Math.floor(
        paidRatio * totalMonths,
      );

      const remainingMonths = Math.max(
        totalMonths - monthsPaid,
        1,
      );

      amountToPay =
        Number(purchase.balance) / remainingMonths;
    }

    /* =====================================================
       ACTIVE / PAYABLE STATE
    ===================================================== */

    return {
      purchaseId: purchase.id,
      itemCategory: purchase.product.category, // ✅ ADDED
      status: purchase.status,
      redeemedAt: purchase.redeemedAt,
      purchaseType: purchase.purchaseType,
      section: purchase.product.title,
      currency: purchase.product.currency,
      planMonths: purchase.yearPlan?.months ?? null,
      amountToPay: Number(amountToPay.toFixed(2)),
      totalAmount: Number(purchase.totalAmount),
      balance: Number(purchase.balance),
      lastPaymentStatus,
      lastPaymentId: lastPayment?.id ?? null,
      isPaymentComplete,
    };
  }
}
