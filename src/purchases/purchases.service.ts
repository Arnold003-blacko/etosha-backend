import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePurchaseDto } from './dto/create-purchase.dto';
import {
  PurchaseStatus,
  PurchaseType,
  ItemCategory,
  FutureFor,
} from '@prisma/client';
import { resolveMatrixPrice } from '../pricing/pricing.service';
import { DashboardGateway } from '../dashboard/dashboard.gateway';

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
  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => DashboardGateway))
    private readonly dashboardGateway: DashboardGateway,
  ) {}

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

    const purchase = await this.prisma.purchase.create({
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

    // Emit real-time update
    this.dashboardGateway.broadcastDashboardUpdate();

    return purchase;
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

  /* =====================================================
   * CREATE PURCHASE WITH INITIAL PAYMENT (ADMIN)
   * Creates a purchase and applies an initial payment atomically
   * Used when recording purchases where payment was already made
   * ===================================================== */
  async createPurchaseWithInitialPayment(
    dto: {
      memberId: string;
      productId: string;
      purchaseType: PurchaseType;
      futureFor?: FutureFor;
      yearPlanId?: number;
      initialPaymentAmount: number;
      paymentMethod?: string;
      paymentReference?: string;
    },
  ) {
    // 🔒 Guard: Validate UUIDs before database queries
    validateUUID(dto.memberId, 'Member ID');
    validateUUID(dto.productId, 'Product ID');

    // Validate initial payment amount
    const initialPayment = Number(dto.initialPaymentAmount);
    if (isNaN(initialPayment) || initialPayment < 0) {
      throw new BadRequestException(
        'Initial payment amount must be a valid number >= 0',
      );
    }

    // Fetch member and product
    const [member, product] = await Promise.all([
      this.prisma.member.findUnique({
        where: { id: dto.memberId },
        select: {
          id: true,
          dateOfBirth: true,
        },
      }),
      this.prisma.product.findUnique({
        where: { id: dto.productId },
        select: {
          id: true,
          amount: true,
          active: true,
          pricingSection: true,
        },
      }),
    ]);

    if (!member) {
      throw new NotFoundException('Member not found');
    }

    if (!product || !product.active) {
      throw new NotFoundException('Product not found or inactive');
    }

    // Calculate total amount (same logic as initiatePurchase)
    let totalAmount = Number(product.amount);

    if (dto.purchaseType === PurchaseType.FUTURE && dto.yearPlanId) {
      const yearPlan = await this.prisma.yearPlan.findUnique({
        where: { id: dto.yearPlanId },
      });

      if (!yearPlan) {
        throw new NotFoundException('Payment plan not found');
      }

      if (!member.dateOfBirth) {
        throw new BadRequestException(
          'Date of birth is required for installment purchases',
        );
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

      const monthly = resolveMatrixPrice(product, yearPlan, age);

      if (!monthly || Number(monthly) <= 0) {
        throw new BadRequestException(
          'Installment pricing not available for this product',
        );
      }

      totalAmount = Number(monthly) * yearPlan.months;
    }

    // Validate initial payment doesn't exceed total
    if (initialPayment > totalAmount) {
      throw new BadRequestException(
        `Initial payment amount (${initialPayment.toFixed(2)}) cannot exceed total amount (${totalAmount.toFixed(2)})`,
      );
    }

    // Calculate balance after initial payment
    const balance = totalAmount - initialPayment;
    const paidAmount = initialPayment;
    const now = new Date();

    // Determine purchase status
    let purchaseStatus: PurchaseStatus;
    if (balance <= 0) {
      purchaseStatus = PurchaseStatus.PAID;
    } else if (paidAmount > 0) {
      purchaseStatus = PurchaseStatus.PARTIALLY_PAID;
    } else {
      purchaseStatus = PurchaseStatus.PENDING_PAYMENT;
    }

    // Create purchase and payment atomically
    const result = await this.prisma.$transaction(async (tx) => {
      // Create purchase
      const purchase = await tx.purchase.create({
        data: {
          memberId: dto.memberId,
          productId: product.id,
          purchaseType: dto.purchaseType,
          futureFor: dto.futureFor ?? null,
          yearPlanId:
            dto.purchaseType === PurchaseType.FUTURE
              ? dto.yearPlanId ?? null
              : null,
          totalAmount,
          paidAmount,
          balance,
          status: purchaseStatus,
          paidAt: balance <= 0 ? now : null,
          completedAt: balance <= 0 ? now : null,
        },
      });

      // Create initial payment if amount > 0
      let payment = null;
      if (initialPayment > 0) {
        const { randomUUID } = await import('crypto');
        const { PaymentStatus } = await import('@prisma/client');

        payment = await tx.payment.create({
          data: {
            purchaseId: purchase.id,
            memberId: dto.memberId,
            amount: initialPayment,
            currency: 'USD',
            method: dto.paymentMethod || 'MANUAL',
            reference:
              dto.paymentReference ||
              `INITIAL-${randomUUID().substring(0, 8).toUpperCase()}`,
            status: PaymentStatus.SUCCESS,
            paidAt: now,
          },
        });
      }

      return { purchase, payment };
    });

    // Emit real-time update
    this.dashboardGateway.broadcastDashboardUpdate();

    return {
      purchase: result.purchase,
      payment: result.payment,
      summary: {
        totalAmount,
        paidAmount,
        balance,
        status: purchaseStatus,
      },
    };
  }

  /* =====================================================
   * CREATE EXISTING PAYER PURCHASE (ADMIN)
   * For clients who were paying before the system was implemented
   * Records their existing payment and sets them up on their payment plan
   * ===================================================== */
  async createExistingPayerPurchase(
    dto: {
      memberId: string;
      productId: string;
      yearPlanId: number;
      amountAlreadyPaid: number;
      futureFor?: FutureFor;
      paymentMethod?: string;
      paymentReference?: string;
    },
  ) {
    // 🔒 Guard: Validate UUIDs before database queries
    validateUUID(dto.memberId, 'Member ID');
    validateUUID(dto.productId, 'Product ID');

    // Validate amount already paid
    const amountPaid = Number(dto.amountAlreadyPaid);
    if (isNaN(amountPaid) || amountPaid < 0) {
      throw new BadRequestException(
        'Amount already paid must be a valid number >= 0',
      );
    }

    // Validate year plan ID
    if (!dto.yearPlanId || typeof dto.yearPlanId !== 'number' || dto.yearPlanId <= 0) {
      throw new BadRequestException('Valid payment plan ID is required for existing payers');
    }

    // Fetch member, product, and year plan
    const [member, product, yearPlan] = await Promise.all([
      this.prisma.member.findUnique({
        where: { id: dto.memberId },
        select: {
          id: true,
          dateOfBirth: true,
        },
      }),
      this.prisma.product.findUnique({
        where: { id: dto.productId },
        select: {
          id: true,
          amount: true,
          active: true,
          pricingSection: true,
        },
      }),
      this.prisma.yearPlan.findUnique({
        where: { id: dto.yearPlanId },
      }),
    ]);

    if (!member) {
      throw new NotFoundException('Member not found');
    }

    if (!product || !product.active) {
      throw new NotFoundException('Product not found or inactive');
    }

    if (!yearPlan) {
      throw new NotFoundException('Payment plan not found');
    }

    // Validate member has date of birth (required for payment plan calculations)
    if (!member.dateOfBirth) {
      throw new BadRequestException(
        'Date of birth is required for payment plan purchases',
      );
    }

    // Calculate total amount based on payment plan (same logic as FUTURE purchases)
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

    const monthly = resolveMatrixPrice(product, yearPlan, age);

    if (!monthly || Number(monthly) <= 0) {
      throw new BadRequestException(
        'Payment plan pricing not available for this product and member age',
      );
    }

    const totalAmount = Number(monthly) * yearPlan.months;

    // Validate amount already paid doesn't exceed total
    if (amountPaid > totalAmount) {
      throw new BadRequestException(
        `Amount already paid (${amountPaid.toFixed(2)}) cannot exceed total plan amount (${totalAmount.toFixed(2)})`,
      );
    }

    // Calculate remaining balance
    const balance = totalAmount - amountPaid;
    const paidAmount = amountPaid;
    const now = new Date();

    // Determine purchase status
    let purchaseStatus: PurchaseStatus;
    if (balance <= 0) {
      purchaseStatus = PurchaseStatus.PAID;
    } else if (paidAmount > 0) {
      purchaseStatus = PurchaseStatus.PARTIALLY_PAID;
    } else {
      purchaseStatus = PurchaseStatus.PENDING_PAYMENT;
    }

    // Create purchase and payment atomically
    const result = await this.prisma.$transaction(async (tx) => {
      // Create purchase with FUTURE type and payment plan
      const purchase = await tx.purchase.create({
        data: {
          memberId: dto.memberId,
          productId: product.id,
          purchaseType: PurchaseType.FUTURE, // Existing payers are always on payment plans
          futureFor: dto.futureFor ?? null,
          yearPlanId: dto.yearPlanId, // Set the payment plan they were on
          totalAmount,
          paidAmount,
          balance,
          status: purchaseStatus,
          paidAt: balance <= 0 ? now : null,
          completedAt: balance <= 0 ? now : null,
        },
      });

      // Create payment record for the amount already paid
      let payment = null;
      if (amountPaid > 0) {
        const { randomUUID } = await import('crypto');
        const { PaymentStatus } = await import('@prisma/client');

        payment = await tx.payment.create({
          data: {
            purchaseId: purchase.id,
            memberId: dto.memberId,
            amount: amountPaid,
            currency: 'USD',
            method: dto.paymentMethod || 'MANUAL',
            reference:
              dto.paymentReference ||
              `EXISTING-${randomUUID().substring(0, 8).toUpperCase()}`,
            status: PaymentStatus.SUCCESS,
            paidAt: now, // Use current date or could be a historical date if provided
            createdAt: now,
          },
        });
      }

      return { purchase, payment };
    });

    // Emit real-time update
    this.dashboardGateway.broadcastDashboardUpdate();

    return {
      purchase: result.purchase,
      payment: result.payment,
      summary: {
        totalAmount,
        paidAmount,
        balance,
        status: purchaseStatus,
        paymentPlan: {
          id: yearPlan.id,
          name: yearPlan.name,
          months: yearPlan.months,
          monthlyAmount: Number(monthly),
        },
      },
    };
  }
}
