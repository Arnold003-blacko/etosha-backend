// src/reconciliation/reconciliation.module.ts
import { Module } from '@nestjs/common';
import { ReconciliationService } from './reconciliation.service';
import { PrismaService } from '../prisma/prisma.service';
import { PayNowService } from '../paynow/paynow.service';
import { PaymentsService } from '../payments/payments.service';

@Module({
  providers: [
    ReconciliationService,
    PrismaService,
    PayNowService,
    PaymentsService,
  ],
})
export class ReconciliationModule {}
