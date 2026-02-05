import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { SmsService } from './sms.service';
import { SmsOutboxEventType } from '@prisma/client';

@Injectable()
export class SmsWorkerService {
  private readonly logger = new Logger(SmsWorkerService.name);
  private isProcessing = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly smsService: SmsService,
  ) {}

  /**
   * Process pending SMS outbox events
   * Runs every minute
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async processOutboxEvents() {
    if (this.isProcessing) {
      this.logger.debug('SMS worker already processing, skipping...');
      return;
    }

    this.isProcessing = true;

    try {
      // Get pending events (limit to 10 at a time to avoid overload)
      const pendingEvents = await this.prisma.smsOutbox.findMany({
        where: {
          status: 'PENDING',
        },
        orderBy: {
          createdAt: 'asc',
        },
        take: 10,
      });

      if (pendingEvents.length === 0) {
        return;
      }

      this.logger.log(`Processing ${pendingEvents.length} pending SMS events`);

      for (const event of pendingEvents) {
        try {
          // Mark as processing
          await this.prisma.smsOutbox.update({
            where: { id: event.id },
            data: { status: 'PROCESSING' },
          });

          // Process based on event type
          if (
            event.eventType === SmsOutboxEventType.BURIAL_READY_NOTIFY_TEAMS
          ) {
            await this.smsService.processBurialNotificationSms(
              event.payload as { burialId: string },
            );
          } else if (
            event.eventType === SmsOutboxEventType.DEBTOR_MONTHLY_REMINDER
          ) {
            await this.smsService.processDebtorReminderSms(
              event.payload as {
                memberId: string;
                month: string;
                amountDue: number;
              },
            );
          } else if (
            event.eventType === SmsOutboxEventType.PROMOTIONAL_CAMPAIGN
          ) {
            await this.smsService.processPromotionalCampaign(
              (event.payload as { campaignId: string }).campaignId,
            );
          }
        } catch (error) {
          this.logger.error(
            `Failed to process SMS event ${event.id}: ${error instanceof Error ? error.message : 'Unknown error'}`,
          );

          // Retry logic
          const retryCount = event.retryCount + 1;
          if (retryCount < event.maxRetries) {
            await this.prisma.smsOutbox.update({
              where: { id: event.id },
              data: {
                status: 'PENDING',
                retryCount,
                errorMessage: error instanceof Error ? error.message : 'Unknown error',
              },
            });
          } else {
            await this.prisma.smsOutbox.update({
              where: { id: event.id },
              data: {
                status: 'FAILED',
                errorMessage: `Max retries exceeded: ${error instanceof Error ? error.message : 'Unknown error'}`,
                processedAt: new Date(),
              },
            });
          }
        }
      }
    } catch (error) {
      this.logger.error(
        `Error in SMS worker: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Monthly debtor reminder scheduler
   * Runs on the 1st of every month at 9:00 AM
   */
  @Cron('0 9 1 * *')
  async scheduleMonthlyDebtorReminders() {
    this.logger.log('Scheduling monthly debtor reminder SMS...');
    await this.smsService.queueMonthlyDebtorReminders();
  }

  /**
   * Process scheduled campaigns
   * Runs every 5 minutes to check for campaigns that should be sent
   */
  @Cron('*/5 * * * *')
  async processScheduledCampaigns() {
    const now = new Date();

    // Find campaigns scheduled for now or earlier that are still in SCHEDULED status
    const scheduledCampaigns = await this.prisma.smsCampaign.findMany({
      where: {
        status: 'SCHEDULED',
        scheduledFor: {
          lte: now,
        },
      },
    });

    if (scheduledCampaigns.length === 0) {
      return;
    }

    this.logger.log(
      `Processing ${scheduledCampaigns.length} scheduled campaigns`,
    );

    for (const campaign of scheduledCampaigns) {
      try {
        // Create outbox event for the campaign
        await this.prisma.smsOutbox.create({
          data: {
            eventType: SmsOutboxEventType.PROMOTIONAL_CAMPAIGN,
            payload: { campaignId: campaign.id },
            status: 'PENDING',
            campaignId: campaign.id,
          },
        });

        this.logger.log(`Queued scheduled campaign ${campaign.id} for sending`);
      } catch (error) {
        this.logger.error(
          `Failed to queue scheduled campaign ${campaign.id}: ${error instanceof Error ? error.message : 'Unknown error'}`,
        );
      }
    }
  }
}
