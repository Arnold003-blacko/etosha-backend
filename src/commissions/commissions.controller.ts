import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { CommissionsService } from './commissions.service';
import { CreateCommissionDto } from './dto/create-commission.dto';
import { ApproveCommissionDto } from './dto/approve-commission.dto';
import { StaffJwtGuard } from '../staff-auth/staff-jwt.guard';
import { CommissionStatus } from '@prisma/client';

@Controller('commissions')
@UseGuards(StaffJwtGuard)
export class CommissionsController {
  constructor(private readonly commissionsService: CommissionsService) {}

  @Post()
  async createCommission(@Body() dto: CreateCommissionDto) {
    return this.commissionsService.createCommission(dto);
  }

  @Get()
  async getCommissions(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: CommissionStatus,
    @Query('company') company?: string,
    @Query('agentStaffId') agentStaffId?: string,
  ) {
    return this.commissionsService.getCommissions(
      page ? parseInt(page) : 1,
      limit ? parseInt(limit) : 50,
      status,
      company,
      agentStaffId,
    );
  }

  @Get(':id')
  async getCommissionById(@Param('id') id: string) {
    return this.commissionsService.getCommissionById(id);
  }

  @Put('approve')
  async approveCommission(@Body() dto: ApproveCommissionDto, @Request() req: any) {
    return this.commissionsService.approveCommission(
      dto,
      req.user.id,
      req.user.level,
    );
  }
}
