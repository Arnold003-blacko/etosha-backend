import { Module } from '@nestjs/common';
import { YearPlansService } from './year-plans.service';
import { YearPlansController } from './year-plans.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [YearPlansController],
  providers: [YearPlansService],
})
export class YearPlansModule {}
