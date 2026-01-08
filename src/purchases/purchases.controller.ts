import {
  Controller,
  Post,
  Body,
  Req,
  UseGuards,
  Param,
  Get,
} from '@nestjs/common';
import { PurchasesService } from './purchases.service';
import { CreatePurchaseDto } from './dto/create-purchase.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('purchases')
export class PurchasesController {
  constructor(
    private readonly purchasesService: PurchasesService,
  ) {}

  /* =========================
     INITIATE PURCHASE
  ========================= */

  @UseGuards(JwtAuthGuard)
  @Post('initiate')
  initiate(@Body() dto: CreatePurchaseDto, @Req() req) {
    return this.purchasesService.initiatePurchase(
      dto,
      req.user.id,
    );
  }

  /* =========================
     SERVICE PURCHASE
  ========================= */

  @UseGuards(JwtAuthGuard)
  @Post('service/:productId')
  async initiateServicePurchase(
    @Param('productId') productId: string,
    @Req() req,
  ) {
    const dto: CreatePurchaseDto = {
      productId,
      purchaseType: 'IMMEDIATE',
    };

    return this.purchasesService.initiateServicePurchase(
      dto,
      req.user.id,
    );
  }

  /* =========================
     SAVE DECEASED DETAILS
     (AUTO-REDEEM FOR IMMEDIATE)
  ========================= */

  @UseGuards(JwtAuthGuard)
  @Post(':id/deceased')
  saveDeceased(
    @Param('id') purchaseId: string,
    @Body() body,
    @Req() req,
  ) {
    return this.purchasesService.saveDeceased(
      purchaseId,
      body,
      req.user.id,
    );
  }

  /* =========================
     VERIFY FUTURE REDEEM (NEW)
     Used by Redeem Modal
  ========================= */

  @UseGuards(JwtAuthGuard)
  @Get(':id/verify-redeem')
  verifyRedeem(
    @Param('id') purchaseId: string,
    @Req() req,
  ) {
    return this.purchasesService.verifyRedeem(
      purchaseId,
      req.user.id,
    );
  }

  /* =========================
     GET MY PURCHASES
  ========================= */

  @UseGuards(JwtAuthGuard)
  @Get('my')
  getMyPurchases(@Req() req) {
    return this.purchasesService.getMyPurchases(
      req.user.id,
    );
  }
}
