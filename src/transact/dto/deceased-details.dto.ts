// DTO for deceased details captured before payment (without purchaseId)
import {
  IsString,
  IsOptional,
  IsDateString,
  IsNotEmpty,
} from 'class-validator';

export class DeceasedDetailsDto {
  @IsNotEmpty({ message: 'fullName must not be empty' })
  @IsString({ message: 'fullName must be a string' })
  fullName: string;

  @IsNotEmpty({ message: 'dateOfBirth must not be empty' })
  @IsDateString({}, { message: 'dateOfBirth must be a valid ISO date string (YYYY-MM-DD)' })
  dateOfBirth: string;

  @IsNotEmpty({ message: 'gender must not be empty' })
  @IsString({ message: 'gender must be a string' })
  gender: string;

  @IsNotEmpty({ message: 'address must not be empty' })
  @IsString({ message: 'address must be a string' })
  address: string;

  @IsNotEmpty({ message: 'relationship must not be empty' })
  @IsString({ message: 'relationship must be a string' })
  relationship: string;

  @IsOptional()
  @IsString({ message: 'causeOfDeath must be a string' })
  causeOfDeath?: string;

  @IsOptional()
  @IsString({ message: 'funeralParlor must be a string' })
  funeralParlor?: string;

  @IsNotEmpty({ message: 'dateOfDeath must not be empty' })
  @IsDateString({}, { message: 'dateOfDeath must be a valid ISO date string (YYYY-MM-DD)' })
  dateOfDeath: string;

  @IsOptional()
  @IsDateString({}, { message: 'expectedBurial must be a valid ISO date string (YYYY-MM-DD)' })
  expectedBurial?: string;
}
