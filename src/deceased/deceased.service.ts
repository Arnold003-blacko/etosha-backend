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
    console.log(
      `[DECEASED] 🔍 createAndRedeem called: purchaseId=${dto.purchaseId}, memberId=${memberId}`,
    );
    console.log(`[DECEASED] DTO received:`, JSON.stringify(dto, null, 2));
    
    // 🔒 Guard: Validate UUID before database query
    if (!dto.purchaseId || typeof dto.purchaseId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(dto.purchaseId)) {
      console.error(`[DECEASED] ❌ Invalid Purchase ID format: ${dto.purchaseId}`);
      throw new BadRequestException('Invalid Purchase ID: must be a valid UUID format');
    }
    
    try {
      const result = await this.prisma.$transaction(async (tx) => {
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

      // 5️⃣ Require next of kin: you cannot save a deceased without their next of kin
      if (!dto.nextOfKin) {
        throw new BadRequestException(
          'Next of kin details are required. You cannot save a deceased without their next of kin.',
        );
      }

      // 6️⃣ Create deceased
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

      // 7️⃣ Create BurialNextOfKin immediately after deceased (required: every deceased has one next of kin)
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

      // 8️⃣ Redeem purchase (ATOMIC)
      await tx.purchase.update({
        where: { id: purchase.id },
        data: {
          redeemedAt: new Date(),
          redeemedByMemberId: memberId,
        },
      });

      // Emit real-time update (after transaction completes)
      this.dashboardGateway.broadcastDashboardUpdate();

        console.log(
          `[DECEASED] ✅ Successfully created deceased ${deceased.id} and next of kin for purchase ${dto.purchaseId}`,
        );
        return deceased;
      });
      
      console.log(`[DECEASED] Transaction completed successfully`);
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const errorStack = error instanceof Error ? error.stack : String(error);
      
      console.error(
        `[DECEASED] ❌ CRITICAL ERROR in createAndRedeem for purchase ${dto.purchaseId}:`,
        errorMessage,
      );
      console.error(`[DECEASED] Error stack:`, errorStack);
      console.error(`[DECEASED] DTO that failed:`, JSON.stringify(dto, null, 2));
      
      // Re-throw with more context
      if (error instanceof BadRequestException || 
          error instanceof NotFoundException || 
          error instanceof ForbiddenException) {
        throw error; // Re-throw validation/authorization errors as-is
      }
      
      // Wrap unexpected errors
      throw new BadRequestException(
        `Failed to create deceased and next of kin records: ${errorMessage}`,
      );
    }
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
            nextOfKin: true,
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
      .filter((p): p is typeof p & { deceased: NonNullable<typeof p.deceased> } => p.deceased !== null)
      .map((p) => ({
        ...p.deceased,
        purchase: {
          id: p.id,
          product: p.product,
          purchaseType: p.purchaseType,
          createdAt: p.createdAt,
        },
        nextOfKin: p.deceased.nextOfKin || null,
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
        nextOfKin: true,
      },
    });

    if (!deceased) {
      throw new NotFoundException('Deceased not found');
    }

    if (!deceased.purchase || deceased.purchase.memberId !== memberId) {
      throw new ForbiddenException('Not your deceased record');
    }

    return deceased.nextOfKin;
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

    if (!deceased.purchase || deceased.purchase.memberId !== memberId) {
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
