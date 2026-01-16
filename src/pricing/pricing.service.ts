// src/pricing/pricing.service.ts

import { YearPlan, PricingSection } from '@prisma/client';

/**
 * Resolve the monthly price from the YearPlan pricing matrix.
 * This is the ONLY place where pricing logic lives.
 */
export function resolveMatrixPrice(
  product: { pricingSection: PricingSection | null },
  yearPlan: YearPlan,
  memberAge: number,
): number {
  if (!product.pricingSection) {
    throw new Error('Product does not use matrix pricing');
  }

  const ageGroup: 'under60' | 'over60' =
    memberAge >= 60 ? 'over60' : 'under60';

  const sectionKey = product.pricingSection.toLowerCase();
  const columnName = `${sectionKey}_${ageGroup}` as keyof YearPlan;

  const price = yearPlan[columnName];

  if (price === null || price === undefined) {
    throw new Error(`Price not configured for ${columnName}`);
  }

  // Prisma Decimal → number
  return Number(price);
}
