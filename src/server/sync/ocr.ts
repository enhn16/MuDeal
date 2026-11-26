import { and, asc, eq, gte, sql } from "drizzle-orm";
import { z } from "zod";
import type { AppDb } from "@/db/client";
import { deals, ocrImageJobs } from "@/db/schema";
import { formatKstDate, startOfKstDayUtc } from "@/lib/kst";
import { sha256Hex } from "@/lib/jwt";
import { recomputeShowPriceCache } from "@/server/modules/reports";
import { hasMeaningfulBenefit, isStatutoryOnlyDiscount } from "./benefit-filter";
import { AUTO_PUBLISH_CONFIDENCE } from "./channels";

const VALID_CONDITION_TAGS = new Set(["MATINEE", "REWATCH", "YOUTH_STUDENT", "OFFICE_WORKER", "CARD_PARTNER"]);
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
          .transform((arr) =>
            arr.filter((t): t is "MATINEE" | "REWATCH" | "YOUTH_STUDENT" | "OFFICE_WORKER" | "CARD_PARTNER" =>
              VALID_CONDITION_TAGS.has(t),
            ),
          ),
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

export type VisionExtractor = (imageBytes: ArrayBuffer, mimeType: string) => Promise<OcrExtractResult>;

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

/** Gemini Vision structured JSON extractor (original image stays in-memory only; never stored in R2). */
export function createGeminiVisionExtractor(apiKey: string): VisionExtractor {
  const models = ["gemini-flash-lite-latest", "gemini-3.8-flash"];
  return async (imageBytes, mimeType) => {
    const prompt =
      '한국 뮤지컬 예매처 공지 이미지에서 일반 관객이 받을 수 있는 특별 할인(타임세일·조기예매·마티네·재관람·학생/수험생·카드특가·무조건 할인)과 현장 이벤트(싱어롱·스페셜 커튼콜·포토카드/굿즈 특전·회차)만 추출해 아래 JSON 스키마로 반환하세요. ' +
      '국가유공자·장애인·복지·경로우대·보훈·임산부·다자녀·문화누리 등 기본 법정 할인은 반드시 제외하고, 관련 특별 혜택이 없으면 hasRelevantInfo=false로 반환하세요. ' +
      '{"hasRelevantInfo":boolean,"confidence":0~1,"discounts":[{"seatGrade":"VIP"|"R"|"S"|"A"|"ALL","salePrice":integer|null,"discountRate":1~99|null,"isUnconditional":boolean,"conditionTags":["MATINEE"|"REWATCH"|"YOUTH_STUDENT"|"OFFICE_WORKER"|"CARD_PARTNER"],"conditionSummary":string,"expiresAtKst":"YYYY-MM-DDTHH:MM:SS"|null}],"events":[{"dealType":"SINGALONG"|"CURTAIN_CALL"|"PERK_GOODS"|"SPECIAL_DAY","eventDates":["YYYY-MM-DD"],"perkSummary":string|null,"conditionSummary":string|null}]}';

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

      const extracted = await opts.extractor(buf, mimeType);
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
          if (
            isStatutoryOnlyDiscount(d.conditionSummary) ||
            !hasMeaningfulBenefit({
              dealType: "DISCOUNT_SITE",
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
            dealType: "DISCOUNT_SITE",
            seatGrade: d.seatGrade,
            salePrice: d.salePrice,
            discountRate: d.discountRate,
            isUnconditional: d.isUnconditional ? 1 : 0,
            conditionTagsJson: d.conditionTags.length ? JSON.stringify(d.conditionTags) : null,
            conditionSummary: d.conditionSummary,
            externalUrl: job.sourcePageUrl,
            expiresAt: d.expiresAtKst ? new Date(`${d.expiresAtKst}+09:00`).toISOString() : null,
            status: dealStatus,
            sourceType: "OCR_APPROVED",
            sourceOcrJobId: job.id,
          });
          draftsCreated += 1;
        }

        const todayKst = formatKstDate(now);
        for (const ev of extracted.events) {
          const validDates = ev.eventDates.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
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
