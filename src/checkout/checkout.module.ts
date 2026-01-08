import { Module } from '@nestjs/common';
import { CheckoutController } from './checkout.controller';
import { PrismaService } from '../prisma/prisma.service';

@Module({
  controllers: [CheckoutController],
  providers: [PrismaService],
})
export class CheckoutModule {}
