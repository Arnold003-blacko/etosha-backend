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
} from '@prisma/client';
import { PayNowService } from '../paynow/paynow.service';
import { DashboardGateway } from '../dashboard/dashboard.gateway';

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly paynow: PayNowService,
    @Inject(forwardRef(() => DashboardGateway))
    private readonly dashboardGateway: DashboardGateway,
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

    const amount = Number(dto.amount);
    if (!amount || amount <= 0)
      throw new BadRequestException('Invalid amount');
    if (amount > Number(purchase.balance))
      throw new BadRequestException('Amount exceeds balance');

    const now = new Date();
    const newBalance = Number(purchase.balance) - amount;

    await this.prisma.$transaction([
      this.prisma.payment.create({
        data: {
          purchaseId: purchase.id,
          memberId,
          amount,
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

    await this.prisma.payment.create({
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

    return { message: 'EcoCash push sent', reference };
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
  private async finalizePayment(
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
      where: { memberId },
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
