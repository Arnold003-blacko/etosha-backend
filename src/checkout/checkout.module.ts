import { Module, forwardRef } from '@nestjs/common';
import { CheckoutController } from './checkout.controller';
import { CheckoutService } from './checkout.service';
import { PrismaService } from '../prisma/prisma.service';
import { DashboardModule } from '../dashboard/dashboard.module';

@Module({
  controllers: [CheckoutController],
  providers: [CheckoutService, PrismaService],
  imports: [forwardRef(() => DashboardModule)],
  exports: [CheckoutService],
})
export class CheckoutModule {}
