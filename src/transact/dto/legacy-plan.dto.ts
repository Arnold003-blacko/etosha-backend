import { IsString, IsNumber, IsUUID, IsOptional, Min, Matches } from 'class-validator';

export class CreateLegacyPlanDto {
  @IsString({ message: 'Member ID must be a string' })
  @Matches(/^[a-z0-9]{20,30}$/i, { message: 'Invalid member ID format' })
  memberId: string;

  @IsUUID('4', { message: 'Invalid product ID format' })
  productId: string;

  @IsNumber({}, { message: 'Total amount must be a number' })
  @Min(0.01, { message: 'Total amount must be greater than 0' })
  totalAmount: number;

  @IsNumber({}, { message: 'Paid amount must be a number' })
  @Min(0, { message: 'Paid amount cannot be negative' })
  paidAmount: number;

  @IsOptional()
  @IsString()
  notes?: string;
}
