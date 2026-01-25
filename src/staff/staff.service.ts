import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateStaffDto } from './dto/create-staff.dto';
import { UpdateStaffDto } from './dto/update-staff.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import * as bcrypt from 'bcrypt';
import { LoggerService, LogCategory } from '../dashboard/logger.service';

@Injectable()
export class StaffService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: LoggerService,
  ) {}

  async create(createStaffDto: CreateStaffDto) {
    const existing = await this.prisma.staff.findUnique({
      where: { email: createStaffDto.email },
    });

    if (existing) {
      throw new BadRequestException('Staff email already in use');
    }

    const existingNationalId = await this.prisma.staff.findUnique({
      where: { nationalId: createStaffDto.nationalId },
    });

    if (existingNationalId) {
      throw new BadRequestException('National ID already in use');
    }

    const hashedPassword = await bcrypt.hash(createStaffDto.password, 10);

    const staff = await this.prisma.staff.create({
      data: {
        firstName: createStaffDto.firstName,
        lastName: createStaffDto.lastName,
        email: createStaffDto.email,
        phone: createStaffDto.phone,
        nationalId: createStaffDto.nationalId,
        dateOfBirth: new Date(createStaffDto.dateOfBirth),
        address: createStaffDto.address,
        location: createStaffDto.location as any,
        level: createStaffDto.level,
        password: hashedPassword,
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        nationalId: true,
        dateOfBirth: true,
        address: true,
        location: true,
        level: true,
        isSystemAdmin: true,
        isActive: true,
        isApproved: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    this.logger.info(
      `[STAFF] New staff created: ${staff.email}`,
      LogCategory.AUTH,
      {
        eventType: 'staff_created',
        staffId: staff.id,
        staffEmail: staff.email,
      },
    );

    return staff;
  }

  async findAll() {
    return this.prisma.staff.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        nationalId: true,
        dateOfBirth: true,
        address: true,
        location: true,
        level: true,
        isSystemAdmin: true,
        isActive: true,
        isApproved: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async findOne(id: string) {
    const staff = await this.prisma.staff.findUnique({
      where: { id },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        nationalId: true,
        dateOfBirth: true,
        address: true,
        location: true,
        level: true,
        isSystemAdmin: true,
        isActive: true,
        isApproved: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!staff) {
      throw new NotFoundException(`Staff with ID ${id} not found`);
    }

    return staff;
  }

  async update(id: string, updateStaffDto: UpdateStaffDto, currentUser: any) {
    const staff = await this.prisma.staff.findUnique({ where: { id } });

    if (!staff) {
      throw new NotFoundException(`Staff with ID ${id} not found`);
    }

    if (updateStaffDto.isSystemAdmin !== undefined && !currentUser.isSystemAdmin) {
      throw new ForbiddenException('Only system administrator can change admin status');
    }

    if (updateStaffDto.isApproved !== undefined && !currentUser.isSystemAdmin) {
      throw new ForbiddenException('Only system administrator can approve staff');
    }

    const updateData: any = { ...updateStaffDto };

    if (updateStaffDto.dateOfBirth) {
      updateData.dateOfBirth = new Date(updateStaffDto.dateOfBirth);
    }

    if (updateStaffDto.password) {
      updateData.password = await bcrypt.hash(updateStaffDto.password, 10);
    }

    delete updateData.password;

    const updated = await this.prisma.staff.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        nationalId: true,
        dateOfBirth: true,
        address: true,
        location: true,
        level: true,
        isSystemAdmin: true,
        isActive: true,
        isApproved: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    this.logger.info(
      `[STAFF] Staff updated: ${updated.email}`,
      LogCategory.AUTH,
      {
        eventType: 'staff_updated',
        staffId: updated.id,
        staffEmail: updated.email,
        updatedBy: currentUser.id,
      },
    );

    return updated;
  }

  async remove(id: string, currentUser: any) {
    if (!currentUser.isSystemAdmin) {
      throw new ForbiddenException('Only system administrator can delete staff');
    }

    const staff = await this.prisma.staff.findUnique({ where: { id } });

    if (!staff) {
      throw new NotFoundException(`Staff with ID ${id} not found`);
    }

    if (staff.id === currentUser.id) {
      throw new BadRequestException('Cannot delete your own account');
    }

    await this.prisma.staff.delete({ where: { id } });

    this.logger.info(
      `[STAFF] Staff deleted: ${staff.email}`,
      LogCategory.AUTH,
      {
        eventType: 'staff_deleted',
        staffId: staff.id,
        staffEmail: staff.email,
        deletedBy: currentUser.id,
      },
    );

    return { message: 'Staff deleted successfully' };
  }

  async approve(id: string, currentUser: any) {
    if (!currentUser.isSystemAdmin) {
      throw new ForbiddenException('Only system administrator can approve staff');
    }

    const staff = await this.findOne(id);

    const updated = await this.prisma.staff.update({
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
        phone: true,
        nationalId: true,
        dateOfBirth: true,
        address: true,
        location: true,
        level: true,
        isSystemAdmin: true,
        isActive: true,
        isApproved: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    this.logger.info(
      `[STAFF] Staff approved: ${updated.email}`,
      LogCategory.AUTH,
      {
        eventType: 'staff_approved',
        staffId: updated.id,
        staffEmail: updated.email,
        approvedBy: currentUser.id,
      },
    );

    return updated;
  }

  async toggleActive(id: string, currentUser: any) {
    if (!currentUser.isSystemAdmin) {
      throw new ForbiddenException('Only system administrator can change active status');
    }

    const staff = await this.findOne(id);

    const updated = await this.prisma.staff.update({
      where: { id },
      data: { isActive: !staff.isActive },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        nationalId: true,
        dateOfBirth: true,
        address: true,
        location: true,
        level: true,
        isSystemAdmin: true,
        isActive: true,
        isApproved: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    this.logger.info(
      `[STAFF] Staff ${updated.isActive ? 'activated' : 'deactivated'}: ${updated.email}`,
      LogCategory.AUTH,
      {
        eventType: 'staff_status_changed',
        staffId: updated.id,
        staffEmail: updated.email,
        isActive: updated.isActive,
        changedBy: currentUser.id,
      },
    );

    return updated;
  }

  async assignAdmin(id: string, currentUser: any) {
    if (!currentUser.isSystemAdmin) {
      throw new ForbiddenException('Only system administrator can assign admin status');
    }

    const staff = await this.findOne(id);

    const updated = await this.prisma.staff.update({
      where: { id },
      data: { isSystemAdmin: true },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        nationalId: true,
        dateOfBirth: true,
        address: true,
        location: true,
        level: true,
        isSystemAdmin: true,
        isActive: true,
        isApproved: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    this.logger.info(
      `[STAFF] Admin assigned: ${updated.email}`,
      LogCategory.AUTH,
      {
        eventType: 'admin_assigned',
        staffId: updated.id,
        staffEmail: updated.email,
        assignedBy: currentUser.id,
      },
    );

    return updated;
  }

  async changePassword(id: string, changePasswordDto: ChangePasswordDto, currentUser: any) {
    if (!currentUser.isSystemAdmin && currentUser.id !== id) {
      throw new ForbiddenException('You can only change your own password');
    }

    const staff = await this.findOne(id);

    const hashedPassword = await bcrypt.hash(changePasswordDto.newPassword, 10);

    await this.prisma.staff.update({
      where: { id },
      data: { password: hashedPassword },
    });

    this.logger.info(
      `[STAFF] Password changed for: ${staff.email}`,
      LogCategory.AUTH,
      {
        eventType: 'staff_password_changed',
        staffId: staff.id,
        staffEmail: staff.email,
        changedBy: currentUser.id,
      },
    );

    return { message: 'Password changed successfully' };
  }

  async getPendingApprovals() {
    return this.prisma.staff.findMany({
      where: {
        isApproved: false,
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        nationalId: true,
        dateOfBirth: true,
        address: true,
        location: true,
        level: true,
        isSystemAdmin: true,
        isActive: true,
        isApproved: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }
}
