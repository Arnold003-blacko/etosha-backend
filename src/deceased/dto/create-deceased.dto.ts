// src/deceased/dto/create-deceased.dto.ts
import {
  IsString,
  IsUUID,
  IsOptional,
  IsDateString,
  IsEmail,
  IsBoolean,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class NextOfKinDto {
  @IsString()
  fullName: string;

  @IsString()
  relationship: string;

  @IsString()
  phone: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsString()
  address: string;

  @IsOptional()
  @IsBoolean()
  isBuyer?: boolean; // Whether the purchase buyer is the next of kin
}

export class CreateDeceasedDto {
  @IsUUID()
  purchaseId: string;

  @IsString()
  fullName: string;

  @IsDateString()
  dateOfBirth: string;

  @IsString()
  gender: string;

  @IsString()
  address: string;

  @IsString()
  relationship: string;

  @IsOptional()
  @IsString()
  causeOfDeath?: string;

  @IsOptional()
  @IsString()
  funeralParlor?: string;

  @IsDateString()
  dateOfDeath: string;

  @IsOptional()
  @IsDateString()
  expectedBurial?: string;

  // Next of kin details - required: you cannot save a deceased without their next of kin
  @ValidateNested()
  @Type(() => NextOfKinDto)
  nextOfKin: NextOfKinDto;
}
