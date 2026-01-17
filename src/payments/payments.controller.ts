// payments/payments.controller.ts
import {
  Body,
  Controller,
  Post,
  Get,
  Req,
  UseGuards,
  BadRequestException,
  Headers,
  Param,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { PaymentsService } from './payments.service';
import { PayNowService } from '../paynow/paynow.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreatePaymentDto } from './dto/create-payment.dto';
import * as qs from 'querystring';

@Controller('payments')
export class PaymentsController {
  constructor(
    private readonly paymentsService: PaymentsService,
    private readonly paynowService: PayNowService,
  ) {}

  /* ============================
   * FLEXIBLE / INTERNAL PAYMENT
   * ============================ */
  @UseGuards(JwtAuthGuard)
  @Post()
  create(@Body() dto: CreatePaymentDto, @Req() req) {
    if (!dto.purchaseId || !dto.amount) {
      throw new BadRequestException(
        'purchaseId and amount are required',
      );
    }

    return this.paymentsService.createPayment(
      dto,
      req.user.id,
    );
  }

  /* ============================
   * PAYNOW REDIRECT PAYMENT
   * ============================ */
  @UseGuards(JwtAuthGuard)
  @Post('paynow/initiate')
  async initiatePayNow(
    @Body('purchaseId') purchaseId: string,
    @Body('amount') amount: number,
    @Req() req,
  ) {
    if (!purchaseId || !amount) {
      throw new BadRequestException(
        'purchaseId and amount are required',
      );
    }

    return this.paymentsService.initiatePayNowPayment(
      purchaseId,
      req.user.id,
      Number(amount),
    );
  }

  /* ============================
   * PAYNOW ECOCASH PUSH
   * ============================ */
  @UseGuards(JwtAuthGuard)
  @Post('paynow/ecocash')
  async initiateEcoCash(
    @Body('purchaseId') purchaseId: string,
    @Body('phone') phone: string,
    @Body('amount') amount: number,
    @Req() req,
  ) {
    if (!purchaseId || !phone || !amount) {
      throw new BadRequestException(
        'purchaseId, phone and amount are required',
      );
    }

    return this.paymentsService.initiateEcoCashPush(
      purchaseId,
      req.user.id,
      phone,
      Number(amount),
    );
  }

  /* ============================
   * 🔁 PAYNOW POLL (MISSING PIECE)
   * ============================
   * Called by frontend while user waits
   * Safe, idempotent, no new purchase created
   */
  @UseGuards(JwtAuthGuard)
  @Post('paynow/poll')
  async pollPayNow(
    @Body('paymentId') paymentId: string,
    @Req() req,
  ) {
    if (!paymentId) {
      throw new BadRequestException('paymentId is required');
    }

    return this.paymentsService.pollPayNowPayment(
      paymentId,
      req.user.id,
    );
  }

  /* ============================
   * GET MY PAYMENTS
   * ============================ */
  @UseGuards(JwtAuthGuard)
  @Get('my')
  getMyPayments(@Req() req) {
    return this.paymentsService.getMyPayments(
      req.user.id,
    );
  }


  /* ============================
   * DOWNLOAD PAYMENT RECEIPT (PDF)
   * ============================ */
  @UseGuards(JwtAuthGuard)
  @Get(':id/receipt')
  async downloadReceipt(
    @Param('id') id: string,
    @Req() req,
    @Res() res: Response,
  ) {
    return this.paymentsService.generateReceiptPdf(
      id,
      req.user.id,
      res,
    );
  }

  /* ============================
   * PAYNOW WEBHOOK (RESULT URL)
   * ============================
   * 🔓 No JWT
   * 📡 x-www-form-urlencoded
   * 🔐 Hash validated
   * ♻️ Idempotent
   */
  @Post('paynow/webhook')
  payNowWebhook(
    @Body() body: any,
    @Headers('content-type') contentType: string,
  ) {
    try {
      const raw =
        typeof body === 'string'
          ? body
          : qs.stringify(body);

      const parsed = qs.parse(raw);

      const isValid =
        this.paynowService.verifyWebhookHash(parsed);

      if (!isValid) {
        console.error(
          '❌ Invalid PayNow webhook hash',
          parsed,
        );
        return { status: 'ignored' };
      }

      setImmediate(() => {
        this.paymentsService
          .processPayNowWebhook(parsed)
          .catch((err) =>
            console.error(
              '⚠️ Webhook processing error:',
              err,
            ),
          );
      });

      return { status: 'ok' };
    } catch (error) {
      console.error(
        '⚠️ PayNow webhook error:',
        error,
      );
      return { status: 'received' };
    }
  }
}
