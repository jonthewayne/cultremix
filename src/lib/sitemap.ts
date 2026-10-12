import { POLICIES } from "./policies";
import { SITE_URL } from "./site";

// /sitemap.xml and /robots.txt (src/routes/sitemap[.]xml.tsx, robots[.]txt.tsx).

export type SitemapEntries = {
  works: Array<{ cr: string; publishedAt?: number }>;
  families: Array<{ family: number; lastAt?: number }>;
  creators: Array<{ username: string; lastAt?: number }>;
};

const escapeXml = (text: string) =>
  text.replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;").replace(/"/gu, "&quot;").replace(/'/gu, "&apos;");

function url(path: string, lastAt?: number) {
  const lastmod = lastAt ? `<lastmod>${new Date(lastAt).toISOString().slice(0, 10)}</lastmod>` : "";
  return `<url><loc>${escapeXml(`${SITE_URL}${path}`)}</loc>${lastmod}</url>`;
}

export function sitemapXml(entries: SitemapEntries | null) {
  const lines = [
    url("/"),
    url("/how-it-works"),
    url("/onchain"),
    ...POLICIES.map((policy) => url(`/policies/${policy.slug}`)),
    ...(entries?.works ?? []).map((work) => url(`/cr/${encodeURIComponent(work.cr)}`, work.publishedAt)),
    ...(entries?.families ?? []).map((family) => url(`/family/${family.family}`, family.lastAt)),
    ...(entries?.creators ?? []).map((creator) => url(`/u/${encodeURIComponent(creator.username)}`, creator.lastAt)),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${lines.join("\n")}\n</urlset>\n`;
}

// Members' pages, the studio, and admin stay out of search results.
export const ROBOTS_TXT = [
  "User-agent: *",
  "Disallow: /admin",
  "Disallow: /studio",
  "Disallow: /settings",
  "Disallow: /onboarding",
  "Disallow: /notifications",
  "Disallow: /dashboard",
  "Disallow: /team",
  "Disallow: /print/",
  "Disallow: /keep/",
  "Disallow: /me/",
  "Disallow: /api/",
  "Disallow: /login",
  "Disallow: /verify-email",
  "Disallow: /verify-phone",
  "",
  `Sitemap: ${SITE_URL}/sitemap.xml`,
  "",
].join("\n");
