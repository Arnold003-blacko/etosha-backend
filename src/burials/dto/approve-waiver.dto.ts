import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { WaiverStatus } from '@prisma/client';

export class ApproveWaiverDto {
  @IsUUID()
  waiverId: string;

  @IsEnum(WaiverStatus)
  status: WaiverStatus;

  @IsOptional()
  @IsString()
  rejectionReason?: string;
}
