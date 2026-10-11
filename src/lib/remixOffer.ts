// The lines of "A remix can change" on a work page (src/components/cr/RemixableParts.tsx RemixOffer):
// what a remix may do with each remixable part, and the remixable words as one phrase.

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

// "GROW and SLOW"; a piece on two lines reads as one.
export function wordsLine(texts: Array<string>) {
  const unique = [...new Set(texts.map((text) => text.replace(/\s*\n\s*/gu, " ").trim()).filter(Boolean))];
  if (unique.length <= 1) return unique[0] ?? "";
  return `${unique.slice(0, -1).join(", ")} and ${unique[unique.length - 1]}`;
}
