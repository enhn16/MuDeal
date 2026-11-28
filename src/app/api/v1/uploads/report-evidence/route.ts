import { and, eq, gte, sql } from "drizzle-orm";
import { getRuntimeDb } from "@/db/client";
import { dealReports } from "@/db/schema";
import { AppError, jsonError } from "@/lib/errors";
import { startOfKstDayUtc } from "@/lib/kst";
import { getAuthEnv, requireRuntimeAuth } from "@/server/modules/auth-runtime";
import { DAILY_REPORT_LIMIT, detectAllowedImageMagic } from "@/server/modules/reports";

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_MULTIPART_BYTES = MAX_BYTES + 65_536;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export async function POST(req: Request) {
  try {
    const user = await requireRuntimeAuth(req);
    const bucket = getAuthEnv().EVIDENCE_BUCKET;
    if (!bucket) {
      throw new AppError("VALIDATION_ERROR", "현재 증빙 이미지 업로드를 지원하지 않아요. 원문 예매처 링크로 제보해 주세요.");
    }

    const rawContentLength = req.headers.get("content-length");
    if (rawContentLength !== null) {
      const trimmedLen = rawContentLength.trim();
      const contentLength = /^\d+$/.test(trimmedLen) ? Number(trimmedLen) : Number.NaN;
      if (!Number.isSafeInteger(contentLength) || contentLength > MAX_MULTIPART_BYTES) {
        throw new AppError("VALIDATION_ERROR", "이미지 파일은 최대 5MB까지 업로드할 수 있습니다.");
      }
    }

    const db = getRuntimeDb();
    const kstStart = startOfKstDayUtc();
    const [countRow] = await db
      .select({ count: sql<number>`count(*)` })
      .from(dealReports)
      .where(and(eq(dealReports.reporterId, user.id), gte(dealReports.createdAt, kstStart)));

    if (Number(countRow?.count ?? 0) >= DAILY_REPORT_LIMIT) {
      throw new AppError(
        "DAILY_REPORT_LIMIT_EXCEEDED",
        `하루 최대 ${DAILY_REPORT_LIMIT}건까지 제보 및 증빙 업로드가 가능합니다.`,
      );
    }

    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) {
      throw new AppError("VALIDATION_ERROR", "업로드할 이미지 파일이 필요합니다.");
    }
    if (!ALLOWED_TYPES.has(file.type)) {
      throw new AppError("VALIDATION_ERROR", "JPG, PNG, WebP 이미지 형식만 업로드할 수 있습니다.");
    }
    if (file.size <= 0 || file.size > MAX_BYTES) {
      throw new AppError("VALIDATION_ERROR", "이미지 파일은 최대 5MB까지 업로드할 수 있습니다.");
    }

    const arrayBuffer = await file.arrayBuffer();
    if (arrayBuffer.byteLength <= 0 || arrayBuffer.byteLength > MAX_BYTES) {
      throw new AppError("VALIDATION_ERROR", "이미지 파일은 최대 5MB까지 업로드할 수 있습니다.");
    }

    const detected = detectAllowedImageMagic(new Uint8Array(arrayBuffer.slice(0, 12)));
    if (!detected) {
      throw new AppError("VALIDATION_ERROR", "실제 JPG, PNG, WebP 이미지 파일만 업로드할 수 있습니다.");
    }

    const r2Key = `reports/${user.id}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${detected.ext}`;
    await bucket.put(r2Key, arrayBuffer, {
      httpMetadata: { contentType: detected.mime },
    });

    return Response.json({ data: { evidenceR2Key: r2Key, size: arrayBuffer.byteLength } }, { status: 201 });
  } catch (err) {
    return jsonError(err);
  }
}
