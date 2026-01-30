import { IsString, IsOptional, IsDateString, IsEnum, IsUUID, IsBoolean, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { BurialStatus } from '@prisma/client';

class UpdateNextOfKinDto {
  @IsOptional()
  @IsString()
  fullName?: string;

  @IsOptional()
  @IsString()
  relationship?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsBoolean()
  isBuyer?: boolean;
}

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

  // Next of Kin fields
  @IsOptional()
  @ValidateNested()
  @Type(() => UpdateNextOfKinDto)
  nextOfKin?: UpdateNextOfKinDto;
}
