import { chosenProducts, offeredShopProducts } from "./shopProduct";
import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

// What making one unit costs, from the product's saved Printful catalog prices (merchProducts
// colors[].variants[].costCents, refreshed by convex/merch.ts refreshCosts): the variant's price,
// plus what each placement beyond the first adds. When the exact variant has no saved price, the
// product's highest saved price stands in, so the estimate errs high. Null when the product has no
// saved prices at all (the line then shares nothing until someone looks; convex/lib/saleCosts.ts).
export async function unitCostFor(
  ctx: QueryCtx,
  work: Doc<"works"> | null,
  variant: Doc<"workVariants"> | null,
): Promise<number | null> {
  let product: Doc<"merchProducts"> | null = null;
  let side: "front" | "back" = "front";
  let mark = false;
  const listingRow = variant?.listingId ? await ctx.db.get("shopProducts", variant.listingId) : null;
  const listing = listingRow?.listing;
  if (listing) {
    product = listing.merchProductId ? await ctx.db.get("merchProducts", listing.merchProductId) : null;
    product ??= await productById(ctx, listing.printfulProductId);
    side = listing.placement.side;
    mark = listing.placement.mark !== undefined;
  } else if (work) {
    // A line without a listing (a simulated sale): the work's first product, as it would sell.
    const [choice] = chosenProducts(work, await offeredShopProducts(ctx));
    if (choice) {
      product = await productById(ctx, choice.product.printfulProductId);
      side = choice.placement.side;
      mark = choice.placement.mark !== undefined;
    }
  }
  if (!product) return null;
  const costs = product.colors.flatMap((color) => color.variants.flatMap((v) => (v.costCents === undefined ? [] : [{ id: v.id, cents: v.costCents }])));
  if (costs.length === 0) return null;
  const exact = variant?.printfulVariantId !== undefined ? costs.find((c) => c.id === variant.printfulVariantId) : undefined;
  const base = exact?.cents ?? Math.max(...costs.map((c) => c.cents));
  const extra = (id: string) => product!.placements?.find((p) => p.id === id)?.extraCents ?? 0;
  // A back print adds the back placement; a chest mark with it is a second placement on the front.
  const placements = (side === "back" ? extra("back") : 0) + (mark ? Math.max(extra("front"), extra("back")) : 0);
  return base + placements;
}

async function productById(ctx: Pick<QueryCtx, "db">, productId: number) {
  return await ctx.db
    .query("merchProducts")
    .withIndex("by_provider_product", (q) => q.eq("provider", "printful").eq("productId", productId))
    .unique();
}
