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

/** Format an ISO expiration timestamp in KST as "~MM.DD(요일)", e.g. "~11.30(월)". */
export function formatBookingDeadline(expiresAt: string | null | undefined): string | null {
  if (!expiresAt) return null;
  const ms = Date.parse(expiresAt);
  if (Number.isNaN(ms)) return null;
  return `~${formatEventDateWithDow(formatKstDate(new Date(ms)))}`;
}

/** True when a deal is currently applicable (not future-only, not expired, and applicable dates not completely past). */
export function isDealActiveNow(
  deal: { opensAt?: string | null; expiresAt?: string | null; eventDates?: string[] },
  now = new Date(),
): boolean {
  if (deal.opensAt) {
    const openMs = Date.parse(deal.opensAt);
    if (!Number.isNaN(openMs) && openMs > now.getTime()) return false;
  }
  if (isExpired(deal.expiresAt, now)) return false;
  if (deal.eventDates && deal.eventDates.length > 0) {
    const todayKst = formatKstDate(now);
    const latest = deal.eventDates[deal.eventDates.length - 1];
    if (latest < todayKst) return false;
  }
  return true;
}

/**
 * Compare two dated benefits/events by priority:
 * 0: currently active today (start <= today <= end) -> ending soonest first
 * 1: upcoming (start > today) -> earliest start date first
 * 2: undated / ongoing
 * 3: already ended (end < today) -> most recent first
 */
export function compareDatedBenefitPriority(
  aDates: string[],
  bDates: string[],
  todayKst: string,
): number {
  const rank = (dates: string[]): { tier: number; primary: string; secondary: string } => {
    if (dates.length === 0) return { tier: 2, primary: "9999-12-31", secondary: "9999-12-31" };
    const first = dates[0];
    const last = dates[dates.length - 1];
    if (first <= todayKst && last >= todayKst) {
      return { tier: 0, primary: last, secondary: first };
    }
    if (first > todayKst) {
      return { tier: 1, primary: first, secondary: last };
    }
    return { tier: 3, primary: last, secondary: first };
  };

  const ra = rank(aDates);
  const rb = rank(bDates);
  if (ra.tier !== rb.tier) return ra.tier - rb.tier;
  if (ra.tier === 3) return rb.primary.localeCompare(ra.primary);
  return ra.primary.localeCompare(rb.primary) || ra.secondary.localeCompare(rb.secondary);
}

/**
 * Extract booking deadline (`bookingExpiresAt`) and applicable performance dates (`applicableDates`)
 * from Korean discount labels like:
 * - "조기예매(~12/1까지 예매시)20%"
 * - "크리스마스 얼리버드(~12/17)"
 * - "연말 얼리버드 할인 (12월 24일~31일 전 회차, 11월 11일부터 12월 23일까지 예매 시 적용)"
 */
export function extractDiscountDatesFromLabel(
  label: string | null | undefined,
  opts: { showStartDate?: string | null; showEndDate?: string | null; now?: Date } = {},
): { bookingExpiresAt: string | null; applicableDates: string[] } {
  if (!label) return { bookingExpiresAt: null, applicableDates: [] };
  const now = opts.now ?? new Date();
  const refYear = Number(formatKstDate(now).slice(0, 4));
  // Strip age/birth/year-only noise like "1959년이전출생", "2027수험표", "36개월~만18세", "1인2매"
  const cleaned = label
    .replace(/\d{4}\s*년\s*이전\s*출생/g, " ")
    .replace(/\d{4}\s*수험표/g, " ")
    .replace(/\d+\s*개월/g, " ")
    .replace(/만\s*\d+\s*세/g, " ")
    .replace(/\d+\s*인\s*\d+\s*매/g, " ");

  let bookingExpiresAt: string | null = null;
  let remainingForPerf = cleaned;

  // 1. Booking deadline clauses: "(~12/1까지 예매시)", "(~12/17)", "11월 11일부터 12월 23일까지 예매 시"
  const bookingClausePatterns = [
    /(?:(?:20\d{2}\s*년\s*)?\d{1,2}\s*월\s*\d{1,2}\s*일\s*부터\s*|(?:20\d{2}[./-])?\d{1,2}[./-]\d{1,2}\s*[~～]\s*|~|～)[^,()]{0,28}?(?:까지\s*예매[^,()]*|까지(?=\s*[),]|$))/g,
    /(?:~|～)\s*(?:20\d{2}[./-])?\d{1,2}[./-]\d{1,2}(?:\s*\([월화수목금토일]\))?(?:\s*까지)?/g,
    /(?:~|～)\s*(?:20\d{2}\s*년\s*)?\d{1,2}\s*월\s*\d{1,2}\s*일(?:\s*까지)?/g,
  ];

  const bookingDatesFound: string[] = [];
  for (const re of bookingClausePatterns) {
    for (const m of cleaned.matchAll(re)) {
      const snippet = m[0];
      // Skip if this snippet explicitly says 회차/공연/관람 (that's performance period, not booking deadline)
      if (/회차|공연|관람/.test(snippet) && !/예매/.test(snippet)) continue;
      const dates = normalizeEventDates(extractDatesFromKoreanText(snippet, refYear), {
        showStartDate: opts.showStartDate,
        showEndDate: opts.showEndDate,
        now,
      });
      if (dates.length > 0) {
        bookingDatesFound.push(...dates);
        remainingForPerf = remainingForPerf.replace(snippet, " ");
      }
    }
  }

  if (bookingDatesFound.length > 0) {
    const latestBooking = bookingDatesFound.sort().at(-1)!;
    bookingExpiresAt = new Date(`${latestBooking}T23:59:59+09:00`).toISOString();
  }

  // 2. Applicable performance dates from remaining text (only explicit date/range mentions)
  const perfDates = normalizeEventDates(extractDatesFromKoreanText(remainingForPerf, refYear), {
    showStartDate: opts.showStartDate,
    showEndDate: opts.showEndDate,
    now,
  });

  return { bookingExpiresAt, applicableDates: perfDates };
}
