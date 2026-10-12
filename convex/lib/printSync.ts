import { aspectOf, clampPlacement } from "../../src/lib/print/placement";
import { areaPlacement, toInches } from "../../src/lib/print/shirtPlacement";
import { printTargetForWork } from "./shopProduct";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

// The Print Studio's placement (inches, convex/print.ts) and the work's publish placement (relative,
// src/lib/print/shirtPlacement.ts) describe the same print on the work's first product, so the
// newest choice is what prints and what the work page says. Saving in the Print Studio writes the
// work's placement (print.savePlacement); this is the other way: a placement changed on the work page
// moves the Print Studio's to match, keeping its art version and color. Approving the work for sale
// makes each product's print file from this placement, so it follows even after the Print Studio's
// own file is made (that file, works.printKey, never changes). Left alone while the Print Studio
// renders, and when the product is printed on its back.
export async function followPublishPlacement(ctx: MutationCtx, workId: Id<"works">, userId: Id<"users">) {
  const work = await ctx.db.get("works", workId);
  if (!work) return;
  const placement = await ctx.db
    .query("printPlacements")
    .withIndex("by_work", (q) => q.eq("workId", workId))
    .unique();
  if (!placement || placement.render?.status === "rendering") return;
  const target = await printTargetForWork(ctx, work);
  if (target.placement?.side !== "front") return;
  const version = await ctx.db.get("printVersions", placement.versionId);
  if (!version?.width || !version.height) return;
  const aspect = aspectOf(version.width, version.height);
  const area = target.geometry.printArea;
  const placed = clampPlacement(areaPlacement(toInches(target.placement, aspect, area), area), aspect, target.geometry);
  if (placed.xIn === placement.xIn && placed.yIn === placement.yIn && placed.widthIn === placement.widthIn) return;
  await ctx.db.patch("printPlacements", placement._id, { ...placed, updatedBy: userId, updatedAt: Date.now(), render: undefined });
}
