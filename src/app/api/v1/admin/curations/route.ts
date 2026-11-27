import { asc } from "drizzle-orm";
import { z } from "zod";
import { getRuntimeDb } from "@/db/client";
import { homeCurations } from "@/db/schema";
import { AppError, jsonError } from "@/lib/errors";
import { validateCurationImageUrl, validateCurationLinkUrl } from "@/server/modules/admin";
import { requireRuntimeAdmin } from "@/server/modules/auth-runtime";
import { writeAuditLog } from "@/server/modules/reports";

const CreateCurationSchema = z.object({
  slotType: z.enum(["HERO", "SPOTLIGHT"]).default("HERO"),
  showId: z.number().int().positive().nullable().optional(),
  eyebrow: z.string().trim().max(40).nullable().optional(),
  title: z.string().trim().min(1).max(80),
  subtitle: z.string().trim().max(120).nullable().optional(),
  imageUrl: z.string().trim().max(500).nullable().optional(),
  linkUrl: z.string().trim().min(1).max(300),
  sortOrder: z.number().int().min(0).default(0),
});

export async function GET(req: Request) {
  try {
    await requireRuntimeAdmin(req);
    const items = await getRuntimeDb()
      .select()
      .from(homeCurations)
      .orderBy(asc(homeCurations.slotType), asc(homeCurations.sortOrder));
    return Response.json({ data: { items } });
  } catch (err) {
    return jsonError(err);
  }
}

export async function POST(req: Request) {
  try {
    const admin = await requireRuntimeAdmin(req);
    const parsed = CreateCurationSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new AppError("VALIDATION_ERROR", "배너 큐레이션 입력값을 확인해 주세요.");
    const safeLinkUrl = validateCurationLinkUrl(parsed.data.linkUrl);
    const safeImageUrl = validateCurationImageUrl(parsed.data.imageUrl);
    const db = getRuntimeDb();
    const [created] = await db
      .insert(homeCurations)
      .values({
        slotType: parsed.data.slotType,
        showId: parsed.data.showId ?? null,
        eyebrow: parsed.data.eyebrow || null,
        title: parsed.data.title,
        subtitle: parsed.data.subtitle || null,
        imageUrl: safeImageUrl,
        linkUrl: safeLinkUrl,
        sortOrder: parsed.data.sortOrder,
        isActive: 1,
      })
      .returning();

    await writeAuditLog(db, admin.id, "CURATION_CREATED", "home_curation", created.id);
    return Response.json({ data: created }, { status: 201 });
  } catch (err) {
    return jsonError(err);
  }
}
