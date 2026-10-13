import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, internalQuery } from "./_generated/server";
import { closeReservation, hasRoom, imageProviderSetting, openReservation, spendValidator } from "./lib/budget";
import { isFlagOn } from "./lib/flagState";
import { photoWorstCaseCents, qualityOf } from "./lib/pricing";
import { shopColors } from "./feed";
import { colorLookup } from "./merch";
import { photoGarment, photoGarmentValidator } from "./publish";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

// Photos in every color (Jon, October 13): after a work's model photo, the same photo in up to three
// of its other shirt colors. Each is an edit of that photo that changes only the garment's color,
// guided by the garment drawn in the new color (imageGen.colorPhoto), so the person, pose, and place
// stay the same. About 4 cents each from the image credit, behind the Photos in every color switch.
// The work page's photo follows the color picked (feed.byCr colorPhotos).

export const COLOR_PHOTOS_FLAG = "photos.colors";
export const MAX_COLOR_PHOTOS = 3;

export function colorPhotoAttempt(id: Id<"colorPhotos">) {
  return `colorPhoto:${id}`;
}

// The model photo the work page shows, once it's in.
async function currentPhoto(ctx: QueryCtx | MutationCtx, workId: Id<"works">) {
  const shoot = await ctx.db
    .query("shoots")
    .withIndex("by_work", (q) => q.eq("workId", workId))
    .first();
  if (!shoot) return null;
  const photo = await ctx.db
    .query("shootPhotos")
    .withIndex("by_shoot_index", (q) => q.eq("shootId", shoot._id).eq("index", 1))
    .unique();
  return photo?.state === "succeeded" && photo.publicKey ? photo.publicKey : null;
}

// Starts the photos in the work's other colors that its current photo doesn't have yet, each holding
// a model photo's worst case against today's gateway budget. Returns how many it started.
export async function startColorPhotos(ctx: MutationCtx, workId: Id<"works">): Promise<number> {
  if (!(await isFlagOn(ctx, COLOR_PHOTOS_FLAG)) || imageProviderSetting() !== "gateway") return 0;
  const work = await ctx.db.get("works", workId);
  if (!work || work.status !== "published") return 0;
  const basedOn = await currentPhoto(ctx, workId);
  if (!basedOn || basedOn.startsWith("fake:")) return 0;
  // The lead color is the one the photo was shot on; the others follow in the creator's order.
  const lead = work.backgroundColor.toLowerCase();
  const colors = shopColors(work, await colorLookup(ctx))
    .filter((color, index) => index > 0 && color.key !== "custom" && color.hex.toLowerCase() !== lead)
    .slice(0, MAX_COLOR_PHOTOS);
  const rows = await ctx.db
    .query("colorPhotos")
    .withIndex("by_work", (q) => q.eq("workId", workId))
    .collect();
  const worstCaseCents = photoWorstCaseCents(qualityOf(process.env.PHOTO_QUALITY, "medium"));
  const now = Date.now();
  let started = 0;
  for (const color of colors) {
    if (rows.some((row) => row.colorKey === color.key && row.basedOn === basedOn && row.state !== "failed")) continue;
    if (!(await hasRoom(ctx, "gateway", worstCaseCents, now))) break;
    const id = await ctx.db.insert("colorPhotos", { workId, colorKey: color.key, hex: color.hex, basedOn, state: "pending" });
    await openReservation(
      ctx,
      { attemptKind: "photo", attemptId: colorPhotoAttempt(id), provider: "gateway", userId: work.creatorId, credits: 0, worstCaseCents, dispatched: true },
      now,
    );
    await ctx.scheduler.runAfter(0, internal.imageGen.colorPhoto, { colorPhotoId: id });
    started += 1;
  }
  return started;
}

// After the model photo is in (publish.recordPhoto).
export const start = internalMutation({
  args: { workId: v.id("works") },
  returns: v.number(),
  handler: async (ctx, args) => await startColorPhotos(ctx, args.workId),
});

// bunx convex run colorPhotos:backfill (production: --prod) makes them for works photographed before
// the switch was on. Safe to rerun.
export const backfill = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const works = await ctx.db
      .query("works")
      .withIndex("by_status_publishedAt", (q) => q.eq("status", "published"))
      .collect();
    let started = 0;
    for (const work of works) started += await startColorPhotos(ctx, work._id);
    return started;
  },
});

// What imageGen.colorPhoto needs: the photo to edit, and the art and garment for the drawn guide.
export const job = internalQuery({
  args: { colorPhotoId: v.id("colorPhotos") },
  returns: v.union(
    v.null(),
    v.object({
      hex: v.string(),
      colorKey: v.string(),
      photoKey: v.string(),
      artKey: v.string(),
      garment: photoGarmentValidator,
      crFamily: v.number(),
      crExpression: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const row = await ctx.db.get("colorPhotos", args.colorPhotoId);
    if (!row || row.state !== "pending") return null;
    const work = await ctx.db.get("works", row.workId);
    if (!work?.artKey || work.status !== "published") return null;
    return {
      hex: row.hex,
      colorKey: row.colorKey,
      photoKey: row.basedOn,
      artKey: work.artKey,
      garment: await photoGarment(ctx, work),
      crFamily: work.crFamily,
      crExpression: work.crExpression,
    };
  },
});

export const record = internalMutation({
  args: { colorPhotoId: v.id("colorPhotos"), publicKey: v.string(), spend: v.optional(spendValidator) },
  returns: v.null(),
  handler: async (ctx, args) => {
    await closeReservation(ctx, colorPhotoAttempt(args.colorPhotoId), args.spend ?? { kind: "settle" });
    const row = await ctx.db.get("colorPhotos", args.colorPhotoId);
    if (row?.state === "pending") await ctx.db.patch("colorPhotos", row._id, { state: "succeeded", publicKey: args.publicKey });
    return null;
  },
});

export const fail = internalMutation({
  args: { colorPhotoId: v.id("colorPhotos"), reason: v.string(), spend: v.optional(spendValidator) },
  returns: v.null(),
  handler: async (ctx, args) => {
    await closeReservation(ctx, colorPhotoAttempt(args.colorPhotoId), args.spend ?? { kind: "settle" });
    const row = await ctx.db.get("colorPhotos", args.colorPhotoId);
    if (row?.state === "pending") await ctx.db.patch("colorPhotos", row._id, { state: "failed", reason: args.reason.slice(0, 300) });
    return null;
  },
});
