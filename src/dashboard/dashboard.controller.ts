import { Controller, Get, Query, Post, Body, Delete, Res, UseGuards, BadRequestException } from '@nestjs/common';
import type { Response } from 'express';
import { DashboardService } from './dashboard.service';
import { LoggerService, LogLevel, LogCategory } from './logger.service';
import { BackupService } from './backup.service';
import { StaffJwtGuard } from '../staff-auth/staff-jwt.guard';

@Controller('dashboard')
@UseGuards(StaffJwtGuard)
export class DashboardController {
  constructor(
    private readonly dashboardService: DashboardService,
    private readonly loggerService: LoggerService,
    private readonly backupService: BackupService,
  ) {}

  /* ============================
   * GET DASHBOARD STATISTICS
   * ============================ */
  @Get('stats')
  getDashboardStats() {
    return this.dashboardService.getDashboardStats();
  }

  /* ============================
   * GET REVENUE DATA FOR CHART
   * ============================ */
  @Get('revenue')
  getRevenueData(@Query('period') period: 'week' | 'month' | 'year' = 'month') {
    return this.dashboardService.getRevenueData(period);
  }

  /* ============================
   * GET RECENT ACTIVITIES
   * ============================ */
  @Get('activities')
  getRecentActivities(@Query('limit') limit?: string) {
    const limitNum = limit ? parseInt(limit, 10) : 10;
    return this.dashboardService.getRecentActivities(limitNum);
  }

  /* ============================
   * GET ALL PAYMENTS (ADMIN)
   * ============================ */
  @Get('payments')
  getAllPayments(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
    @Query('method') method?: string,
  ) {
    const pageNum = page ? parseInt(page, 10) : 1;
    const limitNum = limit ? parseInt(limit, 10) : 50;
    return this.dashboardService.getAllPayments(pageNum, limitNum, status, method);
  }

  /* ============================
   * GET DEBT CONTROL (ADMIN)
   * ============================ */
  @Get('debt-control')
  getDebtControl() {
    return this.dashboardService.getDebtControl();
  }

  /* ============================
   * GET MEMBER FINANCIAL STATEMENT (ADMIN)
   * ============================ */
  @Get('accounts/statement')
  getMemberFinancialStatement(@Query('memberId') memberId: string) {
    if (!memberId) {
      throw new BadRequestException('Member ID is required');
    }
    return this.dashboardService.getMemberFinancialStatement(memberId);
  }

  /* ============================
   * LOGS & HEALTH MONITORING
   * ============================ */
  
  /**
   * GET /dashboard/health
   * Get server health information
   * NOTE: This must be before 'logs' route to avoid route conflict
   */
  @Get('health')
  getHealth() {
    return this.loggerService.getHealthInfo();
  }

  /**
   * GET /dashboard/logs
   * Get all logs with optional filtering
   */
  @Get('logs')
  getLogs(
    @Query('level') level?: LogLevel,
    @Query('category') category?: LogCategory,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
  ) {
    const limitNum = limit ? parseInt(limit, 10) : 1000;
    return {
      logs: this.loggerService.getLogs({
        level,
        category,
        limit: limitNum,
        search,
      }),
      count: this.loggerService.getLogCount(),
    };
  }

  /**
   * GET /dashboard/logs/count
   * Get log statistics
   */
  @Get('logs/count')
  getLogCount() {
    return this.loggerService.getLogCount();
  }

  /**
   * DELETE /dashboard/logs
   * Clear all logs
   */
  @Delete('logs')
  clearLogs() {
    this.loggerService.clearLogs();
    return { message: 'Logs cleared successfully' };
  }

  /**
   * GET /dashboard/backup
   * Download database backup as SQL file
   */
  @Get('backup')
  async downloadBackup(@Res() res: Response) {
    try {
      const sql = await this.backupService.createBackup();
      const filename = this.backupService.getBackupFilename();

      res.setHeader('Content-Type', 'application/sql');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${filename}"`,
      );
      res.send(sql);
    } catch (error) {
      res.status(500).json({
        error: 'Failed to create backup',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
}
