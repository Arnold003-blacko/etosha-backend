import { IsString, IsOptional, IsDateString, IsEnum, IsUUID, IsBoolean, ValidateIf } from 'class-validator';
import { WaiverType } from '@prisma/client';

export class CreateBurialDto {
  // Path A: Paid Purchase Burial
  @IsOptional()
  @IsUUID()
  purchaseId?: string;

  // Path B: Waiver/Donation Burial
  @IsOptional()
  @IsEnum(WaiverType)
  waiverType?: WaiverType;

  @IsOptional()
  @IsString()
  waiverReason?: string;

  // Deceased details
  @IsString()
  fullName: string;

  @IsOptional()
  @IsDateString()
  dateOfBirth?: string;

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

  @IsOptional()
  @IsDateString()
  burialDate?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  // Next of Kin
  @IsString()
  nextOfKinFullName: string;

  @IsString()
  nextOfKinRelationship: string;

  @IsString()
  nextOfKinPhone: string;

  @IsOptional()
  @IsString()
  nextOfKinEmail?: string;

  @IsString()
  nextOfKinAddress: string;

  @IsBoolean()
  isBuyerNextOfKin: boolean;

  // Grave assignment (optional - can be assigned later)
  @IsOptional()
  @IsEnum(['MUHACHA', 'LAWN', 'DONHODZO', 'FAMILY'])
  section?: string;

  @IsOptional()
  @IsString()
  graveNumber?: string;

  @IsOptional()
  @IsString()
  slotNo?: string; // "1" or "2"
}
