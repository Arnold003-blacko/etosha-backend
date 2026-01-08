import {
  Injectable,
  InternalServerErrorException,
  BadRequestException,
} from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import * as crypto from 'crypto';
import * as qs from 'querystring';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentStatus, PurchaseStatus } from '@prisma/client';

@Injectable()
export class PayNowService {
  private readonly http: AxiosInstance;

  private readonly PAYNOW_WEB_ENDPOINT =
    'https://www.paynow.co.zw/interface/initiatetransaction';

  private readonly PAYNOW_MOBILE_ENDPOINT =
    'https://www.paynow.co.zw/interface/remotetransaction';

  private readonly integrationId = process.env.PAYNOW_INTEGRATION_ID;
  private readonly integrationKey = process.env.PAYNOW_INTEGRATION_KEY;
  private readonly returnUrl = process.env.PAYNOW_RETURN_URL;
  private readonly resultUrl = process.env.PAYNOW_RESULT_URL;
  private readonly authEmail = process.env.PAYNOW_AUTH_EMAIL;

  constructor(private readonly prisma: PrismaService) {
    if (
      !this.integrationId ||
      !this.integrationKey ||
      !this.returnUrl ||
      !this.resultUrl ||
      !this.authEmail
    ) {
      throw new Error('❌ PayNow environment variables are missing');
    }

    this.http = axios.create({
      timeout: 10000,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });
  }

  /* =====================================================
     HASH GENERATION
  ===================================================== */
  private generateHash(
    payload: Record<string, string>,
    fieldOrder: string[],
  ): string {
    let concat = '';

    for (const field of fieldOrder) {
      concat += String(payload[field] ?? '');
    }

    concat += this.integrationKey;

    return crypto
      .createHash('sha512')
      .update(concat, 'utf8')
      .digest('hex')
      .toUpperCase();
  }

  /* =====================================================
     PAYNOW WEB (REDIRECT)
  ===================================================== */
  async initiatePayment(params: {
    reference: string;
    amount: number;
  }) {
    const payload: Record<string, string> = {
      id: this.integrationId!,
      reference: params.reference,
      amount: params.amount.toFixed(2),
      additionalinfo: 'Etosha Cemetery Payment',
      returnurl: this.returnUrl!,
      resulturl: this.resultUrl!,
      status: 'Message',
      authemail: this.authEmail!,
    };

    const hashOrder = [
      'id',
      'reference',
      'amount',
      'additionalinfo',
      'returnurl',
      'resulturl',
      'status',
      'authemail',
    ];

    payload.hash = this.generateHash(payload, hashOrder);

    const response = await this.http.post(
      this.PAYNOW_WEB_ENDPOINT,
      qs.stringify(payload),
    );

    const parsed = qs.parse(response.data);

    if (parsed.status !== 'Ok' || !parsed.pollurl) {
      throw new InternalServerErrorException(
        'Invalid PayNow response',
      );
    }

    return {
      redirectUrl: parsed.browserurl as string,
      pollUrl: parsed.pollurl as string,
      reference: params.reference,
    };
  }

  /* =====================================================
     ECOCASH PUSH
  ===================================================== */
  async initiateEcoCashPayment(params: {
    reference: string;
    amount: number;
    phone: string;
  }) {
    const payload: Record<string, string> = {
      id: this.integrationId!,
      reference: params.reference,
      amount: params.amount.toFixed(2),
      additionalinfo: 'Etosha Cemetery Payment',
      returnurl: this.returnUrl!,
      resulturl: this.resultUrl!,
      status: 'Message',
      authemail: this.authEmail!,
      phone: params.phone,
      method: 'ecocash',
    };

    const hashOrder = [
      'id',
      'reference',
      'amount',
      'additionalinfo',
      'returnurl',
      'resulturl',
      'status',
      'authemail',
      'phone',
      'method',
    ];

    payload.hash = this.generateHash(payload, hashOrder);

    const response = await this.http.post(
      this.PAYNOW_MOBILE_ENDPOINT,
      qs.stringify(payload),
    );

    const parsed = qs.parse(response.data);

    if (parsed.status !== 'Ok' || !parsed.pollurl) {
      throw new InternalServerErrorException(
        'Invalid EcoCash response',
      );
    }

    return {
      pollUrl: parsed.pollurl as string,
      reference: params.reference,
    };
  }

  /* =====================================================
     ✅ READ-ONLY POLLING (FIX)
     This is what Reconciliation & Payments expect
  ===================================================== */
  async pollPayment(pollUrl: string): Promise<{
    status: 'PAID' | 'FAILED' | 'PENDING';
    reference?: string;
    amount?: number;
  }> {
    try {
      const response = await this.http.post(pollUrl);
      const parsed = qs.parse(response.data);
      const status = String(parsed.status || '').toLowerCase();

      if (
        status === 'paid' ||
        status === 'awaiting delivery' ||
        status === 'delivered'
      ) {
        return {
          status: 'PAID',
          reference: parsed.reference as string,
          amount: parsed.amount
            ? Number(parsed.amount)
            : undefined,
        };
      }

      if (
        status === 'failed' ||
        status === 'cancelled' ||
        status === 'expired'
      ) {
        return {
          status: 'FAILED',
          reference: parsed.reference as string,
        };
      }

      return {
        status: 'PENDING',
        reference: parsed.reference as string,
      };
    } catch (err) {
      return { status: 'PENDING' };
    }
  }

  /* =====================================================
     WEBHOOK HASH VERIFICATION
  ===================================================== */
  verifyWebhookHash(payload: Record<string, any>): boolean {
    if (!payload?.hash) return false;

    const fieldOrder = [
      'reference',
      'paynowreference',
      'amount',
      'status',
      'pollurl',
    ];

    let concat = '';
    for (const field of fieldOrder) {
      concat += String(payload[field] ?? '');
    }

    concat += this.integrationKey;

    const computedHash = crypto
      .createHash('sha512')
      .update(concat, 'utf8')
      .digest('hex')
      .toUpperCase();

    return computedHash === String(payload.hash).toUpperCase();
  }
}
