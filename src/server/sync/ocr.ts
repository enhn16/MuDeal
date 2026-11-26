import { and, asc, eq, gte, isNotNull, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { AppDb } from "@/db/client";
import { CONDITION_TAGS, deals, ocrImageJobs, shows, type ConditionTag } from "@/db/schema";
import { formatKstDate, normalizeEventDates, startOfKstDayUtc } from "@/lib/kst";
import { sha256Hex } from "@/lib/jwt";
import { recomputeShowPriceCache } from "@/server/modules/reports";
import { classifyDiscountLabel, hasMeaningfulBenefit, isStatutoryDiscount } from "./benefit-filter";
import { AUTO_PUBLISH_CONFIDENCE } from "./channels";

const VALID_CONDITION_TAGS = new Set<string>(CONDITION_TAGS);
const VALID_SEAT_GRADES = new Set(["VIP", "R", "S", "A", "ALL"]);

/** Exact structured OCR output schema from 상세설계서.md §4.4 (resilient to minor LLM tag drift). */
export const OcrExtractSchema = z.object({
  hasRelevantInfo: z.boolean(),
  confidence: z.number().min(0).max(1),
  discounts: z
    .array(
      z.object({
        seatGrade: z
          .string()
          .default("ALL")
          .transform((v) => {
            const u = v.trim().toUpperCase().replace("석", "");
            return (VALID_SEAT_GRADES.has(u) ? u : "ALL") as "VIP" | "R" | "S" | "A" | "ALL";
          }),
        salePrice: z.number().int().nonnegative().nullable().catch(null),
        discountRate: z.number().int().min(1).max(99).nullable().catch(null),
        isUnconditional: z.boolean().default(true),
        conditionTags: z
          .array(z.string())
          .default([])
          .transform((arr) => arr.filter((t): t is ConditionTag => VALID_CONDITION_TAGS.has(t))),
        conditionSummary: z.string().max(200).catch(""),
        expiresAtKst: z.string().nullable().catch(null),
      }),
    )
    .default([]),
  events: z
    .array(
      z.object({
        dealType: z.enum(["SINGALONG", "CURTAIN_CALL", "PERK_GOODS", "SPECIAL_DAY"]),
        eventDates: z.array(z.string()).default([]),
        perkSummary: z.string().max(300).nullable().catch(null),
        conditionSummary: z.string().max(200).nullable().catch(null),
      }),
    )
    .default([]),
});

export type OcrExtractResult = z.infer<typeof OcrExtractSchema>;

export interface VisionExtractContext {
  showTitle?: string;
  startDate?: string;
  endDate?: string;
  todayKst?: string;
}

export type VisionExtractor = (
  imageBytes: ArrayBuffer,
  mimeType: string,
  context?: VisionExtractContext,
) => Promise<OcrExtractResult>;
export type SynopsisExtractor = (
  images: Array<{ bytes: ArrayBuffer; mimeType: string }>,
  showTitle: string,
) => Promise<string | null>;

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

/** Gemini Vision structured JSON extractor (original image stays in-memory only; never stored in R2). */
export function createGeminiVisionExtractor(apiKey: string): VisionExtractor {
  const models = ["gemini-flash-lite-latest", "gemini-2.5-flash"];
  return async (imageBytes, mimeType, context) => {
    const todayKst = context?.todayKst ?? formatKstDate(new Date());
    const periodHint =
      context?.startDate && context?.endDate
        ? `공연명: ${context.showTitle ?? "미상"}, 공연 기간: ${context.startDate} ~ ${context.endDate}, 오늘 날짜(KST): ${todayKst}. `
        : `오늘 날짜(KST): ${todayKst}. `;
    const prompt =
      periodHint +
      '한국 뮤지컬 예매처 공지 이미지에서 일반 관객이 받을 수 있는 특별 할인(타임세일·조기예매·프리뷰·마티네·재관람·학생/수험생·군인·직장인·지역주민·패키지·카드특가·무조건 할인)과 현장 이벤트(싱어롱·스페셜 커튼콜·포토카드/굿즈 특전·스페셜 데이)만 추출해 아래 JSON 스키마로 반환하세요. ' +
      '국가유공자·장애인·복지·경로우대·보훈·임산부·다자녀·문화누리 등 법정·복지 할인은 반드시 제외하고, 마티네/군인/수험생/직장인/재관람/지역주민/패키지/카드 할인은 isUnconditional=false로 표시하세요. ' +
      '특전·싱어롱·커튼콜·스페셜 데이의 진행 날짜 또는 기간(예: 11/24~11/29, 12월 5일(토))이 이미지에 있으면 반드시 eventDates에 ["YYYY-MM-DD"] 형태로 빠짐없이 추출하세요(짧은 연속 기간은 날짜를 모두 나열). 이미지에 연도가 생략된 경우 반드시 위 공연 기간 및 오늘 날짜에 맞는 연도를 사용하고 과거 임의 연도를 지어내지 마세요. 관련 혜택이 없으면 hasRelevantInfo=false로 반환하세요. ' +
      '{"hasRelevantInfo":boolean,"confidence":0~1,"discounts":[{"seatGrade":"VIP"|"R"|"S"|"A"|"ALL","salePrice":integer|null,"discountRate":1~99|null,"isUnconditional":boolean,"conditionTags":["MATINEE"|"REWATCH"|"YOUTH_STUDENT"|"MILITARY_PUBLIC"|"OFFICE_WORKER"|"LOCAL_RESIDENT"|"GROUP_PACKAGE"|"CARD_PARTNER"|"EVENT_CONDITION"],"conditionSummary":string,"expiresAtKst":"YYYY-MM-DDTHH:MM:SS"|null}],"events":[{"dealType":"SINGALONG"|"CURTAIN_CALL"|"PERK_GOODS"|"SPECIAL_DAY","eventDates":["YYYY-MM-DD"],"perkSummary":string|null,"conditionSummary":string|null}]}';

    const b64 = arrayBufferToBase64(imageBytes);
    let lastStatus = 500;
    for (const model of models) {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(
          apiKey,
        )}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  { text: prompt },
                  { inlineData: { mimeType, data: b64 } },
                ],
              },
            ],
            generationConfig: { responseMimeType: "application/json" },
          }),
        },
      );
      lastStatus = res.status;
      if (res.status === 404 || res.status === 429 || res.status === 503) continue;
      if (!res.ok) throw new Error(`Gemini Vision HTTP ${res.status}`);
      const body = (await res.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };
      const rawText = body.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
      return OcrExtractSchema.parse(JSON.parse(rawText));
    }
    throw new Error(`Gemini Vision HTTP ${lastStatus}`);
  };
}

/** Extracts the full synopsis text from a musical's official detail images once at initial registration. */
export function createGeminiSynopsisExtractor(apiKey: string): SynopsisExtractor {
  const models = ["gemini-flash-lite-latest", "gemini-2.5-flash"];
  return async (images, showTitle) => {
    if (images.length === 0) return null;
    const prompt =
      `다음 이미지는 뮤지컬 "${showTitle}"의 공식 상세 소개 이미지입니다. ` +
      '이미지 안에 있는 작품 줄거리(시놉시스) 내용 전체를 자연스러운 한국어 줄글로 정리해 주세요. ' +
      '할인 안내, 티켓 예매 규정, 공연장 주소, 캐스팅 일정표 등 줄거리와 무관한 문구는 제외하고 오직 작품 시놉시스만 반환하세요. ' +
      '이미지에 줄거리 내용이 전혀 없으면 {"synopsis":null}로 반환하세요. ' +
      'JSON 스키마: {"synopsis": string | null}';

    const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [
      { text: prompt },
      ...images.map((img) => ({
        inlineData: { mimeType: img.mimeType, data: arrayBufferToBase64(img.bytes) },
      })),
    ];

    let lastStatus = 500;
    for (const model of models) {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(
          apiKey,
        )}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts }],
            generationConfig: { responseMimeType: "application/json" },
          }),
        },
      );
      lastStatus = res.status;
      if (res.status === 404 || res.status === 429 || res.status === 503) continue;
      if (!res.ok) throw new Error(`Gemini Synopsis HTTP ${res.status}`);
      const body = (await res.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };
      const rawText = body.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
      const parsed = z
        .object({ synopsis: z.string().trim().min(10).max(2000).nullable().catch(null) })
        .safeParse(JSON.parse(rawText));
      return parsed.success ? parsed.data.synopsis : null;
    }
    throw new Error(`Gemini Synopsis HTTP ${lastStatus}`);
  };
}

function parseSynopsisImageUrls(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const trimmed = raw.trim();
  if (trimmed.startsWith("[")) {
    try {
      const arr = JSON.parse(trimmed);
      if (Array.isArray(arr)) return arr.filter((u): u is string => typeof u === "string" && u.startsWith("http")).slice(0, 3);
    } catch {
      return [];
    }
  }
  return trimmed.startsWith("http") ? [trimmed] : [];
}

/** Populates shows.synopsis once for newly registered shows that have synopsisImageUrl(s). */
export async function populateMissingSynopses(
  db: AppDb,
  opts: { extractor: SynopsisExtractor; batchSize?: number; fetchFn?: typeof fetch },
): Promise<{ checked: number; populated: number }> {
  const fetchImpl = opts.fetchFn ?? fetch;
  const targets = await db
    .select({
      id: shows.id,
      title: shows.title,
      synopsisImageUrl: shows.synopsisImageUrl,
    })
    .from(shows)
    .where(and(isNull(shows.synopsis), isNotNull(shows.synopsisImageUrl)))
    .limit(opts.batchSize ?? 4);

  let checked = 0;
  let populated = 0;

  for (const show of targets) {
    const urls = parseSynopsisImageUrls(show.synopsisImageUrl);
    if (urls.length === 0) continue;
    checked += 1;
    try {
      const images: Array<{ bytes: ArrayBuffer; mimeType: string }> = [];
      for (const u of urls) {
        const imgRes = await fetchImpl(u);
        if (!imgRes.ok) continue;
        const mimeType = imgRes.headers.get("content-type")?.split(";")[0] || "image/jpeg";
        const bytes = await imgRes.arrayBuffer();
        if (bytes.byteLength > 0 && bytes.byteLength <= 4_500_000) {
          images.push({ bytes, mimeType });
        }
      }
      if (images.length === 0) continue;
      const synopsis = await opts.extractor(images, show.title);
      if (synopsis) {
        await db
          .update(shows)
          .set({ synopsis, updatedAt: new Date().toISOString() })
          .where(eq(shows.id, show.id));
        populated += 1;
      }
    } catch {
      // Skip transient image/model failure; next run retries automatically
    }
  }

  return { checked, populated };
}

/**
 * BP-SYNC-002-1 & DDS §4.4: process queued OCR image jobs under KST daily limit,
 * dedup by image_hash, block noise (hasRelevantInfo=false), flag confidence < 0.7 as NEEDS_REVIEW.
 */
export async function processPendingOcrJobs(
  db: AppDb,
  opts: { dailyLimit: number; extractor: VisionExtractor; batchSize?: number },
  now = new Date(),
): Promise<{ processed: number; draftsCreated: number; skippedByLimit: boolean }> {
  const kstStart = startOfKstDayUtc(now);
  const [doneToday] = await db
    .select({ count: sql<number>`count(*)` })
    .from(ocrImageJobs)
    .where(
      and(
        gte(ocrImageJobs.updatedAt, kstStart),
        sql`${ocrImageJobs.ocrStatus} IN ('DONE', 'NEEDS_REVIEW')`,
      ),
    );

  const remaining = opts.dailyLimit - Number(doneToday?.count ?? 0);
  if (remaining <= 0) {
    return { processed: 0, draftsCreated: 0, skippedByLimit: true };
  }

  const jobs = await db
    .select()
    .from(ocrImageJobs)
    .where(eq(ocrImageJobs.ocrStatus, "QUEUED"))
    .orderBy(asc(ocrImageJobs.createdAt))
    .limit(Math.min(remaining, opts.batchSize ?? 5));

  let processed = 0;
  let draftsCreated = 0;

  for (const job of jobs) {
    const nowIso = new Date().toISOString();
    await db
      .update(ocrImageJobs)
      .set({ ocrStatus: "PROCESSING", updatedAt: nowIso })
      .where(eq(ocrImageJobs.id, job.id));

    try {
      const imgRes = await fetch(job.imageUrl);
      if (!imgRes.ok) throw new Error(`Image fetch HTTP ${imgRes.status}`);
      const mimeType = imgRes.headers.get("content-type")?.split(";")[0] || "image/jpeg";
      const buf = await imgRes.arrayBuffer();
      const imageHash = await sha256Hex(arrayBufferToBase64(buf).slice(0, 8192) + String(buf.byteLength));

      // Dedup by image_hash
      const [dup] = await db
        .select({ id: ocrImageJobs.id })
        .from(ocrImageJobs)
        .where(and(eq(ocrImageJobs.imageHash, imageHash), sql`${ocrImageJobs.id} != ${job.id}`))
        .limit(1);

      if (dup) {
        await db
          .update(ocrImageJobs)
          .set({ imageHash, ocrStatus: "DONE", errorMessage: "중복 이미지 해시 생략", updatedAt: new Date().toISOString() })
          .where(eq(ocrImageJobs.id, job.id));
        processed += 1;
        continue;
      }

      const showMeta =
        job.showId !== null
          ? (
              await db
                .select({
                  title: shows.title,
                  startDate: shows.startDate,
                  endDate: shows.endDate,
                })
                .from(shows)
                .where(eq(shows.id, job.showId))
                .limit(1)
            )[0] ?? null
          : null;

      const todayKst = formatKstDate(now);
      const extracted = await opts.extractor(buf, mimeType, {
        showTitle: showMeta?.title,
        startDate: showMeta?.startDate,
        endDate: showMeta?.endDate,
        todayKst,
      });
      const nextStatus = !extracted.hasRelevantInfo
        ? "DONE"
        : extracted.confidence < 0.7
          ? "NEEDS_REVIEW"
          : "DONE";

      await db
        .update(ocrImageJobs)
        .set({
          imageHash,
          ocrStatus: nextStatus,
          extractedJson: JSON.stringify(extracted),
          confidence: extracted.confidence,
          errorMessage: null,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(ocrImageJobs.id, job.id));

      if (extracted.hasRelevantInfo) {
        const dealStatus =
          job.showId !== null && extracted.confidence >= AUTO_PUBLISH_CONFIDENCE ? "ACTIVE" : "DRAFT";

        for (const d of extracted.discounts) {
          const classified = classifyDiscountLabel(d.conditionSummary);
          const mergedTags = Array.from(new Set<ConditionTag>([...d.conditionTags, ...classified.conditionTags]));
          const isUnconditional = d.isUnconditional && classified.isUnconditional && mergedTags.length === 0;

          if (
            classified.isStatutory ||
            isStatutoryDiscount(d.conditionSummary) ||
            !hasMeaningfulBenefit({
              dealType: classified.dealType,
              salePrice: d.salePrice,
              discountRate: d.discountRate,
              conditionSummary: d.conditionSummary,
            })
          ) {
            continue;
          }
          await db.insert(deals).values({
            showId: job.showId,
            channelName: job.sourceChannel,
            dealType: classified.dealType,
            seatGrade: d.seatGrade,
            salePrice: d.salePrice,
            discountRate: d.discountRate,
            isUnconditional: isUnconditional ? 1 : 0,
            conditionTagsJson: mergedTags.length ? JSON.stringify(mergedTags) : null,
            conditionSummary: d.conditionSummary,
            externalUrl: job.sourcePageUrl,
            expiresAt: d.expiresAtKst ? new Date(`${d.expiresAtKst}+09:00`).toISOString() : null,
            status: dealStatus,
            sourceType: "OCR_APPROVED",
            sourceOcrJobId: job.id,
          });
          draftsCreated += 1;
        }

        for (const ev of extracted.events) {
          const validDates = normalizeEventDates(ev.eventDates, {
            showStartDate: showMeta?.startDate,
            showEndDate: showMeta?.endDate,
            fallbackText: [ev.conditionSummary, ev.perkSummary].filter(Boolean).join(" "),
            now,
          });
          const latestDate = validDates.at(-1) ?? null;
          // Skip seasonal events whose dates have already completely passed
          if (latestDate && latestDate < todayKst) continue;
          const evExpiresAt = latestDate ? new Date(`${latestDate}T23:59:59+09:00`).toISOString() : null;

          await db.insert(deals).values({
            showId: job.showId,
            channelName: job.sourceChannel,
            dealType: ev.dealType,
            seatGrade: "ALL",
            isUnconditional: 1,
            conditionSummary: ev.conditionSummary,
            eventDatesJson: validDates.length ? JSON.stringify(validDates) : null,
            perkSummary: ev.perkSummary,
            externalUrl: job.sourcePageUrl,
            expiresAt: evExpiresAt,
            status: dealStatus,
            sourceType: "OCR_APPROVED",
            sourceOcrJobId: job.id,
          });
          draftsCreated += 1;
        }

        if (dealStatus === "ACTIVE" && job.showId !== null) {
          await recomputeShowPriceCache(db, job.showId);
        }
      }

      processed += 1;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isTransient = msg.includes("429") || msg.includes("503");
      await db
        .update(ocrImageJobs)
        .set({
          ocrStatus: isTransient ? "QUEUED" : "FAILED",
          errorMessage: msg,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(ocrImageJobs.id, job.id));
    }
  }

  return { processed, draftsCreated, skippedByLimit: false };
}
