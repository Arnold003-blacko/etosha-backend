import { IsUUID, IsNumber, Min, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';

export class CreatePaymentDto {
  @IsUUID()
  purchaseId: string;

  @IsOptional()
  @Type(() => Number) // ensures "75" → 75
  @IsNumber()
  @Min(1)
  amount?: number;
}
