import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentsService } from '../payments/payments.service';
import { PayNowService } from '../paynow/paynow.service';
import { PurchasesService } from '../purchases/purchases.service';
import { MembersService } from '../members/members.service';
import { DeceasedService } from '../deceased/deceased.service';
import { DashboardGateway } from '../dashboard/dashboard.gateway';
import { LoggerService, LogCategory } from '../dashboard/logger.service';
import { CashPaymentDto } from './dto/cash-payment.dto';
import { CreateLegacyPlanDto } from './dto/legacy-plan.dto';
import { StaffCreatePurchaseDto } from './dto/staff-create-purchase.dto';
import { PurchaseStatus, PurchaseType, ItemCategory, PaymentStatus } from '@prisma/client';
import { CreateDeceasedDto } from '../deceased/dto/create-deceased.dto';
import { UpsertNextOfKinDto } from '../members/dto/upsert-next-of-kin.dto';
import { DeceasedDetailsDto } from './dto/deceased-details.dto';

@Injectable()
export class TransactService {
  // Temporary storage for deceased and next of kin details before payment
  // Key: purchaseId, Value: { deceasedDetails, nextOfKinDetails }
  // For immediate burials: both deceasedDetails and nextOfKinDetails are stored
  // For future plans: only nextOfKinDetails stored (deceasedDetails will be provided when redeeming)
  private pendingDetailsMap = new Map<string, {
    deceasedDetails: DeceasedDetailsDto | null;
    nextOfKinDetails: UpsertNextOfKinDto;
  }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly paymentsService: PaymentsService,
    private readonly paynowService: PayNowService,
    private readonly purchasesService: PurchasesService,
    private readonly membersService: MembersService,
    private readonly deceasedService: DeceasedService,
    @Inject(forwardRef(() => DashboardGateway))
    private readonly dashboardGateway: DashboardGateway,
    private readonly logger: LoggerService,
  ) {}

  /* =====================================================
   * SEARCH MEMBERS (WEB - STAFF)
   * ===================================================== */
  async searchMembers(query: string, userId?: string) {
    const startTime = Date.now();

    if (!query || query.length < 2) {
      return [];
    }

    const searchTerm = query.toLowerCase().trim();

    try {
      this.logger.info(
        `[TRANSACT] Member search initiated: "${searchTerm}"`,
        LogCategory.SYSTEM,
        {
          eventType: 'transact_member_search',
          searchQuery: searchTerm,
          userId,
        },
      );

      const members = await this.prisma.member.findMany({
        where: {
          OR: [
            { id: { contains: searchTerm, mode: 'insensitive' } },
            { firstName: { contains: searchTerm, mode: 'insensitive' } },
            { lastName: { contains: searchTerm, mode: 'insensitive' } },
            { email: { contains: searchTerm, mode: 'insensitive' } },
            { phone: { contains: searchTerm, mode: 'insensitive' } },
          ],
        },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
          createdAt: true,
        },
        take: 20, // Limit for performance
        orderBy: { createdAt: 'desc' },
      });

      const duration = Date.now() - startTime;

      this.logger.info(
        `[TRANSACT] Member search completed: ${members.length} results found`,
        LogCategory.SYSTEM,
        {
          eventType: 'transact_member_search_success',
          searchQuery: searchTerm,
          resultCount: members.length,
          duration,
          userId,
        },
      );

      return members;
    } catch (error) {
      const duration = Date.now() - startTime;

      this.logger.error(
        `[TRANSACT] Member search failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error instanceof Error ? error : new Error(String(error)),
        LogCategory.SYSTEM,
        {
          eventType: 'transact_member_search_error',
          searchQuery: searchTerm,
          duration,
          userId,
        },
      );

      throw new BadRequestException('Search failed. Please try again.');
    }
  }

  /* =====================================================
   * GET MEMBER BY ID (WEB - STAFF)
   * ===================================================== */
  async getMemberById(memberId: string, userId?: string) {
    // Validate member ID format (cuid format)
    if (!memberId || typeof memberId !== 'string' || memberId.length < 10) {
      throw new BadRequestException('Invalid member ID format');
    }

    try {
      this.logger.info(
        `[TRANSACT] Fetching member: ${memberId}`,
        LogCategory.SYSTEM,
        {
          eventType: 'transact_get_member',
          memberId,
          userId,
        },
      );

      const member = await this.prisma.member.findUnique({
        where: { id: memberId },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
          country: true,
          address: true,
          city: true,
          createdAt: true,
          nextOfKin: {
            select: {
              fullName: true,
              relationship: true,
              phone: true,
              email: true,
              address: true,
            },
          },
        },
      });

      if (!member) {
        this.logger.warn(
          `[TRANSACT] Member not found: ${memberId}`,
          LogCategory.SYSTEM,
          {
            eventType: 'transact_member_not_found',
            memberId,
            userId,
          },
        );
        throw new NotFoundException('Member not found');
      }

      this.logger.info(
        `[TRANSACT] Member fetched successfully: ${member.firstName} ${member.lastName}`,
        LogCategory.SYSTEM,
        {
          eventType: 'transact_get_member_success',
          memberId,
          userId,
        },
      );

      return member;
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }

      this.logger.error(
        `[TRANSACT] Failed to fetch member: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error instanceof Error ? error : new Error(String(error)),
        LogCategory.SYSTEM,
        {
          eventType: 'transact_get_member_error',
          memberId,
          userId,
        },
      );

      throw new BadRequestException('Failed to fetch member');
    }
  }

  /* =====================================================
   * GET MEMBER PURCHASES (WEB - STAFF)
   * ===================================================== */
  async getMemberPurchases(memberId: string, userId?: string) {
    // Validate member exists
    const member = await this.getMemberById(memberId, userId);

    try {
      this.logger.info(
        `[TRANSACT] Fetching purchases for member: ${memberId}`,
        LogCategory.SYSTEM,
        {
          eventType: 'transact_get_member_purchases',
          memberId,
          userId,
        },
      );

      const purchases = await this.prisma.purchase.findMany({
        where: { memberId: member.id },
        select: {
          id: true,
          purchaseType: true,
          totalAmount: true,
          paidAmount: true,
          balance: true,
          status: true,
          paidAt: true,
          nextDueAt: true,
          lastPaidAt: true,
          completedAt: true,
          createdAt: true,
          product: {
            select: {
              id: true,
              title: true,
              category: true,
              currency: true,
            },
          },
          yearPlan: {
            select: {
              id: true,
              name: true,
              months: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      this.logger.info(
        `[TRANSACT] Purchases fetched: ${purchases.length} plans found`,
        LogCategory.SYSTEM,
        {
          eventType: 'transact_get_member_purchases_success',
          memberId,
          purchaseCount: purchases.length,
          userId,
        },
      );

      return purchases;
    } catch (error) {
      this.logger.error(
        `[TRANSACT] Failed to fetch member purchases: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error instanceof Error ? error : new Error(String(error)),
        LogCategory.SYSTEM,
        {
          eventType: 'transact_get_member_purchases_error',
          memberId,
          userId,
        },
      );

      throw new BadRequestException('Failed to fetch member purchases');
    }
  }

  /* =====================================================
   * GET MEMBER NEXT OF KIN (WEB - STAFF)
   * ===================================================== */
  async getMemberNextOfKin(memberId: string, userId?: string) {
    // Validate member exists
    await this.getMemberById(memberId, userId);

    try {
      this.logger.info(
        `[TRANSACT] Fetching next of kin for member: ${memberId}`,
        LogCategory.SYSTEM,
        {
          eventType: 'transact_get_member_next_of_kin',
          memberId,
          userId,
        },
      );

      const nextOfKin = await this.prisma.nextOfKin.findUnique({
        where: { memberId },
      });

      this.logger.info(
        `[TRANSACT] Next of kin fetched: ${nextOfKin ? 'found' : 'not found'}`,
        LogCategory.SYSTEM,
        {
          eventType: 'transact_get_member_next_of_kin_success',
          memberId,
          hasNextOfKin: !!nextOfKin,
          userId,
        },
      );

      return nextOfKin;
    } catch (error) {
      this.logger.error(
        `[TRANSACT] Failed to fetch next of kin: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error instanceof Error ? error : new Error(String(error)),
        LogCategory.SYSTEM,
        {
          eventType: 'transact_get_member_next_of_kin_error',
          memberId,
          userId,
        },
      );

      throw new BadRequestException('Failed to fetch next of kin');
    }
  }

  /* =====================================================
   * CREATE CASH PAYMENT (WEB - STAFF)
   * ===================================================== */
  async createCashPayment(dto: CashPaymentDto, staffUserId?: string) {
    const startTime = Date.now();

    // Validate UUIDs
    if (!dto.purchaseId || typeof dto.purchaseId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(dto.purchaseId)) {
      throw new BadRequestException('Invalid purchase ID format');
    }

    if (!dto.memberId || typeof dto.memberId !== 'string' || dto.memberId.length < 10) {
      throw new BadRequestException('Invalid member ID format');
    }

    try {
      this.logger.info(
        `[TRANSACT] Cash payment initiated: $${dto.amount} for purchase ${dto.purchaseId}`,
        LogCategory.PAYMENT,
        {
          eventType: 'transact_cash_payment_initiated',
          purchaseId: dto.purchaseId,
          memberId: dto.memberId,
          amount: dto.amount,
          staffUserId,
        },
      );

      // Verify purchase exists and belongs to member
      const purchase = await this.prisma.purchase.findUnique({
        where: { id: dto.purchaseId },
        include: {
          product: {
            select: {
              id: true,
              title: true,
              category: true,
            },
          },
        },
      });

      if (!purchase) {
        this.logger.warn(
          `[TRANSACT] Cash payment failed: Purchase not found`,
          LogCategory.PAYMENT,
          {
            eventType: 'transact_cash_payment_error',
            purchaseId: dto.purchaseId,
            memberId: dto.memberId,
            error: 'Purchase not found',
            staffUserId,
          },
        );
        throw new NotFoundException('Purchase not found');
      }

      if (purchase.memberId !== dto.memberId) {
        this.logger.warn(
          `[TRANSACT] Cash payment failed: Member mismatch`,
          LogCategory.PAYMENT,
          {
            eventType: 'transact_cash_payment_error',
            purchaseId: dto.purchaseId,
            memberId: dto.memberId,
            purchaseMemberId: purchase.memberId,
            error: 'Member mismatch',
            staffUserId,
          },
        );
        throw new ForbiddenException('Purchase does not belong to this member');
      }

      if (purchase.status === PurchaseStatus.PAID) {
        this.logger.warn(
          `[TRANSACT] Cash payment failed: Already paid`,
          LogCategory.PAYMENT,
          {
            eventType: 'transact_cash_payment_error',
            purchaseId: dto.purchaseId,
            memberId: dto.memberId,
            error: 'Already paid',
            staffUserId,
          },
        );
        throw new BadRequestException('Purchase is already fully paid');
      }

      // Validate amount
      const amount = Number(dto.amount);
      if (!amount || amount <= 0) {
        throw new BadRequestException('Invalid payment amount');
      }

      const balance = Number(purchase.balance);
      if (amount > balance) {
        throw new BadRequestException(
          `Amount exceeds balance of $${balance.toFixed(2)}`,
        );
      }

      // Determine internal method:
      // - CASH   → in-person cash at counter
      // - MANUAL → client paid externally; staff is just recording it
      const internalMethod = dto.method === 'MANUAL' ? 'MANUAL' : 'CASH';

      // Create internal payment using PaymentsService
      await this.paymentsService.createPayment(
        {
          purchaseId: dto.purchaseId,
          amount: amount,
          method: internalMethod,
        },
        dto.memberId, // Staff can pay for any member
      );

      // Get updated purchase
      const updatedPurchase = await this.prisma.purchase.findUnique({
        where: { id: dto.purchaseId },
        include: {
          product: {
            select: {
              id: true,
              title: true,
              category: true,
            },
          },
        },
      });

      // Get the payment that was just created
      const payment = await this.prisma.payment.findFirst({
        where: {
          purchaseId: dto.purchaseId,
          memberId: dto.memberId,
        },
        orderBy: { createdAt: 'desc' },
      });

      // For immediate burials, create deceased and next of kin records after payment
      if (
        updatedPurchase?.status === PurchaseStatus.PAID &&
        updatedPurchase?.purchaseType === PurchaseType.IMMEDIATE &&
        updatedPurchase?.product?.category === ItemCategory.SERENITY_GROUND
      ) {
        await this.processPendingDetailsForPurchase(
          dto.purchaseId,
          dto.memberId,
          staffUserId,
        );
      }

      const duration = Date.now() - startTime;

      this.logger.info(
        `[TRANSACT] Cash payment successful: $${amount} processed`,
        LogCategory.PAYMENT,
        {
          eventType: 'transact_cash_payment_success',
          purchaseId: dto.purchaseId,
          memberId: dto.memberId,
          paymentId: payment?.id,
          amount,
          newBalance: Number(updatedPurchase?.balance || 0),
          duration,
          staffUserId,
        },
      );

      // Emit real-time update
      this.dashboardGateway.broadcastDashboardUpdate();

      return {
        payment,
        purchase: updatedPurchase,
      };
    } catch (error) {
      const duration = Date.now() - startTime;

      // Re-throw known exceptions
      if (
        error instanceof NotFoundException ||
        error instanceof ForbiddenException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }

      // Log unexpected errors
      this.logger.error(
        `[TRANSACT] Cash payment error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error instanceof Error ? error : new Error(String(error)),
        LogCategory.PAYMENT,
        {
          eventType: 'transact_cash_payment_error',
          purchaseId: dto.purchaseId,
          memberId: dto.memberId,
          amount: dto.amount,
          duration,
          staffUserId,
        },
      );

      throw new BadRequestException('Failed to process cash payment');
    }
  }

  /* =====================================================
   * CREATE LEGACY PLAN (WEB - STAFF)
   * ===================================================== */
  async createLegacyPlan(dto: CreateLegacyPlanDto, staffUserId?: string) {
    const startTime = Date.now();

    try {
      this.logger.info(
        `[TRANSACT] Legacy plan creation initiated for member: ${dto.memberId}`,
        LogCategory.SYSTEM,
        {
          eventType: 'transact_legacy_plan_initiated',
          memberId: dto.memberId,
          productId: dto.productId,
          totalAmount: dto.totalAmount,
          paidAmount: dto.paidAmount,
          staffUserId,
        },
      );

      // Validate member exists
      const member = await this.getMemberById(dto.memberId, staffUserId);

      // Validate product exists
      const product = await this.prisma.product.findUnique({
        where: { id: dto.productId },
      });

      if (!product) {
        this.logger.warn(
          `[TRANSACT] Legacy plan failed: Product not found`,
          LogCategory.SYSTEM,
          {
            eventType: 'transact_legacy_plan_error',
            memberId: dto.memberId,
            productId: dto.productId,
            error: 'Product not found',
            staffUserId,
          },
        );
        throw new NotFoundException('Product not found');
      }

      // Validate amounts
      const totalAmount = Number(dto.totalAmount);
      const paidAmount = Number(dto.paidAmount);

      if (paidAmount > totalAmount) {
        throw new BadRequestException('Paid amount cannot exceed total amount');
      }

      const balance = totalAmount - paidAmount;
      const status = balance <= 0 ? PurchaseStatus.PAID : PurchaseStatus.PARTIALLY_PAID;

      const purchase = await this.prisma.purchase.create({
        data: {
          memberId: dto.memberId,
          productId: dto.productId,
          purchaseType: 'FUTURE', // Legacy plans are typically future plans
          totalAmount: totalAmount,
          paidAmount: paidAmount,
          balance: balance,
          status: status,
          paidAt: status === PurchaseStatus.PAID ? new Date() : null,
          completedAt: status === PurchaseStatus.PAID ? new Date() : null,
        },
        include: {
          product: {
            select: {
              id: true,
              title: true,
              category: true,
            },
          },
        },
      });

      // If there's a paid amount, create a historical payment record
      // Note: This payment won't count toward today's sales (as per requirement)
      if (paidAmount > 0) {
        await this.prisma.payment.create({
          data: {
            purchaseId: purchase.id,
            memberId: dto.memberId,
            amount: paidAmount,
            method: 'LEGACY', // Mark as legacy payment
            reference: `LEGACY-${purchase.id}`,
            status: 'SUCCESS',
            paidAt: new Date(), // Use current date, but won't count in sales
          },
        });
      }

      const duration = Date.now() - startTime;

      this.logger.info(
        `[TRANSACT] Legacy plan created successfully: ${purchase.id}`,
        LogCategory.SYSTEM,
        {
          eventType: 'transact_legacy_plan_success',
          purchaseId: purchase.id,
          memberId: dto.memberId,
          productId: dto.productId,
          totalAmount,
          paidAmount,
          balance,
          duration,
          staffUserId,
        },
      );

      // Emit real-time update
      this.dashboardGateway.broadcastDashboardUpdate();

      return purchase;
    } catch (error) {
      const duration = Date.now() - startTime;

      if (
        error instanceof NotFoundException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }

      this.logger.error(
        `[TRANSACT] Legacy plan creation error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error instanceof Error ? error : new Error(String(error)),
        LogCategory.SYSTEM,
        {
          eventType: 'transact_legacy_plan_error',
          memberId: dto.memberId,
          productId: dto.productId,
          duration,
          staffUserId,
        },
      );

      throw new BadRequestException('Failed to create legacy plan');
    }
  }

  /* =====================================================
   * INITIATE PURCHASE (WEB - STAFF)
   * Reuses PurchasesService.initiatePurchase so logic matches the app.
   * For immediate burials, captures deceased and next of kin details before payment.
   * ===================================================== */
  async initiatePurchaseForMember(
    dto: StaffCreatePurchaseDto,
    staffUserId?: string,
  ) {
    const { memberId, deceasedDetails, nextOfKinDetails, ...purchaseDto } = dto;

    // Validate member exists (and log via existing helper)
    await this.getMemberById(memberId, staffUserId);

    // Validate that for immediate burials, deceased and next of kin details are provided
    if (purchaseDto.purchaseType === PurchaseType.IMMEDIATE) {
      // Check if product is a grave (SERENITY_GROUND category)
      const product = await this.prisma.product.findUnique({
        where: { id: purchaseDto.productId },
        select: { category: true },
      });

      if (product?.category === ItemCategory.SERENITY_GROUND) {
        if (!deceasedDetails) {
          throw new BadRequestException(
            'Deceased details are required for immediate burial purchases',
          );
        }
        if (!nextOfKinDetails) {
          throw new BadRequestException(
            'Next of kin details are required for immediate burial purchases',
          );
        }
      }
    }

    // For future plans, next of kin details are also required (like the app)
    if (purchaseDto.purchaseType === PurchaseType.FUTURE && nextOfKinDetails) {
      // Store next of kin details to be saved after purchase creation
      // We'll save them after the purchase is created
    }

    try {
      this.logger.info(
        `[TRANSACT] Staff initiating purchase for member: ${memberId}`,
        LogCategory.SYSTEM,
        {
          eventType: 'transact_staff_initiate_purchase',
          memberId,
          productId: purchaseDto.productId,
          purchaseType: purchaseDto.purchaseType,
          yearPlanId: purchaseDto.yearPlanId,
          hasDeceasedDetails: !!deceasedDetails,
          hasNextOfKinDetails: !!nextOfKinDetails,
          staffUserId,
        },
      );

      const purchase = await this.purchasesService.initiatePurchase(
        purchaseDto,
        memberId,
      );

      // Store deceased and next of kin details temporarily for immediate burials
      if (
        purchaseDto.purchaseType === PurchaseType.IMMEDIATE &&
        deceasedDetails &&
        nextOfKinDetails
      ) {
        this.pendingDetailsMap.set(purchase.id, {
          deceasedDetails,
          nextOfKinDetails,
        });

        this.logger.info(
          `[TRANSACT] Stored pending deceased/next of kin details for purchase: ${purchase.id}`,
          LogCategory.SYSTEM,
          {
            eventType: 'transact_pending_details_stored',
            purchaseId: purchase.id,
            memberId,
            staffUserId,
          },
        );
      }

      // For future plans, store next of kin details temporarily
      // They will be saved as BurialNextOfKin when deceased is created (on redemption)
      if (
        purchaseDto.purchaseType === PurchaseType.FUTURE &&
        nextOfKinDetails
      ) {
        // Store temporarily for when they redeem later
        this.pendingDetailsMap.set(purchase.id, {
          deceasedDetails: null as any, // Will be provided when redeeming
          nextOfKinDetails,
        });

        this.logger.info(
          `[TRANSACT] Stored next of kin details for future plan (will be saved when deceased is created): ${purchase.id}`,
          LogCategory.SYSTEM,
          {
            eventType: 'transact_next_of_kin_stored_future',
            purchaseId: purchase.id,
            memberId,
            staffUserId,
          },
        );
      }

      return purchase;
    } catch (error) {
      this.logger.error(
        `[TRANSACT] Staff purchase initiation failed: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
        error instanceof Error ? error : new Error(String(error)),
        LogCategory.SYSTEM,
        {
          eventType: 'transact_staff_initiate_purchase_error',
          memberId,
          productId: dto.productId,
          purchaseType: dto.purchaseType,
          yearPlanId: dto.yearPlanId,
          staffUserId,
        },
      );

      throw new BadRequestException('Failed to initiate purchase');
    }
  }

  /* =====================================================
   * INITIATE PAYNOW PAYMENT (ADMIN/STAFF)
   * ===================================================== */
  async initiatePayNowPayment(
    purchaseId: string,
    memberId: string,
    amount: number,
    staffUserId?: string,
  ) {
    const startTime = Date.now();

    // Validate UUIDs
    if (!purchaseId || typeof purchaseId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(purchaseId)) {
      throw new BadRequestException('Invalid purchase ID format');
    }

    if (!memberId || typeof memberId !== 'string' || memberId.length < 10) {
      throw new BadRequestException('Invalid member ID format');
    }

    try {
      this.logger.info(
        `[TRANSACT] PayNow payment initiated: $${amount} for purchase ${purchaseId}`,
        LogCategory.PAYMENT,
        {
          eventType: 'transact_paynow_payment_initiated',
          purchaseId,
          memberId,
          amount,
          staffUserId,
        },
      );

      // Verify purchase exists and belongs to member
      const purchase = await this.prisma.purchase.findUnique({
        where: { id: purchaseId },
      });

      if (!purchase) {
        throw new NotFoundException('Purchase not found');
      }

      if (purchase.memberId !== memberId) {
        throw new ForbiddenException('Purchase does not belong to this member');
      }

      if (purchase.status === PurchaseStatus.PAID) {
        throw new BadRequestException('Purchase is already fully paid');
      }

      // Validate amount
      const payable = Number(amount);
      if (!payable || payable <= 0) {
        throw new BadRequestException('Invalid payment amount');
      }

      const balance = Number(purchase.balance);
      if (payable > balance) {
        throw new BadRequestException(`Amount exceeds balance of $${balance.toFixed(2)}`);
      }

      // Use PaymentsService to initiate PayNow payment
      const result = await this.paymentsService.initiatePayNowPayment(
        purchaseId,
        memberId, // Staff can pay for any member
        payable,
      );

      const duration = Date.now() - startTime;

      this.logger.info(
        `[TRANSACT] PayNow payment initiated successfully`,
        LogCategory.PAYMENT,
        {
          eventType: 'transact_paynow_payment_success',
          purchaseId,
          memberId,
          amount: payable,
          reference: result.reference,
          duration,
          staffUserId,
        },
      );

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;

      if (
        error instanceof NotFoundException ||
        error instanceof ForbiddenException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }

      this.logger.error(
        `[TRANSACT] PayNow payment error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error instanceof Error ? error : new Error(String(error)),
        LogCategory.PAYMENT,
        {
          eventType: 'transact_paynow_payment_error',
          purchaseId,
          memberId,
          amount,
          duration,
          staffUserId,
        },
      );

      throw new BadRequestException('Failed to initiate PayNow payment');
    }
  }

  /* =====================================================
   * INITIATE ECOCASH PUSH (ADMIN/STAFF)
   * ===================================================== */
  async initiateEcoCashPush(
    purchaseId: string,
    memberId: string,
    phone: string,
    amount: number,
    staffUserId?: string,
  ) {
    const startTime = Date.now();

    // Validate UUIDs
    if (!purchaseId || typeof purchaseId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(purchaseId)) {
      throw new BadRequestException('Invalid purchase ID format');
    }

    if (!memberId || typeof memberId !== 'string' || memberId.length < 10) {
      throw new BadRequestException('Invalid member ID format');
    }

    try {
      this.logger.info(
        `[TRANSACT] EcoCash payment initiated: $${amount} for purchase ${purchaseId}`,
        LogCategory.PAYMENT,
        {
          eventType: 'transact_ecocash_payment_initiated',
          purchaseId,
          memberId,
          phone,
          amount,
          staffUserId,
        },
      );

      // Verify purchase exists and belongs to member
      const purchase = await this.prisma.purchase.findUnique({
        where: { id: purchaseId },
      });

      if (!purchase) {
        throw new NotFoundException('Purchase not found');
      }

      if (purchase.memberId !== memberId) {
        throw new ForbiddenException('Purchase does not belong to this member');
      }

      if (purchase.status === PurchaseStatus.PAID) {
        throw new BadRequestException('Purchase is already fully paid');
      }

      // Validate amount
      const payable = Number(amount);
      if (!payable || payable <= 0) {
        throw new BadRequestException('Invalid payment amount');
      }

      const balance = Number(purchase.balance);
      if (payable > balance) {
        throw new BadRequestException(`Amount exceeds balance of $${balance.toFixed(2)}`);
      }

      // Use PaymentsService to initiate EcoCash payment
      const result = await this.paymentsService.initiateEcoCashPush(
        purchaseId,
        memberId, // Staff can pay for any member
        phone,
        payable,
      );

      const duration = Date.now() - startTime;

      this.logger.info(
        `[TRANSACT] EcoCash payment initiated successfully`,
        LogCategory.PAYMENT,
        {
          eventType: 'transact_ecocash_payment_success',
          purchaseId,
          memberId,
          phone,
          amount: payable,
          reference: result.reference,
          duration,
          staffUserId,
        },
      );

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;

      if (
        error instanceof NotFoundException ||
        error instanceof ForbiddenException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }

      this.logger.error(
        `[TRANSACT] EcoCash payment error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error instanceof Error ? error : new Error(String(error)),
        LogCategory.PAYMENT,
        {
          eventType: 'transact_ecocash_payment_error',
          purchaseId,
          memberId,
          phone,
          amount,
          duration,
          staffUserId,
        },
      );

      throw new BadRequestException('Failed to initiate EcoCash payment');
    }
  }

  /* =====================================================
   * POLL PAYMENT STATUS (STAFF)
   * Allows staff to poll payment status for any payment
   * ===================================================== */
  async pollPaymentStatus(paymentId: string, staffUserId: string) {
    // Staff can poll any payment, so we bypass memberId check
    // by using PaymentsService's internal polling logic
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
    });

    if (!payment) {
      throw new NotFoundException('Payment not found');
    }

    // Use PaymentsService's polling logic but bypass memberId check
    if (payment.status !== PaymentStatus.INITIATED) {
      return { status: payment.status };
    }

    if (!payment.pollUrl) {
      return { status: payment.status };
    }

    const result = await this.paynowService.pollPayment(payment.pollUrl);
    const mapped = this.mapPayNowStatus(result.status);

    // Finalize payment using PaymentsService logic
    await this.paymentsService.finalizePayment(payment.id, mapped);

    // If payment succeeded, check if we need to process pending deceased/next of kin details
    if (mapped === PaymentStatus.SUCCESS) {
      // Get updated purchase to check status
      const updatedPurchase = await this.prisma.purchase.findUnique({
        where: { id: payment.purchaseId },
        include: { product: true },
      });

      // Process pending details if purchase is fully paid and is an immediate burial
      if (
        updatedPurchase?.status === PurchaseStatus.PAID &&
        updatedPurchase?.purchaseType === PurchaseType.IMMEDIATE &&
        updatedPurchase?.product?.category === ItemCategory.SERENITY_GROUND
      ) {
        // Process in background to avoid blocking the response
        setImmediate(async () => {
          try {
            await this.processPendingDetailsForPurchase(
              payment.purchaseId,
              payment.memberId,
              staffUserId,
            );
          } catch (err) {
            this.logger.error(
              `[TRANSACT] Failed to process pending details after payment: ${err instanceof Error ? err.message : 'Unknown error'}`,
              err instanceof Error ? err : new Error(String(err)),
              LogCategory.SYSTEM,
              {
                eventType: 'transact_process_pending_details_error',
                purchaseId: payment.purchaseId,
                paymentId: payment.id,
                memberId: payment.memberId,
                staffUserId,
              },
            );
          }
        });
      }
    }

    return { status: mapped };
  }

  private mapPayNowStatus(status: string): PaymentStatus {
    const s = status?.toLowerCase();
    if (s === 'paid' || s === 'awaiting delivery' || s === 'delivered') {
      return PaymentStatus.SUCCESS;
    }
    if (s === 'failed' || s === 'cancelled' || s === 'expired') {
      return PaymentStatus.FAILED;
    }
    return PaymentStatus.INITIATED;
  }

  /* =====================================================
   * GET STORED NEXT OF KIN FOR PURCHASE
   * Returns stored next of kin details if available (for future plan redemptions)
   * ===================================================== */
  getStoredNextOfKinForPurchase(purchaseId: string): UpsertNextOfKinDto | null {
    const pendingDetails = this.pendingDetailsMap.get(purchaseId);
    return pendingDetails?.nextOfKinDetails || null;
  }

  /* =====================================================
   * PROCESS PENDING DETAILS AFTER PAYMENT
   * Creates deceased and next of kin records for immediate burials
   * after payment succeeds
   * Can be called from payment completion handlers
   * ===================================================== */
  async processPendingDetailsForPurchase(
    purchaseId: string,
    memberId: string,
    staffUserId?: string,
  ) {
    const pendingDetails = this.pendingDetailsMap.get(purchaseId);

    if (!pendingDetails || !pendingDetails.deceasedDetails) {
      // No pending details or no deceased details (future plan), skip
      return;
    }

    try {
      this.logger.info(
        `[TRANSACT] Processing pending deceased/next of kin details for purchase: ${purchaseId}`,
        LogCategory.SYSTEM,
        {
          eventType: 'transact_process_pending_details',
          purchaseId,
          memberId,
          staffUserId,
        },
      );

      const { deceasedDetails, nextOfKinDetails } = pendingDetails;

      // Get purchase to check if buyer is the next of kin
      const purchase = await this.prisma.purchase.findUnique({
        where: { id: purchaseId },
        include: { member: true },
      });

      const isBuyerNextOfKin = purchase?.member && 
        nextOfKinDetails.fullName.toLowerCase().includes(purchase.member.firstName.toLowerCase()) &&
        nextOfKinDetails.fullName.toLowerCase().includes(purchase.member.lastName.toLowerCase());

      // Create deceased record with next of kin (this also redeems the purchase)
      // Next of kin is tied to deceased via BurialNextOfKin, not to member
      await this.deceasedService.createAndRedeem(
        {
          ...deceasedDetails,
          purchaseId,
          nextOfKin: {
            ...nextOfKinDetails,
            isBuyer: isBuyerNextOfKin || false,
          },
        } as CreateDeceasedDto,
        memberId,
      );

      // Remove from pending map
      this.pendingDetailsMap.delete(purchaseId);

      this.logger.info(
        `[TRANSACT] Successfully created deceased and next of kin records for purchase: ${purchaseId}`,
        LogCategory.SYSTEM,
        {
          eventType: 'transact_process_pending_details_success',
          purchaseId,
          memberId,
          staffUserId,
        },
      );
    } catch (error) {
      this.logger.error(
        `[TRANSACT] Failed to process pending details: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
        error instanceof Error ? error : new Error(String(error)),
        LogCategory.SYSTEM,
        {
          eventType: 'transact_process_pending_details_error',
          purchaseId,
          memberId,
          staffUserId,
        },
      );

      // Don't throw - payment already succeeded, details can be added manually later
      // But log the error for staff to handle
    }
  }
}
