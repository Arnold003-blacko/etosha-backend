import { Body, Controller, Post, UseGuards, Get, Param, Patch, ForbiddenException, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  IsEmail,
  IsNotEmpty,
  MinLength,
  IsString,
  IsIn,
  IsInt,
  Min,
  Max,
} from 'class-validator';
import { StaffAuthService } from './staff-auth.service';
import { StaffJwtGuard } from './staff-jwt.guard';
import { PrismaService } from '../prisma/prisma.service';

class StaffRegisterDto {
  @IsNotEmpty()
  @IsString()
  firstName: string;

  @IsNotEmpty()
  @IsString()
  lastName: string;

  @IsEmail()
  email: string;

  @IsNotEmpty()
  @IsString()
  phone: string;

  @IsNotEmpty()
  @IsString()
  nationalId: string;

  @IsNotEmpty()
  dateOfBirth: string; // ISO string

  @IsNotEmpty()
  @IsString()
  address: string;

  @IsIn(['SITE', 'OFFICE', 'PASTORAL'])
  staffType: 'SITE' | 'OFFICE' | 'PASTORAL';

  @IsInt()
  @Min(1)
  @Max(5)
  level: number; // 1..5

  @MinLength(8)
  password: string;
}

class StaffLoginDto {
  @IsEmail()
  email: string;

  @MinLength(8)
  password: string;
}

@Controller('staff/auth')
export class StaffAuthController {
  constructor(
    private readonly staffAuthService: StaffAuthService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Public staff registration endpoint.
   * Accounts are created as inactive & unapproved until a system admin approves them.
   */
  // 🔒 Rate limit registration: 3 attempts per minute
  @Throttle({ medium: { limit: 3, ttl: 60000 } })
  @Post('register')
  async register(@Body() body: StaffRegisterDto) {
    const {
      firstName,
      lastName,
      email,
      phone,
      nationalId,
      dateOfBirth,
      address,
      staffType,
      level,
      password,
    } = body;

    return this.staffAuthService.registerStaff({
      firstName,
      lastName,
      email,
      phone,
      nationalId,
      dateOfBirth: new Date(dateOfBirth),
      address,
      staffType,
      level,
      password,
    });
  }

  /**
   * Staff login for admin web.
   */
  // 🔒 Rate limit login: 5 attempts per minute (prevents brute force)
  @Throttle({ medium: { limit: 5, ttl: 60000 } })
  @Post('login')
  async login(@Body() body: StaffLoginDto) {
    return this.staffAuthService.login(body.email, body.password);
  }

  /**
   * Simple endpoints to approve / activate staff will be protected by StaffJwtGuard
   * and should be used only by system admins.
   */

  @UseGuards(StaffJwtGuard)
  @Get('all')
  async listStaff(@Req() req: any) {
    if (!req.user?.isSystemAdmin) {
      throw new ForbiddenException('Only system administrator can list staff');
    }
    return this.prisma.staff.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        level: true,
        staffType: true,
        isActive: true,
        isApproved: true,
        isSystemAdmin: true,
        createdAt: true,
      },
    });
  }

  @UseGuards(StaffJwtGuard)
  @Patch(':id/approve')
  async approveStaff(@Param('id') id: string, @Req() req: any) {
    if (!req.user?.isSystemAdmin) {
      throw new ForbiddenException('Only system administrator can approve staff');
    }
    return this.prisma.staff.update({
      where: { id },
      data: {
        isApproved: true,
        isActive: true,
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        level: true,
        staffType: true,
        isActive: true,
        isApproved: true,
      },
    });
  }

  @UseGuards(StaffJwtGuard)
  @Patch(':id/toggle-active')
  async toggleActive(@Param('id') id: string, @Req() req: any) {
    if (!req.user?.isSystemAdmin) {
      throw new ForbiddenException('Only system administrator can change active status');
    }
    const staff = await this.prisma.staff.findUnique({ where: { id } });
    if (!staff) return null;

    return this.prisma.staff.update({
      where: { id },
      data: { isActive: !staff.isActive },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        level: true,
        staffType: true,
        isActive: true,
        isApproved: true,
      },
    });
  }
}

