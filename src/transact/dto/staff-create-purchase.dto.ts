import { IsString, Matches, IsOptional, ValidateNested, IsObject } from 'class-validator';
import { Type } from 'class-transformer';
import { CreatePurchaseDto } from '../../purchases/dto/create-purchase.dto';
import { DeceasedDetailsDto } from './deceased-details.dto';
import { UpsertNextOfKinDto } from '../../members/dto/upsert-next-of-kin.dto';

// DTO used by staff to initiate a purchase on behalf of a member.
// It reuses the app's CreatePurchaseDto (productId, purchaseType, yearPlanId, futureFor)
// and adds an explicit memberId so we can pass it into PurchasesService.
// For immediate burials, it also accepts deceased and next of kin details to capture before payment.
export class StaffCreatePurchaseDto extends CreatePurchaseDto {
  @IsString({ message: 'Member ID must be a string' })
  @Matches(/^[a-z0-9]{20,30}$/i, {
    message: 'Invalid member ID format',
  })
  memberId: string;

  // Optional deceased details for immediate burials (captured before payment)
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => DeceasedDetailsDto)
  deceasedDetails?: DeceasedDetailsDto;

  // Optional next of kin details for immediate burials (captured before payment)
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => UpsertNextOfKinDto)
  nextOfKinDetails?: UpsertNextOfKinDto;
}

