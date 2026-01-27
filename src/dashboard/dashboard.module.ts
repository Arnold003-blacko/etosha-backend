import { Module, forwardRef } from '@nestjs/common';
import { APP_INTERCEPTOR, APP_FILTER } from '@nestjs/core';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { DashboardGateway } from './dashboard.gateway';
import { LoggerService } from './logger.service';
import { BackupService } from './backup.service';
import { LoggingInterceptor } from './logging.interceptor';
import { AllExceptionsFilter } from './exception-logger.filter';
import { PrismaModule } from '../prisma/prisma.module';
import { PurchasesModule } from '../purchases/purchases.module';

@Module({
  imports: [PrismaModule, PurchasesModule],
  controllers: [DashboardController],
  providers: [
    DashboardService,
    DashboardGateway,
    LoggerService,
    BackupService,
    // Only register interceptor if HTTP logging is enabled
    ...(process.env.ENABLE_HTTP_LOGGING !== 'false'
      ? [
          {
            provide: APP_INTERCEPTOR,
            useClass: LoggingInterceptor,
          },
        ]
      : []),
    // Global exception filter to catch all errors
    {
      provide: APP_FILTER,
      useClass: AllExceptionsFilter,
    },
  ],
  exports: [DashboardGateway, DashboardService, LoggerService], // Export so other modules can inject it
})
export class DashboardModule {}
