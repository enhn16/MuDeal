import type { MetadataRoute } from "next";

const SITE_URL = "https://mudeal.kr";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/admin/", "/api/", "/my", "/reports/"],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
