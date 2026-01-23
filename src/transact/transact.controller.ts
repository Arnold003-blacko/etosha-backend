import {
  Controller,
  Get,
  Post,
  Query,
  Body,
  Param,
  // UseGuards, // Disabled for development
  Req,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { TransactService } from './transact.service';
// import { JwtAuthGuard } from '../auth/jwt-auth.guard'; // Disabled for development
import { SearchMembersDto } from './dto/search-members.dto';
import { CashPaymentDto } from './dto/cash-payment.dto';
import { CreateLegacyPlanDto } from './dto/legacy-plan.dto';

@Controller('transact')
// Authentication disabled for development - will be enabled later
// @UseGuards(JwtAuthGuard)
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
      // Authentication disabled for development
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
      // Authentication disabled for development
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
      // Authentication disabled for development
      const userId = req.user?.id || req.user?.sub || null;
      return await this.transactService.getMemberPurchases(memberId, userId);
    } catch (error) {
      throw error;
    }
  }

  /* =====================================================
   * CREATE CASH PAYMENT
   * POST /transact/payments/cash
   * ===================================================== */
  @Post('payments/cash')
  @HttpCode(HttpStatus.CREATED)
  async createCashPayment(@Body() dto: CashPaymentDto, @Req() req: any) {
    try {
      // Authentication disabled for development
      const staffUserId = req.user?.id || req.user?.sub || null;
      return await this.transactService.createCashPayment(dto, staffUserId);
    } catch (error) {
      throw error;
    }
  }

  /* =====================================================
   * CREATE LEGACY PLAN
   * POST /transact/plans/legacy
   * ===================================================== */
  @Post('plans/legacy')
  @HttpCode(HttpStatus.CREATED)
  async createLegacyPlan(@Body() dto: CreateLegacyPlanDto, @Req() req: any) {
    try {
      // Authentication disabled for development
      const staffUserId = req.user?.id || req.user?.sub || null;
      return await this.transactService.createLegacyPlan(dto, staffUserId);
    } catch (error) {
      throw error;
    }
  }
}
