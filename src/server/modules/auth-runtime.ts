import { env } from "cloudflare:workers";
import { and, eq, sql } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { getRuntimeDb } from "@/db/client";
import { userNotifications } from "@/db/schema";
import type { CloudflareEnv } from "@/env";
import {
  ACCESS_COOKIE,
  canUseLocalDevAuth,
  getJwtSecret,
  getOptionalAuthUser,
  isLocalhostHost,
  isLocalhostOrigin,
  requireAdmin,
  requireAuth,
  type AuthUser,
} from "./auth";

export function getAuthEnv(): CloudflareEnv {
  return env as unknown as CloudflareEnv;
}

export function getRuntimeJwtSecret(req: Request): string {
  const cfEnv = getAuthEnv();
  return getJwtSecret(cfEnv, {
    allowDevFallback: canUseLocalDevAuth(cfEnv, isLocalhostOrigin(new URL(req.url))),
  });
}

export async function getServerJwtSecret(): Promise<string> {
  const cfEnv = getAuthEnv();
  const h = await headers();
  return getJwtSecret(cfEnv, {
    allowDevFallback: canUseLocalDevAuth(cfEnv, isLocalhostHost(h.get("host"))),
  });
}

export async function requireRuntimeAuth(req: Request): Promise<AuthUser> {
  return requireAuth(getRuntimeDb(), req, getRuntimeJwtSecret(req));
}

export async function requireRuntimeAdmin(req: Request): Promise<AuthUser> {
  return requireAdmin(getRuntimeDb(), req, getRuntimeJwtSecret(req));
}

/** Server Component helper to read current logged-in user + unread notification count. */
export async function getServerSession(): Promise<{ user: AuthUser; unreadCount: number } | null> {
  try {
    const store = await cookies();
    const token = store.get(ACCESS_COOKIE)?.value;
    if (!token) return null;
    const db = getRuntimeDb();
    const user = await getOptionalAuthUser(db, token, await getServerJwtSecret());
    if (!user) return null;

    const [row] = await db
      .select({ count: sql<number>`count(*)` })
      .from(userNotifications)
      .where(and(eq(userNotifications.userId, user.id), eq(userNotifications.isRead, 0)));

    return { user, unreadCount: Number(row?.count ?? 0) };
  } catch {
    return null;
  }
}
