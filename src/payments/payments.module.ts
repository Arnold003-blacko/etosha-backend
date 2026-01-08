// payments/payments.module.ts
import { Module } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { PayNowModule } from '../paynow/paynow.module'; // ✅ ADD THIS

@Module({
  imports: [
    PrismaModule,
    PayNowModule, // ✅ ADD THIS
  ],
  controllers: [PaymentsController],
  providers: [PaymentsService],
})
export class PaymentsModule {}
