import { ConvexError, v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { mutation, query } from "./_generated/server";
import { getViewerUser } from "./identity";
import { requireAdmin } from "./lib/adminAccess";
import { checkRateLimit } from "./lib/authRateLimit";
import { normalizeWaitlistEmail } from "./lib/earlyAccess";
import { isFlagOn } from "./lib/flagState";
import { formatCr } from "./lib/r2";
import type { RateLimitOperation } from "./lib/authRateLimit";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";

// The early-access list (V1 amendment A6). While checkout is off, a shopper leaves an email under
// "Buying opens soon" on a shop page. Nobody is emailed yet; admin exports the list.

async function limit(ctx: MutationCtx, operation: RateLimitOperation, identifier: string) {
  try {
    await checkRateLimit(ctx, operation, identifier);
  } catch {
    throw new ConvexError({ code: "RATE_LIMITED", message: "That’s a lot of tries. Give it a few minutes." });
  }
}

async function findEntry(ctx: MutationCtx, emailLower: string, workId: Id<"works">) {
  return await ctx.db
    .query("waitlist")
    .withIndex("by_email_kind_work", (q) => q.eq("emailLower", emailLower).eq("kind", "buy").eq("workId", workId))
    .first();
}

// Joins the list for one work. Signed-in members can skip the email and use their account's.
// Joining again returns the same answer, so a double tap or a second visit is harmless.
export const join = mutation({
  args: { workId: v.id("works"), email: v.optional(v.string()) },
  returns: v.object({ ok: v.literal(true) }),
  handler: async (ctx, args) => {
    const viewer = await getViewerUser(ctx);
    const raw = args.email?.trim() ? args.email : viewer?.email;
    if (!raw) throw new ConvexError({ code: "INVALID_EMAIL", message: "Add your email." });
    const email = normalizeWaitlistEmail(raw);
    if (!email.ok) throw new ConvexError({ code: "INVALID_EMAIL", message: email.message });

    const work = await ctx.db.get("works", args.workId);
    if (!work || work.status !== "published") {
      throw new ConvexError({ code: "NOT_FOUND", message: "This design isn’t published." });
    }
    if (await isFlagOn(ctx, "commerce.checkout")) {
      throw new ConvexError({ code: "CHECKOUT_OPEN", message: "Buying is open. Grab it now." });
    }

    await limit(ctx, "waitlist:join", `email:${email.emailLower}`);
    if (viewer) await limit(ctx, "waitlist:join", `user:${viewer._id}`);
    else await limit(ctx, "waitlist:visitor_work", `work:${work._id}`);

    if (await findEntry(ctx, email.emailLower, work._id)) return { ok: true as const };
    const now = Date.now();
    await ctx.db.insert("waitlist", {
      emailLower: email.emailLower,
      kind: "buy",
      workId: work._id,
      userId: viewer?._id,
      createdAt: now,
    });
    const total = await ctx.db
      .query("waitlistTotals")
      .withIndex("by_kind_work", (q) => q.eq("kind", "buy").eq("workId", work._id))
      .unique();
    if (total) await ctx.db.patch("waitlistTotals", total._id, { count: total.count + 1, updatedAt: now });
    else await ctx.db.insert("waitlistTotals", { kind: "buy", workId: work._id, count: 1, updatedAt: now });
    return { ok: true as const };
  },
});

// What the shop page shows under "Buying opens soon". Works signed out; it never returns an
// email, only whether the viewer has one on file and has already joined.
export const status = query({
  args: { workId: v.id("works") },
  returns: v.object({ open: v.boolean(), signedIn: v.boolean(), hasEmail: v.boolean(), joined: v.boolean() }),
  handler: async (ctx, args) => {
    const open = !(await isFlagOn(ctx, "commerce.checkout"));
    const viewer = await getViewerUser(ctx);
    const email = viewer?.email ? normalizeWaitlistEmail(viewer.email) : null;
    let joined = false;
    if (email?.ok) {
      const entry = await ctx.db
        .query("waitlist")
        .withIndex("by_email_kind_work", (q) =>
          q.eq("emailLower", email.emailLower).eq("kind", "buy").eq("workId", args.workId),
        )
        .first();
      joined = entry !== null;
    }
    return { open, signedIn: viewer !== null, hasEmail: email?.ok === true, joined };
  },
});

const TOTALS_SHOWN = 100;

// Sign-ups per work, most first, for /admin/waitlist. Any admin can see the counts.
export const adminTotals = query({
  args: {},
  returns: v.object({
    total: v.number(),
    works: v.array(
      v.object({ workId: v.id("works"), cr: v.string(), title: v.optional(v.string()), count: v.number() }),
    ),
  }),
  handler: async (ctx) => {
    await requireAdmin(ctx, "view");
    const rows = await ctx.db
      .query("waitlistTotals")
      .withIndex("by_kind_count", (q) => q.eq("kind", "buy"))
      .order("desc")
      .take(TOTALS_SHOWN);
    const works = [];
    let total = 0;
    for (const row of rows) {
      total += row.count;
      if (!row.workId || row.count === 0) continue;
      const work = await ctx.db.get("works", row.workId);
      if (!work) continue;
      works.push({ workId: work._id, cr: formatCr(work.crFamily, work.crExpression), title: work.title, count: row.count });
    }
    return { total, works };
  },
});

// One page of the list, newest first, for the CSV export. Emails are only for ops and the owner.
export const adminExportPage = query({
  args: { paginationOpts: paginationOptsValidator },
  returns: v.object({
    page: v.array(
      v.object({
        email: v.string(),
        cr: v.optional(v.string()),
        title: v.optional(v.string()),
        member: v.boolean(),
        joinedAt: v.number(),
      }),
    ),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    await requireAdmin(ctx, "manage");
    const result = await ctx.db
      .query("waitlist")
      .withIndex("by_kind_created", (q) => q.eq("kind", "buy"))
      .order("desc")
      .paginate(args.paginationOpts);
    const page = [];
    for (const entry of result.page) {
      const work = entry.workId ? await ctx.db.get("works", entry.workId) : null;
      page.push({
        email: entry.emailLower,
        cr: work ? formatCr(work.crFamily, work.crExpression) : undefined,
        title: work?.title,
        member: entry.userId !== undefined,
        joinedAt: entry.createdAt,
      });
    }
    return { page, isDone: result.isDone, continueCursor: result.continueCursor };
  },
});
