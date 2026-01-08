import {
  Controller,
  Get,
  Param,
  Post,
  Body,
  Patch,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { ItemsService } from './items.service';
import { CreateItemDto } from './dto/create-item.dto';
import { UpdateItemDto } from './dto/update-item.dto';
import { ItemCategory } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Controller('items')
export class ItemsController {
  constructor(
    private readonly itemsService: ItemsService,
    private readonly prisma: PrismaService,
  ) {}

  // GET /items
  @Get()
  getAll() {
    return this.itemsService.findAll();
  }

  // GET /items/category/:cat
  @Get('category/:cat')
  async getByCategory(@Param('cat') cat: string) {
    const category = cat.toUpperCase() as ItemCategory;

    if (!Object.values(ItemCategory).includes(category)) {
      throw new BadRequestException(`Invalid category: ${cat}`);
    }

    const items = await this.itemsService.findByCategory(category);

    // ✅ ADDITION: compute availability safely
    return items.map((item) => ({
      ...item,
      available:
        item.category === ItemCategory.SERVICE
          ? item.active && item.isAvailable
          : item.active,
    }));
  }

  // GET /items/:id
  @Get(':id')
  getOne(@Param('id') id: string) {
    return this.itemsService.findOne(id);
  }

  // ✅ GET /items/:id/plans
  @Get(':id/plans')
  async getItemPlans(@Param('id') id: string) {
    // 1️⃣ Load item
    const item = await this.prisma.product.findUnique({
      where: { id },
    });

    if (!item || !item.pricingSection) {
      throw new NotFoundException('Item has no payment plans');
    }

    // 2️⃣ Load plans
    const plans = await this.prisma.yearPlan.findMany({
      orderBy: { months: 'asc' },
    });

    const sectionKey = item.pricingSection.toLowerCase();

    // 3️⃣ Shape response for frontend
    return plans.map((plan) => ({
      id: plan.id,
      name: plan.name,
      months: plan.months,
      currency: plan.currency,
      prices: {
        under60: plan[`${sectionKey}_under60`],
        over60: plan[`${sectionKey}_over60`],
      },
    }));
  }

  // POST /items
  @Post()
  create(@Body() dto: CreateItemDto) {
    return this.itemsService.create(dto);
  }

  // PATCH /items/:id
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateItemDto) {
    return this.itemsService.update(id, dto);
  }
}
