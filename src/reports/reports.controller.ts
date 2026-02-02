// src/reports/reports.controller.ts
import {
  Controller,
  Get,
  Query,
  Res,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import * as express from 'express';
import * as ExcelJS from 'exceljs';
import { ReportsService } from './reports.service';
import { StaffJwtGuard } from '../staff-auth/staff-jwt.guard';
import {
  getReportDateRange,
  REPORT_DATASET_IDS,
  type ReportDatasetId,
  type ReportTimeline,
} from './dto/report-query.dto';

export interface ReportQueryParams {
  from?: string; // ISO date YYYY-MM-DD – start of period
  to?: string;   // ISO date YYYY-MM-DD – end of period
  year?: string;
  month?: string;
  timeline?: string;
  datasets?: string; // comma-separated for /all
}

/** Prefer from/to; fall back to year/month/timeline. */
function parseDateRangeFromQuery(query: ReportQueryParams): { start: Date; end: Date; label: string } | null {
  if (query.from && query.to) {
    const start = new Date(query.from);
    const end = new Date(query.to);
    if (!isNaN(start.getTime()) && !isNaN(end.getTime())) {
      start.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);
      const label = `${query.from}_to_${query.to}`;
      return { start, end, label };
    }
  }
  const y = query.year ? parseInt(query.year, 10) : undefined;
  if (y == null || isNaN(y)) return null;
  const m = query.month ? parseInt(query.month, 10) : undefined;
  const tl: ReportTimeline =
    query.timeline === 'monthly' || query.timeline === 'yearly' ? query.timeline : 'yearly';
  return getReportDateRange(y, m, tl);
}

function parseDatasets(datasets?: string): ReportDatasetId[] | null {
  if (!datasets || !datasets.trim()) return null;
  const ids = datasets.split(',').map((s) => s.trim().toLowerCase());
  const valid = ids.filter((id) =>
    (REPORT_DATASET_IDS as readonly string[]).includes(id),
  );
  return valid.length > 0 ? (valid as ReportDatasetId[]) : null;
}

@Controller('reports')
@UseGuards(StaffJwtGuard)
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('debtors')
  async generateDebtorsReport(
    @Query() query: ReportQueryParams,
    @Res() res: express.Response,
  ) {
    try {
      const workbook = await this.reportsService.generateDebtorsReport();
      const buffer = await workbook.xlsx.writeBuffer();

      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      res.setHeader(
        'Content-Disposition',
        `attachment; filename=debtors-report-${new Date().toISOString().split('T')[0]}.xlsx`,
      );

      return res.send(buffer);
    } catch (error) {
      throw new BadRequestException(
        `Failed to generate debtors report: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  @Get('plans-started-this-month')
  async generatePlansStartedThisMonthReport(
    @Query() query: ReportQueryParams,
    @Res() res: express.Response,
  ) {
    try {
      const dateRange = parseDateRangeFromQuery(query);
      const workbook =
        await this.reportsService.generatePlansStartedThisMonthReport(
          dateRange ?? undefined,
        );
      const buffer = await workbook.xlsx.writeBuffer();
      const suffix = dateRange ? dateRange.label : new Date().toISOString().split('T')[0];

      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      res.setHeader(
        'Content-Disposition',
        `attachment; filename=plans-started-${suffix}.xlsx`,
      );

      return res.send(buffer);
    } catch (error) {
      throw new BadRequestException(
        `Failed to generate plans started this month report: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  @Get('defaulted-plans')
  async generateDefaultedPlansReport(@Res() res: express.Response) {
    try {
      const workbook =
        await this.reportsService.generateDefaultedPlansReport();
      const buffer = await workbook.xlsx.writeBuffer();

      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      res.setHeader(
        'Content-Disposition',
        `attachment; filename=defaulted-plans-${new Date().toISOString().split('T')[0]}.xlsx`,
      );

      return res.send(buffer);
    } catch (error) {
      throw new BadRequestException(
        `Failed to generate defaulted plans report: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  @Get('graves-sold')
  async generateGravesSoldReport(@Res() res: express.Response) {
    try {
      const workbook = await this.reportsService.generateGravesSoldReport();
      const buffer = await workbook.xlsx.writeBuffer();

      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      res.setHeader(
        'Content-Disposition',
        `attachment; filename=graves-sold-${new Date().toISOString().split('T')[0]}.xlsx`,
      );

      return res.send(buffer);
    } catch (error) {
      throw new BadRequestException(
        `Failed to generate graves sold report: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  @Get('section-revenue')
  async generateSectionRevenueReport(
    @Query() query: ReportQueryParams,
    @Res() res: express.Response,
  ) {
    try {
      const dateRange = parseDateRangeFromQuery(query);
      const workbook =
        await this.reportsService.generateSectionRevenueThisYearReport(
          dateRange ?? undefined,
        );
      const buffer = await workbook.xlsx.writeBuffer();
      const suffix = dateRange ? dateRange.label : String(new Date().getFullYear());

      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      res.setHeader(
        'Content-Disposition',
        `attachment; filename=section-revenue-${suffix}.xlsx`,
      );

      return res.send(buffer);
    } catch (error) {
      throw new BadRequestException(
        `Failed to generate section revenue report: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  @Get('members')
  async generateMembersListReport(
    @Query() query: ReportQueryParams,
    @Res() res: express.Response,
  ) {
    try {
      const dateRange = parseDateRangeFromQuery(query);
      const workbook = await this.reportsService.generateMembersListReport(
        dateRange ?? undefined,
      );
      const buffer = await workbook.xlsx.writeBuffer();
      const suffix = dateRange ? dateRange.label : new Date().toISOString().split('T')[0];

      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      res.setHeader(
        'Content-Disposition',
        `attachment; filename=members-list-${suffix}.xlsx`,
      );

      return res.send(buffer);
    } catch (error) {
      throw new BadRequestException(
        `Failed to generate members list report: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  @Get('revenue')
  async generateRevenueReport(
    @Query() query: ReportQueryParams,
    @Res() res: express.Response,
  ) {
    try {
      const dateRange = parseDateRangeFromQuery(query);
      const workbook = await this.reportsService.generateRevenueReport(
        dateRange ?? undefined,
      );
      const buffer = await workbook.xlsx.writeBuffer();
      const suffix = dateRange ? dateRange.label : String(new Date().getFullYear());

      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      res.setHeader(
        'Content-Disposition',
        `attachment; filename=revenue-report-${suffix}.xlsx`,
      );

      return res.send(buffer);
    } catch (error) {
      throw new BadRequestException(
        `Failed to generate revenue report: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  @Get('payments')
  async generatePaymentsReport(
    @Query() query: ReportQueryParams,
    @Res() res: express.Response,
  ) {
    try {
      const dateRange = parseDateRangeFromQuery(query);
      const workbook = await this.reportsService.generatePaymentsReport(
        dateRange ?? undefined,
      );
      const buffer = await workbook.xlsx.writeBuffer();
      const suffix = dateRange ? dateRange.label : new Date().toISOString().split('T')[0];

      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      res.setHeader(
        'Content-Disposition',
        `attachment; filename=payments-${suffix}.xlsx`,
      );

      return res.send(buffer);
    } catch (error) {
      throw new BadRequestException(
        `Failed to generate payments report: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  @Get('all')
  async generateAllReports(
    @Query() query: ReportQueryParams,
    @Res() res: express.Response,
  ) {
    try {
      const ExcelJS = await import('exceljs');
      const workbook = new ExcelJS.Workbook();

      const dateRange = parseDateRangeFromQuery(query);
      const selectedDatasets = parseDatasets(query.datasets);
      const datasetsToInclude: ReportDatasetId[] =
        selectedDatasets && selectedDatasets.length > 0
          ? selectedDatasets
          : [...REPORT_DATASET_IDS];

      const reportGenerators: Array<() => Promise<ExcelJS.Workbook>> = [];

      if (datasetsToInclude.includes('debtors')) {
        reportGenerators.push(() => this.reportsService.generateDebtorsReport());
      }
      if (datasetsToInclude.includes('plans-started-this-month')) {
        reportGenerators.push(() =>
          this.reportsService.generatePlansStartedThisMonthReport(
            dateRange ?? undefined,
          ),
        );
      }
      if (datasetsToInclude.includes('defaulted-plans')) {
        reportGenerators.push(() =>
          this.reportsService.generateDefaultedPlansReport(),
        );
      }
      if (datasetsToInclude.includes('graves-sold')) {
        reportGenerators.push(() =>
          this.reportsService.generateGravesSoldReport(
            dateRange ?? undefined,
          ),
        );
      }
      if (datasetsToInclude.includes('section-revenue')) {
        reportGenerators.push(() =>
          this.reportsService.generateSectionRevenueThisYearReport(
            dateRange ?? undefined,
          ),
        );
      }
      if (datasetsToInclude.includes('members')) {
        reportGenerators.push(() =>
          this.reportsService.generateMembersListReport(dateRange ?? undefined),
        );
      }
      if (datasetsToInclude.includes('revenue')) {
        reportGenerators.push(() =>
          this.reportsService.generateRevenueReport(
            dateRange ?? undefined,
          ),
        );
      }
      if (datasetsToInclude.includes('payments')) {
        reportGenerators.push(() =>
          this.reportsService.generatePaymentsReport(
            dateRange ?? undefined,
          ),
        );
      }

      const workbooks = await Promise.all(
        reportGenerators.map((fn) => fn()),
      );

      const copyWorksheet = (sourceWs: ExcelJS.Worksheet) => {
        const newWs = workbook.addWorksheet(sourceWs.name);

        if (sourceWs.columns && sourceWs.columns.length > 0) {
          sourceWs.columns.forEach((col: any) => {
            if (col && col.header !== undefined) {
              const newCol = newWs.getColumn(col.number || col.key);
              newCol.header = col.header;
              newCol.width = col.width || 15;
              if (col.numFmt) {
                newCol.numFmt = col.numFmt;
              }
            }
          });
        }

        sourceWs.eachRow((row: ExcelJS.Row, rowNumber: number) => {
          const newRow = newWs.getRow(rowNumber);
          row.eachCell((cell: ExcelJS.Cell, colNumber: number) => {
            const newCell = newRow.getCell(colNumber);
            newCell.value = cell.value;
            if (cell.style) {
              newCell.style = JSON.parse(JSON.stringify(cell.style));
            }
          });
          const rowWithStyle = row as ExcelJS.Row & { style?: unknown };
          if (rowWithStyle.style) {
            (newRow as ExcelJS.Row & { style?: unknown }).style = JSON.parse(
              JSON.stringify(rowWithStyle.style),
            );
          }
        });
      };

      workbooks.forEach((wb) => wb.worksheets.forEach(copyWorksheet));

      const buffer = await workbook.xlsx.writeBuffer();
      const suffix = dateRange
        ? dateRange.label
        : new Date().toISOString().split('T')[0];

      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      res.setHeader(
        'Content-Disposition',
        `attachment; filename=etosha-comprehensive-report-${suffix}.xlsx`,
      );

      return res.send(buffer);
    } catch (error) {
      throw new BadRequestException(
        `Failed to generate comprehensive report: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }
}
