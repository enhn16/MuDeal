const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function toKstShifted(now: Date): Date {
  return new Date(now.getTime() + KST_OFFSET_MS);
}

/** Format a Date as KST YYYY-MM-DD. */
export function formatKstDate(now = new Date()): string {
  return toKstShifted(now).toISOString().slice(0, 10);
}

/** Format a show run period, displaying open-run sentinel dates (2099+) as '오픈런'. */
export function formatShowPeriod(startDate: string, endDate: string): string {
  const start = startDate.replaceAll("-", ".");
  const end = endDate >= "2099-01-01" ? "오픈런" : endDate.replaceAll("-", ".");
  return `${start} ~ ${end}`;
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

const KOREAN_WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"] as const;

export function isValidIsoDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/** Format YYYY-MM-DD as MM.DD(요일), e.g. 2026-12-01 -> 12.01(화). */
export function formatEventDateWithDow(isoDate: string): string {
  if (!isValidIsoDate(isoDate)) return isoDate;
  const dt = new Date(`${isoDate}T00:00:00Z`);
  const dow = KOREAN_WEEKDAYS[dt.getUTCDay()];
  return `${isoDate.slice(5, 7)}.${isoDate.slice(8, 10)}(${dow})`;
}

/** Expand an inclusive YYYY-MM-DD range (capped to maxDays to avoid runaway lists). */
export function expandDateRange(startIso: string, endIso: string, maxDays = 31): string[] {
  if (!isValidIsoDate(startIso)) return [];
  if (!endIso || !isValidIsoDate(endIso) || endIso <= startIso) return [startIso];
  const startMs = Date.parse(`${startIso}T00:00:00Z`);
  const endMs = Date.parse(`${endIso}T00:00:00Z`);
  const totalDays = Math.round((endMs - startMs) / DAY_MS) + 1;
  if (totalDays <= 1) return [startIso];
  if (totalDays > maxDays) {
    return [startIso, endIso];
  }
  const out: string[] = [];
  for (let i = 0; i < totalDays; i++) {
    out.push(new Date(startMs + i * DAY_MS).toISOString().slice(0, 10));
  }
  return out;
}

interface DateRun {
  start: string;
  end: string;
  count: number;
}

function groupConsecutiveDateRuns(dates: string[]): DateRun[] {
  const unique = Array.from(new Set(dates.filter(isValidIsoDate))).sort();
  const runs: DateRun[] = [];
  for (const d of unique) {
    const prev = runs.at(-1);
    if (prev) {
      const diff = Math.round((Date.parse(`${d}T00:00:00Z`) - Date.parse(`${prev.end}T00:00:00Z`)) / DAY_MS);
      if (diff === 1) {
        prev.end = d;
        prev.count += 1;
        continue;
      }
    }
    runs.push({ start: d, end: d, count: 1 });
  }
  return runs;
}

function formatRun(run: DateRun, compactSep = " ~ "): string {
  if (run.count === 1) return formatEventDateWithDow(run.start);
  return `${formatEventDateWithDow(run.start)}${compactSep}${formatEventDateWithDow(run.end)}`;
}

/**
 * Format event/perk dates with Korean weekday for cards ("compact") or detail page ("full").
 * Examples:
 * - ["2026-12-01"] -> "12.01(화)"
 * - ["2026-11-24".."2026-12-01"] -> "11.24(화) ~ 12.01(화)"
 * - ["2026-11-28","2026-12-05","2026-12-12"] -> full: "11.28(토) · 12.05(토) · 12.12(토)", compact: "11.28(토) 외 2일"
 */
export function formatEventDates(
  dates: string[] | null | undefined,
  mode: "compact" | "full" = "full",
): string | null {
  if (!dates || dates.length === 0) return null;
  const runs = groupConsecutiveDateRuns(dates);
  if (runs.length === 0) return null;

  if (runs.length === 1) {
    return formatRun(runs[0]);
  }

  const totalDates = runs.reduce((acc, r) => acc + r.count, 0);
  if (mode === "full") {
    return runs.map((r) => formatRun(r)).join(" · ");
  }

  if (totalDates === 2) {
    return runs.map((r) => formatRun(r)).join(" · ");
  }

  const first = runs[0];
  const remaining = totalDates - first.count;
  if (first.count === 1) {
    return `${formatEventDateWithDow(first.start)} 외 ${remaining}일`;
  }
  return `${formatRun(first, "~")} 외 ${remaining}일`;
}

function makeIsoDate(year: number, month: number, day: number): string | null {
  const iso = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return isValidIsoDate(iso) ? iso : null;
}

/** Extract Korean event/perk dates and ranges from free text (e.g. "11월 24일~29일", "11/28(토), 11/29(일)"). */
export function extractDatesFromKoreanText(text: string | null | undefined, refYear: number): string[] {
  if (!text) return [];
  const found = new Set<string>();
  const addRange = (y1: number, m1: number, d1: number, y2: number | null, m2: number | null, d2: number) => {
    const start = makeIsoDate(y1, m1, d1);
    if (!start) return;
    const endMonth = m2 ?? m1;
    const endYear = y2 ?? (endMonth < m1 ? y1 + 1 : y1);
    const end = makeIsoDate(endYear, endMonth, d2);
    if (!end) {
      found.add(start);
      return;
    }
    for (const d of expandDateRange(start, end)) found.add(d);
  };

  // 1. Ranges with Korean month/day: "2026년 11월 24일 ~ 12월 1일", "11월 24일~29일"
  const krRangeRe =
    /(?:(20\d{2})\s*년\s*)?(\d{1,2})\s*월\s*(\d{1,2})\s*일(?:\s*\([월화수목금토일]\))?\s*[~～\-]\s*(?:(20\d{2})\s*년\s*)?(?:(\d{1,2})\s*월\s*)?(\d{1,2})\s*일/g;
  for (const m of text.matchAll(krRangeRe)) {
    const y1 = m[1] ? Number(m[1]) : refYear;
    addRange(y1, Number(m[2]), Number(m[3]), m[4] ? Number(m[4]) : null, m[5] ? Number(m[5]) : null, Number(m[6]));
  }

  // 2. Ranges with numeric separators: "2026.11.24 ~ 2026.11.29", "11/24(화)~11/29(일)", "11.24~29"
  const numRangeRe =
    /(?:(20\d{2})[./-])?(\d{1,2})[./-](\d{1,2})(?:\s*\([월화수목금토일]\))?\s*[~～\-]\s*(?:(20\d{2})[./-])?(?:(\d{1,2})[./-])?(\d{1,2})(?!\d)/g;
  for (const m of text.matchAll(numRangeRe)) {
    const y1 = m[1] ? Number(m[1]) : refYear;
    const m1 = Number(m[2]);
    const d1 = Number(m[3]);
    const m2 = m[5] ? Number(m[5]) : null;
    const d2 = Number(m[6]);
    if (m1 >= 1 && m1 <= 12 && d1 >= 1 && d1 <= 31 && d2 >= 1 && d2 <= 31) {
      addRange(y1, m1, d1, m[4] ? Number(m[4]) : null, m2, d2);
    }
  }

  // 3. Same-month comma/dot lists: "11월 28일, 29일", "11월 24일·25일"
  const krListRe =
    /(?:(20\d{2})\s*년\s*)?(\d{1,2})\s*월\s*(\d{1,2})\s*일(?:\s*\([월화수목금토일]\))?(?:\s*[,·/]\s*(\d{1,2})\s*일(?:\s*\([월화수목금토일]\))?)+/g;
  for (const m of text.matchAll(krListRe)) {
    const y = m[1] ? Number(m[1]) : refYear;
    const mo = Number(m[2]);
    for (const dm of m[0].matchAll(/(\d{1,2})\s*일/g)) {
      const iso = makeIsoDate(y, mo, Number(dm[1]));
      if (iso) found.add(iso);
    }
  }

  // 4. Single Korean dates: "2026년 12월 1일", "12월 1일"
  const krSingleRe = /(?:(20\d{2})\s*년\s*)?(\d{1,2})\s*월\s*(\d{1,2})\s*일/g;
  for (const m of text.matchAll(krSingleRe)) {
    const iso = makeIsoDate(m[1] ? Number(m[1]) : refYear, Number(m[2]), Number(m[3]));
    if (iso) found.add(iso);
  }

  // 5. Full ISO/dotted dates: "2026-12-01", "2026.12.01", "2026/12/01"
  const fullNumRe = /(20\d{2})[./-](\d{1,2})[./-](\d{1,2})(?!\d)/g;
  for (const m of text.matchAll(fullNumRe)) {
    const iso = makeIsoDate(Number(m[1]), Number(m[2]), Number(m[3]));
    if (iso) found.add(iso);
  }

  // 6. Explicit M/D or M.D(요일) tokens: "11/29", "12.01(화)"
  const mdRe = /(?:^|[^\d./-])(\d{1,2})(?:\/(\d{1,2})|\.(\d{1,2})\s*\([월화수목금토일]\))(?!\d)/g;
  for (const m of text.matchAll(mdRe)) {
    const mo = Number(m[1]);
    const day = Number(m[2] ?? m[3]);
    const iso = makeIsoDate(refYear, mo, day);
    if (iso) found.add(iso);
  }

  return Array.from(found).sort();
}

function shiftIsoDateDays(isoDate: string, days: number): string {
  return new Date(Date.parse(`${isoDate}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Normalize OCR/text event dates and correct hallucinated past years (e.g. 2021/2023/2024)
 * using the show's actual run period or the current KST year.
 */
export function normalizeEventDates(
  rawDates: string[] | null | undefined,
  opts: {
    showStartDate?: string | null;
    showEndDate?: string | null;
    fallbackText?: string | null;
    now?: Date;
  } = {},
): string[] {
  const now = opts.now ?? new Date();
  const todayKst = formatKstDate(now);
  const currentYear = Number(todayKst.slice(0, 4));

  const validRaw = (rawDates ?? []).map((d) => d.trim()).filter(isValidIsoDate);
  const refYear =
    opts.showStartDate && isValidIsoDate(opts.showStartDate) && opts.showStartDate.slice(0, 4) >= String(currentYear - 1)
      ? Math.max(currentYear, Number(opts.showStartDate.slice(0, 4)))
      : currentYear;
  const source =
    validRaw.length > 0 ? validRaw : extractDatesFromKoreanText(opts.fallbackText, refYear);
  if (source.length === 0) return [];

  const hasBoundedPeriod =
    Boolean(opts.showStartDate && isValidIsoDate(opts.showStartDate)) &&
    Boolean(opts.showEndDate && isValidIsoDate(opts.showEndDate) && opts.showEndDate < "2099-01-01");

  const graceStart = hasBoundedPeriod ? shiftIsoDateDays(opts.showStartDate!, -14) : null;
  const graceEnd = hasBoundedPeriod ? shiftIsoDateDays(opts.showEndDate!, 7) : null;
  const minShowYear = hasBoundedPeriod ? Number(opts.showStartDate!.slice(0, 4)) : currentYear;
  const maxShowYear = hasBoundedPeriod ? Number(opts.showEndDate!.slice(0, 4)) : currentYear + 1;

  const normalized = new Set<string>();
  for (const iso of source) {
    const year = Number(iso.slice(0, 4));
    const md = iso.slice(5); // MM-DD

    if (hasBoundedPeriod && graceStart && graceEnd) {
      if (iso >= graceStart && iso <= graceEnd) {
        normalized.add(iso);
        continue;
      }
      // Try remapping MM-DD into the show's running year(s)
      let mapped: string | null = null;
      for (let y = minShowYear; y <= maxShowYear; y++) {
        const candidate = `${y}-${md}`;
        if (isValidIsoDate(candidate) && candidate >= graceStart && candidate <= graceEnd) {
          mapped = candidate;
          break;
        }
      }
      normalized.add(mapped ?? iso);
      continue;
    }

    // Open-run or unknown show period: correct clearly hallucinated past years (< currentYear - 1)
    if (year < currentYear - 1) {
      const thisYear = `${currentYear}-${md}`;
      const nextYear = `${currentYear + 1}-${md}`;
      if (isValidIsoDate(thisYear)) {
        const diffDays = Math.round(
          (Date.parse(`${thisYear}T00:00:00Z`) - Date.parse(`${todayKst}T00:00:00Z`)) / DAY_MS,
        );
        normalized.add(diffDays < -180 && isValidIsoDate(nextYear) ? nextYear : thisYear);
        continue;
      }
    }
    normalized.add(iso);
  }

  return Array.from(normalized).sort();
}
