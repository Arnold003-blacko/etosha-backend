import { Module } from '@nestjs/common';
import { PayNowService } from './paynow.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule], // ✅ REQUIRED so PayNowService can inject PrismaService
  providers: [PayNowService],
  exports: [PayNowService],
})
export class PayNowModule {}
