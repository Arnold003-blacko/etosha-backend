import {
  IsString,
  IsUUID,
  IsNumber,
  IsOptional,
  Min,
  Matches,
  IsDateString,
} from 'class-validator';

export class RegisterLegacyPlanDto {
  @IsString({ message: 'Member ID must be a string' })
  @Matches(/^[a-z0-9]{20,30}$/i, { message: 'Invalid member ID format' })
  memberId: string;

  @IsUUID('4', { message: 'Invalid product ID format' })
  productId: string;

  @IsOptional()
  @IsNumber({}, { message: 'Year plan ID must be a number' })
  yearPlanId?: number;

  @IsNumber({}, { message: 'Already paid amount must be a number' })
  @Min(0, { message: 'Already paid amount cannot be negative' })
  alreadyPaid: number;

  @IsOptional()
  @IsDateString({}, { message: 'Last payment date must be a valid date' })
  lastPaymentDate?: string;
}
