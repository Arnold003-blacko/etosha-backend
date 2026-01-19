// payments/payments.module.ts
import { Module, forwardRef } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { PayNowModule } from '../paynow/paynow.module'; // ✅ ADD THIS
import { DashboardModule } from '../dashboard/dashboard.module'; // For real-time updates

@Module({
  imports: [
    PrismaModule,
    PayNowModule, // ✅ ADD THIS
    forwardRef(() => DashboardModule), // For dashboard gateway
  ],
  controllers: [PaymentsController],
  providers: [PaymentsService],
})
export class PaymentsModule {}
