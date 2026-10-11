import { ConvexError, v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { internal } from "./_generated/api";
import { internalAction, internalMutation, mutation, query } from "./_generated/server";
import { sendEmail } from "./email";
import { getViewerUser } from "./identity";
import { waitlistEmailContent } from "./lib/waitlistEmail";
import { onSaleNow } from "./shopify";
import { requireAdmin } from "./lib/adminAccess";
import { checkRateLimit } from "./lib/authRateLimit";
import { normalizeWaitlistEmail } from "./lib/earlyAccess";
import { isFlagOn } from "./lib/flagState";
import { formatCr } from "./lib/r2";
import type { RateLimitOperation } from "./lib/authRateLimit";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

// The early-access list (V1 amendment A6). While checkout is off, a shopper leaves an email under
// "Buying opens soon" on a shop page, which promises one note when buying opens. Once Checkout is
// on, an admin presses Email them (emailOpen): each person waiting on a design that can be bought
// gets one email naming all such designs. It's a press rather than automatic because the launch
// turns Checkout on for a test order and may turn it off again; a note then would be wrong.

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

// ---- The one email: "you can buy it now" ----

// People emailed per run of Email them; a longer list goes on in the next run, a second later.
const EMAILS_PER_RUN = 50;
// Designs with sign-ups looked at, most wanted first.
const WORKS_SCANNED = 200;

// The designs with sign-ups, most wanted first, and whether each is on sale now.
async function waitlistWorks(ctx: QueryCtx) {
  const rows = await ctx.db
    .query("waitlistTotals")
    .withIndex("by_kind_count", (q) => q.eq("kind", "buy"))
    .order("desc")
    .take(WORKS_SCANNED);
  const out: Array<{ work: Doc<"works">; onSale: boolean }> = [];
  for (const row of rows) {
    if (!row.workId || row.count === 0) continue;
    const work = await ctx.db.get("works", row.workId);
    if (work) out.push({ work, onSale: await onSaleNow(ctx, work) });
  }
  return out;
}

function waiting(ctx: QueryCtx, workId: Id<"works">) {
  return ctx.db.query("waitlist").withIndex("by_work_notified", (q) => q.eq("workId", workId).eq("notifiedAt", undefined));
}

// Emails up to EMAILS_PER_RUN people: each person's waiting entries on designs on sale are marked
// in the same transaction that schedules their email, so nobody hears twice.
async function emailRun(ctx: MutationCtx) {
  const works = (await waitlistWorks(ctx)).filter((entry) => entry.onSale).map((entry) => entry.work);
  const onSale = new Map(works.map((work) => [work._id, work]));
  const now = Date.now();
  let sent = 0;
  for (const work of works) {
    for (;;) {
      const entry = await waiting(ctx, work._id).first();
      if (!entry) break;
      if (sent >= EMAILS_PER_RUN) return { sent, more: true };
      // Everything this address waits on that can be bought now, in one email.
      const theirs = await ctx.db
        .query("waitlist")
        .withIndex("by_email_kind_work", (q) => q.eq("emailLower", entry.emailLower).eq("kind", "buy"))
        .take(100);
      const ready = theirs.filter((row) => row.notifiedAt === undefined && row.workId && onSale.has(row.workId));
      if (!ready.some((row) => row._id === entry._id)) ready.push(entry);
      const designs = [];
      for (const row of ready) {
        await ctx.db.patch("waitlist", row._id, { notifiedAt: now });
        const design = onSale.get(row.workId!);
        if (design) designs.push({ title: design.title, cr: formatCr(design.crFamily, design.crExpression) });
      }
      await ctx.scheduler.runAfter(0, internal.waitlist.sendNote, { to: entry.emailLower, designs });
      sent++;
    }
  }
  return { sent, more: false };
}

// Email them, in Admin, Waitlist (ops and the owner), once Checkout is on.
export const emailOpen = mutation({
  args: {},
  returns: v.object({ sent: v.number(), more: v.boolean() }),
  handler: async (ctx) => {
    await requireAdmin(ctx, "manage");
    if (!(await isFlagOn(ctx, "commerce.checkout"))) {
      throw new ConvexError({ code: "CHECKOUT_CLOSED", message: "Turn Checkout on first: the email says buying is open." });
    }
    const result = await emailRun(ctx);
    if (result.more) await ctx.scheduler.runAfter(1000, internal.waitlist.emailMore, {});
    return result;
  },
});

export const emailMore = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    if (!(await isFlagOn(ctx, "commerce.checkout"))) return null;
    const result = await emailRun(ctx);
    if (result.more) await ctx.scheduler.runAfter(1000, internal.waitlist.emailMore, {});
    return null;
  },
});

export const sendNote = internalAction({
  args: { to: v.string(), designs: v.array(v.object({ title: v.optional(v.string()), cr: v.string() })) },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (args.designs.length === 0) return null;
    const siteUrl = process.env.SITE_URL ?? "https://cultremix.com";
    await sendEmail(ctx, { to: args.to, ...waitlistEmailContent({ designs: args.designs, siteUrl }) });
    return null;
  },
});

// For Admin, Waitlist: who hears when Email them is pressed (people waiting on designs on sale,
// counted even while Checkout is off), who waits on designs not on sale yet, and who has heard.
export const emailSummary = query({
  args: {},
  returns: v.object({
    checkoutOpen: v.boolean(),
    readyPeople: v.number(),
    readyDesigns: v.number(),
    waiting: v.number(),
    notified: v.number(),
  }),
  handler: async (ctx) => {
    await requireAdmin(ctx, "view");
    const people = new Set<string>();
    let readyDesigns = 0;
    let stillWaiting = 0;
    let notified = 0;
    for (const { work, onSale } of await waitlistWorks(ctx)) {
      const pending = await waiting(ctx, work._id).take(1000);
      notified += (
        await ctx.db
          .query("waitlist")
          .withIndex("by_work_notified", (q) => q.eq("workId", work._id).gt("notifiedAt", 0))
          .take(1000)
      ).length;
      if (onSale && pending.length > 0) {
        readyDesigns++;
        for (const entry of pending) people.add(entry.emailLower);
      } else if (!onSale) {
        stillWaiting += pending.length;
      }
    }
    return {
      checkoutOpen: await isFlagOn(ctx, "commerce.checkout"),
      readyPeople: people.size,
      readyDesigns,
      waiting: stillWaiting,
      notified,
    };
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
