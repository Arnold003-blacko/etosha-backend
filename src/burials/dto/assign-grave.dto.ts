import { IsInt, IsString, IsUUID, Min, Max } from 'class-validator';

export class AssignGraveDto {
  @IsUUID()
  deceasedId: string;

  // Section is now derived from purchase.product.pricingSection, not manually assigned
  // Only grave number needs to be assigned

  @IsString()
  graveNumber: string;

  @IsInt()
  @Min(1)
  @Max(2)
  slotNo: number;
}
