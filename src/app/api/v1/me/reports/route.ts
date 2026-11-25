import { getRuntimeDb } from "@/db/client";
import { jsonError } from "@/lib/errors";
import { requireRuntimeAuth } from "@/server/modules/auth-runtime";
import { getMyReportsSummary } from "@/server/modules/personal";

export async function GET(req: Request) {
  try {
    const db = getRuntimeDb();
    const user = await requireRuntimeAuth(req);
    const data = await getMyReportsSummary(db, user.id);
    return Response.json({ data });
  } catch (err) {
    return jsonError(err);
  }
}
