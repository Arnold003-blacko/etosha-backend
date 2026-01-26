import { Module } from '@nestjs/common';
import { BurialsController } from './burials.controller';
import { BurialsService } from './burials.service';
import { PrismaModule } from '../prisma/prisma.module';
import { DashboardModule } from '../dashboard/dashboard.module';

@Module({
  imports: [PrismaModule, DashboardModule],
  controllers: [BurialsController],
  providers: [BurialsService],
  exports: [BurialsService],
})
export class BurialsModule {}
