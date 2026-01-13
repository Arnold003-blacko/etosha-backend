// src/members/dto/create-member.dto.ts

import {
  IsEmail,
  IsNotEmpty,
  MinLength,
  Matches,
  IsDateString,
  IsEnum,
} from 'class-validator';

export enum Gender {
  MALE = 'MALE',
  FEMALE = 'FEMALE',
}

export class CreateMemberDto {
  @IsNotEmpty()
  firstName: string;

  @IsNotEmpty()
  lastName: string;

  @IsEmail()
  email: string;

  @MinLength(6)
  password: string;

  @IsNotEmpty()
  country: string;

  @IsNotEmpty()
  address: string;

  @IsNotEmpty()
  city: string;

  @Matches(/^\d{10}$/, { message: 'phone must be 10 digits' })
  phone: string;

  // nationalId required: letters/numbers/hyphen, 5-20 chars
  @IsNotEmpty()
  @Matches(/^[0-9A-Za-z-]{5,20}$/, {
    message: 'nationalId must be 5-20 characters (letters, numbers or hyphen)',
  })
  nationalId: string;

  /**
   * Date of birth
   * Expected format: YYYY-MM-DD (ISO string)
   * Stored as DateTime in Prisma
   */
  @IsDateString({}, { message: 'dateOfBirth must be a valid ISO date string' })
  dateOfBirth: string;

  /**
   * Gender (REQUIRED)
   * Allowed values: MALE | FEMALE
   */
  @IsEnum(Gender, { message: 'gender must be MALE or FEMALE' })
  gender: Gender;
}
