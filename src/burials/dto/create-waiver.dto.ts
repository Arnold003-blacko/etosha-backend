import { IsEnum, IsString, IsUUID } from 'class-validator';
import { WaiverType } from '@prisma/client';

export class CreateWaiverDto {
  @IsUUID()
  deceasedId: string;

  @IsEnum(WaiverType)
  waiverType: WaiverType;

  @IsString()
  reason: string;
}
