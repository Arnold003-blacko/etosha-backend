import { IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString, IsBoolean, IsInt } from 'class-validator';
// remove generated import and use @prisma/client
import { ItemCategory } from '@prisma/client';



;

export class CreateItemDto {
  @IsEnum(ItemCategory)
  category: ItemCategory;

  @IsString()
  @IsNotEmpty()
  title: string;

  @IsString()
  @IsNotEmpty()
  slug: string;

  @IsNumber()
  amount: number;

  @IsString()
  @IsNotEmpty()
  currency: string;

  @IsString()
  @IsNotEmpty()
  description: string;

  @IsString()
  @IsNotEmpty()
  imagePath: string;

  @IsString()
  @IsNotEmpty()
  sku: string;

  @IsOptional()
  @IsInt()
  quantity?: number | null;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsInt()
  orderNum?: number;
}
