// purchases/dto/create-purchase.dto.ts
import {
  IsEnum,
  IsOptional,
  IsUUID,
  IsInt,
} from 'class-validator';
import { PurchaseType, FutureFor } from '@prisma/client';

export class CreatePurchaseDto {
  @IsUUID()
  productId: string;

  @IsEnum(PurchaseType)
  purchaseType: PurchaseType;

  @IsOptional()
  @IsEnum(FutureFor)
  futureFor?: FutureFor;

  // 🔑 ADD THIS
  @IsOptional()
  @IsInt()
  yearPlanId?: number;
}
