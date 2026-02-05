import { IsDateString, IsNotEmpty } from 'class-validator';

export class ScheduleCampaignDto {
  @IsNotEmpty()
  @IsDateString()
  scheduledFor: string; // ISO date string
}
