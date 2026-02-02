import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ForbiddenException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import PDFDocument from 'pdfkit';
import { Response } from 'express';

import { PrismaService } from '../prisma/prisma.service';
import { CreatePaymentDto } from './dto/create-payment.dto';
import {
  PaymentStatus,
  PurchaseStatus,
  PurchaseType,
  ItemCategory,
} from '@prisma/client';
import { PayNowService } from '../paynow/paynow.service';
import { DashboardGateway } from '../dashboard/dashboard.gateway';
import { TransactService } from '../transact/transact.service';

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly paynow: PayNowService,
    @Inject(forwardRef(() => DashboardGateway))
    private readonly dashboardGateway: DashboardGateway,
    @Inject(forwardRef(() => TransactService))
    private readonly transactService: TransactService,
  ) {}

  /* =====================================================
   * INTERNAL PAYMENT (NO PAYNOW)
   * ===================================================== */
  async createPayment(dto: CreatePaymentDto, memberId: string) {
    // 🔒 Guard: Validate UUID before database query
    if (!dto.purchaseId || typeof dto.purchaseId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(dto.purchaseId)) {
      throw new BadRequestException('Invalid Purchase ID: must be a valid UUID format');
    }
    
    const purchase = await this.prisma.purchase.findUnique({
      where: { id: dto.purchaseId },
    });

    if (!purchase)
      throw new NotFoundException('Purchase not found');
    if (purchase.memberId !== memberId)
      throw new ForbiddenException('Not your purchase');
    if (purchase.status === PurchaseStatus.PAID)
      throw new BadRequestException('Already paid');
    if (purchase.status === PurchaseStatus.CANCELLED)
      throw new BadRequestException('Purchase has been cancelled');

    const amount = Number(dto.amount);
    if (!amount || amount <= 0)
      throw new BadRequestException('Invalid amount');
    if (amount > Number(purchase.balance))
      throw new BadRequestException('Amount exceeds balance');

    const now = new Date();
    const newBalance = Number(purchase.balance) - amount;
    const method = dto.method ?? 'CASH';

    await this.prisma.$transaction([
      this.prisma.payment.create({
        data: {
          purchaseId: purchase.id,
          memberId,
          amount,
          method,
          reference: `LOCAL-${randomUUID()}`,
          status: PaymentStatus.SUCCESS,
          paidAt: now,
        },
      }),
      this.prisma.purchase.update({
        where: { id: purchase.id },
        data: {
          paidAmount: Number(purchase.paidAmount) + amount,
          balance: newBalance,
          status:
            newBalance <= 0
              ? PurchaseStatus.PAID
              : PurchaseStatus.PARTIALLY_PAID,
          paidAt: newBalance <= 0 ? now : null,
          completedAt: newBalance <= 0 ? now : null,
        },
      }),
    ]);

    // Emit real-time update
    this.dashboardGateway.broadcastDashboardUpdate();
  }

  /* =====================================================
   * PAYNOW WEB PAYMENT
   * ===================================================== */
  async initiatePayNowPayment(
    purchaseId: string,
    memberId: string,
    amount: number,
  ) {
    // 🔒 Guard: Validate UUID before database query
    if (!purchaseId || typeof purchaseId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(purchaseId)) {
      throw new BadRequestException('Invalid Purchase ID: must be a valid UUID format');
    }
    
    const purchase = await this.prisma.purchase.findUnique({
      where: { id: purchaseId },
    });

    if (!purchase)
      throw new NotFoundException('Purchase not found');
    if (purchase.memberId !== memberId)
      throw new ForbiddenException('Not your purchase');
    if (purchase.status === PurchaseStatus.PAID)
      throw new BadRequestException('Already paid');
    if (purchase.status === PurchaseStatus.CANCELLED)
      throw new BadRequestException('Purchase has been cancelled');

    const payable = Number(amount);
    if (!payable || payable <= 0)
      throw new BadRequestException('Invalid amount');
    if (payable > Number(purchase.balance))
      throw new BadRequestException('Amount exceeds balance');

    // Cancel any existing INITIATED payments for this purchase when starting a new payment
    await this.prisma.payment.updateMany({
      where: {
        purchaseId: purchase.id,
        status: PaymentStatus.INITIATED,
      },
      data: {
        status: PaymentStatus.EXPIRED,
      },
    });

    const reference = `ETOSHA-${randomUUID()}`;

    const paynow = await this.paynow.initiatePayment({
      reference,
      amount: payable,
    });

    await this.prisma.payment.create({
      data: {
        purchaseId: purchase.id,
        memberId,
        amount: payable,
        currency: 'USD',
        method: 'PAYNOW',
        reference,
        pollUrl: paynow.pollUrl,
        status: PaymentStatus.INITIATED,
      },
    });

    return {
      redirectUrl: paynow.redirectUrl,
      reference,
    };
  }

  /* =====================================================
   * PAYNOW ECOCASH PUSH
   * ===================================================== */
  async initiateEcoCashPush(
    purchaseId: string,
    memberId: string,
    phone: string,
    amount: number,
  ) {
    // 🔒 Guard: Validate UUID before database query
    if (!purchaseId || typeof purchaseId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(purchaseId)) {
      throw new BadRequestException('Invalid Purchase ID: must be a valid UUID format');
    }
    
    if (!/^07\d{8}$/.test(phone)) {
      throw new BadRequestException('Invalid EcoCash number');
    }

    const purchase = await this.prisma.purchase.findUnique({
      where: { id: purchaseId },
    });

    if (!purchase)
      throw new NotFoundException('Purchase not found');
    if (purchase.memberId !== memberId)
      throw new ForbiddenException('Not your purchase');
    if (purchase.status === PurchaseStatus.CANCELLED)
      throw new BadRequestException('Purchase has been cancelled');

    const payable = Number(amount);
    if (!payable || payable <= 0)
      throw new BadRequestException('Invalid amount');
    if (payable > Number(purchase.balance))
      throw new BadRequestException('Amount exceeds balance');
    
    // EcoCash has a maximum transaction limit of $500 USD
    const ECOCASH_MAX_AMOUNT = 500;
    if (payable > ECOCASH_MAX_AMOUNT) {
      throw new BadRequestException(
        `EcoCash payment limit is $${ECOCASH_MAX_AMOUNT} per transaction. Your amount of $${payable.toFixed(2)} exceeds this limit. You can pay $${ECOCASH_MAX_AMOUNT} now, then go to "My Plans" to complete the remaining payment.`
      );
    }

    // Cancel any existing INITIATED payments for this purchase when starting a new payment
    await this.prisma.payment.updateMany({
      where: {
        purchaseId: purchase.id,
        status: PaymentStatus.INITIATED,
      },
      data: {
        status: PaymentStatus.EXPIRED,
      },
    });

    const reference = `ETOSHA-${randomUUID()}`;

    const res = await this.paynow.initiateEcoCashPayment({
      reference,
      amount: payable,
      phone,
    });

    const payment = await this.prisma.payment.create({
      data: {
        purchaseId: purchase.id,
        memberId,
        amount: payable,
        currency: 'USD',
        method: 'PAYNOW_ECOCASH',
        reference,
        pollUrl: res.pollUrl,
        status: PaymentStatus.INITIATED,
      },
    });

    return { message: 'EcoCash push sent', reference, paymentId: payment.id };
  }

  /* =====================================================
   * 🔁 PAYNOW POLLING (MISSING METHOD — FIX)
   * ===================================================== */
  async pollPayNowPayment(
    paymentId: string,
    memberId: string,
  ) {
    // 🔒 Guard: Validate UUID before database query
    if (!paymentId || typeof paymentId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(paymentId)) {
      throw new BadRequestException('Invalid Payment ID: must be a valid UUID format');
    }
    
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
    });

    if (!payment)
      throw new NotFoundException('Payment not found');
    if (payment.memberId !== memberId)
      throw new ForbiddenException('Not your payment');

    // 🔒 Idempotency guard
    if (payment.status !== PaymentStatus.INITIATED) {
      return { status: payment.status };
    }

    if (!payment.pollUrl) {
      return { status: payment.status };
    }

    const result = await this.paynow.pollPayment(
      payment.pollUrl,
    );

    const mapped = this.mapPayNowStatus(result.status);

    await this.finalizePayment(payment.id, mapped);

    return { status: mapped };
  }

  /* =====================================================
   * PAYNOW WEBHOOK (FIXED)
   * ===================================================== */
  async processPayNowWebhook(payload: any) {
    const reference = payload.reference;
    const status = payload.status;

    if (!reference || !status) return;

    const payment = await this.prisma.payment.findUnique({
      where: { reference },
    });

    if (
      !payment ||
      payment.status !== PaymentStatus.INITIATED
    )
      return;

    const mapped = this.mapPayNowStatus(status);

    // ✅ amount comes from DB, not payload
    await this.finalizePayment(payment.id, mapped);
  }

  /* =====================================================
   * FINALIZE PAYMENT (PURCHASE UPDATE GUARANTEED)
   * ===================================================== */
  async finalizePayment(
    paymentId: string,
    status: PaymentStatus,
  ) {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
    });

    if (
      !payment ||
      payment.status !== PaymentStatus.INITIATED
    )
      return;

    if (status !== PaymentStatus.SUCCESS) {
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: { status },
      });
      return;
    }

    const purchase = await this.prisma.purchase.findUnique({
      where: { id: payment.purchaseId },
    });

    if (!purchase) return;

    // Don't process payment if purchase is cancelled
    if (purchase.status === PurchaseStatus.CANCELLED) {
      // Just mark payment as expired/failed
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: { status: PaymentStatus.EXPIRED },
      });
      return;
    }

    const paid = Number(payment.amount);
    const now = new Date();
    const newBalance = Number(purchase.balance) - paid;

    const autoRedeem =
      newBalance <= 0 &&
      purchase.purchaseType === PurchaseType.IMMEDIATE &&
      !purchase.redeemedAt;

    await this.prisma.$transaction([
      this.prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: PaymentStatus.SUCCESS,
          paidAt: now,
        },
      }),
      this.prisma.purchase.update({
        where: { id: purchase.id },
        data: {
          paidAmount: Number(purchase.paidAmount) + paid,
          balance: newBalance,
          status:
            newBalance <= 0
              ? PurchaseStatus.PAID
              : PurchaseStatus.PARTIALLY_PAID,
          paidAt: newBalance <= 0 ? now : null,
          completedAt: newBalance <= 0 ? now : null,
          redeemedAt: autoRedeem ? now : undefined,
          redeemedByMemberId: autoRedeem
            ? purchase.memberId
            : undefined,
        },
      }),
    ]);

    // Emit real-time update
    this.dashboardGateway.broadcastDashboardUpdate();

    // Process pending deceased/next of kin details if purchase is fully paid and is an immediate burial
    // This handles webhook payments (PayNow/EcoCash) that finalize through this method
    if (
      status === PaymentStatus.SUCCESS &&
      newBalance <= 0 &&
      purchase.purchaseType === PurchaseType.IMMEDIATE
    ) {
      // Get product to check category
      const product = await this.prisma.product.findUnique({
        where: { id: purchase.productId },
      });

      console.log(
        `[PAYMENTS] 🔍 Checking if should process pending details: purchaseId=${purchase.id}, purchaseType=${purchase.purchaseType}, newBalance=${newBalance}, productId=${purchase.productId}`,
      );

      if (product?.category === ItemCategory.SERENITY_GROUND && this.transactService) {
        console.log(
          `[PAYMENTS] ✅ Conditions met: Product category is SERENITY_GROUND, transactService available`,
        );
        // Process SYNCHRONOUSLY to ensure records are created immediately
        // This prevents orphan records and ensures data consistency
        try {
          console.log(
            `[PAYMENTS] 🚀 Processing pending deceased/next of kin details for purchase: ${purchase.id}`,
          );
          await this.transactService.processPendingDetailsForPurchase(
            purchase.id,
            purchase.memberId,
          );
          console.log(
            `[PAYMENTS] ✅ Successfully saved deceased and next of kin records for purchase: ${purchase.id}`,
          );
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : 'Unknown error';
          console.error(
            `[PAYMENTS] ❌ CRITICAL: Failed to process pending details after payment finalization for purchase ${purchase.id}:`,
            errorMessage,
          );
          console.error(`[PAYMENTS] Error details:`, err);
          
          // Log error but don't fail the payment - details can be added manually later
          // However, this is a critical issue that needs attention
          console.error(
            `[PAYMENTS] CRITICAL: Payment succeeded but deceased/next of kin records were NOT created for purchase ${purchase.id}. Error: ${errorMessage}`,
          );
        }
      } else {
        console.log(
          `[PAYMENTS] ⚠️ Conditions NOT met: productCategory=${product?.category}, transactService=${!!this.transactService}`,
        );
      }
    }
  }

  /* =====================================================
   * PAYNOW STATUS MAP
   * ===================================================== */
  private mapPayNowStatus(status: string): PaymentStatus {
    const s = status?.toLowerCase();

    if (
      s === 'paid' ||
      s === 'awaiting delivery' ||
      s === 'delivered'
    )
      return PaymentStatus.SUCCESS;

    if (s === 'failed' || s === 'cancelled')
      return PaymentStatus.FAILED;

    if (s === 'expired') return PaymentStatus.EXPIRED;

    return PaymentStatus.INITIATED;
  }

  /* =====================================================
   * GET MY PAYMENTS
   * ===================================================== */
  async getMyPayments(memberId: string) {
    return this.prisma.payment.findMany({
      where: {
        memberId,
        // Exclude payments from cancelled purchases - they are stale and should not be shown to customers
        purchase: {
          status: {
            not: PurchaseStatus.CANCELLED,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        amount: true,
        currency: true,
        method: true,
        status: true,
        reference: true,
        createdAt: true,
        purchaseId: true,
      },
    });
  }


  /* =====================================================
   * GENERATE RECEIPT PDF
   * ===================================================== */
  async generateReceiptPdf(
    paymentId: string,
    memberId: string,
    res: Response,
  ) {
    // 🔒 Guard: Validate UUID before database query
    if (!paymentId || typeof paymentId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(paymentId)) {
      throw new BadRequestException('Invalid Payment ID: must be a valid UUID format');
    }
    
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: { member: true },
    });

    if (!payment)
      throw new NotFoundException('Payment not found');

    if (payment.memberId !== memberId)
      throw new ForbiddenException('Access denied');

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename=Etosha_Receipt_${payment.reference}.pdf`,
    );

    const doc = new PDFDocument({
      margin: 50,
      size: 'A4',
    });

    doc.pipe(res);

    doc
      .fontSize(22)
      .text('Payment Receipt', { align: 'center' })
      .moveDown();

    doc
      .fontSize(30)
      .text(`USD ${Number(payment.amount).toFixed(2)}`, {
        align: 'center',
      });

    doc.end();
  }
}
