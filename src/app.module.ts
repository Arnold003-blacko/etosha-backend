import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';

import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DeceasedModule } from './deceased/deceased.module';
import { PrismaModule } from './prisma/prisma.module';
import { MembersModule } from './members/members.module';
import { AuthModule } from './auth/auth.module';
import { StaffAuthModule } from './staff-auth/staff-auth.module';
import { ItemsModule } from './items/items.module';
import { YearPlansModule } from './year-plans/year-plans.module';
import { UpcomingModule } from './upcoming/upcoming.module';
import { PurchasesModule } from './purchases/purchases.module';
import { PaymentsModule } from './payments/payments.module';
import { PayNowModule } from './paynow/paynow.module';
import { CheckoutModule } from './checkout/checkout.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { TransactModule } from './transact/transact.module';
import { StaffModule } from './staff/staff.module';
import { ClientsModule } from './clients/clients.module';
import { BurialsModule } from './burials/burials.module';
import { CommissionsModule } from './commissions/commissions.module';
import { SmsModule } from './sms/sms.module';
import { ReportsModule } from './reports/reports.module';

@Module({
  controllers: [AppController],
  providers: [
    AppService,
    // 🔒 Rate limiting guard (applied globally but can be overridden per route)
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
  imports: [
    // Global config (.env)
    ConfigModule.forRoot({ isGlobal: true }),

    // 🔒 Rate limiting configuration
    ThrottlerModule.forRoot([
      {
        name: 'short',
        ttl: 60000, // 1 minute
        limit: 10, // 10 requests per minute (for general endpoints)
      },
      {
        name: 'medium',
        ttl: 60000, // 1 minute
        limit: 5, // 5 requests per minute (for auth endpoints - applied via decorator)
      },
      {
        name: 'long',
        ttl: 900000, // 15 minutes
        limit: 100, // 100 requests per 15 minutes (for general API usage)
      },
    ]),

    // 🕒 Enable cron / scheduled jobs (SAFE)
    ScheduleModule.forRoot(),

    // Core infrastructure
    PrismaModule,

    // Feature modules
    AuthModule,
    StaffAuthModule,
    StaffModule,
    MembersModule,
    ClientsModule,
    ItemsModule,
    YearPlansModule,
    UpcomingModule,
    PurchasesModule,
    PaymentsModule,
    PayNowModule,
    CheckoutModule,
    DeceasedModule,
    DashboardModule,
    TransactModule,
    BurialsModule,
    CommissionsModule,
    SmsModule,
    ReportsModule,
  ],
})
export class AppModule {}
