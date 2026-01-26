import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { BurialsService } from './burials.service';
import { CreateBurialDto } from './dto/create-burial.dto';
import { CreateWaiverDto } from './dto/create-waiver.dto';
import { ApproveWaiverDto } from './dto/approve-waiver.dto';
import { CreateAssignmentRequestDto } from './dto/create-assignment-request.dto';
import { AssignGraveDto } from './dto/assign-grave.dto';
import { UpdateDeceasedDto } from './dto/update-deceased.dto';
import { StaffJwtGuard } from '../staff-auth/staff-jwt.guard';
import { BurialStatus, AssignmentRequestStatus } from '@prisma/client';

@Controller('burials')
@UseGuards(StaffJwtGuard)
export class BurialsController {
  constructor(private readonly burialsService: BurialsService) {}

  @Post()
  async createBurial(@Body() dto: CreateBurialDto, @Request() req: any) {
    return this.burialsService.createBurial(dto, req.user.id);
  }

  @Get('register')
  async getDeceasedRegister(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('status') status?: BurialStatus,
  ) {
    return this.burialsService.getDeceasedRegister(
      page ? parseInt(page) : 1,
      limit ? parseInt(limit) : 50,
      search,
      status,
    );
  }

  @Get('calendar')
  async getBurialCalendar(
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
  ) {
    return this.burialsService.getBurialCalendar(
      new Date(startDate),
      new Date(endDate),
    );
  }

  // Purchase lookup endpoint (must be before :id route)
  @Get('purchases/:purchaseId')
  async lookupPurchase(@Param('purchaseId') purchaseId: string) {
    return this.burialsService.lookupPurchase(purchaseId);
  }

  @Get(':id')
  async getDeceasedById(@Param('id') id: string) {
    return this.burialsService.getDeceasedById(id);
  }

  @Put(':id')
  async updateDeceased(
    @Param('id') id: string,
    @Body() dto: UpdateDeceasedDto,
  ) {
    return this.burialsService.updateDeceased(id, dto);
  }

  @Patch(':id/mark-buried')
  async markBuried(@Param('id') id: string) {
    return this.burialsService.markBuried(id);
  }

  // Waiver endpoints
  @Post('waivers')
  async createWaiver(@Body() dto: CreateWaiverDto) {
    return this.burialsService.createWaiver(dto);
  }

  @Put('waivers/approve')
  async approveWaiver(@Body() dto: ApproveWaiverDto, @Request() req: any) {
    return this.burialsService.approveWaiver(
      dto,
      req.user.id,
      req.user.level,
    );
  }

  // Assignment request endpoints
  @Post('assignment-requests')
  async createAssignmentRequest(
    @Body() dto: CreateAssignmentRequestDto,
    @Request() req: any,
  ) {
    return this.burialsService.createAssignmentRequest(dto, req.user.id);
  }

  @Get('assignment-requests/queue')
  async getAssignmentRequests(
    @Query('status') status?: AssignmentRequestStatus,
  ) {
    return this.burialsService.getAssignmentRequests(status);
  }

  // Grave assignment endpoint
  @Post('assign-grave')
  async assignGrave(@Body() dto: AssignGraveDto, @Request() req: any) {
    return this.burialsService.assignGrave(dto, req.user.id);
  }
}
