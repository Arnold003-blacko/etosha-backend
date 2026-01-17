import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePurchaseDto } from './dto/create-purchase.dto';
import {
  PurchaseStatus,
  PurchaseType,
  ItemCategory,
} from '@prisma/client';
import { resolveMatrixPrice } from '../pricing/pricing.service';

/**
 * UUID validation regex pattern
 * Matches standard UUID format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
 */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validates if a string is a valid UUID format
 * Prevents Prisma crashes from invalid UUID strings
 */
function validateUUID(id: string, fieldName: string = 'ID'): void {
  if (!id || typeof id !== 'string') {
    throw new BadRequestException(`Invalid ${fieldName}: must be a string`);
  }
  if (!UUID_REGEX.test(id)) {
    throw new BadRequestException(`Invalid ${fieldName}: must be a valid UUID format`);
  }
}

@Injectable()
export class PurchasesService {
  constructor(private readonly prisma: PrismaService) {}

  /* =====================================================
   * INITIATE PURCHASE
   * ===================================================== */
  async initiatePurchase(dto: CreatePurchaseDto, memberId: string) {
    // ✅ OPTIMIZED: Fetch only needed fields
    // For resolveMatrixPrice, we need the full product or at least pricingSection
    const product = await this.prisma.product.findUnique({
      where: { id: dto.productId },
      select: {
        id: true,
        amount: true,
        active: true,
        pricingSection: true, // Required for resolveMatrixPrice
      },
    });

    if (!product || !product.active) {
      throw new NotFoundException('Product not found or inactive');
    }

    let totalAmount = Number(product.amount);

    if (
      dto.purchaseType === PurchaseType.FUTURE &&
      dto.yearPlanId
    ) {
      // ✅ OPTIMIZED: Parallel queries for member and yearPlan
      const [member, yearPlan] = await Promise.all([
        this.prisma.member.findUnique({
          where: { id: memberId },
          select: {
            dateOfBirth: true,
          },
        }),
        this.prisma.yearPlan.findUnique({
          where: { id: dto.yearPlanId },
        }),
      ]);

      if (!member?.dateOfBirth) {
        throw new BadRequestException(
          'Date of birth is required for installment purchases',
        );
      }

      if (!yearPlan) {
        throw new NotFoundException('Payment plan not found');
      }

      const today = new Date();
      const dob = new Date(member.dateOfBirth);
      let age = today.getFullYear() - dob.getFullYear();
      if (
        today.getMonth() < dob.getMonth() ||
        (today.getMonth() === dob.getMonth() &&
          today.getDate() < dob.getDate())
      ) {
        age--;
      }

      // product has pricingSection which is all resolveMatrixPrice needs
      const monthly = resolveMatrixPrice(product, yearPlan, age);

      if (!monthly || Number(monthly) <= 0) {
        throw new BadRequestException(
          'Installment pricing not available for this product',
        );
      }

      totalAmount = Number(monthly) * yearPlan.months;
    }

    return this.prisma.purchase.create({
      data: {
        memberId,
        productId: product.id,
        purchaseType: dto.purchaseType,
        futureFor: dto.futureFor ?? null,
        yearPlanId:
          dto.purchaseType === PurchaseType.FUTURE
            ? dto.yearPlanId ?? null
            : null,
        totalAmount,
        paidAmount: 0,
        balance: totalAmount,
        status: PurchaseStatus.PENDING_PAYMENT,
      },
    });
  }

  /* =====================================================
   * SERVICE PURCHASE
   * ===================================================== */
  async initiateServicePurchase(
    dto: CreatePurchaseDto,
    memberId: string,
  ) {
    // ✅ OPTIMIZED: Fetch only needed fields
    const product = await this.prisma.product.findUnique({
      where: { id: dto.productId },
      select: {
        id: true,
        amount: true,
        active: true,
        category: true,
        isAvailable: true,
      },
    });

    if (!product || !product.active) {
      throw new NotFoundException('Service not found or inactive');
    }

    if (product.category !== ItemCategory.SERVICE) {
      throw new BadRequestException('Product is not a service');
    }

    if (!product.isAvailable) {
      throw new BadRequestException(
        'Service is currently hired out',
      );
    }

    return this.initiatePurchase(
      {
        ...dto,
        purchaseType: PurchaseType.IMMEDIATE,
        yearPlanId: undefined,
      },
      memberId,
    );
  }

  /* =====================================================
   * VERIFY FUTURE REDEEM (FOR MODAL)
   * ===================================================== */
  async verifyRedeem(purchaseId: string, memberId: string) {
    // 🔒 Guard: Validate UUID before database query
    validateUUID(purchaseId, 'Purchase ID');
    
    const purchase = await this.prisma.purchase.findUnique({
      where: { id: purchaseId },
    });

    if (!purchase) {
      throw new NotFoundException('Purchase not found');
    }

    if (purchase.memberId !== memberId) {
      throw new ForbiddenException();
    }

    if (purchase.purchaseType !== PurchaseType.FUTURE) {
      throw new BadRequestException(
        'Immediate purchases are redeemed automatically',
      );
    }

    if (purchase.status !== PurchaseStatus.PAID) {
      throw new BadRequestException('Purchase not fully paid');
    }

    if (purchase.redeemedAt) {
      throw new BadRequestException('Purchase already redeemed');
    }

    return { ok: true };
  }

  /* =====================================================
   * SAVE DECEASED DETAILS
   * ===================================================== */
  async saveDeceased(
    purchaseId: string,
    data: {
      fullName: string;
      gender: string;
      address: string;
      relationship: string;
      causeOfDeath?: string;
      funeralParlor?: string;
      dateOfBirth: string;
      dateOfDeath: string;
      expectedBurial?: string;
    },
    memberId: string,
  ) {
    // 🔒 Guard: Validate UUID before database query
    validateUUID(purchaseId, 'Purchase ID');
    
    const purchase = await this.prisma.purchase.findUnique({
      where: { id: purchaseId },
    });

    if (!purchase) {
      throw new NotFoundException('Purchase not found');
    }

    if (purchase.memberId !== memberId) {
      throw new ForbiddenException();
    }

    const deceased = await this.prisma.deceased.upsert({
      where: { purchaseId },
      update: {
        ...data,
        dateOfBirth: new Date(data.dateOfBirth),
        dateOfDeath: new Date(data.dateOfDeath),
        expectedBurial: data.expectedBurial
          ? new Date(data.expectedBurial)
          : null,
      },
      create: {
        purchaseId,
        ...data,
        dateOfBirth: new Date(data.dateOfBirth),
        dateOfDeath: new Date(data.dateOfDeath),
        expectedBurial: data.expectedBurial
          ? new Date(data.expectedBurial)
          : null,
      },
    });

    // ✅ MARK AS REDEEMED ONCE DECEASED DETAILS ARE SAVED
    if (!purchase.redeemedAt) {
      await this.prisma.purchase.update({
        where: { id: purchaseId },
        data: {
          redeemedAt: new Date(),
          redeemedByMemberId: memberId,
        },
      });
    }

    return deceased;
  }

  /* =====================================================
   * GET MY PURCHASES
   * ===================================================== */
  async getMyPurchases(memberId: string) {
    // ✅ OPTIMIZED: Use select instead of include to fetch only needed fields
    return this.prisma.purchase.findMany({
      where: { memberId },
      select: {
        id: true,
        purchaseType: true,
        futureFor: true,
        totalAmount: true,
        paidAmount: true,
        balance: true,
        status: true,
        paidAt: true,
        nextDueAt: true,
        lastPaidAt: true,
        completedAt: true,
        reminderEnabled: true,
        createdAt: true,
        updatedAt: true,
        redeemedAt: true,
        yearPlan: {
          select: { id: true, name: true, months: true },
        },
        product: {
          select: { id: true, title: true, category: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}
