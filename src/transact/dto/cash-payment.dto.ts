import { IsString, IsNumber, IsUUID, Min } from 'class-validator';

export class CashPaymentDto {
  @IsUUID('4', { message: 'Invalid purchase ID format' })
  purchaseId: string;

  @IsUUID('4', { message: 'Invalid member ID format' })
  memberId: string;

  @IsNumber({}, { message: 'Amount must be a number' })
  @Min(0.01, { message: 'Amount must be greater than 0' })
  amount: number;
}
