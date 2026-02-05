// src/deceased/deceased.controller.ts
import {
  Body,
  Controller,
  Post,
  Get,
  Patch,
  Param,
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
    try {
      // Only log in development to avoid information disclosure
      if (process.env.NODE_ENV !== 'production') {
        console.log(`[DECEASED CONTROLLER] POST /deceased called by user ${req.user.id}`);
        console.log(`[DECEASED CONTROLLER] DTO received:`, JSON.stringify(dto, null, 2));
      }
      return await this.service.createAndRedeem(dto, req.user.id);
    } catch (error) {
      // Error logging is safe - doesn't expose sensitive data
      console.error(`[DECEASED CONTROLLER] Error in POST /deceased:`, error);
      throw error; // Re-throw to let NestJS handle it properly
    }
  }

  /**
   * GET /deceased/my
   * Get all deceased records for the authenticated member
   */
  @Get('my')
  async getMyDeceased(@Req() req) {
    return this.service.getDeceasedForMember(req.user.id);
  }

  /**
   * GET /deceased/:deceasedId/next-of-kin
   * Get next of kin for a specific deceased person
   */
  @Get(':deceasedId/next-of-kin')
  async getNextOfKin(@Param('deceasedId') deceasedId: string, @Req() req) {
    return this.service.getNextOfKinForDeceased(deceasedId, req.user.id);
  }

  /**
   * PATCH /deceased/:deceasedId/next-of-kin
   * Update next of kin for a specific deceased person
   */
  @Patch(':deceasedId/next-of-kin')
  async updateNextOfKin(
    @Param('deceasedId') deceasedId: string,
    @Body() dto: {
      fullName: string;
      relationship: string;
      phone: string;
      email?: string;
      address: string;
    },
    @Req() req,
  ) {
    return this.service.updateNextOfKinForDeceased(
      deceasedId,
      req.user.id,
      dto,
    );
  }
}
