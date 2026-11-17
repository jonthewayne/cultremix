import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, mutation, query } from "./_generated/server";
import { getViewerUser } from "./identity";
import { requireMember } from "./studio";
import { requireAdmin } from "./lib/adminAccess";
import { imageUrlReader } from "./lib/imageUrls";
import { formatCr, parseCr } from "./lib/r2";
import { setCreatorAccess } from "./lib/creators";
import { cleanArtistInputs, claimCode, slugBase } from "./lib/artistCredits";
import { redirectClaimedPayees } from "./earnings";
import type { ArtistCredits } from "./lib/economics";
import type { ArtistInput, CleanArtist } from "./lib/artistCredits";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

// Outside artists a design credits (docs/decisions.md, "Credit and a reserved share for outside
// artists"). A creator names up to three artists while publishing ("Inspired by"), or staff add or
// correct them later. Each credit comes out of that creator's own part of the creator pool
// (convex/lib/economics.ts, v5), is paid to the artist's hidden payee account and held there, and
// moves to the artist's own account once they claim the page and an admin approves it.

type Ctx = QueryCtx | MutationCtx;
type Role = keyof ArtistCredits;

const inputValidator = v.object({ name: v.string(), link: v.string() });
// Claims one member can have open at once.
const MAX_OPEN_CLAIMS = 5;

// ---- Creating artists and credits ----

async function uniqueSlug(ctx: MutationCtx, name: string) {
  const base = slugBase(name);
  for (let n = 1; n < 200; n++) {
    const slug = n === 1 ? base : `${base}-${n}`;
    const taken = await ctx.db.query("artists").withIndex("by_slug", (q) => q.eq("slug", slug)).first();
    if (!taken) return slug;
  }
  return `${base}-${Date.now()}`;
}

// The artist with this link, or a new one with its hidden payee account. The link decides who an
// artist is; the name is only how they're shown. So "J. Doe" and "Jane Doe" with the same link are
// one artist, a renamed page still matches its link, and a declined artist stays declined. Two
// artists with the same name but different links stay apart. Artists made before the link table
// are found by name and link once and then indexed.
async function artistFor(ctx: MutationCtx, input: CleanArtist, by: Id<"users">): Promise<Doc<"artists">> {
  const linked = await ctx.db.query("artistLinks").withIndex("by_key", (q) => q.eq("key", input.key)).first();
  const byLink = linked ? await ctx.db.get("artists", linked.artistId) : null;
  if (byLink) return byLink;
  const sameName = await ctx.db
    .query("artists")
    .withIndex("by_nameLower", (q) => q.eq("nameLower", input.name.toLowerCase()))
    .take(20);
  const match = sameName.find((artist) => artist.linkKeys.includes(input.key));
  if (match) {
    await ctx.db.insert("artistLinks", { key: input.key, artistId: match._id });
    return match;
  }
  const now = Date.now();
  // The payee never signs in and gets no wallet: walletStatus "ready" keeps the wallet cron away.
  const payeeId = await ctx.db.insert("users", { name: input.name, artistPayee: true, walletStatus: "ready" });
  const id = await ctx.db.insert("artists", {
    name: input.name,
    nameLower: input.name.toLowerCase(),
    slug: await uniqueSlug(ctx, input.name),
    links: [input.link],
    linkKeys: [input.key],
    status: "unclaimed",
    payeeId,
    createdBy: by,
    createdAt: now,
    updatedAt: now,
  });
  await ctx.db.insert("artistLinks", { key: input.key, artistId: id });
  return (await ctx.db.get("artists", id))!;
}

// Replaces a work's credits with these (an empty list removes them).
export async function setWorkCredits(
  ctx: MutationCtx,
  workId: Id<"works">,
  inputs: ReadonlyArray<ArtistInput>,
  by: Id<"users">,
  source: "creator" | "staff",
) {
  const cleaned = cleanArtistInputs(inputs);
  if (!cleaned.ok) throw new ConvexError({ code: "INVALID_INPUT", message: cleaned.message });
  const old = await ctx.db.query("artistCredits").withIndex("by_work", (q) => q.eq("workId", workId)).take(10);
  for (const row of old) await ctx.db.delete("artistCredits", row._id);
  const now = Date.now();
  for (const input of cleaned.artists) {
    const artist = await artistFor(ctx, input, by);
    await ctx.db.insert("artistCredits", { workId, artistId: artist._id, source, addedBy: by, createdAt: now });
  }
}

// ---- Which credits a sale pays, and which a page shows ----

async function familyRootOf(ctx: Ctx, work: Doc<"works">): Promise<Doc<"works"> | null> {
  if (work.familyRootId && work.familyRootId !== work._id) return await ctx.db.get("works", work.familyRootId);
  let current: Doc<"works"> | null = work;
  const seen = new Set<string>();
  for (let i = 0; i < 50 && current; i++) {
    if (seen.has(current._id)) return null;
    seen.add(current._id);
    if (current._id !== work._id && current.kind !== "variation") return current;
    if (!current.parentWorkId) return current._id === work._id ? null : current;
    current = await ctx.db.get("works", current.parentWorkId);
  }
  return null;
}

// The works whose creators a sale of this work pays, by role, as convex/lib/shopLineage.ts reads
// the lineage: the work itself, its family's first work, and the work a fork came from.
async function paidWorks(ctx: Ctx, work: Doc<"works">): Promise<Partial<Record<Role, Doc<"works">>>> {
  if (work.kind === "fork") {
    const parent = work.parentWorkId ? await ctx.db.get("works", work.parentWorkId) : null;
    return parent ? { creator: work, upstream: parent } : { creator: work };
  }
  if (work.kind === "original" || !work.parentWorkId) return { creator: work };
  const root = await familyRootOf(ctx, work);
  if (!root) return { creator: work };
  if (root.kind === "fork") {
    const upstream = root.parentWorkId ? await ctx.db.get("works", root.parentWorkId) : null;
    return upstream ? { creator: work, family_root: root, upstream } : { creator: work, family_root: root };
  }
  return { creator: work, family_root: root };
}

async function creditedArtists(ctx: Ctx, workId: Id<"works">) {
  const rows = await ctx.db.query("artistCredits").withIndex("by_work", (q) => q.eq("workId", workId)).take(10);
  const artists = await Promise.all(rows.map((row) => ctx.db.get("artists", row.artistId)));
  return artists.filter((artist): artist is Doc<"artists"> => artist !== null && artist.status !== "declined");
}

// Who a credited artist's share is paid to: the member who claimed it, else the hidden payee.
export function artistRecipient(artist: Doc<"artists">): Id<"users"> {
  return artist.status === "claimed" && artist.claimedBy ? artist.claimedBy : artist.payeeId;
}

// The artists a sale of this work pays, by the role whose part their share comes from, and each
// recipient's artist (for the economics panel).
export async function saleCredits(ctx: Ctx, work: Doc<"works">) {
  const works = await paidWorks(ctx, work);
  const credits: ArtistCredits = {};
  const byRecipient = new Map<string, Doc<"artists">>();
  for (const role of ["creator", "family_root", "upstream"] as const) {
    const source = works[role];
    if (!source) continue;
    const artists = await creditedArtists(ctx, source._id);
    if (artists.length === 0) continue;
    credits[role] = artists.map((artist) => {
      byRecipient.set(artistRecipient(artist), artist);
      return artistRecipient(artist);
    });
  }
  return { credits, byRecipient };
}

const shownValidator = v.object({
  name: v.string(),
  slug: v.string(),
  claimed: v.boolean(),
  // The CR number of the design that credits them, when it's an earlier design in the lineage.
  via: v.union(v.string(), v.null()),
});

async function shownCredits(ctx: Ctx, work: Doc<"works">) {
  const works = await paidWorks(ctx, work);
  const out: Array<{ name: string; slug: string; claimed: boolean; via: string | null }> = [];
  const seen = new Set<string>();
  for (const role of ["creator", "family_root", "upstream"] as const) {
    const source = works[role];
    if (!source) continue;
    for (const artist of await creditedArtists(ctx, source._id)) {
      if (seen.has(artist._id)) continue;
      seen.add(artist._id);
      const via = source._id === work._id || source.status === "private" ? null : formatCr(source.crFamily, source.crExpression);
      out.push({ name: artist.name, slug: artist.slug, claimed: artist.status === "claimed", via });
    }
  }
  return out;
}

// A design's "Inspired by" line: its own credits and those it inherits.
export const forWork = query({
  args: { cr: v.string() },
  returns: v.array(shownValidator),
  handler: async (ctx, args) => {
    const parsed = parseCr(args.cr);
    if (!parsed) return [];
    const work = await ctx.db
      .query("works")
      .withIndex("by_family_expression", (q) => q.eq("crFamily", parsed.family).eq("crExpression", parsed.expression))
      .unique();
    if (!work || (work.status !== "published" && work.status !== "withdrawn")) return [];
    return await shownCredits(ctx, work);
  },
});

// A kept design's credits, for its own creator.
export const forKept = query({
  args: { workId: v.id("works") },
  returns: v.array(shownValidator),
  handler: async (ctx, args) => {
    const viewer = await getViewerUser(ctx);
    const work = await ctx.db.get("works", args.workId);
    if (!viewer || !work || work.creatorId !== viewer._id) return [];
    return await shownCredits(ctx, work);
  },
});

// ---- The artist's page ----

async function heldCents(ctx: Ctx, payeeId: Id<"users">) {
  let cents = 0;
  for (const state of ["held", "pending"] as const) {
    const rows = await ctx.db
      .query("earnings")
      .withIndex("by_recipient_state", (q) => q.eq("recipientId", payeeId).eq("state", state))
      .take(2000);
    for (const row of rows) if (!row.simulated) cents += row.amountCents;
  }
  return cents;
}

const claimView = v.object({
  id: v.id("artistClaims"),
  code: v.string(),
  status: v.union(v.literal("started"), v.literal("submitted"), v.literal("approved"), v.literal("rejected")),
  proofUrl: v.union(v.string(), v.null()),
  reason: v.union(v.string(), v.null()),
});

export const page = query({
  args: { slug: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      id: v.id("artists"),
      name: v.string(),
      links: v.array(v.string()),
      status: v.union(v.literal("unclaimed"), v.literal("claimed"), v.literal("declined")),
      claimedBy: v.union(v.string(), v.null()),
      // Set aside for them from sales so far, still held until they claim it (real orders only).
      heldCents: v.number(),
      works: v.array(
        v.object({ cr: v.string(), title: v.union(v.string(), v.null()), thumbUrl: v.union(v.string(), v.null()), backgroundColor: v.string() }),
      ),
      viewer: v.object({ signedIn: v.boolean(), isClaimant: v.boolean(), claim: v.union(v.null(), claimView) }),
    }),
  ),
  handler: async (ctx, args) => {
    const artist = await ctx.db.query("artists").withIndex("by_slug", (q) => q.eq("slug", args.slug)).unique();
    if (!artist) return null;
    const rows = await ctx.db.query("artistCredits").withIndex("by_artist", (q) => q.eq("artistId", artist._id)).take(60);
    const urls = imageUrlReader(ctx);
    const works = [];
    for (const row of rows) {
      const work = await ctx.db.get("works", row.workId);
      if (!work || work.status !== "published") continue;
      const art = await urls(work.artKey);
      works.push({
        cr: formatCr(work.crFamily, work.crExpression),
        title: work.title ?? null,
        thumbUrl: art.mediumUrl ?? art.thumbUrl ?? null,
        backgroundColor: work.backgroundColor,
      });
    }
    // An unclaimed page appears once a published design credits the artist; until then it's only
    // a name a member typed (a private keep can credit one too).
    if (works.length === 0 && artist.status === "unclaimed") return null;
    const viewer = await getViewerUser(ctx);
    const claimer = artist.claimedBy ? await ctx.db.get("users", artist.claimedBy) : null;
    let claim = null;
    if (viewer) {
      const claims = await ctx.db.query("artistClaims").withIndex("by_artist", (q) => q.eq("artistId", artist._id)).take(100);
      const latest = claims.filter((c) => c.userId === viewer._id).sort((a, b) => b.createdAt - a.createdAt)[0];
      if (latest) {
        claim = { id: latest._id, code: latest.code, status: latest.status, proofUrl: latest.proofUrl ?? null, reason: latest.reason ?? null };
      }
    }
    return {
      id: artist._id,
      name: artist.name,
      links: artist.links,
      status: artist.status,
      claimedBy: claimer?.username ?? null,
      heldCents: artist.status === "unclaimed" ? await heldCents(ctx, artist.payeeId) : 0,
      works,
      viewer: { signedIn: Boolean(viewer), isClaimant: Boolean(viewer && artist.claimedBy === viewer._id), claim },
    };
  },
});

// ---- Claiming ----

// Gives the member a code to post where their work lives. Asking again returns the same code.
export const startClaim = mutation({
  args: { artistId: v.id("artists") },
  returns: v.id("artistClaims"),
  handler: async (ctx, args) => {
    const user = await requireMember(ctx);
    const artist = await ctx.db.get("artists", args.artistId);
    if (!artist || artist.status !== "unclaimed") {
      throw new ConvexError({ code: "NOT_CLAIMABLE", message: "This page has already been claimed." });
    }
    const claims = await ctx.db.query("artistClaims").withIndex("by_artist", (q) => q.eq("artistId", artist._id)).take(100);
    const open = claims.find((c) => c.userId === user._id && (c.status === "started" || c.status === "submitted"));
    if (open) return open._id;
    // A member can have a few claims open at once, so claims can't be opened in bulk.
    const mine = await ctx.db.query("artistClaims").withIndex("by_user", (q) => q.eq("userId", user._id)).order("desc").take(100);
    // A claim started and never sent for a week no longer counts, so abandoned ones don't block.
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const counted = mine.filter((c) => c.status === "submitted" || (c.status === "started" && c.createdAt > weekAgo));
    if (counted.length >= MAX_OPEN_CLAIMS) {
      throw new ConvexError({ code: "TOO_MANY_CLAIMS", message: "You have a few claims open already. Finish one first." });
    }
    return await ctx.db.insert("artistClaims", {
      artistId: artist._id,
      userId: user._id,
      code: claimCode(),
      status: "started",
      createdAt: Date.now(),
    });
  },
});

// Where the member posted the code (or says they emailed from the site's domain).
export const submitClaim = mutation({
  args: { claimId: v.id("artistClaims"), proofUrl: v.string(), note: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireMember(ctx);
    const claim = await ctx.db.get("artistClaims", args.claimId);
    if (!claim || claim.userId !== user._id || (claim.status !== "started" && claim.status !== "submitted")) {
      throw new ConvexError({ code: "NOT_FOUND", message: "That claim isn't open." });
    }
    const proofUrl = args.proofUrl.trim().slice(0, 300);
    if (!/^https?:\/\/\S+\.\S+/iu.test(proofUrl)) {
      throw new ConvexError({ code: "INVALID_INPUT", message: "Paste the link to the post or page with the code." });
    }
    await ctx.db.patch("artistClaims", claim._id, {
      proofUrl,
      note: args.note?.trim().slice(0, 500) || undefined,
      status: "submitted",
      submittedAt: Date.now(),
    });
    return null;
  },
});

// A claimed artist renames their page or turns the credit down. Turning it down takes them off
// every design and stops their share of new sales; what they've already been paid stays theirs.
export const updateMine = mutation({
  args: { artistId: v.id("artists"), name: v.optional(v.string()), decline: v.optional(v.boolean()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireMember(ctx);
    const artist = await ctx.db.get("artists", args.artistId);
    if (!artist || artist.claimedBy !== user._id) throw new ConvexError({ code: "FORBIDDEN", message: "Only the artist can change this." });
    const patch: Partial<Doc<"artists">> = { updatedAt: Date.now() };
    if (args.name !== undefined) {
      const name = args.name.replace(/\s+/gu, " ").trim();
      if (!name || [...name].length > 60) throw new ConvexError({ code: "INVALID_INPUT", message: "Give the page a name, up to 60 characters." });
      patch.name = name;
      patch.nameLower = name.toLowerCase();
    }
    if (args.decline !== undefined) patch.status = args.decline ? "declined" : "claimed";
    await ctx.db.patch("artists", artist._id, patch);
    return null;
  },
});

// ---- Admin ----

const adminArtist = v.object({
  id: v.id("artists"),
  name: v.string(),
  slug: v.string(),
  links: v.array(v.string()),
  status: v.union(v.literal("unclaimed"), v.literal("claimed"), v.literal("declined")),
  claimedBy: v.union(v.string(), v.null()),
  credits: v.number(),
  heldCents: v.number(),
});

export const adminOverview = query({
  args: {},
  returns: v.object({
    claims: v.array(
      v.object({
        id: v.id("artistClaims"),
        artist: v.object({ name: v.string(), slug: v.string(), links: v.array(v.string()) }),
        username: v.string(),
        code: v.string(),
        proofUrl: v.union(v.string(), v.null()),
        note: v.union(v.string(), v.null()),
        submittedAt: v.number(),
      }),
    ),
    artists: v.array(adminArtist),
  }),
  handler: async (ctx) => {
    await requireAdmin(ctx, "view");
    const submitted = await ctx.db.query("artistClaims").withIndex("by_status", (q) => q.eq("status", "submitted")).take(50);
    const claims = [];
    for (const claim of submitted) {
      const artist = await ctx.db.get("artists", claim.artistId);
      const user = await ctx.db.get("users", claim.userId);
      if (!artist) continue;
      claims.push({
        id: claim._id,
        artist: { name: artist.name, slug: artist.slug, links: artist.links },
        username: user?.username ?? "member",
        code: claim.code,
        proofUrl: claim.proofUrl ?? null,
        note: claim.note ?? null,
        submittedAt: claim.submittedAt ?? claim.createdAt,
      });
    }
    const all = await ctx.db.query("artists").order("desc").take(100);
    const artists = [];
    for (const artist of all) {
      const credits = await ctx.db.query("artistCredits").withIndex("by_artist", (q) => q.eq("artistId", artist._id)).take(200);
      const claimer = artist.claimedBy ? await ctx.db.get("users", artist.claimedBy) : null;
      artists.push({
        id: artist._id,
        name: artist.name,
        slug: artist.slug,
        links: artist.links,
        status: artist.status,
        claimedBy: claimer?.username ?? null,
        credits: credits.length,
        heldCents: artist.status === "unclaimed" ? await heldCents(ctx, artist.payeeId) : 0,
      });
    }
    return { claims, artists };
  },
});

async function workByCr(ctx: Ctx, cr: string) {
  const parsed = parseCr(cr.trim().replace(/^cr\s*/iu, ""));
  if (!parsed) return null;
  return await ctx.db
    .query("works")
    .withIndex("by_family_expression", (q) => q.eq("crFamily", parsed.family).eq("crExpression", parsed.expression))
    .unique();
}

// A design's own credits, for staff to correct.
export const adminWorkCredits = query({
  args: { cr: v.string() },
  returns: v.union(
    v.null(),
    v.object({ cr: v.string(), title: v.union(v.string(), v.null()), artists: v.array(v.object({ name: v.string(), link: v.string() })) }),
  ),
  handler: async (ctx, args) => {
    await requireAdmin(ctx, "view");
    const work = await workByCr(ctx, args.cr);
    if (!work) return null;
    const rows = await ctx.db.query("artistCredits").withIndex("by_work", (q) => q.eq("workId", work._id)).take(10);
    const artists = [];
    for (const row of rows) {
      const artist = await ctx.db.get("artists", row.artistId);
      if (artist) artists.push({ name: artist.name, link: artist.links[0] ?? "" });
    }
    return { cr: formatCr(work.crFamily, work.crExpression), title: work.title ?? null, artists };
  },
});

export const adminSetWorkCredits = mutation({
  args: { cr: v.string(), artists: v.array(inputValidator) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx, "manage");
    const work = await workByCr(ctx, args.cr);
    if (!work) throw new ConvexError({ code: "NOT_FOUND", message: "No design has that CR number." });
    await setWorkCredits(ctx, work._id, args.artists, admin._id, "staff");
    return null;
  },
});

// Approving a claim: the page becomes the member's, they get creator access (so their shares can
// be paid), and everything held for the artist moves to their account.
export const approveClaim = mutation({
  args: { claimId: v.id("artistClaims") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx, "manage");
    const claim = await ctx.db.get("artistClaims", args.claimId);
    if (!claim || claim.status !== "submitted") throw new ConvexError({ code: "NOT_FOUND", message: "That claim isn't waiting." });
    const artist = await ctx.db.get("artists", claim.artistId);
    const user = await ctx.db.get("users", claim.userId);
    if (!artist || !user) throw new ConvexError({ code: "NOT_FOUND", message: "That claim isn't waiting." });
    if (artist.status !== "unclaimed") throw new ConvexError({ code: "NOT_CLAIMABLE", message: "This artist is already claimed." });
    const now = Date.now();
    await ctx.db.patch("artistClaims", claim._id, { status: "approved", decidedAt: now, decidedBy: admin._id });
    await ctx.db.patch("artists", artist._id, { status: "claimed", claimedBy: user._id, claimedAt: now, updatedAt: now });
    await ctx.db.patch("users", artist.payeeId, { claimedBy: user._id });
    // Other open claims on this artist are closed.
    for (const other of await ctx.db.query("artistClaims").withIndex("by_artist", (q) => q.eq("artistId", artist._id)).take(50)) {
      if (other._id !== claim._id && (other.status === "started" || other.status === "submitted")) {
        await ctx.db.patch("artistClaims", other._id, { status: "rejected", reason: "Someone else's claim was approved.", decidedAt: now, decidedBy: admin._id });
      }
    }
    await setCreatorAccess(ctx, user, true, { grantedBy: admin._id, note: `artist: ${artist.name}` });
    // Move what's held for the artist, a few orders at a time (moveHeld).
    await ctx.scheduler.runAfter(0, internal.artists.moveHeld, { payeeId: artist.payeeId, userId: user._id });
    return null;
  },
});

// Moves a claimed artist's held shares to the member, a few orders per run: each run takes the
// payee's next earnings rows, redirects their orders (convex/earnings.ts redirectClaimedPayees,
// which takes every payee row on those orders off the payee), and schedules the next run. Once no
// row is left on the payee, the member's "not_creator" holds are released.
const MOVE_ROWS = 100;
const MOVE_ORDERS = 10;
export const moveHeld = internalMutation({
  // after: rows created before this were left behind (their line no longer names the payee).
  args: { payeeId: v.id("users"), userId: v.id("users"), after: v.optional(v.number()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("earnings")
      .withIndex("by_recipient_created", (q) =>
        args.after === undefined ? q.eq("recipientId", args.payeeId) : q.eq("recipientId", args.payeeId).gt("createdAt", args.after),
      )
      .take(MOVE_ROWS);
    if (rows.length > 0) {
      const orders = [...new Set(rows.map((row) => row.orderId))].slice(0, MOVE_ORDERS);
      for (const orderId of orders) await redirectClaimedPayees(ctx, orderId);
      // While rows move, the next run starts where this one did. When none did (their lines no
      // longer name the payee), it steps past them so later rows still move.
      let moved = false;
      for (const row of rows) {
        if (orders.includes(row.orderId) && (await ctx.db.get("earnings", row._id))?.recipientId !== args.payeeId) moved = true;
      }
      if (!moved) console.warn(`moveHeld: ${rows.length} earnings rows stay on artist payee ${args.payeeId}`);
      const after = moved ? args.after : Math.max(...rows.filter((row) => orders.includes(row.orderId)).map((row) => row.createdAt));
      await ctx.scheduler.runAfter(0, internal.artists.moveHeld, { ...args, after });
      return null;
    }
    await ctx.scheduler.runAfter(0, internal.earnings.releaseCreatorHolds, { userId: args.userId });
    return null;
  },
});

export const rejectClaim = mutation({
  args: { claimId: v.id("artistClaims"), reason: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx, "manage");
    const claim = await ctx.db.get("artistClaims", args.claimId);
    if (!claim || (claim.status !== "submitted" && claim.status !== "started")) {
      throw new ConvexError({ code: "NOT_FOUND", message: "That claim isn't waiting." });
    }
    await ctx.db.patch("artistClaims", claim._id, {
      status: "rejected",
      reason: args.reason.trim().slice(0, 300) || "We couldn't confirm it.",
      decidedAt: Date.now(),
      decidedBy: admin._id,
    });
    return null;
  },
});
