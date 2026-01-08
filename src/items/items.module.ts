// src/items/items.module.ts
import { Module } from '@nestjs/common';
import { ItemsController } from './items.controller';
import { ItemsService } from './items.service';
import { PrismaModule } from '../prisma/prisma.module'; // <- correct import

@Module({
  imports: [PrismaModule],
  controllers: [ItemsController],
  providers: [ItemsService],
})
export class ItemsModule {}
