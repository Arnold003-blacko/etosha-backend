import { Controller, Get, Query, Post, Body, Delete } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { LoggerService, LogLevel, LogCategory } from './logger.service';

@Controller('dashboard')
export class DashboardController {
  constructor(
    private readonly dashboardService: DashboardService,
    private readonly loggerService: LoggerService,
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
}
