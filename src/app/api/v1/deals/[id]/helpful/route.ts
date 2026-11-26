import { getRuntimeDb } from "@/db/client";
import { AppError, jsonError } from "@/lib/errors";
import { ACCESS_COOKIE, getOptionalAuthUser, parseCookieHeader } from "@/server/modules/auth";
import { getRuntimeJwtSecret } from "@/server/modules/auth-runtime";
import { hashSessionIdentity, voteDealHelpful } from "@/server/modules/deals";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const dealId = Number(id);
    if (!Number.isInteger(dealId) || dealId <= 0) {
      throw new AppError("VALIDATION_ERROR", "유효하지 않은 딜 ID입니다.");
    }
    const db = getRuntimeDb();
    const bag = parseCookieHeader(req.headers.get("cookie"));
    const user = await getOptionalAuthUser(db, bag[ACCESS_COOKIE], getRuntimeJwtSecret(req));
    const sessionHash = await hashSessionIdentity(req);
    const data = await voteDealHelpful(db, dealId, { userId: user?.id, sessionHash });
    return Response.json({ data });
  } catch (err) {
    return jsonError(err);
  }
}
