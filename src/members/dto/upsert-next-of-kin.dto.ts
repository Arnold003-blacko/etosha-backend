import {
  IsString,
  IsOptional,
  IsEmail,
} from 'class-validator';

export class UpsertNextOfKinDto {
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
}
