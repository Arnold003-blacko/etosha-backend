import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Req,
  ForbiddenException,
} from '@nestjs/common';
import { StaffService } from './staff.service';
import { CreateStaffDto } from './dto/create-staff.dto';
import { UpdateStaffDto } from './dto/update-staff.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { StaffJwtGuard } from '../staff-auth/staff-jwt.guard';

@Controller('staff')
@UseGuards(StaffJwtGuard)
export class StaffController {
  constructor(private readonly staffService: StaffService) {}

  @Post()
  async create(@Body() createStaffDto: CreateStaffDto, @Req() req: any) {
    if (!req.user?.isSystemAdmin) {
      throw new ForbiddenException('Only system administrator can create staff');
    }
    return this.staffService.create(createStaffDto);
  }

  @Get()
  async findAll(@Req() req: any) {
    if (!req.user?.isSystemAdmin) {
      throw new ForbiddenException('Only system administrator can list all staff');
    }
    return this.staffService.findAll();
  }

  @Get('pending-approvals')
  async getPendingApprovals(@Req() req: any) {
    if (!req.user?.isSystemAdmin) {
      throw new ForbiddenException('Only system administrator can view pending approvals');
    }
    return this.staffService.getPendingApprovals();
  }

  @Get(':id')
  async findOne(@Param('id') id: string, @Req() req: any) {
    // Users can view their own profile, admins can view any
    if (!req.user?.isSystemAdmin && req.user?.id !== id) {
      throw new ForbiddenException('You can only view your own profile');
    }
    return this.staffService.findOne(id);
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() updateStaffDto: UpdateStaffDto,
    @Req() req: any,
  ) {
    // Users can update their own profile (limited fields), admins can update any
    if (!req.user?.isSystemAdmin && req.user?.id !== id) {
      throw new ForbiddenException('You can only update your own profile');
    }
    return this.staffService.update(id, updateStaffDto, req.user);
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @Req() req: any) {
    return this.staffService.remove(id, req.user);
  }

  @Patch(':id/approve')
  async approve(@Param('id') id: string, @Req() req: any) {
    return this.staffService.approve(id, req.user);
  }

  @Patch(':id/toggle-active')
  async toggleActive(@Param('id') id: string, @Req() req: any) {
    return this.staffService.toggleActive(id, req.user);
  }

  @Patch(':id/assign-admin')
  async assignAdmin(@Param('id') id: string, @Req() req: any) {
    return this.staffService.assignAdmin(id, req.user);
  }

  @Patch(':id/change-password')
  async changePassword(
    @Param('id') id: string,
    @Body() changePasswordDto: ChangePasswordDto,
    @Req() req: any,
  ) {
    return this.staffService.changePassword(id, changePasswordDto, req.user);
  }
}
