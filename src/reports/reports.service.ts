// src/reports/reports.service.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as ExcelJS from 'exceljs';
import {
  PurchaseStatus,
  PurchaseType,
  PaymentStatus,
  PricingSection,
  ItemCategory,
} from '@prisma/client';
import type { ReportDateRange } from './dto/report-query.dto';

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Generate Debtors Report
   * Lists all members with outstanding balances
   */
  async generateDebtorsReport(): Promise<ExcelJS.Workbook> {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Debtors');

    // Get all purchases with balance > 0 (exclude cancelled purchases)
    const purchases = await this.prisma.purchase.findMany({
      where: {
        balance: { gt: 0 },
        status: {
          in: [PurchaseStatus.PENDING_PAYMENT, PurchaseStatus.PARTIALLY_PAID],
        },
        // Exclude cancelled purchases - they are stale
        NOT: {
          status: PurchaseStatus.CANCELLED,
        },
      },
      include: {
        member: {
          select: {
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
            address: true,
            city: true,
            country: true,
          },
        },
        product: {
          select: {
            title: true,
            category: true,
            pricingSection: true,
          },
        },
        yearPlan: true,
        payments: {
          where: {
            status: PaymentStatus.SUCCESS,
          },
          select: {
            amount: true,
            paidAt: true,
          },
          orderBy: { paidAt: 'desc' },
          take: 1,
          },
        },
      orderBy: { balance: 'desc' },
    });

    // Set up headers
    worksheet.columns = [
      { header: 'Purchase ID', key: 'purchaseId', width: 36 },
      { header: 'Member Name', key: 'memberName', width: 25 },
      { header: 'Email', key: 'email', width: 30 },
      { header: 'Phone', key: 'phone', width: 15 },
      { header: 'Address', key: 'address', width: 30 },
      { header: 'City', key: 'city', width: 15 },
      { header: 'Country', key: 'country', width: 15 },
      { header: 'Product', key: 'product', width: 25 },
      { header: 'Section', key: 'section', width: 15 },
      { header: 'Total Amount', key: 'totalAmount', width: 15 },
      { header: 'Paid Amount', key: 'paidAmount', width: 15 },
      { header: 'Balance', key: 'balance', width: 15 },
      { header: 'Purchase Date', key: 'purchaseDate', width: 20 },
      { header: 'Last Payment Date', key: 'lastPaymentDate', width: 20 },
      { header: 'Payment Plan', key: 'paymentPlan', width: 20 },
    ];

    // Style header row
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF4472C4' },
    };
    worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

    // Add data rows
    purchases.forEach((purchase) => {
      worksheet.addRow({
        purchaseId: purchase.id,
        memberName: `${purchase.member.firstName} ${purchase.member.lastName}`,
        email: purchase.member.email,
        phone: purchase.member.phone,
        address: purchase.member.address,
        city: purchase.member.city,
        country: purchase.member.country,
        product: purchase.product.title,
        section: purchase.product.pricingSection || 'N/A',
        totalAmount: Number(purchase.totalAmount),
        paidAmount: Number(purchase.paidAmount),
        balance: Number(purchase.balance),
        purchaseDate: purchase.createdAt.toISOString().split('T')[0],
        lastPaymentDate: purchase.payments[0]?.paidAt
          ? new Date(purchase.payments[0].paidAt).toISOString().split('T')[0]
          : 'Never',
        paymentPlan: purchase.yearPlan
          ? `${purchase.yearPlan.name} (${purchase.yearPlan.months} months)`
          : 'N/A',
      });
    });

    // Format currency columns
    ['totalAmount', 'paidAmount', 'balance'].forEach((col) => {
      worksheet.getColumn(col).numFmt = '$#,##0.00';
    });

    return workbook;
  }

  /**
   * Generate Plans Started This Month Report (or for a chosen month/year range)
   */
  async generatePlansStartedThisMonthReport(
    dateRange?: ReportDateRange,
  ): Promise<ExcelJS.Workbook> {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Plans Started This Month');

    const now = new Date();
    const startOfRange = dateRange?.start ?? new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfRange = dateRange?.end ?? new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

    const purchases = await this.prisma.purchase.findMany({
      where: {
        createdAt: {
          gte: startOfRange,
          lte: endOfRange,
        },
        purchaseType: PurchaseType.FUTURE,
        yearPlanId: { not: null },
        // Exclude cancelled purchases - they are stale and not real sales
        NOT: {
          status: PurchaseStatus.CANCELLED,
        },
      },
      include: {
        member: {
          select: {
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
          },
        },
        product: {
          select: {
            title: true,
            pricingSection: true,
          },
        },
        yearPlan: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    worksheet.columns = [
      { header: 'Purchase ID', key: 'purchaseId', width: 36 },
      { header: 'Member Name', key: 'memberName', width: 25 },
      { header: 'Email', key: 'email', width: 30 },
      { header: 'Phone', key: 'phone', width: 15 },
      { header: 'Product', key: 'product', width: 25 },
      { header: 'Section', key: 'section', width: 15 },
      { header: 'Total Amount', key: 'totalAmount', width: 15 },
      { header: 'Payment Plan', key: 'paymentPlan', width: 25 },
      { header: 'Monthly Installment', key: 'monthlyInstallment', width: 18 },
      { header: 'Status', key: 'status', width: 15 },
      { header: 'Start Date', key: 'startDate', width: 20 },
    ];

    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF4472C4' },
    };
    worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

    purchases.forEach((purchase) => {
      const monthlyInstallment = purchase.yearPlan
        ? Number(purchase.totalAmount) / purchase.yearPlan.months
        : 0;

      worksheet.addRow({
        purchaseId: purchase.id,
        memberName: `${purchase.member.firstName} ${purchase.member.lastName}`,
        email: purchase.member.email,
        phone: purchase.member.phone,
        product: purchase.product.title,
        section: purchase.product.pricingSection || 'N/A',
        totalAmount: Number(purchase.totalAmount),
        paymentPlan: purchase.yearPlan
          ? `${purchase.yearPlan.name} (${purchase.yearPlan.months} months)`
          : 'N/A',
        monthlyInstallment: monthlyInstallment,
        status: purchase.status,
        startDate: purchase.createdAt.toISOString().split('T')[0],
      });
    });

    (['totalAmount', 'monthlyInstallment'] as const).forEach((col) => {
      worksheet.getColumn(col).numFmt = '$#,##0.00';
    });

    return workbook;
  }

  /**
   * Generate Defaulted Plans Report
   * Plans that are 3+ months behind on payments
   */
  async generateDefaultedPlansReport(): Promise<ExcelJS.Workbook> {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Defaulted Plans');

    const now = new Date();
    const currentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    currentMonth.setHours(0, 0, 0, 0);

    const purchases = await this.prisma.purchase.findMany({
      where: {
        balance: { gt: 0 },
        yearPlanId: { not: null },
        purchaseType: PurchaseType.FUTURE,
        status: {
          in: [PurchaseStatus.PENDING_PAYMENT, PurchaseStatus.PARTIALLY_PAID],
        },
        // Exclude cancelled purchases - they are stale
        NOT: {
          status: PurchaseStatus.CANCELLED,
        },
      },
      include: {
        member: {
          select: {
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
          },
        },
        product: {
          select: {
            title: true,
            pricingSection: true,
          },
        },
        yearPlan: true,
        payments: {
          where: {
            status: PaymentStatus.SUCCESS,
            paidAt: { not: null },
          },
          select: {
            amount: true,
            paidAt: true,
          },
          orderBy: { paidAt: 'asc' },
        },
      },
    });

    const defaultedRecords: any[] = [];

    for (const purchase of purchases) {
      if (!purchase.yearPlan) continue;

      const totalMonths = purchase.yearPlan.months;
      const monthlyInstallment = Number(purchase.totalAmount) / totalMonths;

      const purchaseDate = new Date(purchase.createdAt);
      const purchaseMonth = new Date(
        purchaseDate.getFullYear(),
        purchaseDate.getMonth(),
        1,
      );
      purchaseMonth.setHours(0, 0, 0, 0);

      const monthsDiff =
        (currentMonth.getFullYear() - purchaseMonth.getFullYear()) * 12 +
        (currentMonth.getMonth() - purchaseMonth.getMonth());

      const currentMonthNumber = Math.max(0, monthsDiff);
      const paidAmountTracker = Number(purchase.paidAmount);
      const monthsCovered = Math.floor(paidAmountTracker / monthlyInstallment);
      const monthsBehind = currentMonthNumber - monthsCovered;

      if (monthsBehind >= 3) {
        defaultedRecords.push({
          ...purchase,
          monthsBehind,
          monthlyInstallment,
        });
      }
    }

    worksheet.columns = [
      { header: 'Purchase ID', key: 'purchaseId', width: 36 },
      { header: 'Member Name', key: 'memberName', width: 25 },
      { header: 'Email', key: 'email', width: 30 },
      { header: 'Phone', key: 'phone', width: 15 },
      { header: 'Product', key: 'product', width: 25 },
      { header: 'Section', key: 'section', width: 15 },
      { header: 'Total Amount', key: 'totalAmount', width: 15 },
      { header: 'Paid Amount', key: 'paidAmount', width: 15 },
      { header: 'Balance', key: 'balance', width: 15 },
      { header: 'Monthly Installment', key: 'monthlyInstallment', width: 18 },
      { header: 'Months Behind', key: 'monthsBehind', width: 15 },
      { header: 'Payment Plan', key: 'paymentPlan', width: 25 },
      { header: 'Last Payment Date', key: 'lastPaymentDate', width: 20 },
    ];

    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFFF0000' },
    };
    worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

    defaultedRecords.forEach((purchase) => {
      const lastPayment = purchase.payments[purchase.payments.length - 1];
      worksheet.addRow({
        purchaseId: purchase.id,
        memberName: `${purchase.member.firstName} ${purchase.member.lastName}`,
        email: purchase.member.email,
        phone: purchase.member.phone,
        product: purchase.product.title,
        section: purchase.product.pricingSection || 'N/A',
        totalAmount: Number(purchase.totalAmount),
        paidAmount: Number(purchase.paidAmount),
        balance: Number(purchase.balance),
        monthlyInstallment: purchase.monthlyInstallment,
        monthsBehind: purchase.monthsBehind,
        paymentPlan: purchase.yearPlan
          ? `${purchase.yearPlan.name} (${purchase.yearPlan.months} months)`
          : 'N/A',
        lastPaymentDate: lastPayment?.paidAt
          ? new Date(lastPayment.paidAt).toISOString().split('T')[0]
          : 'Never',
      });
    });

    // Must be an array [...] not (...); comma operator causes TS2695
    (['totalAmount', 'paidAmount', 'balance', 'monthlyInstallment'] as const).forEach((col) => {
      worksheet.getColumn(col).numFmt = '$#,##0.00';
    });

    return workbook;
  }

  /**
   * Generate Graves Sold Report (optionally filtered by sold date range)
   */
  async generateGravesSoldReport(
    dateRange?: ReportDateRange,
  ): Promise<ExcelJS.Workbook> {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Graves Sold');

    const graveSlots = await this.prisma.graveSlot.findMany({
      where: {
        purchaseId: { not: null },
        ...(dateRange && {
          createdAt: { gte: dateRange.start, lte: dateRange.end },
        }),
      },
      include: {
        grave: true,
        purchase: {
          include: {
            member: {
              select: {
                firstName: true,
                lastName: true,
                email: true,
                phone: true,
              },
            },
            product: {
              select: {
                title: true,
                pricingSection: true,
              },
            },
          },
        },
        deceased: {
          select: {
            fullName: true,
            dateOfDeath: true,
            burialDate: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    worksheet.columns = [
      { header: 'Grave Number', key: 'graveNumber', width: 15 },
      { header: 'Section', key: 'section', width: 15 },
      { header: 'Slot Number', key: 'slotNumber', width: 12 },
      { header: 'Purchase ID', key: 'purchaseId', width: 36 },
      { header: 'Member Name', key: 'memberName', width: 25 },
      { header: 'Email', key: 'email', width: 30 },
      { header: 'Phone', key: 'phone', width: 15 },
      { header: 'Product', key: 'product', width: 25 },
      { header: 'Price at Purchase', key: 'priceAtPurchase', width: 18 },
      { header: 'Deceased Name', key: 'deceasedName', width: 25 },
      { header: 'Date of Death', key: 'dateOfDeath', width: 18 },
      { header: 'Burial Date', key: 'burialDate', width: 18 },
      { header: 'Sold Date', key: 'soldDate', width: 18 },
    ];

    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF00B050' },
    };
    worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

    graveSlots.forEach((slot) => {
      worksheet.addRow({
        graveNumber: slot.grave.graveNumber,
        section: slot.grave.section,
        slotNumber: slot.slotNo,
        purchaseId: slot.purchaseId || 'N/A',
        memberName: slot.purchase
          ? `${slot.purchase.member.firstName} ${slot.purchase.member.lastName}`
          : 'N/A',
        email: slot.purchase?.member.email || 'N/A',
        phone: slot.purchase?.member.phone || 'N/A',
        product: slot.purchase?.product.title || 'N/A',
        priceAtPurchase: slot.priceAtPurchase
          ? Number(slot.priceAtPurchase)
          : 'N/A',
        deceasedName: slot.deceased?.fullName || 'Not Assigned',
        dateOfDeath: slot.deceased?.dateOfDeath
          ? new Date(slot.deceased.dateOfDeath).toISOString().split('T')[0]
          : 'N/A',
        burialDate: slot.deceased?.burialDate
          ? new Date(slot.deceased.burialDate).toISOString().split('T')[0]
          : 'N/A',
        soldDate: slot.createdAt.toISOString().split('T')[0],
      });
    });

    const priceCol = worksheet.getColumn('priceAtPurchase');
    if (priceCol) priceCol.numFmt = '$#,##0.00';

    return workbook;
  }

  /**
   * Generate Section Revenue Report (for chosen year or month range)
   */
  async generateSectionRevenueThisYearReport(
    dateRange?: ReportDateRange,
  ): Promise<ExcelJS.Workbook> {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Section Revenue This Year');

    const now = new Date();
    const startOfRange = dateRange?.start ?? new Date(now.getFullYear(), 0, 1);
    const endOfRange = dateRange?.end ?? new Date(now.getFullYear(), 11, 31, 23, 59, 59);

    const purchases = await this.prisma.purchase.findMany({
      where: {
        createdAt: {
          gte: startOfRange,
          lte: endOfRange,
        },
        status: PurchaseStatus.PAID,
        // Exclude cancelled purchases - they are stale and not real sales
        NOT: {
          status: PurchaseStatus.CANCELLED,
        },
        product: {
          category: ItemCategory.SERENITY_GROUND,
          pricingSection: { not: null },
        },
      },
      include: {
        product: {
          select: {
            pricingSection: true,
            title: true,
          },
        },
        payments: {
          where: {
            status: PaymentStatus.SUCCESS,
          },
          select: {
            amount: true,
            paidAt: true,
          },
        },
      },
    });

    // Group by section
    const sectionRevenue: Record<string, {
      section: string;
      totalRevenue: number;
      purchaseCount: number;
      purchases: typeof purchases;
    }> = {};

    purchases.forEach((purchase) => {
      const section = purchase.product.pricingSection || 'UNKNOWN';
      if (!sectionRevenue[section]) {
        sectionRevenue[section] = {
          section,
          totalRevenue: 0,
          purchaseCount: 0,
          purchases: [],
        };
      }
      sectionRevenue[section].totalRevenue += Number(purchase.totalAmount);
      sectionRevenue[section].purchaseCount += 1;
      sectionRevenue[section].purchases.push(purchase);
    });

    worksheet.columns = [
      { header: 'Section', key: 'section', width: 20 },
      { header: 'Total Revenue', key: 'totalRevenue', width: 18 },
      { header: 'Number of Purchases', key: 'purchaseCount', width: 20 },
      { header: 'Average Purchase Amount', key: 'averageAmount', width: 22 },
    ];

    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF7030A0' },
    };
    worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

    Object.values(sectionRevenue)
      .sort((a, b) => b.totalRevenue - a.totalRevenue)
      .forEach((data) => {
        worksheet.addRow({
          section: data.section,
          totalRevenue: data.totalRevenue,
          purchaseCount: data.purchaseCount,
          averageAmount: data.totalRevenue / data.purchaseCount,
        });
      });

    // Add total row
    const totalRevenue = Object.values(sectionRevenue).reduce(
      (sum, data) => sum + data.totalRevenue,
      0,
    );
    const totalPurchases = Object.values(sectionRevenue).reduce(
      (sum, data) => sum + data.purchaseCount,
      0,
    );

    worksheet.addRow({
      section: 'TOTAL',
      totalRevenue: totalRevenue,
      purchaseCount: totalPurchases,
      averageAmount: totalRevenue / totalPurchases,
    });

    const totalRow = worksheet.rowCount;
    worksheet.getRow(totalRow).font = { bold: true };
    worksheet.getRow(totalRow).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFFFC000' },
    };

    (['totalRevenue', 'averageAmount'] as const).forEach((col) => {
      worksheet.getColumn(col).numFmt = '$#,##0.00';
    });

    return workbook;
  }

  /**
   * Generate Members List Report (optionally filtered by registration date range)
   */
  async generateMembersListReport(
    dateRange?: ReportDateRange,
  ): Promise<ExcelJS.Workbook> {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Members List');

    const where = dateRange
      ? { createdAt: { gte: dateRange.start, lte: dateRange.end } }
      : undefined;

    const members = await this.prisma.member.findMany({
      where,
      include: {
        purchases: {
          select: {
            id: true,
            status: true,
            totalAmount: true,
            paidAmount: true,
            balance: true,
            createdAt: true,
          },
        },
        _count: {
          select: {
            purchases: true,
            payments: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    worksheet.columns = [
      { header: 'Member ID', key: 'memberId', width: 20 },
      { header: 'First Name', key: 'firstName', width: 20 },
      { header: 'Last Name', key: 'lastName', width: 20 },
      { header: 'Email', key: 'email', width: 30 },
      { header: 'Phone', key: 'phone', width: 15 },
      { header: 'Address', key: 'address', width: 30 },
      { header: 'City', key: 'city', width: 15 },
      { header: 'Country', key: 'country', width: 15 },
      { header: 'Date of Birth', key: 'dateOfBirth', width: 18 },
      { header: 'Gender', key: 'gender', width: 10 },
      { header: 'Total Purchases', key: 'totalPurchases', width: 15 },
      { header: 'Total Payments', key: 'totalPayments', width: 15 },
      { header: 'Total Spent', key: 'totalSpent', width: 15 },
      { header: 'Registration Date', key: 'registrationDate', width: 20 },
    ];

    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF0070C0' },
    };
    worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

    members.forEach((member) => {
      const totalSpent = member.purchases.reduce(
        (sum, p) => sum + Number(p.paidAmount),
        0,
      );

      worksheet.addRow({
        memberId: member.id,
        firstName: member.firstName,
        lastName: member.lastName,
        email: member.email,
        phone: member.phone,
        address: member.address,
        city: member.city,
        country: member.country,
        dateOfBirth: member.dateOfBirth.toISOString().split('T')[0],
        gender: member.gender || 'N/A',
        totalPurchases: member._count.purchases,
        totalPayments: member._count.payments,
        totalSpent: totalSpent,
        registrationDate: member.createdAt.toISOString().split('T')[0],
      });
    });

    worksheet.getColumn('totalSpent').numFmt = '$#,##0.00';

    return workbook;
  }

  /**
   * Generate Comprehensive Revenue Report (for chosen year or month range)
   */
  async generateRevenueReport(
    dateRange?: ReportDateRange,
  ): Promise<ExcelJS.Workbook> {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Revenue Report');

    const now = new Date();
    const startOfRange = dateRange?.start ?? new Date(now.getFullYear(), 0, 1);
    const endOfRange = dateRange?.end ?? new Date(now.getFullYear(), 11, 31, 23, 59, 59);

    const payments = await this.prisma.payment.findMany({
      where: {
        status: PaymentStatus.SUCCESS,
        paidAt: {
          gte: startOfRange,
          lte: endOfRange,
        },
        // Exclude payments from cancelled purchases - they are stale and not real revenue
        purchase: {
          status: {
            not: PurchaseStatus.CANCELLED,
          },
        },
      },
      include: {
        purchase: {
          include: {
            product: {
              select: {
                title: true,
                category: true,
                pricingSection: true,
              },
            },
            member: {
              select: {
                firstName: true,
                lastName: true,
                email: true,
              },
            },
          },
        },
      },
      orderBy: { paidAt: 'desc' },
    });

    worksheet.columns = [
      { header: 'Payment ID', key: 'paymentId', width: 36 },
      { header: 'Payment Date', key: 'paymentDate', width: 18 },
      { header: 'Amount', key: 'amount', width: 15 },
      { header: 'Method', key: 'method', width: 15 },
      { header: 'Member Name', key: 'memberName', width: 25 },
      { header: 'Email', key: 'email', width: 30 },
      { header: 'Product', key: 'product', width: 25 },
      { header: 'Category', key: 'category', width: 15 },
      { header: 'Section', key: 'section', width: 15 },
      { header: 'Reference', key: 'reference', width: 30 },
    ];

    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF00B050' },
    };
    worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

    payments.forEach((payment) => {
      worksheet.addRow({
        paymentId: payment.id,
        paymentDate: payment.paidAt
          ? new Date(payment.paidAt).toISOString().split('T')[0]
          : 'N/A',
        amount: Number(payment.amount),
        method: payment.method,
        memberName: `${payment.purchase.member.firstName} ${payment.purchase.member.lastName}`,
        email: payment.purchase.member.email,
        product: payment.purchase.product.title,
        category: payment.purchase.product.category,
        section: payment.purchase.product.pricingSection || 'N/A',
        reference: payment.reference,
      });
    });

    // Add summary row
    const totalRevenue = payments.reduce(
      (sum, p) => sum + Number(p.amount),
      0,
    );
    worksheet.addRow({
      paymentId: 'TOTAL',
      paymentDate: '',
      amount: totalRevenue,
      method: '',
      memberName: '',
      email: '',
      product: '',
      category: '',
      section: '',
      reference: '',
    });

    const totalRow = worksheet.rowCount;
    worksheet.getRow(totalRow).font = { bold: true };
    worksheet.getRow(totalRow).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFFFC000' },
    };

    worksheet.getColumn('amount').numFmt = '$#,##0.00';

    return workbook;
  }

  /**
   * Generate Payments Report – all payments made in the selected period (from–to).
   * Requires date range; filters by paidAt.
   */
  async generatePaymentsReport(
    dateRange?: ReportDateRange,
  ): Promise<ExcelJS.Workbook> {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Payments');

    const now = new Date();
    const startOfRange = dateRange?.start ?? new Date(now.getFullYear(), 0, 1);
    const endOfRange = dateRange?.end ?? new Date(now.getFullYear(), 11, 31, 23, 59, 59);

    const payments = await this.prisma.payment.findMany({
      where: {
        status: PaymentStatus.SUCCESS,
        paidAt: {
          gte: startOfRange,
          lte: endOfRange,
        },
      },
      include: {
        purchase: {
          include: {
            product: {
              select: {
                title: true,
                category: true,
                pricingSection: true,
              },
            },
            member: {
              select: {
                firstName: true,
                lastName: true,
                email: true,
                phone: true,
              },
            },
          },
        },
      },
      orderBy: { paidAt: 'desc' },
    });

    worksheet.columns = [
      { header: 'Payment ID', key: 'paymentId', width: 36 },
      { header: 'Payment Date', key: 'paymentDate', width: 18 },
      { header: 'Amount', key: 'amount', width: 15 },
      { header: 'Method', key: 'method', width: 15 },
      { header: 'Member Name', key: 'memberName', width: 25 },
      { header: 'Email', key: 'email', width: 30 },
      { header: 'Phone', key: 'phone', width: 15 },
      { header: 'Product', key: 'product', width: 25 },
      { header: 'Category', key: 'category', width: 15 },
      { header: 'Section', key: 'section', width: 15 },
      { header: 'Reference', key: 'reference', width: 30 },
    ];

    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF2196F3' },
    };
    worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

    payments.forEach((payment) => {
      worksheet.addRow({
        paymentId: payment.id,
        paymentDate: payment.paidAt
          ? new Date(payment.paidAt).toISOString().split('T')[0]
          : 'N/A',
        amount: Number(payment.amount),
        method: payment.method,
        memberName: `${payment.purchase.member.firstName} ${payment.purchase.member.lastName}`,
        email: payment.purchase.member.email,
        phone: payment.purchase.member.phone ?? 'N/A',
        product: payment.purchase.product.title,
        category: payment.purchase.product.category,
        section: payment.purchase.product.pricingSection || 'N/A',
        reference: payment.reference,
      });
    });

    const totalAmount = payments.reduce((sum, p) => sum + Number(p.amount), 0);
    worksheet.addRow({
      paymentId: 'TOTAL',
      paymentDate: '',
      amount: totalAmount,
      method: '',
      memberName: '',
      email: '',
      phone: '',
      product: '',
      category: '',
      section: '',
      reference: '',
    });
    const totalRow = worksheet.rowCount;
    worksheet.getRow(totalRow).font = { bold: true };
    worksheet.getRow(totalRow).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFFFC000' },
    };
    worksheet.getColumn('amount').numFmt = '$#,##0.00';

    return workbook;
  }
}
