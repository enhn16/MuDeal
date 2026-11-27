import { AppError, jsonError } from "@/lib/errors";
import { getAuthEnv, requireRuntimeAdmin } from "@/server/modules/auth-runtime";

const ALLOWED_RESPONSE_MIMES = new Set(["image/jpeg", "image/png", "image/webp"]);

function resolveSafeEvidenceMime(rawContentType: string | undefined, key: string): string {
  const normalized = rawContentType?.split(";")[0]?.trim().toLowerCase() ?? "";
  if (ALLOWED_RESPONSE_MIMES.has(normalized)) return normalized;
  const lowerKey = key.toLowerCase();
  if (lowerKey.endsWith(".png")) return "image/png";
  if (lowerKey.endsWith(".webp")) return "image/webp";
  if (lowerKey.endsWith(".jpg") || lowerKey.endsWith(".jpeg")) return "image/jpeg";
  return "application/octet-stream";
}

/** Admin-only R2 evidence image viewer with strict prefix & path-traversal guard. */
export async function GET(req: Request) {
  try {
    await requireRuntimeAdmin(req);
    const key = new URL(req.url).searchParams.get("key")?.trim() ?? "";
    if (!key || !key.startsWith("reports/") || key.includes("..") || key.includes("\\")) {
      throw new AppError("VALIDATION_ERROR", "올바르지 않은 증빙 파일 경로입니다.");
    }

    const bucket = getAuthEnv().EVIDENCE_BUCKET;
    if (!bucket) {
      throw new AppError("NOT_FOUND", "증빙 이미지 스토리지가 비활성화되어 있습니다.");
    }
    const obj = await bucket.get(key);
    if (!obj) {
      throw new AppError("NOT_FOUND", "증빙 이미지를 찾을 수 없습니다.");
    }

    const headers = new Headers();
    headers.set("Content-Type", resolveSafeEvidenceMime(obj.httpMetadata?.contentType, key));
    headers.set("Cache-Control", "private, max-age=300");
    headers.set("Content-Security-Policy", "sandbox");
    headers.set("X-Content-Type-Options", "nosniff");
    return new Response(obj.body, { status: 200, headers });
  } catch (err) {
    return jsonError(err);
  }
}
