import { and, asc, eq, gte, sql } from "drizzle-orm";
import { z } from "zod";
import type { AppDb } from "@/db/client";
import { deals, ocrImageJobs } from "@/db/schema";
import { startOfKstDayUtc } from "@/lib/kst";
import { sha256Hex } from "@/lib/jwt";

/** Exact structured OCR output schema from 상세설계서.md §4.4. */
export const OcrExtractSchema = z.object({
  hasRelevantInfo: z.boolean(),
  confidence: z.number().min(0).max(1),
  discounts: z
    .array(
      z.object({
        seatGrade: z.enum(["VIP", "R", "S", "A", "ALL"]).default("ALL"),
        salePrice: z.number().int().nonnegative().nullable(),
        discountRate: z.number().int().min(1).max(99).nullable(),
        isUnconditional: z.boolean(),
        conditionTags: z
          .array(z.enum(["MATINEE", "REWATCH", "YOUTH_STUDENT", "OFFICE_WORKER", "CARD_PARTNER"]))
          .default([]),
        conditionSummary: z.string().max(200),
        expiresAtKst: z.string().nullable(),
      }),
    )
    .default([]),
  events: z
    .array(
      z.object({
        dealType: z.enum(["SINGALONG", "CURTAIN_CALL", "PERK_GOODS", "SPECIAL_DAY"]),
        eventDates: z.array(z.string()).default([]),
        perkSummary: z.string().max(300).nullable(),
        conditionSummary: z.string().max(200).nullable(),
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
  return async (imageBytes, mimeType) => {
    const prompt =
      "한국 뮤지컬 예매처 공지 이미지에서 할인 정보(좌석별 할인가·할인율·무조건/조건부·마감일)와 현장 이벤트(싱어롱·커튼콜·굿즈 특전·회차)만 JSON으로 추출하세요. 관련 정보가 없으면 hasRelevantInfo=false로 반환하세요.";

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(
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
                { inlineData: { mimeType, data: arrayBufferToBase64(imageBytes) } },
              ],
            },
          ],
          generationConfig: { responseMimeType: "application/json" },
        }),
      },
    );

    if (!res.ok) throw new Error(`Gemini Vision HTTP ${res.status}`);
    const body = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const rawText = body.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
    return OcrExtractSchema.parse(JSON.parse(rawText));
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
    .limit(Math.min(remaining, opts.batchSize ?? 10));

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
        for (const d of extracted.discounts) {
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
            status: "DRAFT",
            sourceType: "OCR_APPROVED",
            sourceOcrJobId: job.id,
          });
          draftsCreated += 1;
        }

        for (const ev of extracted.events) {
          await db.insert(deals).values({
            showId: job.showId,
            channelName: job.sourceChannel,
            dealType: ev.dealType,
            seatGrade: "ALL",
            isUnconditional: 1,
            conditionSummary: ev.conditionSummary,
            eventDatesJson: ev.eventDates.length ? JSON.stringify(ev.eventDates) : null,
            perkSummary: ev.perkSummary,
            externalUrl: job.sourcePageUrl,
            status: "DRAFT",
            sourceType: "OCR_APPROVED",
            sourceOcrJobId: job.id,
          });
          draftsCreated += 1;
        }
      }

      processed += 1;
    } catch (err) {
      await db
        .update(ocrImageJobs)
        .set({
          ocrStatus: "FAILED",
          errorMessage: err instanceof Error ? err.message : String(err),
          updatedAt: new Date().toISOString(),
        })
        .where(eq(ocrImageJobs.id, job.id));
    }
  }

  return { processed, draftsCreated, skippedByLimit: false };
}
