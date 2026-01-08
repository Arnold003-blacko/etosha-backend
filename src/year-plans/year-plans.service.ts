import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class YearPlansService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    return this.prisma.yearPlan.findMany({
      orderBy: { id: 'asc' },
    });
  }
}
