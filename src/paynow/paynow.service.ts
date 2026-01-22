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

  constructor(private readonly prisma: PrismaService) {
    this.http = axios.create({
      timeout: 10000,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });
  }

  /* =====================================================
     🔐 RUNTIME CONFIG
  ===================================================== */
  private getConfig() {
    const {
      PAYNOW_INTEGRATION_ID,
      PAYNOW_INTEGRATION_KEY,
      PAYNOW_RETURN_URL,
      PAYNOW_RESULT_URL,
      PAYNOW_AUTH_EMAIL,
    } = process.env;

    if (
      !PAYNOW_INTEGRATION_ID ||
      !PAYNOW_INTEGRATION_KEY ||
      !PAYNOW_RETURN_URL ||
      !PAYNOW_RESULT_URL ||
      !PAYNOW_AUTH_EMAIL
    ) {
      throw new Error('❌ PayNow environment variables are missing');
    }

    return {
      integrationId: PAYNOW_INTEGRATION_ID,
      integrationKey: PAYNOW_INTEGRATION_KEY,
      returnUrl: PAYNOW_RETURN_URL,
      resultUrl: PAYNOW_RESULT_URL,
      authEmail: PAYNOW_AUTH_EMAIL,
    };
  }

  /* =====================================================
     HASH GENERATION
  ===================================================== */
  private generateHash(
    payload: Record<string, string>,
    fieldOrder: string[],
    integrationKey: string,
  ): string {
    let concat = '';

    for (const field of fieldOrder) {
      concat += String(payload[field] ?? '');
    }

    concat += integrationKey;

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
    const {
      integrationId,
      integrationKey,
      returnUrl,
      resultUrl,
      authEmail,
    } = this.getConfig();

    const payload: Record<string, string> = {
      id: integrationId,
      reference: params.reference,
      amount: params.amount.toFixed(2),
      additionalinfo: 'Etosha Cemetery Payment',
      returnurl: returnUrl,
      resulturl: resultUrl,
      status: 'Message',
      // Omit authemail field entirely to prevent email auto-fill on PayNow website
    };

    const hashOrder = [
      'id',
      'reference',
      'amount',
      'additionalinfo',
      'returnurl',
      'resulturl',
      'status',
    ];

    payload.hash = this.generateHash(payload, hashOrder, integrationKey);

    const response = await this.http.post(
      this.PAYNOW_WEB_ENDPOINT,
      qs.stringify(payload),
    );

    const parsed = qs.parse(response.data);

    if (parsed.status !== 'Ok' || !parsed.pollurl) {
      throw new InternalServerErrorException('Invalid PayNow response');
    }

    return {
      redirectUrl: parsed.browserurl as string,
      pollUrl: parsed.pollurl as string,
      reference: params.reference,
    };
  }

  /* =====================================================
     🔴 ECOCASH PUSH (FIXED)
  ===================================================== */

  private normalizeEcoCashPhone(phone: string): string {
    let p = phone.replace(/\D/g, '');

    if (p.startsWith('0')) p = '263' + p.substring(1);
    if (p.startsWith('2637')) return p;

    throw new BadRequestException('Invalid EcoCash phone number');
  }

  async initiateEcoCashPayment(params: {
    reference: string;
    amount: number;
    phone: string;
  }) {
    if (params.amount < 1) {
      throw new BadRequestException('EcoCash minimum amount is $1');
    }

    const {
      integrationId,
      integrationKey,
      returnUrl,
      resultUrl,
      authEmail,
    } = this.getConfig();

    const phone = this.normalizeEcoCashPhone(params.phone);

    const payload: Record<string, string> = {
      id: integrationId,
      reference: params.reference,
      merchantreference: params.reference,
      amount: params.amount.toFixed(2),
      additionalinfo: 'Etosha Cemetery Payment',
      returnurl: returnUrl,
      resulturl: resultUrl,
      status: 'Message',
      // Omit authemail field entirely to prevent email auto-fill on PayNow website
      phone,
      method: 'ecocash',
    };

    const hashOrder = [
      'id',
      'reference',
      'merchantreference',
      'amount',
      'additionalinfo',
      'returnurl',
      'resulturl',
      'status',
      'phone',
      'method',
    ];

    payload.hash = this.generateHash(payload, hashOrder, integrationKey);

    const response = await this.http.post(
      this.PAYNOW_MOBILE_ENDPOINT,
      qs.stringify(payload),
    );

    const parsed = qs.parse(response.data);

    if (parsed.status !== 'Ok' || !parsed.pollurl) {
      throw new InternalServerErrorException(
        `EcoCash failed: ${parsed.error || 'Unknown error'}`,
      );
    }

    return {
      pollUrl: parsed.pollurl as string,
      reference: params.reference,
    };
  }

  /* =====================================================
     POLLING
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
          amount: parsed.amount ? Number(parsed.amount) : undefined,
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
    } catch {
      return { status: 'PENDING' };
    }
  }

  /* =====================================================
     WEBHOOK HASH VERIFICATION
  ===================================================== */
  verifyWebhookHash(payload: Record<string, any>): boolean {
    if (!payload?.hash) return false;

    const { integrationKey } = this.getConfig();

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

    concat += integrationKey;

    const computedHash = crypto
      .createHash('sha512')
      .update(concat, 'utf8')
      .digest('hex')
      .toUpperCase();

    return computedHash === String(payload.hash).toUpperCase();
  }
}
