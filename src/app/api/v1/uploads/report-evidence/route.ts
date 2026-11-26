import { AppError, jsonError } from "@/lib/errors";
import { getAuthEnv, requireRuntimeAuth } from "@/server/modules/auth-runtime";

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export async function POST(req: Request) {
  try {
    const user = await requireRuntimeAuth(req);
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

    const bucket = getAuthEnv().EVIDENCE_BUCKET;
    if (!bucket) {
      throw new AppError("VALIDATION_ERROR", "현재 증빙 이미지 업로드를 지원하지 않아요. 원문 예매처 링크로 제보해 주세요.");
    }

    const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
    const r2Key = `reports/${user.id}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
    await bucket.put(r2Key, await file.arrayBuffer(), {
      httpMetadata: { contentType: file.type },
    });

    return Response.json({ data: { evidenceR2Key: r2Key, size: file.size } }, { status: 201 });
  } catch (err) {
    return jsonError(err);
  }
}
