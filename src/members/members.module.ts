import { Module, forwardRef } from '@nestjs/common';
import { MembersService } from './members.service';
import { MembersController } from './members.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { DashboardModule } from '../dashboard/dashboard.module'; // For real-time updates

@Module({
  imports: [
    PrismaModule,
    forwardRef(() => DashboardModule), // For dashboard gateway
  ],
  controllers: [MembersController],
  providers: [MembersService],
  exports: [MembersService], // Export MembersService so other modules can use it
})
export class MembersModule {}
