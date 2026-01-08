// src/deceased/deceased.module.ts
import { Module } from '@nestjs/common';
import { DeceasedService } from './deceased.service';
import { DeceasedController } from './deceased.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [DeceasedService],
  controllers: [DeceasedController],
})
export class DeceasedModule {}
