// purchases/dto/create-existing-payer.dto.ts
import {
  IsUUID,
  IsNumber,
  Min,
  IsInt,
  IsOptional,
  IsString,
  IsEnum,
} from 'class-validator';
import { Type } from 'class-transformer';
import { FutureFor } from '@prisma/client';

/**
 * DTO for creating a purchase for an existing payer
 * Used to migrate clients who were paying before the system was implemented
 * Records their existing payment and sets them up on their payment plan
 */
export class CreateExistingPayerDto {
  @IsUUID()
  memberId: string;

  @IsUUID()
  productId: string;

  /**
   * Payment plan ID - Optional
   * Required only if the product has payment plans
   * If product has no plans, this should be null/undefined (direct payment)
   */
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  yearPlanId?: number;

  /**
   * Amount already paid by the client before system implementation
   * This is the historical payment amount
   */
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  amountAlreadyPaid: number;

  /**
   * Optional: Who the purchase is for (SELF or OTHER)
   */
  @IsOptional()
  @IsEnum(FutureFor)
  futureFor?: FutureFor;

  /**
   * Payment method for recording the historical payment
   * Defaults to 'MANUAL' if not provided
   */
  @IsOptional()
  @IsString()
  paymentMethod?: string;

  /**
   * Optional reference/note for the historical payment
   */
  @IsOptional()
  @IsString()
  paymentReference?: string;

  /**
   * Optional: Paid-through month or last payment date
   * Used to set nextDueAt correctly to avoid incorrect arrears calculation
   * Format: YYYY-MM-DD (ISO date string)
   */
  @IsOptional()
  @IsString()
  paidThroughDate?: string;
}
