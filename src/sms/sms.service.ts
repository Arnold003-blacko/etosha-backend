import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  SmsOutboxEventType,
  SmsCategory,
  SmsStatus,
  StaffType,
} from '@prisma/client';
import twilio from 'twilio';

@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);
  private twilioClient: ReturnType<typeof twilio> | null = null;

  constructor(private readonly prisma: PrismaService) {
    // Initialize Twilio client if credentials are available
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;

    if (accountSid && authToken) {
      this.twilioClient = twilio(accountSid, authToken);
      this.logger.log('Twilio client initialized');
    } else {
      this.logger.warn(
        'Twilio credentials not found. SMS sending will be disabled.',
      );
    }
  }

  /**
   * Queue burial notification SMS event
   */
  async queueBurialNotificationSms(burialId: string): Promise<void> {
    await this.prisma.smsOutbox.create({
      data: {
        eventType: SmsOutboxEventType.BURIAL_READY_NOTIFY_TEAMS,
        payload: { burialId },
        status: 'PENDING',
      },
    });
    this.logger.log(`Queued burial notification SMS for burial ${burialId}`);
  }

  /**
   * Process burial notification SMS event
   */
  async processBurialNotificationSms(payload: { burialId: string }) {
    const burial = await this.prisma.deceased.findUnique({
      where: { id: payload.burialId },
      include: {
        purchase: {
          include: {
            product: {
              select: {
                pricingSection: true,
              },
            },
          },
        },
        nextOfKin: true,
        graveSlot: {
          include: {
            grave: {
              select: {
                section: true,
              },
            },
          },
        },
      },
    });

    if (!burial) {
      throw new Error(`Burial ${payload.burialId} not found`);
    }

    // Validate required fields
    if (
      !burial.fullName ||
      !burial.expectedBurial ||
      !burial.nextOfKin ||
      !burial.nextOfKin.fullName ||
      !burial.nextOfKin.phone ||
      !burial.nextOfKin.relationship
    ) {
      throw new Error(
        `Burial ${payload.burialId} missing required fields for SMS notification`,
      );
    }

    // Get section label
    const sectionLabel =
      burial.graveSlot?.grave.section ||
      burial.purchase?.product?.pricingSection ||
      'N/A';

    // Format burial date/time
    const burialDateTime = burial.expectedBurial
      ? new Date(burial.expectedBurial).toLocaleString('en-US', {
          dateStyle: 'short',
          timeStyle: 'short',
        })
      : 'TBD';

    // Get burial reference (use ID first 8 chars)
    const burialRef = burial.id.substring(0, 8).toUpperCase();

    // Get all active staff for operational SMS (SITE + OFFICE)
    const operationalStaff = await this.prisma.staff.findMany({
      where: {
        isActive: true,
        isApproved: true,
        staffType: {
          in: [StaffType.SITE, StaffType.OFFICE],
        },
      },
    });

    // Get all active pastoral staff
    const pastoralStaff = await this.prisma.staff.findMany({
      where: {
        isActive: true,
        isApproved: true,
        staffType: StaffType.PASTORAL,
      },
    });

    // Create outbox event for tracking
    const outbox = await this.prisma.smsOutbox.create({
      data: {
        eventType: SmsOutboxEventType.BURIAL_READY_NOTIFY_TEAMS,
        payload: { burialId: payload.burialId },
        status: 'PROCESSING',
      },
    });

    const smsLogs: any[] = [];

    try {
      // Send operational SMS to Site + Office staff
      for (const staff of operationalStaff) {
        const message = this.formatOperationalSms(
          burialRef,
          sectionLabel,
          burial.fullName,
          burialDateTime,
        );

        const phoneE164 = this.normalizePhoneToE164(staff.phone);
        if (!phoneE164) {
          this.logger.warn(
            `Invalid phone number for staff ${staff.id}: ${staff.phone}`,
          );
          continue;
        }

        const smsLog = await this.sendSms(
          phoneE164,
          message,
          SmsCategory.OPS,
          outbox.id,
        );
        smsLogs.push(smsLog);
      }

      // Send pastoral SMS to Pastoral Team
      for (const staff of pastoralStaff) {
        const message = this.formatPastoralSms(
          burialRef,
          burial.fullName,
          burial.nextOfKin.fullName,
          burial.nextOfKin.relationship,
          burial.nextOfKin.phone,
          burialDateTime,
        );

        const phoneE164 = this.normalizePhoneToE164(staff.phone);
        if (!phoneE164) {
          this.logger.warn(
            `Invalid phone number for staff ${staff.id}: ${staff.phone}`,
          );
          continue;
        }

        const smsLog = await this.sendSms(
          phoneE164,
          message,
          SmsCategory.PASTORAL,
          outbox.id,
        );
        smsLogs.push(smsLog);
      }

      // Mark outbox as completed
      await this.prisma.smsOutbox.update({
        where: { id: outbox.id },
        data: {
          status: 'COMPLETED',
          processedAt: new Date(),
        },
      });

      // Mark burial as SMS notified
      await this.prisma.deceased.update({
        where: { id: payload.burialId },
        data: {
          smsNotifiedAt: new Date(),
        },
      });

      this.logger.log(
        `Successfully sent ${smsLogs.length} SMS notifications for burial ${payload.burialId}`,
      );
    } catch (error) {
      // Mark outbox as failed
      await this.prisma.smsOutbox.update({
        where: { id: outbox.id },
        data: {
          status: 'FAILED',
          errorMessage: error instanceof Error ? error.message : 'Unknown error',
          processedAt: new Date(),
        },
      });

      this.logger.error(
        `Failed to send burial notification SMS: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      throw error;
    }
  }

  /**
   * Format operational SMS message (Site + Office staff)
   */
  private formatOperationalSms(
    ref: string,
    section: string,
    deceasedName: string,
    burialDateTime: string,
  ): string {
    return `BURIAL NOTICE
Ref: ${ref}
Section: ${section}
Deceased: ${deceasedName}
Burial: ${burialDateTime}
Please prepare site & equipment.`;
  }

  /**
   * Format pastoral SMS message (Pastoral Team)
   */
  private formatPastoralSms(
    ref: string,
    deceasedName: string,
    nokName: string,
    relationship: string,
    nokPhone: string,
    burialDateTime: string,
  ): string {
    return `PASTORAL NOTICE
Ref: ${ref}
Deceased: ${deceasedName}
NOK: ${nokName} (${relationship})
NOK Phone: ${nokPhone}
Burial: ${burialDateTime}`;
  }

  /**
   * Send SMS via Twilio
   */
  private async sendSms(
    to: string,
    message: string,
    category: SmsCategory,
    outboxId: string,
  ): Promise<any> {
    // Create SMS log entry
    const smsLog = await this.prisma.smsLog.create({
      data: {
        outboxId,
        recipientPhone: to,
        messageBody: message,
        category,
        status: SmsStatus.QUEUED,
      },
    });

    if (!this.twilioClient) {
      this.logger.warn(
        `Twilio not configured. SMS log created but not sent: ${smsLog.id}`,
      );
      await this.prisma.smsLog.update({
        where: { id: smsLog.id },
        data: {
          status: SmsStatus.FAILED,
          errorMessage: 'Twilio not configured',
        },
      });
      return smsLog;
    }

    try {
      const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;
      const from = process.env.TWILIO_PHONE_NUMBER;

      if (!messagingServiceSid && !from) {
        throw new Error(
          'TWILIO_MESSAGING_SERVICE_SID or TWILIO_PHONE_NUMBER must be set',
        );
      }

      // Use Messaging Service if available, otherwise use phone number
      const twilioMessage = await this.twilioClient.messages.create({
        to,
        body: message,
        ...(messagingServiceSid
          ? { messagingServiceSid }
          : { from: from! }),
        statusCallback: process.env.TWILIO_STATUS_CALLBACK_URL,
      });

      // Update SMS log with Twilio SID and status
      await this.prisma.smsLog.update({
        where: { id: smsLog.id },
        data: {
          twilioMessageSid: twilioMessage.sid,
          status: SmsStatus.SENT,
          sentAt: new Date(),
        },
      });

      this.logger.log(`SMS sent: ${twilioMessage.sid} to ${to}`);
      return smsLog;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to send SMS to ${to}: ${errorMessage}`);

      await this.prisma.smsLog.update({
        where: { id: smsLog.id },
        data: {
          status: SmsStatus.FAILED,
          errorMessage,
        },
      });

      throw error;
    }
  }

  /**
   * Normalize phone number to E.164 format
   * Assumes Zimbabwe numbers (+263 prefix)
   */
  private normalizePhoneToE164(phone: string): string | null {
    if (!phone) return null;

    // Remove all non-digit characters
    const digits = phone.replace(/\D/g, '');

    // If already starts with country code
    if (digits.startsWith('263')) {
      return `+${digits}`;
    }

    // If starts with 0, replace with +263
    if (digits.startsWith('0')) {
      return `+263${digits.substring(1)}`;
    }

    // If 9 digits (Zimbabwe mobile), add +263
    if (digits.length === 9) {
      return `+263${digits}`;
    }

    // If 10 digits and starts with 7 (Zimbabwe mobile), add +263
    if (digits.length === 10 && digits.startsWith('7')) {
      return `+263${digits}`;
    }

    // If already in E.164 format
    if (digits.startsWith('263') && digits.length >= 12) {
      return `+${digits}`;
    }

    this.logger.warn(`Could not normalize phone number: ${phone}`);
    return null;
  }

  /**
   * Handle Twilio status callback
   */
  async handleTwilioStatusCallback(
    messageSid: string,
    status: string,
  ): Promise<void> {
    const smsLog = await this.prisma.smsLog.findFirst({
      where: { twilioMessageSid: messageSid },
    });

    if (!smsLog) {
      this.logger.warn(`SMS log not found for Twilio SID: ${messageSid}`);
      return;
    }

    const updateData: any = {};

    switch (status.toLowerCase()) {
      case 'sent':
        updateData.status = SmsStatus.SENT;
        updateData.sentAt = new Date();
        break;
      case 'delivered':
        updateData.status = SmsStatus.DELIVERED;
        updateData.deliveredAt = new Date();
        break;
      case 'failed':
      case 'undelivered':
        updateData.status = SmsStatus.FAILED;
        updateData.errorMessage = `Twilio status: ${status}`;
        break;
      default:
        // Other statuses like 'queued', 'sending' - no update needed
        return;
    }

    await this.prisma.smsLog.update({
      where: { id: smsLog.id },
      data: updateData,
    });

    this.logger.log(`Updated SMS log ${smsLog.id} status to ${status}`);
  }

  /**
   * Queue monthly debtor reminder SMS
   */
  async queueMonthlyDebtorReminders(): Promise<void> {
    const now = new Date();
    const currentMonth = now.toLocaleString('default', { month: 'long' });

    // Get all members with outstanding balance
    const membersWithDebt = await this.prisma.member.findMany({
      where: {
        purchases: {
          some: {
            balance: {
              gt: 0,
            },
            status: {
              in: ['PENDING_PAYMENT', 'PARTIALLY_PAID'],
            },
          },
        },
      },
      include: {
        purchases: {
          where: {
            balance: {
              gt: 0,
            },
            status: {
              in: ['PENDING_PAYMENT', 'PARTIALLY_PAID'],
            },
          },
        },
      },
    });

    for (const member of membersWithDebt) {
      // Calculate total outstanding balance
      const totalBalance = member.purchases.reduce(
        (sum, p) => sum + Number(p.balance),
        0,
      );

      if (totalBalance > 0) {
        await this.prisma.smsOutbox.create({
          data: {
            eventType: SmsOutboxEventType.DEBTOR_MONTHLY_REMINDER,
            payload: {
              memberId: member.id,
              month: currentMonth,
              amountDue: totalBalance,
            },
            status: 'PENDING',
          },
        });
      }
    }

    this.logger.log(
      `Queued ${membersWithDebt.length} monthly debtor reminder SMS events`,
    );
  }

  /**
   * Process monthly debtor reminder SMS
   */
  async processDebtorReminderSms(payload: {
    memberId: string;
    month: string;
    amountDue: number;
  }) {
    const member = await this.prisma.member.findUnique({
      where: { id: payload.memberId },
      include: {
        purchases: {
          where: {
            balance: {
              gt: 0,
            },
            status: {
              in: ['PENDING_PAYMENT', 'PARTIALLY_PAID'],
            },
          },
          include: {
            product: true,
          },
        },
      },
    });

    if (!member) {
      throw new Error(`Member ${payload.memberId} not found`);
    }

    const phoneE164 = this.normalizePhoneToE164(member.phone);
    if (!phoneE164) {
      throw new Error(`Invalid phone number for member ${member.id}`);
    }

    // Format payment methods (placeholder - adjust based on your system)
    const paymentMethods = 'PayNow or bank transfer';
    const supportPhone = process.env.SUPPORT_PHONE || 'support';

    // Get account reference (first purchase ID or member ID)
    const accountRef =
      member.purchases[0]?.id.substring(0, 8).toUpperCase() ||
      member.id.substring(0, 8).toUpperCase();

    // Calculate due date (end of current month)
    const now = new Date();
    const dueDate = new Date(
      now.getFullYear(),
      now.getMonth() + 1,
      0,
    ).toLocaleDateString('en-US', { dateStyle: 'short' });

    const message = `PAYMENT REMINDER
Hi ${member.firstName}, your balance for ${payload.month} is $${payload.amountDue.toFixed(2)}.
Ref: ${accountRef} | Due: ${dueDate}
Pay via ${paymentMethods} or call ${supportPhone}.`;

    const outbox = await this.prisma.smsOutbox.create({
      data: {
        eventType: SmsOutboxEventType.DEBTOR_MONTHLY_REMINDER,
        payload,
        status: 'PROCESSING',
      },
    });

    try {
      await this.sendSms(phoneE164, message, SmsCategory.DEBTOR, outbox.id);

      await this.prisma.smsOutbox.update({
        where: { id: outbox.id },
        data: {
          status: 'COMPLETED',
          processedAt: new Date(),
        },
      });
    } catch (error) {
      await this.prisma.smsOutbox.update({
        where: { id: outbox.id },
        data: {
          status: 'FAILED',
          errorMessage: error instanceof Error ? error.message : 'Unknown error',
          processedAt: new Date(),
        },
      });
      throw error;
    }
  }
}
