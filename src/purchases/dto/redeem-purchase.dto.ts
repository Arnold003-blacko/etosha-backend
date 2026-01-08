import {
  IsString,
  IsOptional,
  IsDateString,
} from 'class-validator';

export class RedeemPurchaseDto {
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
}
