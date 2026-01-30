import {
  Injectable,
  BadRequestException,
  UnauthorizedException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateMemberDto } from './dto/create-member.dto';
import { LoginMemberDto } from './dto/login-member.dto';
import * as bcrypt from 'bcrypt';
import { DashboardGateway } from '../dashboard/dashboard.gateway';
import * as jwt from 'jsonwebtoken';

@Injectable()
export class MembersService {
  constructor(
    private prisma: PrismaService,
    @Inject(forwardRef(() => DashboardGateway))
    private readonly dashboardGateway: DashboardGateway,
  ) {}

  // helper to remove sensitive fields
  private sanitize(member: any) {
    if (!member) return null;
    const { password, ...safe } = member;
    return safe;
  }

  /* =========================
     AUTH / CORE
  ========================= */

  // Signup: create new member with hashed password
  async signup(data: CreateMemberDto) {
    const exists = await this.prisma.member.findUnique({
      where: { email: data.email },
    });

    if (exists) {
      throw new BadRequestException('Email already registered');
    }

    // ✅ REQUIRED DOB VALIDATION (ADDED)
    if (!data.dateOfBirth) {
      throw new BadRequestException('Date of birth is required');
    }

    const hashedPassword = await bcrypt.hash(data.password, 10);

    try {
      const member = await this.prisma.member.create({
        data: {
          firstName: data.firstName,
          lastName: data.lastName,
          email: data.email,
          country: data.country,
          address: data.address,
          city: data.city,
          phone: data.phone,
          nationalId: data.nationalId,
          password: hashedPassword,

          // ✅ GUARANTEED NON-NULL DOB
          dateOfBirth: new Date(data.dateOfBirth),

          // ✅ FIX: SAVE GENDER
          gender: data.gender,
        },
      });

      // Emit real-time update
      this.dashboardGateway.broadcastDashboardUpdate();

      // Generate JWT token (same as login)
      const jwtSecret = process.env.JWT_SECRET as string;
      if (!jwtSecret) {
        throw new Error(
          'JWT_SECRET is missing in environment variables',
        );
      }

      const token = jwt.sign(
        { id: member.id, email: member.email },
        jwtSecret,
        { expiresIn: '7d' },
      );

      return {
        message: 'Signup successful',
        token, // Return token so user is automatically logged in
        member: this.sanitize(member),
      };
    } catch (e: any) {
      if (e?.code === 'P2002' && Array.isArray(e?.meta?.target)) {
        const targets: string[] = e.meta.target;
        if (targets.includes('email')) {
          throw new BadRequestException('Email already registered');
        }
        if (targets.includes('nationalId')) {
          throw new BadRequestException(
            'National ID already registered',
          );
        }
      }
      throw e;
    }
  }

  // Login: validate credentials and issue JWT
  async login(data: LoginMemberDto) {
    const member = await this.prisma.member.findUnique({
      where: { email: data.email },
    });

    if (!member) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const valid = await bcrypt.compare(
      data.password,
      member.password,
    );
    if (!valid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const jwtSecret = process.env.JWT_SECRET as string;
    if (!jwtSecret) {
      throw new Error(
        'JWT_SECRET is missing in environment variables',
      );
    }

    const token = jwt.sign(
      { id: member.id, email: member.email },
      jwtSecret,
      { expiresIn: '7d' },
    );

    return {
      message: 'Login successful',
      token,
      member: this.sanitize(member),
    };
  }

  /* =========================
     MEMBER LOOKUPS
  ========================= */

  async findById(id: string) {
    const member = await this.prisma.member.findUnique({
      where: { id },
    });
    return this.sanitize(member);
  }

  async findByEmail(email: string) {
    const member = await this.prisma.member.findUnique({
      where: { email },
    });
    return this.sanitize(member);
  }

  async findByIdOrEmail(value: string) {
    const member = await this.prisma.member.findFirst({
      where: {
        OR: [{ id: value }, { email: value }],
      },
    });
    return this.sanitize(member);
  }

  async getProfileFromPayload(payload: {
    id: string;
    email: string;
  }) {
    const member = await this.prisma.member.findUnique({
      where: { id: payload.id },
    });

    if (!member) {
      throw new UnauthorizedException('User not found');
    }

    return this.sanitize(member);
  }

}
