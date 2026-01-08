// src/deceased/deceased.controller.ts
import {
  Body,
  Controller,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { DeceasedService } from './deceased.service';
import { CreateDeceasedDto } from './dto/create-deceased.dto';

@Controller('deceased')
@UseGuards(JwtAuthGuard)
export class DeceasedController {
  constructor(private readonly service: DeceasedService) {}

  /**
   * ✅ FINAL CONFIRMATION ENDPOINT
   * This endpoint:
   * - creates the deceased
   * - redeems the purchase
   * - must be called ONLY after payment success
   */
  @Post()
  async create(@Body() dto: CreateDeceasedDto, @Req() req) {
    return this.service.createAndRedeem(dto, req.user.id);
  }
}
