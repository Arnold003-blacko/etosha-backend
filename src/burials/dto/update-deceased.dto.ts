import { IsString, IsOptional, IsDateString, IsEnum, IsUUID } from 'class-validator';
import { BurialStatus } from '@prisma/client';

export class UpdateDeceasedDto {
  @IsOptional()
  @IsString()
  fullName?: string;

  @IsOptional()
  @IsDateString()
  dateOfBirth?: string;

  @IsOptional()
  @IsString()
  gender?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  relationship?: string;

  @IsOptional()
  @IsString()
  causeOfDeath?: string;

  @IsOptional()
  @IsString()
  funeralParlor?: string;

  @IsOptional()
  @IsDateString()
  dateOfDeath?: string;

  @IsOptional()
  @IsDateString()
  expectedBurial?: string;

  @IsOptional()
  @IsDateString()
  burialDate?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsEnum(BurialStatus)
  status?: BurialStatus;

  @IsOptional()
  @IsUUID()
  purchaseId?: string;
}
