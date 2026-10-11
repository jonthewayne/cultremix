import { describe, expect, it } from "vitest";
import { ROBOTS_TXT, sitemapXml } from "../../src/lib/sitemap";

describe("sitemap and robots", () => {
  it("lists the public pages, works, families, and creators with escaped addresses", () => {
    const xml = sitemapXml({
      works: [{ cr: "101-001", publishedAt: Date.UTC(2026, 9, 1) }],
      families: [{ family: 101, lastAt: Date.UTC(2026, 9, 1) }],
      creators: [{ username: "sam&co" }],
    });
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain("<loc>https://cultremix.com/</loc>");
    expect(xml).toContain("<loc>https://cultremix.com/policies/returns</loc>");
    expect(xml).toContain("<url><loc>https://cultremix.com/cr/101-001</loc><lastmod>2026-10-01</lastmod></url>");
    expect(xml).toContain("<loc>https://cultremix.com/family/101</loc>");
    expect(xml).toContain("<loc>https://cultremix.com/u/sam%26co</loc>");
  });

  it("still lists the fixed pages when the list couldn't be read", () => {
    const xml = sitemapXml(null);
    expect(xml).toContain("<loc>https://cultremix.com/onchain</loc>");
    expect(xml).not.toContain("/cr/");
  });

  it("keeps members' pages and admin out of search and points to the sitemap", () => {
    for (const path of ["/admin", "/studio", "/keep/", "/print/", "/me/"]) expect(ROBOTS_TXT).toContain(`Disallow: ${path}`);
    expect(ROBOTS_TXT).not.toMatch(/Disallow: \/cr\b/u);
    expect(ROBOTS_TXT).toContain("Sitemap: https://cultremix.com/sitemap.xml");
  });
});

