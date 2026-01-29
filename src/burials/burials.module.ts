import { Module } from '@nestjs/common';
import { BurialsController } from './burials.controller';
import { BurialsService } from './burials.service';
import { PrismaModule } from '../prisma/prisma.module';
import { DashboardModule } from '../dashboard/dashboard.module';
import { SmsModule } from '../sms/sms.module';

@Module({
  imports: [PrismaModule, DashboardModule, SmsModule],
  controllers: [BurialsController],
  providers: [BurialsService],
  exports: [BurialsService],
})
export class BurialsModule {}
