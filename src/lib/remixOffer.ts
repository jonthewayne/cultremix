// The lines of "A remix can change" on a work page (src/components/cr/RemixableParts.tsx RemixOffer):
// what a remix may do with each remixable part, and the remixable words.

export type OfferPart = {
  id: string;
  kind: "character" | "person" | "group";
  label: string;
  empty?: "keep" | "omit" | "require";
  count?: number;
  max?: number;
};

// "Santa: anyone, from a photo"
export function offerLine(part: OfferPart) {
  if (part.kind === "character") return `${part.label}: swap it for anything`;
  if (part.kind === "person") {
    return `${part.label}: anyone, from a photo${part.empty === "omit" ? ", or left out" : part.empty === "require" ? " (a photo is needed)" : ""}`;
  }
  const most = part.max ?? part.count;
  return `${part.label}: ${most ? `up to ${most}, ` : ""}one photo each`;
}

// The remixable words once each, in order; a piece on two lines reads as one. The page shows each as
// its own chip, since a design's words carry their own commas ("Keep it", "weird,", "Wanda").
export function remixWords(texts: Array<string>) {
  return [...new Set(texts.map((text) => text.replace(/\s*\n\s*/gu, " ").trim()).filter(Boolean))];
}
