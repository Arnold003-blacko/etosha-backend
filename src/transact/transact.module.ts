import { Module, forwardRef } from '@nestjs/common';
import { TransactController } from './transact.controller';
import { TransactService } from './transact.service';
import { PrismaModule } from '../prisma/prisma.module';
import { PaymentsModule } from '../payments/payments.module';
import { PurchasesModule } from '../purchases/purchases.module';
import { MembersModule } from '../members/members.module';
import { DashboardModule } from '../dashboard/dashboard.module';

@Module({
  imports: [
    PrismaModule,
    PaymentsModule,
    PurchasesModule,
    MembersModule,
    forwardRef(() => DashboardModule),
  ],
  controllers: [TransactController],
  providers: [TransactService],
  exports: [TransactService],
})
export class TransactModule {}
