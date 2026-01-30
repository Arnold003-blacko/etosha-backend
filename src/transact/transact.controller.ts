import {
  Controller,
  Get,
  Post,
  Query,
  Body,
  Param,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { TransactService } from './transact.service';
import { StaffJwtGuard } from '../staff-auth/staff-jwt.guard';
import { SearchMembersDto } from './dto/search-members.dto';
import { CashPaymentDto } from './dto/cash-payment.dto';
import { CreateLegacyPlanDto } from './dto/legacy-plan.dto';
import { StaffCreatePurchaseDto } from './dto/staff-create-purchase.dto';

@Controller('transact')
@UseGuards(StaffJwtGuard)
export class TransactController {
  constructor(private readonly transactService: TransactService) {}

  /* =====================================================
   * SEARCH MEMBERS
   * GET /transact/members/search?q=query
   * ===================================================== */
  @Get('members/search')
  @HttpCode(HttpStatus.OK)
  async searchMembers(@Query() dto: SearchMembersDto, @Req() req: any) {
    try {
      const userId = req.user?.id || req.user?.sub || null;
      return await this.transactService.searchMembers(dto.q, userId);
    } catch (error) {
      // Error is handled by service
      throw error;
    }
  }

  /* =====================================================
   * GET MEMBER BY ID
   * GET /transact/members/:memberId
   * ===================================================== */
  @Get('members/:memberId')
  @HttpCode(HttpStatus.OK)
  async getMember(@Param('memberId') memberId: string, @Req() req: any) {
    try {
      const userId = req.user?.id || req.user?.sub || null;
      return await this.transactService.getMemberById(memberId, userId);
    } catch (error) {
      throw error;
    }
  }

  /* =====================================================
   * GET MEMBER PURCHASES
   * GET /transact/members/:memberId/purchases
   * ===================================================== */
  @Get('members/:memberId/purchases')
  @HttpCode(HttpStatus.OK)
  async getMemberPurchases(@Param('memberId') memberId: string, @Req() req: any) {
    try {
      const userId = req.user?.id || req.user?.sub || null;
      return await this.transactService.getMemberPurchases(memberId, userId);
    } catch (error) {
      throw error;
    }
  }

  /* =====================================================
   * GET MEMBER NEXT OF KIN
   * GET /transact/members/:memberId/next-of-kin
   * ===================================================== */
  @Get('members/:memberId/next-of-kin')
  @HttpCode(HttpStatus.OK)
  async getMemberNextOfKin(@Param('memberId') memberId: string, @Req() req: any) {
    try {
      const userId = req.user?.id || req.user?.sub || null;
      return await this.transactService.getMemberNextOfKin(memberId, userId);
    } catch (error) {
      throw error;
    }
  }

  /* =====================================================
   * INITIATE PURCHASE (WEB - STAFF)
   * POST /transact/purchases/initiate
   * ===================================================== */
  @Post('purchases/initiate')
  @HttpCode(HttpStatus.CREATED)
  async initiatePurchase(
    @Body() dto: StaffCreatePurchaseDto,
    @Req() req: any,
  ) {
    const staffUserId = req.user?.id || req.user?.sub || null;
    return this.transactService.initiatePurchaseForMember(dto, staffUserId);
  }

  /* =====================================================
   * CREATE CASH PAYMENT (ADMIN/STAFF)
   * POST /transact/payments/cash
   * ===================================================== */
  @Post('payments/cash')
  @HttpCode(HttpStatus.CREATED)
  async createCashPayment(@Body() dto: CashPaymentDto, @Req() req: any) {
    try {
      const staffUserId = req.user?.id || req.user?.sub || null;
      return await this.transactService.createCashPayment(dto, staffUserId);
    } catch (error) {
      throw error;
    }
  }

  /* =====================================================
   * INITIATE PAYNOW PAYMENT (ADMIN/STAFF)
   * POST /transact/payments/paynow
   * ===================================================== */
  @Post('payments/paynow')
  @HttpCode(HttpStatus.OK)
  async initiatePayNow(
    @Body('purchaseId') purchaseId: string,
    @Body('memberId') memberId: string,
    @Body('amount') amount: number,
    @Req() req: any,
  ) {
    if (!purchaseId || !memberId || !amount) {
      throw new BadRequestException(
        'purchaseId, memberId and amount are required',
      );
    }

    const staffUserId = req.user?.id || req.user?.sub || null;
    return await this.transactService.initiatePayNowPayment(
      purchaseId,
      memberId,
      Number(amount),
      staffUserId,
    );
  }

  /* =====================================================
   * INITIATE ECOCASH PUSH (ADMIN/STAFF)
   * POST /transact/payments/ecocash
   * ===================================================== */
  @Post('payments/ecocash')
  @HttpCode(HttpStatus.OK)
  async initiateEcoCash(
    @Body('purchaseId') purchaseId: string,
    @Body('memberId') memberId: string,
    @Body('phone') phone: string,
    @Body('amount') amount: number,
    @Req() req: any,
  ) {
    if (!purchaseId || !memberId || !phone || !amount) {
      throw new BadRequestException(
        'purchaseId, memberId, phone and amount are required',
      );
    }

    const staffUserId = req.user?.id || req.user?.sub || null;
    return await this.transactService.initiateEcoCashPush(
      purchaseId,
      memberId,
      phone,
      Number(amount),
      staffUserId,
    );
  }

  /* =====================================================
   * POLL PAYMENT STATUS (STAFF)
   * POST /transact/payments/poll
   * Allows staff to poll payment status for any payment
   * ===================================================== */
  @Post('payments/poll')
  @HttpCode(HttpStatus.OK)
  async pollPayment(
    @Body('paymentId') paymentId: string,
    @Req() req: any,
  ) {
    if (!paymentId) {
      throw new BadRequestException('paymentId is required');
    }

    const staffUserId = req.user?.id || req.user?.sub || null;
    return await this.transactService.pollPaymentStatus(paymentId, staffUserId);
  }

  /* =====================================================
   * CREATE LEGACY PLAN
   * POST /transact/plans/legacy
   * ===================================================== */
  @Post('plans/legacy')
  @HttpCode(HttpStatus.CREATED)
  async createLegacyPlan(@Body() dto: CreateLegacyPlanDto, @Req() req: any) {
    try {
      const staffUserId = req.user?.id || req.user?.sub || null;
      return await this.transactService.createLegacyPlan(dto, staffUserId);
    } catch (error) {
      throw error;
    }
  }

  /* =====================================================
   * VERIFY DECEASED RECORDS WERE SAVED
   * GET /transact/purchases/:purchaseId/verify-deceased
   * Returns whether deceased and next of kin records exist for a purchase
   * ===================================================== */
  @Get('purchases/:purchaseId/verify-deceased')
  @HttpCode(HttpStatus.OK)
  async verifyDeceasedRecordsSaved(@Param('purchaseId') purchaseId: string) {
    try {
      return await this.transactService.verifyDeceasedRecordsSaved(purchaseId);
    } catch (error) {
      throw error;
    }
  }
}
