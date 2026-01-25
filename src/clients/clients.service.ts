import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateMemberDto } from '../members/dto/create-member.dto';
import { UpdateClientDto } from './dto/update-client.dto';
import { ChangeClientPasswordDto } from './dto/change-password.dto';
import * as bcrypt from 'bcrypt';
import { LoggerService, LogCategory } from '../dashboard/logger.service';

@Injectable()
export class ClientsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: LoggerService,
  ) {}

  async create(createClientDto: CreateMemberDto) {
    const existing = await this.prisma.member.findUnique({
      where: { email: createClientDto.email },
    });

    if (existing) {
      throw new BadRequestException('Client email already in use');
    }

    if (createClientDto.nationalId) {
      const existingNationalId = await this.prisma.member.findUnique({
        where: { nationalId: createClientDto.nationalId },
      });

      if (existingNationalId) {
        throw new BadRequestException('National ID already in use');
      }
    }

    const hashedPassword = await bcrypt.hash(createClientDto.password, 10);

    const client = await this.prisma.member.create({
      data: {
        firstName: createClientDto.firstName,
        lastName: createClientDto.lastName,
        email: createClientDto.email,
        country: createClientDto.country,
        address: createClientDto.address,
        city: createClientDto.city,
        phone: createClientDto.phone,
        nationalId: createClientDto.nationalId,
        dateOfBirth: new Date(createClientDto.dateOfBirth),
        gender: createClientDto.gender,
        password: hashedPassword,
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        country: true,
        address: true,
        city: true,
        phone: true,
        nationalId: true,
        dateOfBirth: true,
        gender: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    this.logger.info(
      `[CLIENT] New client created: ${client.email}`,
      LogCategory.AUTH,
      {
        eventType: 'client_created',
        clientId: client.id,
        clientEmail: client.email,
      },
    );

    return client;
  }

  async findAll() {
    return this.prisma.member.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        country: true,
        address: true,
        city: true,
        phone: true,
        nationalId: true,
        dateOfBirth: true,
        gender: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async findOne(id: string) {
    const client = await this.prisma.member.findUnique({
      where: { id },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        country: true,
        address: true,
        city: true,
        phone: true,
        nationalId: true,
        dateOfBirth: true,
        gender: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!client) {
      throw new NotFoundException(`Client with ID ${id} not found`);
    }

    return client;
  }

  async update(id: string, updateClientDto: UpdateClientDto) {
    const client = await this.prisma.member.findUnique({ where: { id } });

    if (!client) {
      throw new NotFoundException(`Client with ID ${id} not found`);
    }

    const updateData: any = { ...updateClientDto };

    if (updateClientDto.dateOfBirth) {
      updateData.dateOfBirth = new Date(updateClientDto.dateOfBirth);
    }

    if (updateClientDto.password) {
      updateData.password = await bcrypt.hash(updateClientDto.password, 10);
    }

    delete updateData.password;

    const updated = await this.prisma.member.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        country: true,
        address: true,
        city: true,
        phone: true,
        nationalId: true,
        dateOfBirth: true,
        gender: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    this.logger.info(
      `[CLIENT] Client updated: ${updated.email}`,
      LogCategory.AUTH,
      {
        eventType: 'client_updated',
        clientId: updated.id,
        clientEmail: updated.email,
      },
    );

    return updated;
  }

  async remove(id: string) {
    const client = await this.prisma.member.findUnique({ where: { id } });

    if (!client) {
      throw new NotFoundException(`Client with ID ${id} not found`);
    }

    await this.prisma.member.delete({ where: { id } });

    this.logger.info(
      `[CLIENT] Client deleted: ${client.email}`,
      LogCategory.AUTH,
      {
        eventType: 'client_deleted',
        clientId: client.id,
        clientEmail: client.email,
      },
    );

    return { message: 'Client deleted successfully' };
  }

  async changePassword(id: string, changePasswordDto: ChangeClientPasswordDto) {
    const client = await this.findOne(id);

    const hashedPassword = await bcrypt.hash(changePasswordDto.newPassword, 10);

    await this.prisma.member.update({
      where: { id },
      data: { password: hashedPassword },
    });

    this.logger.info(
      `[CLIENT] Password changed for: ${client.email}`,
      LogCategory.AUTH,
      {
        eventType: 'client_password_changed',
        clientId: client.id,
        clientEmail: client.email,
      },
    );

    return { message: 'Password changed successfully' };
  }
}
