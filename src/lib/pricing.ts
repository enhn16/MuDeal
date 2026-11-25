export interface ComparableDeal {
  salePrice: number | null;
  isUnconditional: number | boolean;
  expiresAt: string | null;
  lastVerifiedAt: string;
}

/** BP-DEAL-001-1: floor((base - sale) / base * 100); null if no real discount. */
export function calcDiscountRate(basePrice: number | null, salePrice: number | null): number | null {
  if (!basePrice || basePrice <= 0 || salePrice === null || salePrice < 0 || salePrice >= basePrice) {
    return null;
  }
  return Math.floor(((basePrice - salePrice) / basePrice) * 100);
}

/** BP-DEAL-002-3: salePrice ASC -> unconditional first -> later/null expiry -> fresher verification. */
export function compareDealsForDisplay(a: ComparableDeal, b: ComparableDeal): number {
  const priceA = a.salePrice ?? Number.MAX_SAFE_INTEGER;
  const priceB = b.salePrice ?? Number.MAX_SAFE_INTEGER;
  if (priceA !== priceB) return priceA - priceB;

  const uncA = a.isUnconditional ? 1 : 0;
  const uncB = b.isUnconditional ? 1 : 0;
  if (uncA !== uncB) return uncB - uncA;

  const expA = a.expiresAt ? Date.parse(a.expiresAt) : Number.MAX_SAFE_INTEGER;
  const expB = b.expiresAt ? Date.parse(b.expiresAt) : Number.MAX_SAFE_INTEGER;
  if (expA !== expB) return expB - expA;

  return Date.parse(b.lastVerifiedAt) - Date.parse(a.lastVerifiedAt);
}

/** BP-DEAL-002-2: split general (unconditional) lowest vs conditional lowest. */
export function summarizeLowestDeals<T extends ComparableDeal>(deals: T[]): {
  generalLowest: T | null;
  conditionalLowest: T | null;
} {
  const priced = deals.filter((d) => d.salePrice !== null).sort(compareDealsForDisplay);
  const generalLowest = priced.find((d) => Boolean(d.isUnconditional)) ?? null;
  const conditionalLowest = priced.find((d) => !d.isUnconditional) ?? null;
  return { generalLowest, conditionalLowest };
}

export function formatKrw(price: number): string {
  return `${price.toLocaleString("ko-KR")}원`;
}
