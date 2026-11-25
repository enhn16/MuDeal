import { desc } from "drizzle-orm";
import { getRuntimeDb } from "@/db/client";
import { syncRuns } from "@/db/schema";
import { jsonError } from "@/lib/errors";
import { requireRuntimeAdmin } from "@/server/modules/auth-runtime";
import { hasConsecutiveFailureAlert } from "@/server/sync/channels";

export async function GET(req: Request) {
  try {
    await requireRuntimeAdmin(req);
    const db = getRuntimeDb();
    const runs = await db.select().from(syncRuns).orderBy(desc(syncRuns.startedAt)).limit(30);
    const sources = Array.from(new Set(runs.map((r) => r.sourceName)));
    const alerts: Record<string, boolean> = {};
    for (const s of sources) alerts[s] = await hasConsecutiveFailureAlert(db, s);
    return Response.json({ data: { runs, alerts } });
  } catch (err) {
    return jsonError(err);
  }
}
