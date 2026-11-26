import { AppError, jsonError } from "@/lib/errors";
import { getAuthEnv, requireRuntimeAdmin } from "@/server/modules/auth-runtime";

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
    headers.set("Content-Type", obj.httpMetadata?.contentType || "image/jpeg");
    headers.set("Cache-Control", "private, max-age=300");
    return new Response(obj.body, { status: 200, headers });
  } catch (err) {
    return jsonError(err);
  }
}
