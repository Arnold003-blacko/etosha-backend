import {
  IsString,
  IsNumber,
  IsUUID,
  Min,
  Matches,
  IsOptional,
  IsIn,
} from 'class-validator';

export class CashPaymentDto {
  @IsUUID('4', { message: 'Invalid purchase ID format' })
  purchaseId: string;

  @IsString({ message: 'Member ID must be a string' })
  @Matches(/^[a-z0-9]{20,30}$/i, { message: 'Invalid member ID format' })
  memberId: string;

  @IsNumber({}, { message: 'Amount must be a number' })
  @Min(0.01, { message: 'Amount must be greater than 0' })
  amount: number;

  /**
   * High-level payment method for staff-side cash-style payments.
   * - 'CASH'   → in-person cash at counter
   * - 'MANUAL' → client paid externally; staff is just recording it
   */
  @IsOptional()
  @IsString()
  @IsIn(['CASH', 'MANUAL'], {
    message: 'method must be CASH or MANUAL',
  })
  method?: 'CASH' | 'MANUAL';
}
