// Report query parameters: month/year selection and timeline
export type ReportTimeline = 'monthly' | 'yearly';

export interface ReportDateRange {
  start: Date;
  end: Date;
  label: string; // e.g. "2024-03" or "2024"
}

/**
 * Get start/end dates and a label from year, optional month, and timeline.
 * - timeline monthly + month 1-12 → that month in that year
 * - timeline yearly (or no month) → full year
 */
export function getReportDateRange(
  year: number,
  month?: number,
  timeline: ReportTimeline = 'yearly',
): ReportDateRange {
  const y = Math.max(1900, Math.min(2100, year));
  if (timeline === 'monthly' && month != null && month >= 1 && month <= 12) {
    const start = new Date(y, month - 1, 1, 0, 0, 0, 0);
    const end = new Date(y, month, 0, 23, 59, 59, 999);
    return {
      start,
      end,
      label: `${y}-${String(month).padStart(2, '0')}`,
    };
  }
  // yearly
  const start = new Date(y, 0, 1, 0, 0, 0, 0);
  const end = new Date(y, 11, 31, 23, 59, 59, 999);
  return { start, end, label: String(y) };
}

/** All report dataset IDs that can be included in "all" report */
export const REPORT_DATASET_IDS = [
  'debtors',
  'plans-started-this-month',
  'defaulted-plans',
  'graves-sold',
  'section-revenue',
  'members',
  'revenue',
] as const;

export type ReportDatasetId = (typeof REPORT_DATASET_IDS)[number];
