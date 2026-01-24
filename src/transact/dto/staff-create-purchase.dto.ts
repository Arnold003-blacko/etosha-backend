import { IsString, Matches } from 'class-validator';
import { CreatePurchaseDto } from '../../purchases/dto/create-purchase.dto';

// DTO used by staff to initiate a purchase on behalf of a member.
// It reuses the app's CreatePurchaseDto (productId, purchaseType, yearPlanId, futureFor)
// and adds an explicit memberId so we can pass it into PurchasesService.
export class StaffCreatePurchaseDto extends CreatePurchaseDto {
  @IsString({ message: 'Member ID must be a string' })
  @Matches(/^[a-z0-9]{20,30}$/i, {
    message: 'Invalid member ID format',
  })
  memberId: string;
}

