import {
  IsEmail,
  IsNotEmpty,
  IsString,
  IsIn,
  IsInt,
  Min,
  Max,
  MinLength,
  IsOptional,
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

  @IsIn(['SITE', 'OFFICE', 'PASTORAL'])
  staffType: 'SITE' | 'OFFICE' | 'PASTORAL';

  @IsInt()
  @Min(1)
  @Max(5)
  level: number;

  @MinLength(8)
  password: string;
}
