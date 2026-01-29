// src/deceased/deceased.module.ts
import { Module, forwardRef } from '@nestjs/common';
import { DeceasedService } from './deceased.service';
import { DeceasedController } from './deceased.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { DashboardModule } from '../dashboard/dashboard.module'; // For real-time updates

@Module({
  imports: [
    PrismaModule,
    forwardRef(() => DashboardModule), // For dashboard gateway
  ],
  providers: [DeceasedService],
  controllers: [DeceasedController],
  exports: [DeceasedService], // Export DeceasedService so it can be used in other modules
})
export class DeceasedModule {}
