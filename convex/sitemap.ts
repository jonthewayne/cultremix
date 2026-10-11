import { v } from "convex/values";
import { query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { formatCr } from "./lib/r2";

// What /sitemap.xml lists (src/routes/sitemap[.]xml.tsx): the newest published works, their
// families, and their creators' profiles. Public facts only; kept designs never appear.
const MAX_WORKS = 2000;

export const entries = query({
  args: {},
  returns: v.object({
    works: v.array(v.object({ cr: v.string(), publishedAt: v.optional(v.number()) })),
    families: v.array(v.object({ family: v.number(), lastAt: v.optional(v.number()) })),
    creators: v.array(v.object({ username: v.string(), lastAt: v.optional(v.number()) })),
  }),
  handler: async (ctx) => {
    const works = await ctx.db
      .query("works")
      .withIndex("by_status_publishedAt", (q) => q.eq("status", "published"))
      .order("desc")
      .take(MAX_WORKS);
    const families = new Map<number, number | undefined>();
    const creatorLast = new Map<Id<"users">, number | undefined>();
    for (const work of works) {
      if (!families.has(work.crFamily)) families.set(work.crFamily, work.publishedAt);
      if (!creatorLast.has(work.creatorId)) creatorLast.set(work.creatorId, work.publishedAt);
    }
    const creators: Array<{ username: string; lastAt?: number }> = [];
    for (const [userId, lastAt] of creatorLast) {
      const user = await ctx.db.get("users", userId);
      if (user?.username) creators.push({ username: user.username, ...(lastAt ? { lastAt } : {}) });
    }
    return {
      works: works.map((work) => ({ cr: formatCr(work.crFamily, work.crExpression), ...(work.publishedAt ? { publishedAt: work.publishedAt } : {}) })),
      families: [...families].map(([family, lastAt]) => ({ family, ...(lastAt ? { lastAt } : {}) })),
      creators,
    };
  },
});

