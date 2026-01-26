import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { PricingSection } from '@prisma/client';

export class CreateAssignmentRequestDto {
  @IsUUID()
  deceasedId: string;

  @IsOptional()
  @IsEnum(PricingSection)
  requestedSection?: PricingSection;

  @IsOptional()
  @IsString()
  notes?: string;
}
