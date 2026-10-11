import { defineTable } from "convex/server";
import { v } from "convex/values";

// Print Studio (V1 U6, publish first, print file later). A published work's art is version 1;
// tools make further versions; one placement per work; one print file per work, made once.
export const printTables = {
  printVersions: defineTable({
    workId: v.id("works"),
    number: v.number(),
    parentId: v.optional(v.id("printVersions")),
    // cutout: the background removed by fal's BiRefNet (convex/upscale.ts), for art whose
    // background isn't one flat color.
    op: v.union(v.literal("published"), v.literal("trim"), v.literal("knockout"), v.literal("upscale"), v.literal("cutout")),
    status: v.union(v.literal("pending"), v.literal("ready"), v.literal("failed")),
    // Version 1 is the published art's own key; later versions sit in an unguessable folder
    // (convex/lib/printKeys.ts).
    key: v.optional(v.string()),
    previewKey: v.optional(v.string()),
    sha256: v.optional(v.string()),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    // The print check's alpha measurements (src/lib/print/alpha.ts).
    metrics: v.optional(
      v.object({ hasAlpha: v.boolean(), solid: v.number(), visible: v.number(), haze: v.number() }),
    ),
    params: v.optional(
      v.object({ color: v.optional(v.string()), tolerance: v.optional(v.number()), fromEdges: v.optional(v.boolean()) }),
    ),
    // This version is (or comes from) an upscale. Upscaled images never go to the image models;
    // a remix starts from remixSourceId, the last version before the upscale (KTD-20).
    upscaled: v.boolean(),
    remixSourceId: v.optional(v.id("printVersions")),
    // The one fal submission an upscale gets. "submitting" is claimed before the POST, so a
    // second run never posts again; the request ID is saved before any polling.
    fal: v.optional(
      v.object({
        state: v.union(v.literal("queued"), v.literal("submitting"), v.literal("submitted")),
        requestId: v.optional(v.string()),
        statusUrl: v.optional(v.string()),
        responseUrl: v.optional(v.string()),
        submittedAt: v.optional(v.number()),
        polls: v.number(),
        latencyMs: v.optional(v.number()),
      }),
    ),
    charged: v.number(),
    error: v.optional(v.string()),
    createdBy: v.id("users"),
    finishedAt: v.optional(v.number()),
  }).index("by_work_number", ["workId", "number"]),

  printPlacements: defineTable({
    workId: v.id("works"),
    versionId: v.id("printVersions"),
    xIn: v.number(),
    yIn: v.number(),
    widthIn: v.number(),
    // A color name from shared/config/print-products.ts.
    color: v.string(),
    updatedBy: v.id("users"),
    updatedAt: v.number(),
    render: v.optional(
      v.object({
        status: v.union(v.literal("rendering"), v.literal("failed")),
        error: v.optional(v.string()),
        startedAt: v.number(),
      }),
    ),
  }).index("by_work", ["workId"]),

  printFiles: defineTable({
    workId: v.id("works"),
    versionId: v.id("printVersions"),
    key: v.string(),
    previewKey: v.optional(v.string()),
    sha256: v.string(),
    // The whole print area at 300 DPI.
    widthPx: v.number(),
    heightPx: v.number(),
    // The design on it.
    placement: v.object({ xIn: v.number(), yIn: v.number(), widthIn: v.number(), heightIn: v.number() }),
    rect: v.object({ left: v.number(), top: v.number(), width: v.number(), height: v.number() }),
    product: v.string(),
    color: v.string(),
    dpi: v.number(),
    grade: v.union(v.literal("good"), v.literal("great")),
    coverage: v.number(),
    haze: v.number(),
    warnings: v.array(v.string()),
    createdBy: v.id("users"),
  }).index("by_work", ["workId"]),
};
