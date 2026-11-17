import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, mutation, query } from "./_generated/server";
import { getViewerUser } from "./identity";
import { requireMember } from "./studio";
import { requireAdmin } from "./lib/adminAccess";
import { imageUrlReader } from "./lib/imageUrls";
import { formatCr, parseCr } from "./lib/r2";
import { setCreatorAccess } from "./lib/creators";
import { sha256Hex } from "./lib/economicsConfigs";
import { queueCreditRecord } from "./lineage";
import { notifyArtistClaim } from "./lib/notifications";
import { cleanArtistInputs, claimCode, linkKey, normalizeLink, slugBase } from "./lib/artistCredits";
import { artistSharesOn } from "./lib/economicsConfigs";
import { redirectClaimedPayees } from "./earnings";
import { effectiveKind, effectiveParent, familyRoot } from "./lib/shopLineage";
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
// New artists one member can name a day, while publishing.
const NEW_ARTISTS_PER_DAY = 10;
// Claims one member can have open at once.
const MAX_OPEN_CLAIMS = 5;
// A claim started and not sent within a week expires: it can't be sent, and asking again starts a new one.
const CLAIM_EXPIRES_MS = 7 * 24 * 60 * 60 * 1000;
function claimExpired(claim: Doc<"artistClaims">) {
  return claim.status === "started" && Date.now() - claim.createdAt > CLAIM_EXPIRES_MS;
}

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
async function artistFor(ctx: MutationCtx, input: CleanArtist, by: Id<"users">, source: "creator" | "staff"): Promise<Doc<"artists">> {
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
  // A member can name a handful of new artists a day; staff can name any number.
  if (source === "creator") {
    const recent = await ctx.db
      .query("artists")
      .withIndex("by_createdBy", (q) => q.eq("createdBy", by).gt("createdAt", now - 24 * 60 * 60 * 1000))
      .take(NEW_ARTISTS_PER_DAY);
    if (recent.length >= NEW_ARTISTS_PER_DAY) {
      throw new ConvexError({ code: "TOO_MANY_ARTISTS", message: "You've credited a lot of new artists today. Try again tomorrow, or leave the credit off for now." });
    }
  }
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
    const artist = await artistFor(ctx, input, by, source);
    await ctx.db.insert("artistCredits", { workId, artistId: artist._id, source, addedBy: by, createdAt: now });
  }
  await recordCredits(ctx, workId, by);
}

// A credited artist as Monad knows them: a SHA-256 of their CultRemix artist ID keyed with a server
// secret (ARTIST_HASH_SECRET, its own so rotating others never changes it), never their name or
// links, so the public artist ID can't be matched to the record. The same artist always gets the
// same hash. Without the secret, no record is made (null).
async function artistHash(artistId: Id<"artists">): Promise<string | null> {
  const secret = process.env.ARTIST_HASH_SECRET?.trim();
  if (!secret) return null;
  return await sha256Hex(`cultremix-artist:${secret}:${artistId}`);
}

// Queues a record of a public work's current credits for Monad (lineage.ts queueCreditRecord). A
// private keep's credits are recorded when it's shared. Only where sales pay credited artists.
export async function recordCredits(ctx: MutationCtx, workId: Id<"works">, by: Id<"users">) {
  if (!artistSharesOn()) return;
  const work = await ctx.db.get("works", workId);
  if (!work || work.keep !== undefined || work.status === "private" || work.status === "withdrawn") return;
  const artists = await creditedArtists(ctx, workId);
  const hashes: Array<string> = [];
  for (const artist of artists) {
    const hash = await artistHash(artist._id);
    if (hash === null) {
      console.error("recordCredits: ARTIST_HASH_SECRET isn't set, so credits aren't recorded on Monad");
      return;
    }
    hashes.push(hash);
  }
  const rows = await ctx.db.query("lineageAmendments").withIndex("by_work_sequence", (q) => q.eq("workId", workId)).take(200);
  // A work never credited on Monad needs no "none" record.
  if (hashes.length === 0 && !rows.some((row) => row.artistCredit)) return;
  await queueCreditRecord(ctx, work, by, hashes);
}

// ---- Which credits a sale pays, and which a page shows ----

// The works whose creators a sale of this work pays, by role, as convex/lib/shopLineage.ts reads
// the lineage (a confirmed correction included): the work itself, its family's first work, and the
// work a fork came from.
async function paidWorks(ctx: Ctx, work: Doc<"works">): Promise<Partial<Record<Role, Doc<"works">>>> {
  const kind = effectiveKind(work);
  const parentId = effectiveParent(work);
  if (kind === "fork") {
    const parent = parentId ? await ctx.db.get("works", parentId) : null;
    return parent ? { creator: work, upstream: parent } : { creator: work };
  }
  if (kind === "original" || !parentId) return { creator: work };
  const root = await familyRoot(ctx.db, work);
  if (!root) return { creator: work };
  if (effectiveKind(root) === "fork") {
    const upstreamId = effectiveParent(root);
    const upstream = upstreamId ? await ctx.db.get("works", upstreamId) : null;
    return upstream ? { creator: work, family_root: root, upstream } : { creator: work, family_root: root };
  }
  return { creator: work, family_root: root };
}

async function creditedArtists(ctx: Ctx, workId: Id<"works">) {
  const rows = await ctx.db.query("artistCredits").withIndex("by_work", (q) => q.eq("workId", workId)).take(10);
  const artists = await Promise.all(rows.map((row) => ctx.db.get("artists", row.artistId)));
  return artists.filter((artist): artist is Doc<"artists"> => artist !== null && artist.status !== "declined" && !artist.hidden);
}

// Who a credited artist's share is paid to: the member who claimed it, else the hidden payee.
export function artistRecipient(artist: Doc<"artists">): Id<"users"> {
  // In its review window, sales still hold the share on the payee (approveClaim).
  return artist.status === "claimed" && artist.claimedBy && artist.reviewUntil === undefined ? artist.claimedBy : artist.payeeId;
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
  // Shown only where new sales pay credited artists (economics v5).
  if (!artistSharesOn()) return [];
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
    // Hidden by staff, or a deployment where sales don't pay artists: no page.
    if (!artist || artist.hidden || !artistSharesOn()) return null;
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
      heldCents: artist.status === "unclaimed" || artist.reviewUntil !== undefined ? await heldCents(ctx, artist.payeeId) : 0,
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
    const open = claims.find((c) => c.userId === user._id && (c.status === "submitted" || (c.status === "started" && !claimExpired(c))));
    if (open) return open._id;
    // A member can have a few claims open at once, so claims can't be opened in bulk.
    const mine = await ctx.db.query("artistClaims").withIndex("by_user", (q) => q.eq("userId", user._id)).order("desc").take(100);
    // A claim started and never sent for a week has expired, so abandoned ones don't block.
    const counted = mine.filter((c) => c.status === "submitted" || (c.status === "started" && !claimExpired(c)));
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
    if (!claim || claim.userId !== user._id || (claim.status !== "started" && claim.status !== "submitted") || claimExpired(claim)) {
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
    // While a new claim is in review, staff can still undo it, so the page stays as it was.
    if (artist.reviewUntil !== undefined) {
      throw new ConvexError({ code: "IN_REVIEW", message: "Your claim is still in review. You can rename the page or turn the credit down once it's done." });
    }
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
  // Hidden by staff (adminUpdateArtist).
  hidden: v.boolean(),
  // A claim in its review window: when the money moves (adminUnclaim can still undo it).
  reviewUntil: v.union(v.number(), v.null()),
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
        // Whether the proof link is on one of the artist's own sites (instagram.com for an
        // instagram.com link). A comment or a lookalike elsewhere is flagged for a closer look.
        // page: on one of the artist's own pages (or under it). site: the same site but another
        // page, like a comment or a lookalike account, so check who posted it. elsewhere: another site.
        proofMatch: v.union(v.literal("page"), v.literal("site"), v.literal("elsewhere")),
        // Members who credited this artist while publishing; the claimant among them is flagged.
        creditedBy: v.array(v.string()),
        claimantCredited: v.boolean(),
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
      const proof = claim.proofUrl ? normalizeLink(claim.proofUrl) : null;
      const proofKey = proof ? linkKey(proof) : null;
      const hostOf = (key: string) => key.split(/[/?]/u)[0];
      const proofMatch = !proofKey
        ? ("elsewhere" as const)
        : artist.linkKeys.some((key) => proofKey === key || proofKey.startsWith(key + "/") || proofKey.startsWith(key + "?"))
          ? ("page" as const)
          : artist.linkKeys.some((key) => hostOf(key) === hostOf(proofKey))
            ? ("site" as const)
            : ("elsewhere" as const);
      const credits = await ctx.db.query("artistCredits").withIndex("by_artist", (q) => q.eq("artistId", artist._id)).take(50);
      const crediters = [...new Set(credits.filter((c) => c.source === "creator").map((c) => c.addedBy))];
      const creditedBy = [];
      for (const id of crediters.slice(0, 10)) creditedBy.push((await ctx.db.get("users", id))?.username ?? "member");
      claims.push({
        id: claim._id,
        artist: { name: artist.name, slug: artist.slug, links: artist.links },
        username: user?.username ?? "member",
        code: claim.code,
        proofUrl: claim.proofUrl ?? null,
        note: claim.note ?? null,
        submittedAt: claim.submittedAt ?? claim.createdAt,
        proofMatch,
        creditedBy,
        claimantCredited: crediters.includes(claim.userId),
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
        heldCents: artist.status === "unclaimed" || artist.reviewUntil !== undefined ? await heldCents(ctx, artist.payeeId) : 0,
        hidden: artist.hidden ?? false,
        reviewUntil: artist.reviewUntil ?? null,
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

// Approving a claim gives the member the page right away, and starts a review window
// (CLAIM_REVIEW_MS) before any money moves: sales keep holding the artist's share on its hidden
// payee, and an admin can still undo the claim (adminUnclaim) with nothing to move back. When the
// window ends, finishClaim gives the member creator access and moves everything held to them.
const CLAIM_REVIEW_MS = 14 * 24 * 60 * 60 * 1000;

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
    const job = await ctx.scheduler.runAfter(CLAIM_REVIEW_MS, internal.artists.finishClaim, { artistId: artist._id });
    await ctx.db.patch("artists", artist._id, {
      status: "claimed",
      claimedBy: user._id,
      claimedAt: now,
      reviewUntil: now + CLAIM_REVIEW_MS,
      reviewJob: job,
      approvedBy: admin._id,
      updatedAt: now,
    });
    // Other open claims on this artist are closed.
    for (const other of await ctx.db.query("artistClaims").withIndex("by_artist", (q) => q.eq("artistId", artist._id)).take(50)) {
      if (other._id !== claim._id && (other.status === "started" || other.status === "submitted")) {
        await ctx.db.patch("artistClaims", other._id, { status: "rejected", reason: "Someone else's claim was approved.", decidedAt: now, decidedBy: admin._id });
        await notifyArtistClaim(ctx, { recipientId: other.userId, slug: artist.slug, message: `Your claim to ${artist.name}'s page wasn't approved: someone else's was.` });
      }
    }
    const days = Math.round(CLAIM_REVIEW_MS / (24 * 60 * 60 * 1000));
    await notifyArtistClaim(ctx, {
      recipientId: user._id,
      slug: artist.slug,
      message: `Your claim to ${artist.name}'s page was approved. What's set aside for you moves to your earnings in ${days} days, and later sales pay you from then.`,
    });
    return null;
  },
});

// The end of a claim's review window: the member gets creator access (so their shares can be
// paid), the hidden payee points at them, and everything held moves to them (moveHeld).
export const finishClaim = internalMutation({
  args: { artistId: v.id("artists") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const artist = await ctx.db.get("artists", args.artistId);
    if (!artist || artist.status === "unclaimed" || !artist.claimedBy || artist.reviewUntil === undefined) return null;
    const user = await ctx.db.get("users", artist.claimedBy);
    if (!user) return null;
    await ctx.db.patch("artists", artist._id, { reviewUntil: undefined, reviewJob: undefined, updatedAt: Date.now() });
    await ctx.db.patch("users", artist.payeeId, { claimedBy: user._id });
    await setCreatorAccess(ctx, user, true, { grantedBy: artist.approvedBy ?? user._id, note: `artist: ${artist.name}` });
    await ctx.scheduler.runAfter(0, internal.artists.moveHeld, { payeeId: artist.payeeId, userId: user._id });
    await notifyArtistClaim(ctx, { recipientId: user._id, slug: artist.slug, message: `What was set aside for ${artist.name} is in your earnings now.` });
    return null;
  },
});

// Undoes an approved claim while it's in review: nothing has moved yet, so the page goes back to
// unclaimed and keeps holding its share. After the window, money has moved and staff correct it by hand.
export const adminUnclaim = mutation({
  args: { artistId: v.id("artists"), reason: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx, "manage");
    const artist = await ctx.db.get("artists", args.artistId);
    if (!artist || artist.status === "unclaimed" || !artist.claimedBy) throw new ConvexError({ code: "NOT_FOUND", message: "That artist isn't claimed." });
    if (artist.reviewUntil === undefined) {
      throw new ConvexError({ code: "TOO_LATE", message: "Its review window is over and the money has moved, so this needs a correction by hand." });
    }
    if (artist.reviewJob) await ctx.scheduler.cancel(artist.reviewJob);
    const member = artist.claimedBy;
    const now = Date.now();
    await ctx.db.patch("artists", artist._id, {
      status: "unclaimed",
      claimedBy: undefined,
      claimedAt: undefined,
      reviewUntil: undefined,
      reviewJob: undefined,
      approvedBy: undefined,
      updatedAt: now,
    });
    const reason = args.reason.trim().slice(0, 300) || "We couldn't confirm it after all.";
    for (const claim of await ctx.db.query("artistClaims").withIndex("by_artist", (q) => q.eq("artistId", artist._id)).take(50)) {
      if (claim.userId === member && claim.status === "approved") {
        await ctx.db.patch("artistClaims", claim._id, { status: "rejected", reason, decidedAt: now, decidedBy: admin._id });
      }
    }
    await notifyArtistClaim(ctx, { recipientId: member, slug: artist.slug, message: `Your claim to ${artist.name}'s page was undone: ${reason}` });
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
      const after = moved ? args.after : rows[0].createdAt;
      await ctx.scheduler.runAfter(0, internal.artists.moveHeld, { ...args, after });
      return null;
    }
    await ctx.scheduler.runAfter(0, internal.earnings.releaseCreatorHolds, { userId: args.userId });
    return null;
  },
});

// Staff rename an artist (the first member to credit a link names them for everyone) or hide one:
// a hidden artist has no page, designs stop showing the credit, and new sales stop paying it. It's
// staff's own switch, apart from an artist's decline, which only the artist changes.
export const adminUpdateArtist = mutation({
  args: { artistId: v.id("artists"), name: v.optional(v.string()), hidden: v.optional(v.boolean()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireAdmin(ctx, "manage");
    const artist = await ctx.db.get("artists", args.artistId);
    if (!artist) throw new ConvexError({ code: "NOT_FOUND", message: "No such artist." });
    const patch: Partial<Doc<"artists">> = { updatedAt: Date.now() };
    if (args.name !== undefined) {
      const name = args.name.replace(/\s+/gu, " ").trim();
      if (!name || [...name].length > 60) throw new ConvexError({ code: "INVALID_INPUT", message: "Give the artist a name, up to 60 characters." });
      patch.name = name;
      patch.nameLower = name.toLowerCase();
    }
    if (args.hidden !== undefined) patch.hidden = args.hidden || undefined;
    await ctx.db.patch("artists", artist._id, patch);
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
    const artist = await ctx.db.get("artists", claim.artistId);
    if (artist) {
      const reason = args.reason.trim().slice(0, 300) || "We couldn't confirm it.";
      await notifyArtistClaim(ctx, { recipientId: claim.userId, slug: artist.slug, message: `Your claim to ${artist.name}'s page wasn't approved: ${reason}` });
    }
    return null;
  },
});

// Records every credited public work's credits on Monad that aren't recorded yet (a design credited
// while ARTIST_HASH_SECRET was missing, say). Safe to rerun: a work whose latest record already says
// the same is left alone (lineage.ts queueCreditRecord). A page of credits per call; deploy:migrate's
// credits step follows the cursor.
export const recordAllCredits = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  returns: v.object({ checked: v.number(), cursor: v.union(v.string(), v.null()), secret: v.boolean() }),
  handler: async (ctx, args) => {
    const secret = Boolean(process.env.ARTIST_HASH_SECRET?.trim());
    if (!secret) return { checked: 0, cursor: null, secret };
    const page = await ctx.db.query("artistCredits").paginate({ numItems: 100, cursor: args.cursor ?? null });
    const works = [...new Set(page.page.map((row) => row.workId))];
    for (const workId of works) {
      const work = await ctx.db.get("works", workId);
      if (work) await recordCredits(ctx, workId, work.creatorId);
    }
    return { checked: works.length, cursor: page.isDone ? null : page.continueCursor, secret };
  },
});
