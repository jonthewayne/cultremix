// How far a remix moved from the design it remixes, judged by GPT-6 Luna from the two images
// (convex/lib/remixCompare.ts makes the call). A remix that reads as the same design publishes as a
// variation; one that reads as a new design may start a new family as a fork, which pays its
// creator more (convex/lib/economics.ts). Pure: the prompt and the answer's parsing, for tests.

export const REMIX_JUDGE_SYSTEM = [
  "You compare a remix of a t-shirt design with the original design it came from. Image 1 is the original; image 2 is the remix. " +
    "On CultRemix a remix is published as a variation or a fork, and your answer decides which it may be.",
  "- variation: still the same design. Someone who saw both shirts would call the remix a version of the original: the same main subject " +
    "or characters, the same layout, and the same overall look (drawing technique, line work, lettering style, and palette), even with changes " +
    "such as different or added words, recolored parts, small details added or removed, a different background or setting, or the same subject " +
    "in a different pose.",
  "- fork: a new design built from the original. Someone would call the remix a different shirt inspired by the original, because the main " +
    "subject or characters were replaced, the layout was rebuilt into a different composition, or the whole design was redrawn in a clearly " +
    "different style (technique, line work, and palette all changed).",
  "Changed words alone never make a fork, however many words changed. When it's close, answer variation. Gray around a design is a " +
    "transparent background, not part of the design.",
  'Answer with JSON only: {"subject": "same" or "changed", "layout": "same" or "changed", "style": "same" or "changed", ' +
    '"verdict": "variation" or "fork", "reason": one short sentence for the person who made the remix, saying what stayed the same or what ' +
    'changed, without calling the designs image 1 or image 2}',
].join("\n");

export type Aspect = "same" | "changed";
export type RemixVerdict = {
  verdict: "variation" | "fork";
  reason: string;
  subject?: Aspect;
  layout?: Aspect;
  style?: Aspect;
};

const aspect = (value: unknown): Aspect | undefined => (value === "same" || value === "changed" ? value : undefined);

// The judge's JSON answer, or null when it isn't one.
export function parseRemixVerdict(text: string): RemixVerdict | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  const verdict = parsed.verdict;
  if (verdict !== "variation" && verdict !== "fork") return null;
  let reason = typeof parsed.reason === "string" ? parsed.reason.replace(/\s+/gu, " ").trim().slice(0, 200) : "";
  if (reason && !/[.!?]$/u.test(reason)) reason += ".";
  return { verdict, reason, subject: aspect(parsed.subject), layout: aspect(parsed.layout), style: aspect(parsed.style) };
}
