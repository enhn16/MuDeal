import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { getRuntimeDb } from "@/db/client";
import { userNotifications } from "@/db/schema";
import { AppError, jsonError } from "@/lib/errors";
import { ACCESS_COOKIE, REFRESH_COOKIE, buildSetCookie } from "@/server/modules/auth";
import { getAuthEnv, requireRuntimeAuth } from "@/server/modules/auth-runtime";
import { updateNickname, withdrawUserAccount } from "@/server/modules/personal";

export async function GET(req: Request) {
  try {
    const db = getRuntimeDb();
    const user = await requireRuntimeAuth(req);
    const [row] = await db
      .select({ count: sql<number>`count(*)` })
      .from(userNotifications)
      .where(and(eq(userNotifications.userId, user.id), eq(userNotifications.isRead, 0)));

    return Response.json({ data: { user, unreadCount: Number(row?.count ?? 0) } });
  } catch (err) {
    return jsonError(err);
  }
}

const PatchSchema = z.object({ nickname: z.string().trim().min(1).max(20) });

export async function PATCH(req: Request) {
  try {
    const db = getRuntimeDb();
    const user = await requireRuntimeAuth(req);
    const parsed = PatchSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new AppError("VALIDATION_ERROR", "닉네임은 1~20자로 입력해 주세요.");
    const data = await updateNickname(db, user.id, parsed.data.nickname);
    return Response.json({ data });
  } catch (err) {
    return jsonError(err);
  }
}

export async function DELETE(req: Request) {
  try {
    const db = getRuntimeDb();
    const user = await requireRuntimeAuth(req);
    await withdrawUserAccount(db, user.id, new Date(), {
      evidenceBucket: getAuthEnv().EVIDENCE_BUCKET,
    });

    const isSecure = new URL(req.url).protocol === "https:";
    const headers = new Headers({ "Content-Type": "application/json" });
    headers.append("Set-Cookie", buildSetCookie(ACCESS_COOKIE, "", { maxAge: 0, isSecure }));
    headers.append("Set-Cookie", buildSetCookie(REFRESH_COOKIE, "", { maxAge: 0, isSecure }));
    return new Response(JSON.stringify({ data: { withdrawn: true } }), { status: 200, headers });
  } catch (err) {
    return jsonError(err);
  }
}
