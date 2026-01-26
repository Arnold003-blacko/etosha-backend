import { IsEnum, IsInt, IsString, IsUUID, Min, Max } from 'class-validator';
import { PricingSection } from '@prisma/client';

export class AssignGraveDto {
  @IsUUID()
  deceasedId: string;

  @IsEnum(PricingSection)
  section: PricingSection;

  @IsString()
  graveNumber: string;

  @IsInt()
  @Min(1)
  @Max(2)
  slotNo: number;
}
