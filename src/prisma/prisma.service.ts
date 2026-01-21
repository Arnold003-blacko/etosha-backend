import { Injectable, OnModuleInit, Inject, Optional } from '@nestjs/common';
import { PrismaClient, Prisma } from '@prisma/client';
import { LoggerService, LogCategory, LogLevel } from '../dashboard/logger.service';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit
{
  constructor(@Optional() @Inject(LoggerService) private logger?: LoggerService) {
    super({
      log: process.env.LOG_DB_QUERIES === 'true' 
        ? [
            { level: 'query', emit: 'event' },
            { level: 'error', emit: 'event' },
            { level: 'warn', emit: 'event' },
          ]
        : [{ level: 'error', emit: 'event' }],
    });
  }

  async onModuleInit() {
    await this.$connect();

    // Set up query logging if enabled
    if (this.logger && process.env.LOG_DB_QUERIES === 'true') {
      this.$on('query' as never, (e: Prisma.QueryEvent) => {
        const duration = e.duration || 0;
        const isSlow = duration > 100; // Log queries over 100ms as slow

        if (isSlow) {
          this.logger!.warn(
            `Slow database query: ${e.query}`,
            LogCategory.DATABASE,
            {
              dbQuery: e.query,
              dbDuration: duration,
              dbParams: e.params,
              isSlow: true,
            },
          );
        } else {
          this.logger!.debug(
            `Database query: ${e.query.substring(0, 100)}...`,
            LogCategory.DATABASE,
            {
              dbQuery: e.query,
              dbDuration: duration,
            },
          );
        }
      });

      this.$on('error' as never, (e: Prisma.LogEvent) => {
        this.logger!.log(
          LogLevel.ERROR,
          LogCategory.DATABASE,
          `Database error: ${e.message}`,
          {
            dbTarget: e.target,
            dbMessage: e.message,
            error: e.message,
          },
        );
      });
    }

    // 🔑 Proper shutdown handling (CRITICAL)
    this.$on('beforeExit' as never, async () => {
      await this.$disconnect();
    });
  }
}
