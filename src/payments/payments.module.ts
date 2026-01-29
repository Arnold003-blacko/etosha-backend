// payments/payments.module.ts
import { Module, forwardRef } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { PayNowModule } from '../paynow/paynow.module'; // ✅ ADD THIS
import { DashboardModule } from '../dashboard/dashboard.module'; // For real-time updates
import { TransactModule } from '../transact/transact.module'; // For processing pending details

@Module({
  imports: [
    PrismaModule,
    PayNowModule, // ✅ ADD THIS
    forwardRef(() => DashboardModule), // For dashboard gateway
    forwardRef(() => TransactModule), // For processing pending deceased/next of kin details
  ],
  controllers: [PaymentsController],
  providers: [PaymentsService],
  exports: [PaymentsService], // Export PaymentsService so other modules can use it
})
export class PaymentsModule {}
