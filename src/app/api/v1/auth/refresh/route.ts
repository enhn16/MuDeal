import { getRuntimeDb } from "@/db/client";
import { jsonError } from "@/lib/errors";
import {
  REFRESH_COOKIE,
  parseCookieHeader,
  rotateRefreshSession,
} from "@/server/modules/auth";
import { getRuntimeJwtSecret } from "@/server/modules/auth-runtime";

export async function POST(req: Request) {
  try {
    const isSecure = new URL(req.url).protocol === "https:";
    const bag = parseCookieHeader(req.headers.get("cookie"));
    const headers = new Headers();
    const user = await rotateRefreshSession(getRuntimeDb(), bag[REFRESH_COOKIE], headers, {
      secret: getRuntimeJwtSecret(req),
      isSecure,
    });
    return Response.json({ data: { user } }, { headers });
  } catch (err) {
    return jsonError(err);
  }
}
