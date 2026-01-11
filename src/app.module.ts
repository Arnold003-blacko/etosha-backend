import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';

import { DeceasedModule } from './deceased/deceased.module';
import { PrismaModule } from './prisma/prisma.module';
import { MembersModule } from './members/members.module';
import { AuthModule } from './auth/auth.module';
import { ItemsModule } from './items/items.module';
import { YearPlansModule } from './year-plans/year-plans.module';
import { UpcomingModule } from './upcoming/upcoming.module';
import { PurchasesModule } from './purchases/purchases.module';
import { PaymentsModule } from './payments/payments.module';
import { PayNowModule } from './paynow/paynow.module';
import { CheckoutModule } from './checkout/checkout.module';
import { ReconciliationModule } from './reconciliation/reconciliation.module';

@Module({
  imports: [
    // Global config (.env)
    ConfigModule.forRoot({ isGlobal: true }),

    // 🕒 Enable cron / scheduled jobs (SAFE)
    ScheduleModule.forRoot(),

    // Core infrastructure
    PrismaModule,

    // Feature modules
    AuthModule,
    MembersModule,
    ItemsModule,
    YearPlansModule,
    UpcomingModule,
    PurchasesModule,
    PaymentsModule,
    PayNowModule,
    CheckoutModule,
    DeceasedModule,

    // 🛡️ Background reconciliation (NON-INTRUSIVE)
    ReconciliationModule,
  ],
})
export class AppModule {}
