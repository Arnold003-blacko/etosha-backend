import { IsUUID, IsNumber, Min, IsOptional, IsString } from 'class-validator';
import { Type } from 'class-transformer';

export class CreatePaymentDto {
  @IsUUID()
  purchaseId: string;

  @IsOptional()
  @Type(() => Number) // ensures "75" → 75
  @IsNumber()
  @Min(1)
  amount?: number;

  /**
   * Optional internal payment method override.
   * Examples: 'CASH', 'MANUAL'.
   * If omitted, defaults to 'CASH' for internal payments.
   */
  @IsOptional()
  @IsString()
  method?: string;
}
