import { getRuntimeDb } from "@/db/client";
import { jsonError } from "@/lib/errors";
import { requireRuntimeAdmin } from "@/server/modules/auth-runtime";
import { listAdminIssues } from "@/server/modules/admin";

export async function GET(req: Request) {
  try {
    await requireRuntimeAdmin(req);
    const items = await listAdminIssues(getRuntimeDb());
    return Response.json({ data: { items } });
  } catch (err) {
    return jsonError(err);
  }
}
