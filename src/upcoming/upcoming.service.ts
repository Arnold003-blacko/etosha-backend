import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class UpcomingService {
  private readonly SUPABASE_URL = process.env.SUPABASE_URL ?? '';
  private readonly PLACEHOLDER =
    'https://via.placeholder.com/800x600?text=No+Image';

  constructor(private readonly prisma: PrismaService) {}

  private buildImageUrl(imagePath?: string | null): string {
    if (!imagePath || !this.SUPABASE_URL) return this.PLACEHOLDER;

    // remove leading slashes to avoid //
    const cleanPath = imagePath.replace(/^\/+/, '');

    return `${this.SUPABASE_URL}/storage/v1/object/public/${cleanPath}`;
  }

  async findAll() {
    const rows = await this.prisma.upcoming.findMany({
      orderBy: { orderNum: 'asc' },
    });

    return rows.map((row) => ({
      ...row,
      imageUrl: this.buildImageUrl(row.imagePath),
    }));
  }
}
