import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  SmsOutboxEventType,
  SmsCategory,
  SmsStatus,
  StaffType,
} from '@prisma/client';
import Twilio from 'twilio';
import type { Twilio as TwilioType } from 'twilio';

@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);
  private twilioClient: TwilioType | null = null;

  constructor(private readonly prisma: PrismaService) {
    this.initializeTwilioClient();
  }

  /**
   * Initialize or reinitialize Twilio client
   */
  private initializeTwilioClient(): void {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;

    if (accountSid && authToken) {
      try {
        this.twilioClient = Twilio(accountSid, authToken);
        this.logger.log('Twilio client initialized successfully');
      } catch (error) {
        this.logger.error(
          `Failed to initialize Twilio client: ${error instanceof Error ? error.message : 'Unknown error'}`,
        );
        this.twilioClient = null;
      }
    } else {
      this.logger.warn(
        'Twilio credentials not found. SMS sending will be disabled.',
      );
      this.twilioClient = null;
    }
  }

  /**
   * Check if Twilio is properly configured
   */
  isTwilioConfigured(): boolean {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;
    const phoneNumber = process.env.TWILIO_PHONE_NUMBER;

    return !!(
      accountSid &&
      authToken &&
      (messagingServiceSid || phoneNumber)
    );
  }

  /**
   * Get Twilio configuration status
   */
  getTwilioConfigStatus(): {
    configured: boolean;
    hasAccountSid: boolean;
    hasAuthToken: boolean;
    hasMessagingService: boolean;
    hasPhoneNumber: boolean;
    status: 'ready' | 'missing_config' | 'error';
  } {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;
    const phoneNumber = process.env.TWILIO_PHONE_NUMBER;

    const hasAccountSid = !!accountSid;
    const hasAuthToken = !!authToken;
    const hasMessagingService = !!messagingServiceSid;
    const hasPhoneNumber = !!phoneNumber;

    const configured =
      hasAccountSid &&
      hasAuthToken &&
      (hasMessagingService || hasPhoneNumber);

    let status: 'ready' | 'missing_config' | 'error' = 'missing_config';
    if (configured && this.twilioClient) {
      status = 'ready';
    } else if (configured && !this.twilioClient) {
      status = 'error';
    }

    return {
      configured,
      hasAccountSid,
      hasAuthToken,
      hasMessagingService,
      hasPhoneNumber,
      status,
    };
  }

  /**
   * Validate Twilio configuration and throw if missing
   */
  private validateTwilioConfig(): void {
    if (!this.isTwilioConfigured()) {
      const config = this.getTwilioConfigStatus();
      const missing: string[] = [];

      if (!config.hasAccountSid) missing.push('TWILIO_ACCOUNT_SID');
      if (!config.hasAuthToken) missing.push('TWILIO_AUTH_TOKEN');
      if (!config.hasMessagingService && !config.hasPhoneNumber) {
        missing.push('TWILIO_MESSAGING_SERVICE_SID or TWILIO_PHONE_NUMBER');
      }

      throw new Error(
        `Twilio is not configured. Missing environment variables: ${missing.join(', ')}`,
      );
    }

    if (!this.twilioClient) {
      // Try to reinitialize
      this.initializeTwilioClient();
      if (!this.twilioClient) {
        throw new Error(
          'Twilio client failed to initialize. Please check your credentials.',
        );
      }
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

    // Get Site Staff (all SITE staff)
    const siteStaff = await this.prisma.staff.findMany({
      where: {
        isActive: true,
        isApproved: true,
        staffType: StaffType.SITE,
      },
    });

    // Get Office Level 1 Staff only (exclude bosses/managers)
    const officeLevel1Staff = await this.prisma.staff.findMany({
      where: {
        isActive: true,
        isApproved: true,
        staffType: StaffType.OFFICE,
        level: 1, // Only Level 1 general workers
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
      // Send operational SMS to Site Staff
      for (const staff of siteStaff) {
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

      // Send Office Level 1 SMS (includes NOK details)
      for (const staff of officeLevel1Staff) {
        const message = this.formatOfficeLevel1Sms(
          burialRef,
          sectionLabel,
          burial.fullName,
          burialDateTime,
          burial.nextOfKin.fullName,
          burial.nextOfKin.phone,
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
   * Format Office Level 1 SMS message (includes NOK details)
   */
  private formatOfficeLevel1Sms(
    ref: string,
    section: string,
    deceasedName: string,
    burialDateTime: string,
    nokName: string,
    nokPhone: string,
  ): string {
    return `BURIAL NOTICE
Ref: ${ref}
Section: ${section}
Deceased: ${deceasedName}
Burial: ${burialDateTime}
NOK: ${nokName}
NOK Phone: ${nokPhone}
Please prepare for walk-in clients.`;
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
    // Validate phone number format
    const normalizedPhone = this.normalizePhoneToE164(to);
    if (!normalizedPhone) {
      throw new Error(`Invalid phone number format: ${to}`);
    }

    // Validate Twilio configuration
    this.validateTwilioConfig();

    // Create SMS log entry
    const smsLog = await this.prisma.smsLog.create({
      data: {
        outboxId,
        recipientPhone: normalizedPhone,
        messageBody: message,
        category,
        status: SmsStatus.QUEUED,
      },
    });

    try {
      const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;
      const from = process.env.TWILIO_PHONE_NUMBER;

      if (!messagingServiceSid && !from) {
        throw new Error(
          'TWILIO_MESSAGING_SERVICE_SID or TWILIO_PHONE_NUMBER must be set',
        );
      }

      // Use Messaging Service if available, otherwise use phone number
      const twilioMessage = await this.twilioClient!.messages.create({
        to: normalizedPhone,
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

      this.logger.log(`SMS sent: ${twilioMessage.sid} to ${normalizedPhone}`);
      return smsLog;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to send SMS to ${normalizedPhone}: ${errorMessage}`);

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
   * Send a test SMS (public method for testing)
   */
  async sendTestSms(
    phoneNumber: string,
    message?: string,
  ): Promise<{ success: boolean; messageSid?: string; error?: string }> {
    try {
      // Validate Twilio configuration
      this.validateTwilioConfig();

      // Normalize phone number
      const normalizedPhone = this.normalizePhoneToE164(phoneNumber);
      if (!normalizedPhone) {
        return {
          success: false,
          error: `Invalid phone number format: ${phoneNumber}`,
        };
      }

      // Default test message
      const testMessage =
        message ||
        `Test SMS from Etosha - ${new Date().toLocaleString()}`;

      // Create a temporary outbox entry for tracking
      const outbox = await this.prisma.smsOutbox.create({
        data: {
          eventType: SmsOutboxEventType.PROMOTIONAL_CAMPAIGN,
          payload: { test: true },
          status: 'PROCESSING',
        },
      });

      // Send SMS
      const smsLog = await this.sendSms(
        normalizedPhone,
        testMessage,
        SmsCategory.PROMO,
        outbox.id,
      );

      // Mark outbox as completed
      await this.prisma.smsOutbox.update({
        where: { id: outbox.id },
        data: {
          status: 'COMPLETED',
          processedAt: new Date(),
        },
      });

      return {
        success: true,
        messageSid: smsLog.twilioMessageSid || undefined,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Test SMS failed: ${errorMessage}`);
      return {
        success: false,
        error: errorMessage,
      };
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

  /**
   * Create a new promotional campaign
   */
  async createPromotionalCampaign(
    title: string,
    message: string,
    targetGroup: any,
    scheduledFor: Date | null,
    createdBy: string,
  ) {
    const campaign = await this.prisma.smsCampaign.create({
      data: {
        title,
        message,
        targetGroup: targetGroup ? JSON.stringify(targetGroup) : null,
        scheduledFor,
        status: scheduledFor ? 'SCHEDULED' : 'DRAFT',
        createdBy,
      },
    });

    this.logger.log(`Created promotional campaign: ${campaign.id}`);
    return campaign;
  }

  /**
   * Schedule a campaign for future sending
   */
  async scheduleCampaign(campaignId: string, scheduledFor: Date) {
    const campaign = await this.prisma.smsCampaign.update({
      where: { id: campaignId },
      data: {
        scheduledFor,
        status: 'SCHEDULED',
      },
    });

    this.logger.log(`Scheduled campaign ${campaignId} for ${scheduledFor}`);
    return campaign;
  }

  /**
   * Get eligible members based on campaign target group filters
   */
  private async getEligibleMembers(targetGroup: any): Promise<any[]> {
    let where: any = {
      AND: [
        { phone: { not: null } },
        { phone: { not: '' } },
      ], // Must have phone number
    };

    // Parse target group filters
    if (targetGroup) {
      // Filter: hasPurchases
      if (targetGroup.hasPurchases === true) {
        where.purchases = {
          some: {},
        };
      }

      // Filter: specific sections (via purchases)
      if (targetGroup.sections && Array.isArray(targetGroup.sections)) {
        where.purchases = {
          ...where.purchases,
          some: {
            product: {
              pricingSection: {
                in: targetGroup.sections,
              },
            },
          },
        };
      }

      // Filter: date range (members created between dates)
      if (targetGroup.createdAfter || targetGroup.createdBefore) {
        where.createdAt = {};
        if (targetGroup.createdAfter) {
          where.createdAt.gte = new Date(targetGroup.createdAfter);
        }
        if (targetGroup.createdBefore) {
          where.createdAt.lte = new Date(targetGroup.createdBefore);
        }
      }
    }

    const members = await this.prisma.member.findMany({
      where,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        phone: true,
      },
    });

    return members;
  }

  /**
   * Process promotional campaign and send SMS to eligible members
   */
  async processPromotionalCampaign(campaignId: string) {
    const campaign = await this.prisma.smsCampaign.findUnique({
      where: { id: campaignId },
    });

    if (!campaign) {
      throw new Error(`Campaign ${campaignId} not found`);
    }

    if (campaign.status === 'COMPLETED') {
      throw new Error(`Campaign ${campaignId} already completed`);
    }

    if (campaign.status === 'CANCELLED') {
      throw new Error(`Campaign ${campaignId} is cancelled`);
    }

    // Update campaign status to SENDING
    await this.prisma.smsCampaign.update({
      where: { id: campaignId },
      data: { status: 'SENDING' },
    });

    // Parse target group
    const targetGroup = campaign.targetGroup
      ? JSON.parse(campaign.targetGroup)
      : null;

    // Get eligible members
    const eligibleMembers = await this.getEligibleMembers(targetGroup);

    if (eligibleMembers.length === 0) {
      await this.prisma.smsCampaign.update({
        where: { id: campaignId },
        data: {
          status: 'COMPLETED',
          sentAt: new Date(),
        },
      });
      this.logger.warn(`No eligible members for campaign ${campaignId}`);
      return { sent: 0, failed: 0 };
    }

    // Create outbox event for tracking
    const outbox = await this.prisma.smsOutbox.create({
      data: {
        eventType: SmsOutboxEventType.PROMOTIONAL_CAMPAIGN,
        payload: { campaignId },
        status: 'PROCESSING',
        campaignId: campaign.id,
      },
    });

    let sentCount = 0;
    let failedCount = 0;

    try {
      // Send SMS to each eligible member
      for (const member of eligibleMembers) {
        const phoneE164 = this.normalizePhoneToE164(member.phone);
        if (!phoneE164) {
          this.logger.warn(
            `Invalid phone number for member ${member.id}: ${member.phone}`,
          );
          failedCount++;
          continue;
        }

        try {
          await this.sendSms(
            phoneE164,
            campaign.message,
            SmsCategory.PROMO,
            outbox.id,
          );
          sentCount++;
        } catch (error) {
          this.logger.error(
            `Failed to send promotional SMS to ${phoneE164}: ${error instanceof Error ? error.message : 'Unknown error'}`,
          );
          failedCount++;
        }
      }

      // Mark outbox as completed
      await this.prisma.smsOutbox.update({
        where: { id: outbox.id },
        data: {
          status: 'COMPLETED',
          processedAt: new Date(),
        },
      });

      // Mark campaign as completed
      await this.prisma.smsCampaign.update({
        where: { id: campaignId },
        data: {
          status: 'COMPLETED',
          sentAt: new Date(),
        },
      });

      this.logger.log(
        `Campaign ${campaignId} completed: ${sentCount} sent, ${failedCount} failed`,
      );

      return { sent: sentCount, failed: failedCount };
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

      // Mark campaign as failed
      await this.prisma.smsCampaign.update({
        where: { id: campaignId },
        data: {
          status: 'DRAFT', // Reset to draft so it can be retried
        },
      });

      throw error;
    }
  }

  /**
   * Get all campaigns
   */
  async getCampaigns() {
    return this.prisma.smsCampaign.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        outboxEvents: {
          include: {
            smsLogs: {
              select: {
                status: true,
              },
            },
          },
        },
      },
    });
  }

  /**
   * Get campaign by ID
   */
  async getCampaignById(campaignId: string) {
    return this.prisma.smsCampaign.findUnique({
      where: { id: campaignId },
      include: {
        outboxEvents: {
          include: {
            smsLogs: true,
          },
        },
      },
    });
  }

  /**
   * Cancel a scheduled campaign
   */
  async cancelCampaign(campaignId: string) {
    const campaign = await this.prisma.smsCampaign.findUnique({
      where: { id: campaignId },
    });

    if (!campaign) {
      throw new Error(`Campaign ${campaignId} not found`);
    }

    if (campaign.status === 'COMPLETED') {
      throw new Error('Cannot cancel completed campaign');
    }

    if (campaign.status === 'SENDING') {
      throw new Error('Cannot cancel campaign that is currently sending');
    }

    return this.prisma.smsCampaign.update({
      where: { id: campaignId },
      data: {
        status: 'CANCELLED',
      },
    });
  }
}
