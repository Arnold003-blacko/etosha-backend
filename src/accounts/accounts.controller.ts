import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { AccountsService } from './accounts.service';
import { StaffJwtGuard } from '../staff-auth/staff-jwt.guard';

@Controller('accounts')
@UseGuards(StaffJwtGuard)
export class AccountsController {
  constructor(private readonly accountsService: AccountsService) {}

  /**
   * GET /accounts/member/:memberId/statement
   * Generate financial statement for a member
   */
  @Get('member/:memberId/statement')
  async getFinancialStatement(
    @Param('memberId') memberId: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const start = startDate ? new Date(startDate) : undefined;
    const end = endDate ? new Date(endDate) : undefined;

    return this.accountsService.getFinancialStatement(memberId, start, end);
  }
}
