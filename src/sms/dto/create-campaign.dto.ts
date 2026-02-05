import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsDateString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateCampaignDto {
  @IsNotEmpty()
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  title: string;

  @IsNotEmpty()
  @IsString()
  @MinLength(10)
  @MaxLength(1600) // SMS character limit
  message: string;

  @IsOptional()
  @IsString()
  targetGroup?: string; // JSON string with filter criteria

  @IsOptional()
  @IsDateString()
  scheduledFor?: string; // ISO date string for scheduling
}
