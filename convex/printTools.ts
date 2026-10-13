"use node";

import { v } from "convex/values";
import { hazeShare } from "../src/lib/print/alpha";
import { HAZE_REFUSE, printCheck } from "../src/lib/print/check";
import { parseHex } from "../src/lib/print/knockout";
import { aspectOf, canvasPx, clampPlacement, pixelRect, placedHeight } from "../src/lib/print/placement";
import { areaPlacement, markPlacement, toInches } from "../src/lib/print/shirtPlacement";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { geometryOf } from "./lib/shopProduct";
import { knockoutImage, largeWebp, measureImage, previewWebp, renderPrintFile, sha256Of, trimImage } from "./lib/printImage";
import { printFileKey, printLargeKey, printPreviewKey, printVersionKey, randomCode } from "./lib/printKeys";
import { storageMode } from "./lib/r2";
import { fetchPublicImage, storeObject } from "./lib/storage";
import type { PrintGeometry } from "../shared/config/print-products";
import type { Doc, Id } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";
import type { PrintArea, RelativePlacement } from "../src/lib/print/shirtPlacement";

// Print Studio's sharp work: measuring version 1, making trim and knockout versions, and the print
// file render. Every version and the print file sit behind a fresh random code in their path.

function readable(error: unknown) {
  return error instanceof Error && error.message ? error.message.slice(0, 200) : "Something went wrong.";
}

// keptBy: a kept design's creator, whose folder holds its print files (lib/printKeys.ts).
type Job = { version: Doc<"printVersions">; parent: Doc<"printVersions"> | null; family: number; expression: number; keptBy?: string };

// Stores a new version's PNG and its preview, then records it.
export async function storeVersion(
  ctx: ActionCtx,
  job: Job,
  bytes: Uint8Array,
  extra: { latencyMs?: number; requireAlpha?: boolean } = {},
): Promise<boolean> {
  const measured = await measureImage(bytes);
  if (extra.requireAlpha && !measured.metrics.hasAlpha) {
    throw new Error(`The ${job.version.op === "cutout" ? "cutout" : "upscale"} came back without transparency, so it can't be used.`);
  }
  const planned = printVersionKey(job.family, job.expression, randomCode(), job.version.number, job.keptBy);
  const [key, previewKey] = await Promise.all([
    storeObject(ctx, planned, bytes, "image/png"),
    previewWebp(bytes).then((webp) => storeObject(ctx, printPreviewKey(planned), webp, "image/webp")),
  ]);
  return await ctx.runMutation(internal.print.recordVersion, {
    versionId: job.version._id,
    key,
    previewKey,
    sha256: sha256Of(bytes),
    width: measured.width,
    height: measured.height,
    metrics: {
      hasAlpha: measured.metrics.hasAlpha,
      solid: measured.metrics.solid,
      visible: measured.metrics.visible,
      haze: measured.metrics.haze,
    },
    latencyMs: extra.latencyMs,
  });
}

// Version 1: the published art as it is, measured.
export const measure = internalAction({
  args: { versionId: v.id("printVersions") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const job: Job | null = await ctx.runQuery(internal.print.versionJob, args);
    if (!job || job.version.status !== "pending" || !job.version.key) return null;
    try {
      const bytes = await fetchPublicImage(job.version.key, ctx);
      const { width, height, metrics } = await measureImage(bytes);
      await ctx.runMutation(internal.print.recordVersion, {
        versionId: args.versionId,
        key: job.version.key,
        sha256: job.version.sha256 ?? sha256Of(bytes),
        width,
        height,
        metrics: { hasAlpha: metrics.hasAlpha, solid: metrics.solid, visible: metrics.visible, haze: metrics.haze },
      });
    } catch (error) {
      await ctx.runMutation(internal.print.failVersion, { versionId: args.versionId, error: readable(error) });
    }
    return null;
  },
});

// The work page's art: a 2400 px copy of the published art's upscale, stored beside it (convex/print.ts
// startArtUpscale). The published file stays as it is.
export const makeLargeArt = internalAction({
  args: { versionId: v.id("printVersions") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const job: Job | null = await ctx.runQuery(internal.print.versionJob, args);
    const key = job?.version.key;
    if (!job || job.version.status !== "ready" || job.version.op !== "upscale" || !key || key.startsWith("fake:")) return null;
    try {
      const bytes = await fetchPublicImage(key, ctx);
      const largeKey = await storeObject(ctx, printLargeKey(key), await largeWebp(bytes), "image/webp");
      await ctx.runMutation(internal.print.recordLargeArt, { versionId: args.versionId, largeKey });
    } catch (error) {
      console.error("makeLargeArt failed", args.versionId, readable(error));
    }
    return null;
  },
});

// A trim or knockout version, made from its parent. Neither ever enlarges.
export const makeVersion = internalAction({
  args: { versionId: v.id("printVersions") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const job: Job | null = await ctx.runQuery(internal.print.versionJob, args);
    if (!job || job.version.status !== "pending") return null;
    try {
      if (!storageMode()) throw new Error("Storage isn't set up.");
      if (!job.parent?.key) throw new Error("The version it starts from is missing.");
      const source = await fetchPublicImage(job.parent.key, ctx);
      let bytes: Uint8Array;
      if (job.version.op === "trim") {
        const trimmed = await trimImage(source);
        if (!trimmed) throw new Error("Nothing to trim: it's already tight.");
        bytes = trimmed.bytes;
      } else if (job.version.op === "knockout") {
        const params = job.version.params;
        const color = params?.color ? parseHex(params.color) : null;
        if (!params || !color) throw new Error("Pick a color to knock out.");
        const result = await knockoutImage(source, {
          color,
          tolerance: params.tolerance ?? 10,
          fromEdges: params.fromEdges ?? true,
        });
        if (result.cleared === 0) throw new Error("Nothing matched that color. Try a higher tolerance.");
        bytes = result.bytes;
      } else {
        throw new Error("Not a tool version.");
      }
      await storeVersion(ctx, job, bytes);
    } catch (error) {
      await ctx.runMutation(internal.print.failVersion, { versionId: args.versionId, error: readable(error) });
    }
    return null;
  },
});

type RenderJob = {
  family: number;
  expression: number;
  locked: boolean;
  placement: { xIn: number; yIn: number; widthIn: number; color: string };
  geometry: PrintGeometry;
  createdBy: Id<"users">;
  version: {
    id: Id<"printVersions">;
    key: string;
    width: number;
    height: number;
    metrics: { hasAlpha: boolean; solid: number; visible: number; haze: number };
  };
};

// The print file: the placed version at 300 DPI on the whole print-area canvas. The server runs
// the print check again on what it rendered before anything is recorded.
export const render = internalAction({
  args: { workId: v.id("works") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const job: RenderJob | null = await ctx.runQuery(internal.print.renderJob, args);
    if (!job || job.locked) return null;
    try {
      if (!storageMode()) throw new Error("Storage isn't set up.");
      const { version, placement, geometry } = job;
      const metrics = { width: version.width, height: version.height, ...version.metrics };
      const check = printCheck(metrics, placement, geometry);
      const refusal = check.items.find((item) => item.status === "refuse");
      if (refusal || check.grade === "refused") throw new Error(refusal?.label ?? "Not printable yet.");

      const source = await fetchPublicImage(version.key, ctx);
      const aspect = aspectOf(version.width, version.height);
      const rect = pixelRect(placement, aspect, geometry);
      const canvas = canvasPx(geometry);
      const rendered = await renderPrintFile(source, rect, canvas, geometry.dpi);

      // The server's readiness check, on the pixels that will print.
      if (!rendered.designMetrics.hasAlpha) throw new Error("The rendered file lost its transparency.");
      if (hazeShare(rendered.designMetrics) > HAZE_REFUSE) throw new Error("The rendered file has too much faint haze.");

      const planned = printFileKey(job.family, job.expression, randomCode());
      const [key, previewKey] = await Promise.all([
        storeObject(ctx, planned, rendered.bytes, "image/png"),
        previewWebp(rendered.bytes).then((webp) => storeObject(ctx, printPreviewKey(planned), webp, "image/webp")),
      ]);
      const grade = check.grade === "great" ? "great" : "good";
      await ctx.runMutation(internal.print.recordRender, {
        workId: args.workId,
        versionId: version.id,
        key,
        previewKey,
        sha256: rendered.sha256,
        widthPx: canvas.width,
        heightPx: canvas.height,
        placement: {
          xIn: placement.xIn,
          yIn: placement.yIn,
          widthIn: placement.widthIn,
          heightIn: Math.round(placedHeight(placement.widthIn, aspect) * 100) / 100,
        },
        rect,
        product: geometry.key,
        color: placement.color,
        dpi: Math.round(check.dpi * 10) / 10,
        grade,
        coverage: check.coverage,
        haze: check.haze,
        warnings: check.items.filter((item) => item.status === "warn").map((item) => item.label),
        createdBy: job.createdBy,
      });
    } catch (error) {
      await ctx.runMutation(internal.print.failRender, { workId: args.workId, error: readable(error) });
    }
    return null;
  },
});

type ListingJob = {
  family: number;
  expression: number;
  keptBy?: string;
  version: { id: Id<"printVersions">; key: string; width: number; height: number; metrics: { hasAlpha: boolean; solid: number; visible: number; haze: number } };
  listings: Array<{
    listingId: Id<"shopProducts">;
    productKey: string;
    placement: RelativePlacement;
    printArea: PrintArea;
    markArea?: PrintArea;
    studio?: { xIn: number; yIn: number; widthIn: number };
  }>;
};

type ListingFile = {
  key: string;
  previewKey: string;
  sha256: string;
  widthPx: number;
  heightPx: number;
  versionId: Id<"printVersions">;
  placement: { xIn: number; yIn: number; widthIn: number; heightIn: number };
  dpi: number;
  grade: "great" | "good";
  warnings: Array<string>;
  madeAt: number;
};

// One print file: the art at placement on geometry's whole print area, checked, rendered, checked
// again on the rendered pixels, and stored behind a fresh random code. A chest mark is small by
// design, so the ink-coverage minimum doesn't apply to it; every other check does.
async function renderOne(
  ctx: ActionCtx,
  job: ListingJob,
  source: Uint8Array,
  placement: { xIn: number; yIn: number; widthIn: number },
  geometry: PrintGeometry,
  options: { mark?: boolean } = {},
): Promise<ListingFile> {
  const { version } = job;
  const aspect = aspectOf(version.width, version.height);
  const metrics = { width: version.width, height: version.height, ...version.metrics };
  const check = printCheck(metrics, placement, geometry);
  const refusal = check.items.find((item) => item.status === "refuse" && !(options.mark && item.key === "coverage"));
  if (refusal || check.grade === "refused") throw new Error(`${options.mark ? "The chest mark: " : ""}${refusal?.label ?? "Not printable yet."}`);
  const rect = pixelRect(placement, aspect, geometry);
  const canvas = canvasPx(geometry);
  const rendered = await renderPrintFile(source, rect, canvas, geometry.dpi);
  if (!rendered.designMetrics.hasAlpha) throw new Error("The rendered file lost its transparency.");
  if (hazeShare(rendered.designMetrics) > HAZE_REFUSE) throw new Error("The rendered file has too much faint haze.");
  const planned = printFileKey(job.family, job.expression, randomCode(), job.keptBy);
  const [key, previewKey] = await Promise.all([
    storeObject(ctx, planned, rendered.bytes, "image/png"),
    previewWebp(rendered.bytes).then((webp) => storeObject(ctx, printPreviewKey(planned), webp, "image/webp")),
  ]);
  return {
    key,
    previewKey,
    sha256: rendered.sha256,
    widthPx: canvas.width,
    heightPx: canvas.height,
    versionId: version.id,
    placement: {
      xIn: placement.xIn,
      yIn: placement.yIn,
      widthIn: placement.widthIn,
      heightIn: Math.round(placedHeight(placement.widthIn, aspect) * 100) / 100,
    },
    dpi: Math.round(check.dpi * 10) / 10,
    grade: check.grade === "great" ? "great" : "good",
    warnings: check.items.filter((item) => item.status === "warn").map((item) => item.label),
    madeAt: Date.now(),
  };
}

// The print files for a work going on sale (convex/sales.ts): for each product, the art placed where
// its creator chose on that product's whole print area at 300 DPI. A file covering the whole area is
// what Printful expects for the placement, so it prints where the preview showed it, and when
// Printful scales a print down for smaller sizes it scales as one piece and stays centered. A back
// print with a chest mark gets a second file, the mark on the front print area, recorded with it.
export const renderListings = internalAction({
  args: { workId: v.id("works"), versionId: v.id("printVersions"), listingIds: v.array(v.id("shopProducts")) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const job: ListingJob | null = await ctx.runQuery(internal.sales.renderJob, args);
    if (!job) return null;
    const { version } = job;
    const aspect = aspectOf(version.width, version.height);
    let source: Uint8Array | null = null;
    for (const listing of job.listings) {
      try {
        if (!storageMode()) throw new Error("Storage isn't set up.");
        const geometry = geometryOf(listing.productKey, listing.printArea);
        // The Print Studio's placement for this product when there is one, else the publish placement.
        const placement = listing.studio
          ? clampPlacement(listing.studio, aspect, geometry)
          : areaPlacement(toInches(listing.placement, aspect, listing.printArea), listing.printArea);
        source ??= await fetchPublicImage(version.key, ctx);
        const file = await renderOne(ctx, job, source, placement, geometry);
        const mark =
          listing.placement.side === "back" && listing.placement.mark !== undefined && listing.markArea
            ? await renderOne(
                ctx,
                job,
                source,
                markPlacement(listing.placement.mark, aspect, listing.markArea),
                geometryOf(`${listing.productKey}-front`, listing.markArea),
                { mark: true },
              )
            : undefined;
        await ctx.runMutation(internal.sales.recordListingFile, {
          listingId: listing.listingId,
          file,
          ...(mark ? { markFile: mark } : {}),
        });
      } catch (error) {
        await ctx.runMutation(internal.sales.failListingFile, { listingId: listing.listingId, error: readable(error) });
      }
    }
    return null;
  },
});
