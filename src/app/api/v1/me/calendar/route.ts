import { z } from "zod";
import { getRuntimeDb } from "@/db/client";
import { AppError, jsonError } from "@/lib/errors";
import { formatKstDate } from "@/lib/kst";
import { requireRuntimeAuth } from "@/server/modules/auth-runtime";
import { createCalendarEvent, getMyCalendar } from "@/server/modules/personal";

const CreateSchema = z.object({
  eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  eventTime: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  category: z.enum(["WATCH", "TICKETING", "EVENT", "CUSTOM"]).default("CUSTOM"),
  title: z.string().trim().min(1).max(80),
  memo: z.string().trim().max(200).nullable().optional(),
  sourceShowId: z.number().int().positive().nullable().optional(),
  sourceDealId: z.number().int().positive().nullable().optional(),
});

export async function GET(req: Request) {
  try {
    const db = getRuntimeDb();
    const user = await requireRuntimeAuth(req);
    const sp = new URL(req.url).searchParams;
    const today = formatKstDate();
    const ym = today.slice(0, 7);
    const from = /^\d{4}-\d{2}-\d{2}$/.test(sp.get("from") ?? "") ? sp.get("from")! : `${ym}-01`;
    const to = /^\d{4}-\d{2}-\d{2}$/.test(sp.get("to") ?? "") ? sp.get("to")! : `${ym}-31`;
    const data = await getMyCalendar(db, user.id, from, to);
    return Response.json({ data });
  } catch (err) {
    return jsonError(err);
  }
}

export async function POST(req: Request) {
  try {
    const db = getRuntimeDb();
    const user = await requireRuntimeAuth(req);
    const parsed = CreateSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      throw new AppError("VALIDATION_ERROR", "날짜(YYYY-MM-DD)와 일정 제목을 확인해 주세요.", parsed.error.flatten());
    }
    const created = await createCalendarEvent(db, user.id, parsed.data);
    return Response.json({ data: created }, { status: 201 });
  } catch (err) {
    return jsonError(err);
  }
}
