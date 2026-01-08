// src/items/items.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateItemDto } from './dto/create-item.dto';
import { UpdateItemDto } from './dto/update-item.dto';
import { ItemCategory } from '@prisma/client';

@Injectable()
export class ItemsService {
  constructor(private prisma: PrismaService) {}

  // Convenience getter that always returns a string (never undefined)
  private get supabaseUrl(): string {
    return String(process.env.SUPABASE_URL ?? '').replace(/\/+$/, '');
  }

  async findAll() {
    const rows = await this.prisma.product.findMany({
      orderBy: { orderNum: 'asc' },
    });
    return rows.map(r => this.mapRow(r));
  }

  async findByCategory(category: ItemCategory) {
    const rows = await this.prisma.product.findMany({
      where: { category },
      orderBy: { orderNum: 'asc' },
    });
    return rows.map(r => this.mapRow(r));
  }

  async findOne(id: string) {
    const row = await this.prisma.product.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Item not found');
    return this.mapRow(row);
  }

  async create(dto: CreateItemDto) {
    const created = await this.prisma.product.create({ data: dto as any });
    return this.mapRow(created);
  }

  async update(id: string, dto: UpdateItemDto) {
    await this.findOne(id); // ensure exists or throw
    const updated = await this.prisma.product.update({
      where: { id },
      data: dto as any,
    });
    return this.mapRow(updated);
  }

  /**
   * mapRow
   * - Generates the actual Supabase URL based on DB path.
   * - Placeholder is only used if the path is missing.
   * - Does NOT modify bucket or filename.
   */
  private mapRow(r: any) {
    const SUPABASE_URL: string = this.supabaseUrl;
    const PLACEHOLDER = 'https://via.placeholder.com/800x600?text=No+Image';

    if (!SUPABASE_URL) {
      console.warn('SUPABASE_URL is missing!');
    }

    // Prefer existing full imageUrl in DB
    if (typeof r.imageUrl === 'string' && r.imageUrl.trim()) {
      return {
        ...r,
        imageUrl: r.imageUrl.trim(),
        available: this.computeAvailable(r),
        priceText: this.computePriceText(r),
      };
    }

    // Extract image path from DB
    let rawPath: string | null = null;
    if (typeof r.imagePath === 'string' && r.imagePath.trim()) rawPath = r.imagePath.trim();
    else if (typeof r.image_path === 'string' && r.image_path.trim()) rawPath = r.image_path.trim();

    // Construct actual Supabase URL if path exists
    const imageUrl =
      rawPath && SUPABASE_URL
        ? `${SUPABASE_URL}/storage/v1/object/public/${rawPath}`
        : PLACEHOLDER;

    return {
      ...r,
      imageUrl,
      available: this.computeAvailable(r),
      priceText: this.computePriceText(r),
    };
  }

  // Helpers
  private computeAvailable(r: any): boolean {
    if (r.category === 'SERENITY_GROUND') {
      return typeof r.quantity === 'number' ? r.quantity > 0 : false;
    } else if (r.category === 'SERVICE') {
      return !!r.active;
    }
    return true;
  }

  private computePriceText(r: any): string | null {
    if (typeof r.priceText === 'string' && r.priceText.trim()) return r.priceText;
    const amtString = r.amount != null ? String(r.amount) : null;
    const amtNumber =
      amtString != null && !Number.isNaN(Number(amtString)) ? Number(amtString) : null;
    if (amtNumber != null && r.currency) {
      return `${amtNumber} ${String(r.currency)}`;
    }
    return null;
  }
}
