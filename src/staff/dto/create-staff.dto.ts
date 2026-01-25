import {
  IsEmail,
  IsNotEmpty,
  IsString,
  IsIn,
  IsInt,
  Min,
  Max,
  MinLength,
} from 'class-validator';

export class CreateStaffDto {
  @IsNotEmpty()
  @IsString()
  firstName: string;

  @IsNotEmpty()
  @IsString()
  lastName: string;

  @IsEmail()
  email: string;

  @IsNotEmpty()
  @IsString()
  phone: string;

  @IsNotEmpty()
  @IsString()
  nationalId: string;

  @IsNotEmpty()
  dateOfBirth: string;

  @IsNotEmpty()
  @IsString()
  address: string;

  @IsIn(['HARARE_OFFICE', 'GARDEN_SITE'])
  location: 'HARARE_OFFICE' | 'GARDEN_SITE';

  @IsInt()
  @Min(1)
  @Max(5)
  level: number;

  @MinLength(8)
  password: string;
}
