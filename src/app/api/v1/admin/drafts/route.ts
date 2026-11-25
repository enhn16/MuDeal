import { getRuntimeDb } from "@/db/client";
import { jsonError } from "@/lib/errors";
import { requireRuntimeAdmin } from "@/server/modules/auth-runtime";
import { listAdminReviewQueue } from "@/server/modules/admin";

export async function GET(req: Request) {
  try {
    await requireRuntimeAdmin(req);
    const data = await listAdminReviewQueue(getRuntimeDb());
    return Response.json({ data: { items: data.drafts } });
  } catch (err) {
    return jsonError(err);
  }
}
