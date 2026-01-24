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
import { PurchasesService } from '../purchases/purchases.service';
import { MembersService } from '../members/members.service';
import { DashboardGateway } from '../dashboard/dashboard.gateway';
import { LoggerService, LogCategory } from '../dashboard/logger.service';
import { CashPaymentDto } from './dto/cash-payment.dto';
import { CreateLegacyPlanDto } from './dto/legacy-plan.dto';
import { StaffCreatePurchaseDto } from './dto/staff-create-purchase.dto';
import { PurchaseStatus } from '@prisma/client';

@Injectable()
export class TransactService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly paymentsService: PaymentsService,
    private readonly purchasesService: PurchasesService,
    private readonly membersService: MembersService,
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
        throw new BadRequestException(`Amount exceeds balance of $${balance.toFixed(2)}`);
      }

      // Create cash payment using PaymentsService
      await this.paymentsService.createPayment(
        {
          purchaseId: dto.purchaseId,
          amount: amount,
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
   * ===================================================== */
  async initiatePurchaseForMember(
    dto: StaffCreatePurchaseDto,
    staffUserId?: string,
  ) {
    const { memberId, ...purchaseDto } = dto;

    // Validate member exists (and log via existing helper)
    await this.getMemberById(memberId, staffUserId);

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
          staffUserId,
        },
      );

      const purchase = await this.purchasesService.initiatePurchase(
        purchaseDto,
        memberId,
      );

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
}
