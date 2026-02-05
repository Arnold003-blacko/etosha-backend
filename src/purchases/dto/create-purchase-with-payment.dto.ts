// purchases/dto/create-purchase-with-payment.dto.ts
import {
  IsEnum,
  IsOptional,
  IsUUID,
  IsInt,
  IsNumber,
  Min,
  IsString,
  ValidateIf,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PurchaseType, FutureFor } from '@prisma/client';

/**
 * DTO for creating a purchase with an initial payment amount
 * Used by admin/staff to record purchases where payment was already made
 */
export class CreatePurchaseWithPaymentDto {
  @IsUUID()
  memberId: string;

  @IsUUID()
  productId: string;

  @IsEnum(PurchaseType)
  purchaseType: PurchaseType;

  @IsOptional()
  @IsEnum(FutureFor)
  futureFor?: FutureFor;

  /**
   * Payment plan ID - Optional
   * For FUTURE purchases:
   *   - If provided: Purchase uses installment plan (monthly payments)
   *   - If not provided: Purchase is full payment at immediate price (no installments)
   * For IMMEDIATE purchases: Ignored
   */
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  yearPlanId?: number;

  /**
   * Initial payment amount that was already paid
   * Must be >= 0 and <= totalAmount
   */
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  initialPaymentAmount: number;

  /**
   * Payment method for the initial payment
   * Examples: 'CASH', 'MANUAL', 'BANK_TRANSFER', etc.
   * Defaults to 'MANUAL' if not provided
   */
  @IsOptional()
  @IsString()
  paymentMethod?: string;

  /**
   * Optional reference/note for the initial payment
   */
  @IsOptional()
  @IsString()
  paymentReference?: string;
}
