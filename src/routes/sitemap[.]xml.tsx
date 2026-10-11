import { createFileRoute } from "@tanstack/react-router";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import { sitemapXml } from "~/lib/sitemap";
import type { SitemapEntries } from "~/lib/sitemap";

// /sitemap.xml: the home page, /onchain, the policies, and every published work, family, and creator.
export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async () => {
        let entries: SitemapEntries | null = null;
        const convexUrl = process.env.VITE_CONVEX_URL;
        if (convexUrl) entries = await new ConvexHttpClient(convexUrl).query(api.sitemap.entries, {}).catch(() => null);
        return new Response(sitemapXml(entries), {
          headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=3600" },
        });
      },
    },
  },
});

