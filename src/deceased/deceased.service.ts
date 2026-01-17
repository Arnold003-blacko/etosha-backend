// src/deceased/deceased.service.ts
import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateDeceasedDto } from './dto/create-deceased.dto';
import { PurchaseStatus } from '@prisma/client';

@Injectable()
export class DeceasedService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * ✅ SINGLE SOURCE OF TRUTH
   * Creating deceased ALWAYS redeems the purchase
   */
  async createAndRedeem(
    dto: CreateDeceasedDto,
    memberId: string,
  ) {
    // 🔒 Guard: Validate UUID before database query
    if (!dto.purchaseId || typeof dto.purchaseId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(dto.purchaseId)) {
      throw new BadRequestException('Invalid Purchase ID: must be a valid UUID format');
    }
    
    return this.prisma.$transaction(async (tx) => {
      // 1️⃣ Load purchase
      const purchase = await tx.purchase.findUnique({
        where: { id: dto.purchaseId },
        include: { deceased: true },
      });

      if (!purchase) {
        throw new NotFoundException('Purchase not found');
      }

      // 2️⃣ Ownership check
      if (purchase.memberId !== memberId) {
        throw new ForbiddenException('Not your purchase');
      }

      // 3️⃣ Must be PAID
      if (purchase.status !== PurchaseStatus.PAID) {
        throw new ForbiddenException(
          'Purchase must be paid before saving deceased details',
        );
      }

      // 4️⃣ Idempotency (safe retry)
      if (purchase.deceased) {
        return purchase.deceased;
      }

      // 5️⃣ Create deceased
      const deceased = await tx.deceased.create({
        data: {
          purchaseId: purchase.id,
          fullName: dto.fullName,
          dateOfBirth: new Date(dto.dateOfBirth),
          gender: dto.gender,
          address: dto.address,
          relationship: dto.relationship,
          causeOfDeath: dto.causeOfDeath,
          funeralParlor: dto.funeralParlor,
          dateOfDeath: new Date(dto.dateOfDeath),
          expectedBurial: dto.expectedBurial
            ? new Date(dto.expectedBurial)
            : null,
        },
      });

      // 6️⃣ Redeem purchase (ATOMIC)
      await tx.purchase.update({
        where: { id: purchase.id },
        data: {
          redeemedAt: new Date(),
          redeemedByMemberId: memberId,
        },
      });

      return deceased;
    });
  }
}
