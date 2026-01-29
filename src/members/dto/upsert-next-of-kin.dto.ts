import {
  IsString,
  IsOptional,
  IsEmail,
  IsNotEmpty,
} from 'class-validator';
import { Transform } from 'class-transformer';

export class UpsertNextOfKinDto {
  @IsNotEmpty({ message: 'fullName must not be empty' })
  @IsString({ message: 'fullName must be a string' })
  fullName: string;

  @IsNotEmpty({ message: 'relationship must not be empty' })
  @IsString({ message: 'relationship must be a string' })
  relationship: string;

  @IsNotEmpty({ message: 'phone must not be empty' })
  @IsString({ message: 'phone must be a string' })
  phone: string;

  @IsOptional()
  @Transform(({ value }) => value === '' ? undefined : value)
  @IsEmail({}, { message: 'email must be a valid email address' })
  email?: string;

  @IsNotEmpty({ message: 'address must not be empty' })
  @IsString({ message: 'address must be a string' })
  address: string;
}
