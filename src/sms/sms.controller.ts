import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { SmsService } from './sms.service';
import { StaffJwtGuard } from '../staff-auth/staff-jwt.guard';

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
}
