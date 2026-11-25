import { getRuntimeDb } from "@/db/client";
import { jsonError } from "@/lib/errors";
import {
  REFRESH_COOKIE,
  clearAuthCookies,
  parseCookieHeader,
  revokeRefreshSession,
} from "@/server/modules/auth";

export async function POST(req: Request) {
  try {
    const isSecure = new URL(req.url).protocol === "https:";
    const bag = parseCookieHeader(req.headers.get("cookie"));
    await revokeRefreshSession(getRuntimeDb(), bag[REFRESH_COOKIE]);
    const headers = new Headers();
    clearAuthCookies(headers, isSecure);
    return Response.json({ data: { loggedOut: true } }, { headers });
  } catch (err) {
    return jsonError(err);
  }
}
