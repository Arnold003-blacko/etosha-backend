// src/auth/auth.service.ts
import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  // ✅ Register a new member
  async register(
    firstName: string,
    lastName: string,
    email: string,
    password: string,
    extra: any = {},
  ) {
    const existing = await this.prisma.member.findUnique({
      where: { email },
    });

    if (existing) {
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

    return {
      token,
      member,
    };
  }

  // ✅ Login existing member
  async login(email: string, password: string) {
    const member = await this.prisma.member.findUnique({
      where: { email },
    });

    if (!member) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const passwordValid = await bcrypt.compare(password, member.password);

    if (!passwordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // ✅ IMPORTANT: use `id`, NOT `sub`
    const token = this.jwt.sign({
      id: member.id,
      email: member.email,
    });

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
