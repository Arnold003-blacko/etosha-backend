import { IsString, IsNotEmpty, IsOptional, Matches } from 'class-validator';

export class TestSmsDto {
  @IsNotEmpty()
  @IsString()
  @Matches(/^(\+?263|0)?[7]\d{8}$/, {
    message:
      'Phone number must be a valid Zimbabwe mobile number (e.g., +263771234567, 0771234567, or 771234567)',
  })
  phoneNumber: string;

  @IsOptional()
  @IsString()
  message?: string;
}
