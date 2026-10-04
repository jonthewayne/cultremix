import { COMPARE_MAX, COMPARE_MIN } from "../../convex/lib/studioRules";

// Compare, pure: the designs it holds (in the address as ?compare=<id>,<id>,…), picking and
// dropping them, the pairs a phone steps through, and the one scale every design is drawn at.

export { COMPARE_MAX, COMPARE_MIN };

// The ids in ?compare=, in order, without blanks or repeats, at most COMPARE_MAX.
export function parseCompare(raw: unknown): Array<string> {
  if (typeof raw !== "string") return [];
  const ids: Array<string> = [];
  for (const part of raw.split(",")) {
    const id = part.trim();
    if (id && !ids.includes(id)) ids.push(id);
    if (ids.length === COMPARE_MAX) break;
  }
  return ids;
}

export const compareParam = (ids: Array<string>): string | undefined => (ids.length > 0 ? ids.join(",") : undefined);

// Compare opens with two or more.
export const canCompare = (ids: Array<string>) => ids.length >= COMPARE_MIN;

export type Pick = { picks: Array<string>; full: boolean };

// Tapping a design while picking: in if it's out (unless four are picked already), out if it's in.
export function togglePick(picks: Array<string>, id: string): Pick {
  if (picks.includes(id)) return { picks: picks.filter((other) => other !== id), full: false };
  if (picks.length >= COMPARE_MAX) return { picks, full: true };
  return { picks: [...picks, id], full: false };
}

// Phones show two at a time: 1+2, then 3+4. An odd one out is paired with the one before it
// (three designs: 1+2, then 2+3), so every pair is a real comparison.
export function phonePairs(count: number): Array<[number, number]> {
  if (count < 2) return [];
  const pairs: Array<[number, number]> = [];
  for (let first = 0; first < count; first += 2) {
    pairs.push(first + 1 < count ? [first, first + 1] : [first - 1, first]);
  }
  return pairs;
}

// The pair to show after the list changed (a design dropped): the same one, or the last there is.
export const clampPair = (pair: number, count: number) => Math.max(0, Math.min(pair, phonePairs(count).length - 1));

// The pair holding a design, so dropping one keeps its neighbor in view.
export function pairHolding(count: number, index: number): number {
  const at = phonePairs(count).findIndex(([a, b]) => a === index || b === index);
  return Math.max(0, at);
}

export type Size = { width: number; height: number };

// The one scale (displayed pixels per original pixel) at which every design fits its box, so
// they're all drawn at the same size relative to each other. Unknown sizes are left out; with
// none known, 0.
export function sharedScale(sizes: Array<Size | undefined>, box: Size): number {
  let scale = Infinity;
  for (const size of sizes) {
    if (!size || size.width <= 0 || size.height <= 0) continue;
    scale = Math.min(scale, box.width / size.width, box.height / size.height);
  }
  return Number.isFinite(scale) ? Math.max(0, scale) : 0;
}
