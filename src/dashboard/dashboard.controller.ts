import { Controller, Get, Query } from '@nestjs/common';
import { DashboardService } from './dashboard.service';

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

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
}
