// src/deceased/deceased.service.ts
import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateDeceasedDto } from './dto/create-deceased.dto';
import { PurchaseStatus } from '@prisma/client';
import { DashboardGateway } from '../dashboard/dashboard.gateway';

@Injectable()
export class DeceasedService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => DashboardGateway))
    private readonly dashboardGateway: DashboardGateway,
  ) {}

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

      // 4️⃣ Check if already redeemed (prevent double redemption)
      if (purchase.deceased) {
        throw new BadRequestException(
          'This purchase has already been redeemed. Each purchase can only be redeemed once.'
        );
      }

      if (purchase.redeemedAt) {
        throw new BadRequestException(
          'This purchase has already been redeemed. Each purchase can only be redeemed once.'
        );
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

      // 6️⃣ Create BurialNextOfKin - tied to deceased, not member (if provided)
      if (dto.nextOfKin) {
        await tx.burialNextOfKin.create({
          data: {
            deceasedId: deceased.id,
            fullName: dto.nextOfKin.fullName,
            relationship: dto.nextOfKin.relationship,
            phone: dto.nextOfKin.phone,
            email: dto.nextOfKin.email || null,
            address: dto.nextOfKin.address,
            isBuyer: dto.nextOfKin.isBuyer || false,
          },
        });
      }

      // 7️⃣ Redeem purchase (ATOMIC)
      await tx.purchase.update({
        where: { id: purchase.id },
        data: {
          redeemedAt: new Date(),
          redeemedByMemberId: memberId,
        },
      });

      // Emit real-time update (after transaction completes)
      this.dashboardGateway.broadcastDashboardUpdate();

      return deceased;
    });
  }

  /**
   * Get all deceased records for a member (via their purchases)
   */
  async getDeceasedForMember(memberId: string) {
    const purchases = await this.prisma.purchase.findMany({
      where: {
        memberId,
        deceased: { isNot: null },
      },
      include: {
        deceased: {
          include: {
            burialNextOfKin: true,
          },
        },
        product: {
          select: {
            title: true,
            category: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    return purchases
      .filter((p) => p.deceased)
      .map((p) => ({
        ...p.deceased,
        purchase: {
          id: p.id,
          product: p.product,
          purchaseType: p.purchaseType,
          createdAt: p.createdAt,
        },
        nextOfKin: p.deceased?.burialNextOfKin || null,
      }));
  }

  /**
   * Get next of kin for a deceased person
   */
  async getNextOfKinForDeceased(deceasedId: string, memberId: string) {
    const deceased = await this.prisma.deceased.findUnique({
      where: { id: deceasedId },
      include: {
        purchase: {
          select: { memberId: true },
        },
        burialNextOfKin: true,
      },
    });

    if (!deceased) {
      throw new NotFoundException('Deceased not found');
    }

    if (deceased.purchase.memberId !== memberId) {
      throw new ForbiddenException('Not your deceased record');
    }

    return deceased.burialNextOfKin;
  }

  /**
   * Update next of kin for a deceased person
   */
  async updateNextOfKinForDeceased(
    deceasedId: string,
    memberId: string,
    dto: {
      fullName: string;
      relationship: string;
      phone: string;
      email?: string;
      address: string;
    },
  ) {
    const deceased = await this.prisma.deceased.findUnique({
      where: { id: deceasedId },
      include: {
        purchase: {
          select: { memberId: true },
        },
      },
    });

    if (!deceased) {
      throw new NotFoundException('Deceased not found');
    }

    if (deceased.purchase.memberId !== memberId) {
      throw new ForbiddenException('Not your deceased record');
    }

    return this.prisma.burialNextOfKin.upsert({
      where: { deceasedId },
      update: {
        fullName: dto.fullName,
        relationship: dto.relationship,
        phone: dto.phone,
        email: dto.email || null,
        address: dto.address,
      },
      create: {
        deceasedId,
        fullName: dto.fullName,
        relationship: dto.relationship,
        phone: dto.phone,
        email: dto.email || null,
        address: dto.address,
        isBuyer: false,
      },
    });
  }
}
