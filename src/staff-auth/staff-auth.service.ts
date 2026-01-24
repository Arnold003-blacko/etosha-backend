import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { LoggerService, LogCategory } from '../dashboard/logger.service';

export interface StaffJwtPayload {
  id: string;
  email: string;
}

@Injectable()
export class StaffAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly logger: LoggerService,
  ) {}

  async registerStaff(input: {
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    nationalId: string;
    dateOfBirth: Date;
    address: string;
    location: string;
    level: number;
    password: string;
  }) {
    const {
      firstName,
      lastName,
      email,
      phone,
      nationalId,
      dateOfBirth,
      address,
      location,
      level,
      password,
    } = input;

    const existing = await this.prisma.staff.findUnique({
      where: { email },
    });

    if (existing) {
      throw new BadRequestException('Staff email already in use');
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const staff = await this.prisma.staff.create({
      data: {
        firstName,
        lastName,
        email,
        phone,
        nationalId,
        dateOfBirth,
        address,
        location: location as any,
        level,
        password: hashedPassword,
        // isApproved stays false until admin approves
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        level: true,
        location: true,
        isApproved: true,
        isActive: true,
      },
    });

    this.logger.info(
      `[STAFF] New staff registration submitted: ${email}`,
      LogCategory.AUTH,
      {
        eventType: 'staff_registration_submitted',
        staffId: staff.id,
        staffEmail: staff.email,
      },
    );

    return staff;
  }

  async login(email: string, password: string) {
    const staff = await this.prisma.staff.findUnique({
      where: { email },
    });

    if (!staff) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!staff.isActive || !staff.isApproved) {
      throw new UnauthorizedException(
        'Account not active or not approved. Contact system administrator.',
      );
    }

    const passwordValid = await bcrypt.compare(password, staff.password);

    if (!passwordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const payload: StaffJwtPayload = {
      id: staff.id,
      email: staff.email,
    };

    const token = this.jwt.sign(payload);

    this.logger.info(
      `[STAFF] Staff login successful: ${email}`,
      LogCategory.AUTH,
      {
        eventType: 'staff_login_success',
        staffId: staff.id,
        staffEmail: staff.email,
        level: staff.level,
        location: staff.location,
      },
    );

    return {
      token,
      staff: {
        id: staff.id,
        firstName: staff.firstName,
        lastName: staff.lastName,
        email: staff.email,
        level: staff.level,
        location: staff.location,
        isSystemAdmin: staff.isSystemAdmin,
      },
    };
  }

  async validateStaff(id: string) {
    return this.prisma.staff.findUnique({
      where: { id },
    });
  }
}

