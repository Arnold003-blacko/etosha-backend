// src/members/dto/create-member.dto.ts

import {
  IsEmail,
  IsNotEmpty,
  MinLength,
  Matches,
  IsDateString,
  IsOptional,
} from 'class-validator';

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
  @IsOptional()
  @IsDateString({}, { message: 'dateOfBirth must be a valid ISO date string' })
  dateOfBirth?: string;
}
