import { IsUUID } from 'class-validator';

export class ApproveCommissionDto {
  @IsUUID()
  commissionId: string;
}
