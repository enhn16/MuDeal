const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function toKstShifted(now: Date): Date {
  return new Date(now.getTime() + KST_OFFSET_MS);
}

/** Format a Date as KST YYYY-MM-DD. */
export function formatKstDate(now = new Date()): string {
  return toKstShifted(now).toISOString().slice(0, 10);
}

/** Format an ISO/UTC timestamp or Date as KST MM.DD HH:mm. */
export function formatKstDateTime(value: string | Date): string {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return typeof value === "string" ? value.slice(5, 16).replace("T", " ") : "";
  const iso = toKstShifted(date).toISOString();
  return `${iso.slice(5, 7)}.${iso.slice(8, 10)} ${iso.slice(11, 16)}`;
}

/** UTC ISO string for 00:00:00 KST of the given instant (daily limit reset boundary). */
export function startOfKstDayUtc(now = new Date()): string {
  const kstDate = formatKstDate(now);
  return new Date(`${kstDate}T00:00:00+09:00`).toISOString();
}

/** BP-RESET-001-3: expired once nowUtc >= expiresAt (inclusive at the exact boundary). */
export function isExpired(expiresAt: string | null | undefined, now = new Date()): boolean {
  if (!expiresAt) return false;
  return now.getTime() >= Date.parse(expiresAt);
}

/** KST calendar day difference until target ISO/YYYY-MM-DD (0 = D-Day, < 0 = ended). */
export function calcKstDDay(target: string, now = new Date()): number {
  const todayUtc = Date.parse(`${formatKstDate(now)}T00:00:00Z`);
  const targetKstDate = /^\d{4}-\d{2}-\d{2}$/.test(target)
    ? target
    : formatKstDate(new Date(target));
  const targetUtc = Date.parse(`${targetKstDate}T00:00:00Z`);
  return Math.round((targetUtc - todayUtc) / DAY_MS);
}

/** BP-SEARCH-001: date range presets in KST YYYY-MM-DD. */
export function resolveDatePreset(
  preset: "TODAY" | "THIS_WEEKEND" | "THIS_MONTH",
  now = new Date(),
): { dateFrom: string; dateTo: string } {
  const shifted = toKstShifted(now);
  const year = shifted.getUTCFullYear();
  const month = shifted.getUTCMonth();
  const day = shifted.getUTCDate();
  const dow = shifted.getUTCDay(); // 0=Sun..6=Sat

  const fmt = (d: Date) => d.toISOString().slice(0, 10);

  if (preset === "TODAY") {
    const today = fmt(shifted);
    return { dateFrom: today, dateTo: today };
  }
  if (preset === "THIS_WEEKEND") {
    // Sun -> today only; Sat -> Sat~Sun; Mon~Fri -> upcoming Sat~Sun
    const satOffset = dow === 0 ? 0 : 6 - dow;
    const sunOffset = dow === 0 ? 0 : 7 - dow;
    const from = new Date(Date.UTC(year, month, day + satOffset));
    const to = new Date(Date.UTC(year, month, day + sunOffset));
    return { dateFrom: fmt(from), dateTo: fmt(to) };
  }
  const monthStart = new Date(Date.UTC(year, month, 1));
  const monthEnd = new Date(Date.UTC(year, month + 1, 0));
  return { dateFrom: fmt(monthStart), dateTo: fmt(monthEnd) };
}
