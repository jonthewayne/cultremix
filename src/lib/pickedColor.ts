// The work page's one shirt-color selection. The art square, the publish swatches, and the buy
// box all read it, so they can't disagree. Colors are keyed by garment color key
// (convex/lib/garments.ts); the buy box's offer colors carry the same keys.

export type PickedColor = { cr: string; key: string } | null;

// While the work is on sale the page shows what can be bought (the offer's colors); otherwise
// the colors the work was published with.
export function pageColors<C extends { key: string }>(published: Array<C>, offer: { colors: Array<C> } | null | undefined) {
  return offer && offer.colors.length > 0 ? offer.colors : published;
}

// The picked color when it belongs to this work and is still on the list, else the lead color.
export function selectedColor<C extends { key: string }>(colors: Array<C>, picked: PickedColor, cr: string): C | undefined {
  return colors.find((color) => picked?.cr === cr && color.key === picked.key) ?? colors[0];
}
