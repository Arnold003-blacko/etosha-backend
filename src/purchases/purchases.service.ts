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
  Payment,
  YearPlan,
  PaymentStatus,
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
      let payment: any = null;
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
      yearPlanId?: number;
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

    // Validate year plan ID (required for existing payers)
    if (!dto.yearPlanId || typeof dto.yearPlanId !== 'number' || dto.yearPlanId <= 0) {
      throw new BadRequestException('Valid payment plan ID is required for existing payers');
    }
    
    const yearPlanId: number = dto.yearPlanId; // Now TypeScript knows it's a number

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
        where: { id: yearPlanId },
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
          yearPlanId: yearPlanId, // Set the payment plan they were on
          totalAmount,
          paidAmount,
          balance,
          status: purchaseStatus,
          paidAt: balance <= 0 ? now : null,
          completedAt: balance <= 0 ? now : null,
        },
      });

      // Create payment record for the amount already paid
      let payment: any = null;
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

  /* =====================================================
   * REGISTER LEGACY PLAN (EXISTING CLIENT PLAN)
   * =====================================================
   * This module registers an existing plan that was active before the system existed.
   * Supports both:
   * - Monthly Installment Plans (with yearPlanId)
   * - Full Settlement / Direct Payment (no yearPlanId)
   * 
   * Creates purchase + legacy payment entry with LEGACY_SETTLEMENT method.
   * Remaining balance is calculated using payments.service logic.
   */
  async registerLegacyPlan(dto: {
    memberId: string;
    productId: string;
    yearPlanId?: number; // Required if product has plans, null if direct payment
    alreadyPaid: number;
    lastPaymentDate?: string;
  }) {
    try {
      // 🔒 Guard: Validate IDs
      if (!dto.memberId || typeof dto.memberId !== 'string' || dto.memberId.trim().length === 0) {
        throw new BadRequestException('Invalid Member ID: must be a non-empty string');
      }
      validateUUID(dto.productId, 'Product ID');

      // Validate already paid amount
      const alreadyPaid = Number(dto.alreadyPaid);
      if (isNaN(alreadyPaid) || alreadyPaid < 0) {
        throw new BadRequestException(
          'Already paid amount must be a valid number >= 0',
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

      // Check if product has plans configured
      const hasPlans = !!product.pricingSection;

      // Validate yearPlanId based on product type
      let yearPlan: any = null;
      let totalAmount: number;
      let monthlyInstallment: number | null = null;
      let planMonths: number | null = null;

        if (hasPlans) {
          // Product has plans - yearPlanId is required
          if (!dto.yearPlanId) {
            throw new BadRequestException(
              'Payment plan is required for this product. Please select a plan.',
            );
          }

          // Validate member has date of birth (required for payment plan calculations)
          if (!member.dateOfBirth) {
            throw new BadRequestException(
              'Date of birth is required for installment purchases',
            );
          }

          // Fetch year plan
          yearPlan = await this.prisma.yearPlan.findUnique({
            where: { id: dto.yearPlanId },
          });

          if (!yearPlan) {
            throw new NotFoundException('Payment plan not found');
          }

          // Calculate total amount based on payment plan
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

          monthlyInstallment = Number(monthly);
          planMonths = yearPlan.months;
          totalAmount = monthlyInstallment * (planMonths || 0);
        } else {
          // Product has no plans - direct payment/full settlement
          if (dto.yearPlanId) {
            throw new BadRequestException(
              'This product does not have payment plans. Do not select a plan.',
            );
          }

          // Use product's direct amount
          totalAmount = Number(product.amount);
        }

        // Validate already paid doesn't exceed total
        if (alreadyPaid > totalAmount) {
          throw new BadRequestException(
            `Already paid amount (${alreadyPaid.toFixed(2)}) cannot exceed total contract amount (${totalAmount.toFixed(2)})`,
          );
        }

        // Calculate remaining balance
        const remainingBalance = totalAmount - alreadyPaid;
        const now = new Date();
        const lastPaymentDate = dto.lastPaymentDate
          ? new Date(dto.lastPaymentDate)
          : now;

        // Determine purchase status
        let purchaseStatus: PurchaseStatus;
        if (remainingBalance <= 0) {
          purchaseStatus = PurchaseStatus.PAID;
        } else if (alreadyPaid > 0) {
          purchaseStatus = PurchaseStatus.PARTIALLY_PAID;
        } else {
          purchaseStatus = PurchaseStatus.PENDING_PAYMENT;
        }

        // Create purchase and legacy payment atomically
        const result = await this.prisma.$transaction(async (tx) => {
      // 1) Create the Purchase/Contract record
      const purchase = await tx.purchase.create({
        data: {
          memberId: dto.memberId,
          productId: product.id,
          purchaseType: hasPlans ? PurchaseType.FUTURE : PurchaseType.IMMEDIATE,
          yearPlanId: yearPlan?.id ?? null,
          totalAmount,
          paidAmount: 0, // Will be updated by payment service logic
          balance: totalAmount, // Will be updated by payment service logic
          status: PurchaseStatus.PENDING_PAYMENT, // Will be updated after payment
        },
      });

      // 2) Create the Historic Payment as LEGACY_SETTLEMENT
      let payment: any = null;
      if (alreadyPaid > 0) {
        const { randomUUID } = await import('crypto');

        payment = await tx.payment.create({
          data: {
            purchaseId: purchase.id,
            memberId: dto.memberId,
            amount: alreadyPaid,
            currency: 'USD',
            method: 'LEGACY_SETTLEMENT', // Special method for legacy payments
            reference: `LEGACY-${randomUUID().substring(0, 8).toUpperCase()}`,
            status: PaymentStatus.SUCCESS,
            paidAt: lastPaymentDate,
            createdAt: now,
          },
        });

        // 3) Update purchase using payments.service logic
        // Calculate totalPaid from all SUCCESS payments
        const allPayments = await tx.payment.findMany({
          where: {
            purchaseId: purchase.id,
            status: PaymentStatus.SUCCESS,
          },
        });

        const totalPaid = allPayments.reduce(
          (sum, p) => sum + Number(p.amount),
          0,
        );
        const newBalance = totalAmount - totalPaid;
        const finalStatus =
          newBalance <= 0
            ? PurchaseStatus.PAID
            : totalPaid > 0
              ? PurchaseStatus.PARTIALLY_PAID
              : PurchaseStatus.PENDING_PAYMENT;

        await tx.purchase.update({
          where: { id: purchase.id },
          data: {
            paidAmount: totalPaid,
            balance: newBalance,
            status: finalStatus,
            paidAt: newBalance <= 0 ? now : null,
            completedAt: newBalance <= 0 ? now : null,
          },
        });
      }

      return { purchase, payment };
    });

        // Fetch updated purchase
        const updatedPurchase = await this.prisma.purchase.findUnique({
      where: { id: result.purchase.id },
      include: {
        product: {
          select: {
            id: true,
            title: true,
            pricingSection: true,
          },
        },
        yearPlan: yearPlan
          ? {
              select: {
                id: true,
                name: true,
                months: true,
              },
            }
          : false,
      },
    });

      if (!updatedPurchase) {
        throw new NotFoundException('Failed to retrieve created purchase');
      }

      // Emit real-time update
      this.dashboardGateway.broadcastDashboardUpdate();

      return {
        purchase: updatedPurchase,
        payment: result.payment,
        summary: {
          totalAmount,
          monthlyInstallment,
          planMonths,
          alreadyPaid,
          remainingBalance: Number(updatedPurchase.balance),
          status: updatedPurchase.status,
        },
      };
    } catch (error) {
      // Re-throw known exceptions
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      // Log unexpected errors
      console.error('[registerLegacyPlan] Unexpected error:', error);
      throw new BadRequestException(
        `Failed to register legacy plan: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }
}
