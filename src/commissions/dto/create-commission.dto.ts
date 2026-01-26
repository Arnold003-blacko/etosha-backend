import { IsString, IsUUID, IsOptional, IsEnum, IsDecimal } from 'class-validator';
import { PricingSection } from '@prisma/client';

export class CreateCommissionDto {
  @IsUUID()
  purchaseId: string;

  @IsString()
  agentName: string;

  @IsString()
  company: string; // "Etosha" or parlour name

  @IsOptional()
  @IsUUID()
  agentStaffId?: string; // If it's an Etosha staff member
}
