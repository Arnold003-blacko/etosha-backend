import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  UseGuards,
  Request,
} from '@nestjs/common';
import { SmsService } from './sms.service';
import { StaffJwtGuard } from '../staff-auth/staff-jwt.guard';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { ScheduleCampaignDto } from './dto/schedule-campaign.dto';
import { TestSmsDto } from './dto/test-sms.dto';

@Controller('sms')
export class SmsController {
  constructor(private readonly smsService: SmsService) {}

  /**
   * Twilio status callback endpoint (public, no auth required)
   * Twilio will POST to this endpoint with message status updates
   */
  @Post('twilio/status-callback')
  async handleTwilioStatusCallback(@Body() body: any) {
    const { MessageSid, MessageStatus } = body;

    if (!MessageSid || !MessageStatus) {
      return { error: 'Missing MessageSid or MessageStatus' };
    }

    await this.smsService.handleTwilioStatusCallback(MessageSid, MessageStatus);

    return { success: true };
  }

  /**
   * Manual trigger for monthly debtor reminders (admin only)
   */
  @Post('debtor-reminders/queue')
  @UseGuards(StaffJwtGuard)
  async queueDebtorReminders() {
    await this.smsService.queueMonthlyDebtorReminders();
    return { message: 'Debtor reminder SMS queued successfully' };
  }

  /**
   * Create a new promotional campaign (admin only)
   */
  @Post('campaigns')
  @UseGuards(StaffJwtGuard)
  async createCampaign(@Body() dto: CreateCampaignDto, @Request() req: any) {
    const staffId = req.user?.id || req.user?.sub;
    const targetGroup = dto.targetGroup ? JSON.parse(dto.targetGroup) : null;
    const scheduledFor = dto.scheduledFor ? new Date(dto.scheduledFor) : null;

    const campaign = await this.smsService.createPromotionalCampaign(
      dto.title,
      dto.message,
      targetGroup,
      scheduledFor,
      staffId,
    );

    return campaign;
  }

  /**
   * Get all campaigns (admin only)
   */
  @Get('campaigns')
  @UseGuards(StaffJwtGuard)
  async getCampaigns() {
    return this.smsService.getCampaigns();
  }

  /**
   * Get campaign by ID (admin only)
   */
  @Get('campaigns/:id')
  @UseGuards(StaffJwtGuard)
  async getCampaignById(@Param('id') id: string) {
    return this.smsService.getCampaignById(id);
  }

  /**
   * Send campaign immediately (admin only)
   */
  @Post('campaigns/:id/send')
  @UseGuards(StaffJwtGuard)
  async sendCampaign(@Param('id') id: string) {
    const result = await this.smsService.processPromotionalCampaign(id);
    return {
      message: 'Campaign sent successfully',
      sent: result.sent,
      failed: result.failed,
    };
  }

  /**
   * Schedule campaign for future sending (admin only)
   */
  @Post('campaigns/:id/schedule')
  @UseGuards(StaffJwtGuard)
  async scheduleCampaign(
    @Param('id') id: string,
    @Body() dto: ScheduleCampaignDto,
  ) {
    const scheduledFor = new Date(dto.scheduledFor);
    const campaign = await this.smsService.scheduleCampaign(id, scheduledFor);
    return campaign;
  }

  /**
   * Cancel scheduled campaign (admin only)
   */
  @Post('campaigns/:id/cancel')
  @UseGuards(StaffJwtGuard)
  async cancelCampaign(@Param('id') id: string) {
    const campaign = await this.smsService.cancelCampaign(id);
    return { message: 'Campaign cancelled successfully', campaign };
  }

  /**
   * Check Twilio configuration status (admin only)
   */
  @Get('health')
  @UseGuards(StaffJwtGuard)
  async getHealth() {
    return this.smsService.getTwilioConfigStatus();
  }

  /**
   * Send a test SMS (admin only)
   */
  @Post('test')
  @UseGuards(StaffJwtGuard)
  async sendTestSms(@Body() dto: TestSmsDto) {
    return this.smsService.sendTestSms(dto.phoneNumber, dto.message);
  }
}
