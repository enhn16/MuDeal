import { getRuntimeDb } from "@/db/client";
import { jsonError } from "@/lib/errors";
import { listCommunityDeals } from "@/server/modules/shows";

export async function GET(req: Request) {
  try {
    const raw = new URL(req.url).searchParams.get("sort");
    const sort = raw === "clicks" || raw === "helpful" ? raw : "latest";
    const items = await listCommunityDeals(getRuntimeDb(), sort);
    return Response.json({ data: { items } });
  } catch (err) {
    return jsonError(err);
  }
}
