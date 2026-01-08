import { Module } from '@nestjs/common';
import { UpcomingService } from './upcoming.service';
import { UpcomingController } from './upcoming.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [UpcomingController],
  providers: [UpcomingService],
})
export class UpcomingModule {}
