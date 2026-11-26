import type { MetadataRoute } from "next";
import { desc, or, eq } from "drizzle-orm";
import { getRuntimeDb } from "@/db/client";
import { actors, shows } from "@/db/schema";

export const dynamic = "force-dynamic";

const SITE_URL = "https://mudeal.kr";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticUrls: MetadataRoute.Sitemap = [
    { url: SITE_URL, changeFrequency: "hourly", priority: 1.0 },
    { url: `${SITE_URL}/search`, changeFrequency: "hourly", priority: 0.9 },
    { url: `${SITE_URL}/terms`, changeFrequency: "monthly", priority: 0.2 },
    { url: `${SITE_URL}/privacy`, changeFrequency: "monthly", priority: 0.2 },
  ];

  try {
    const db = getRuntimeDb();
    const [activeShows, topActors] = await Promise.all([
      db
        .select({ id: shows.id, updatedAt: shows.updatedAt })
        .from(shows)
        .where(or(eq(shows.status, "ONGOING"), eq(shows.status, "UPCOMING")))
        .limit(500),
      db
        .select({ id: actors.id, updatedAt: actors.updatedAt })
        .from(actors)
        .orderBy(desc(actors.followerCount))
        .limit(300),
    ]);

    return [
      ...staticUrls,
      ...activeShows.map((s) => ({
        url: `${SITE_URL}/shows/${s.id}`,
        lastModified: s.updatedAt,
        changeFrequency: "daily" as const,
        priority: 0.8,
      })),
      ...topActors.map((a) => ({
        url: `${SITE_URL}/actors/${a.id}`,
        lastModified: a.updatedAt,
        changeFrequency: "weekly" as const,
        priority: 0.6,
      })),
    ];
  } catch {
    return staticUrls;
  }
}
