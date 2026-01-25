import { IsOptional, IsString, IsEmail, IsDateString, IsEnum, Matches } from 'class-validator';
import { Gender } from '../../members/dto/create-member.dto';

export class UpdateClientDto {
  @IsOptional()
  @IsString()
  firstName?: string;

  @IsOptional()
  @IsString()
  lastName?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  country?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @Matches(/^\d{10}$/, { message: 'phone must be 10 digits' })
  phone?: string;

  @IsOptional()
  @Matches(/^[0-9A-Za-z-]{5,20}$/, {
    message: 'nationalId must be 5-20 characters (letters, numbers or hyphen)',
  })
  nationalId?: string;

  @IsOptional()
  @IsDateString({}, { message: 'dateOfBirth must be a valid ISO date string' })
  dateOfBirth?: string;

  @IsOptional()
  @IsEnum(Gender, { message: 'gender must be MALE or FEMALE' })
  gender?: Gender;

  @IsOptional()
  @IsString()
  @Matches(/^.{6,}$/, { message: 'password must be at least 6 characters' })
  password?: string;
}
