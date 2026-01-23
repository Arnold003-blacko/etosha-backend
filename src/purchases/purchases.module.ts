import { Module, forwardRef } from '@nestjs/common';
import { PurchasesService } from './purchases.service';
import { PurchasesController } from './purchases.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { DashboardModule } from '../dashboard/dashboard.module'; // For real-time updates

@Module({
  imports: [
    PrismaModule,
    forwardRef(() => DashboardModule), // For dashboard gateway
  ],
  controllers: [PurchasesController],
  providers: [PurchasesService],
  exports: [PurchasesService], // Export PurchasesService so other modules can use it
})
export class PurchasesModule {}
