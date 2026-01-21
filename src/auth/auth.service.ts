// src/auth/auth.service.ts
import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import { JwtService } from '@nestjs/jwt';
import { LoggerService, LogCategory } from '../dashboard/logger.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly logger: LoggerService,
  ) {}

  // ✅ Register a new member
  async register(
    firstName: string,
    lastName: string,
    email: string,
    password: string,
    extra: any = {},
  ) {
    const startTime = Date.now();
    
    try {
      const existing = await this.prisma.member.findUnique({
        where: { email },
      });

      if (existing) {
        this.logger.warn(
          `Registration attempt with existing email: ${email}`,
          LogCategory.AUTH,
          { email, eventType: 'registration_failed_duplicate' },
        );
        throw new BadRequestException('Email already in use');
      }

      const hashedPassword = await bcrypt.hash(password, 10);

      const member = await this.prisma.member.create({
        data: {
          firstName,
          lastName,
          email,
          password: hashedPassword,
          ...extra,
        },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          createdAt: true,
        },
      });

      // ✅ IMPORTANT: use `id`, NOT `sub`
      const token = this.jwt.sign({
        id: member.id,
        email: member.email,
      });

      const duration = Date.now() - startTime;
      
      // Log successful registration
      this.logger.info(
        `User registered successfully: ${email}`,
        LogCategory.AUTH,
        {
          eventType: 'user_registered',
          userId: member.id,
          userEmail: member.email,
          duration,
          hasExtraData: Object.keys(extra).length > 0,
        },
      );

      return {
        token,
        member,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error(
        `Registration failed for email: ${email}`,
        error instanceof Error ? error : new Error(String(error)),
        LogCategory.AUTH,
        {
          eventType: 'registration_failed',
          email,
          duration,
        },
      );
      throw error;
    }
  }

  // ✅ Login existing member
  async login(email: string, password: string) {
    const startTime = Date.now();
    
    try {
      const member = await this.prisma.member.findUnique({
        where: { email },
      });

      if (!member) {
        this.logger.warn(
          `Login attempt with non-existent email: ${email}`,
          LogCategory.AUTH,
          { email, eventType: 'login_failed_user_not_found' },
        );
        throw new UnauthorizedException('Invalid credentials');
      }

      const passwordValid = await bcrypt.compare(password, member.password);

      if (!passwordValid) {
        this.logger.warn(
          `Login attempt with invalid password for: ${email}`,
          LogCategory.AUTH,
          {
            email,
            userId: member.id,
            eventType: 'login_failed_invalid_password',
          },
        );
        throw new UnauthorizedException('Invalid credentials');
      }

      // ✅ IMPORTANT: use `id`, NOT `sub`
      const token = this.jwt.sign({
        id: member.id,
        email: member.email,
      });

      const duration = Date.now() - startTime;

      // Log successful login
      this.logger.info(
        `User logged in successfully: ${email}`,
        LogCategory.AUTH,
        {
          eventType: 'user_logged_in',
          userId: member.id,
          userEmail: member.email,
          duration,
        },
      );

      return {
        token,
        member: {
          id: member.id,
          firstName: member.firstName,
          lastName: member.lastName,
          email: member.email,
          createdAt: member.createdAt,
        },
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      if (!(error instanceof UnauthorizedException)) {
        // Only log if it's not an expected auth error
        this.logger.error(
          `Login error for email: ${email}`,
          error instanceof Error ? error : new Error(String(error)),
          LogCategory.AUTH,
          {
            eventType: 'login_error',
            email,
            duration,
          },
        );
      }
      throw error;
    }
  }

  // ✅ Used by JwtStrategy
  async validateMember(id: string) {
    if (!id) return null;

    return this.prisma.member.findUnique({
      where: { id },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
      },
    });
  }
}
