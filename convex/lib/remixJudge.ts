// How far a remix moved from the design it remixes, judged by GPT-6 Luna from the two images
// (convex/lib/remixCompare.ts makes the call). A remix that reads as the same design publishes as a
// variation; one that reads as a new design may start a new family as a fork, which pays its
// creator more (convex/lib/economics.ts). Pure: the prompt and the answer's parsing, for tests.
// Jon's rule (2026-10-05): a design is its look and its layout. Swapping what it shows (a lion for a
// wolf), its words, or its colors keeps it a variation; redrawing it in a different style or medium,
// even with the same layout (GROW SLOW as pixel art), or rebuilding its layout makes it a fork.

export const REMIX_JUDGE_SYSTEM = [
  "You compare a remix of a t-shirt design with the original design it came from. Image 1 is the original; image 2 is the remix. " +
    "On CultRemix a remix is published as a variation or a fork, and your answer decides which it may be. A design is its look and its " +
    "layout; what it shows can be swapped.",
  "- variation: the same design with new content. It keeps the original's look (its drawing technique or medium, line work, shading, " +
    "texture, and lettering style) and its layout, even when its main subject or characters are swapped for others (a lion becomes a wolf, " +
    "mushrooms become a cactus), its words change (even when the lettering is resized, rewrapped, or moved to fit new or removed words), " +
    "it's recolored, details are added or removed, the background or setting changes, or a subject is shown in a different pose.",
  "- fork: a new design built from the original. The whole design is redrawn in a clearly different style or medium (such as pixel art, a " +
    "pencil sketch, a watercolor, or pop art in place of the original's technique), even when its layout, subjects, words, and colors stay " +
    "the same; or its artwork is rebuilt into a different composition; or it shares little with the original.",
  "Changed words never make a fork, and neither do swapped subjects or new colors while the look and layout stay. When it's close, answer " +
    "variation. Gray around a design is a transparent background, not part of the design.",
  'Answer with JSON only: {"subject": "same" or "changed", "layout": "same" or "changed" (the arrangement of the main artwork; lettering ' +
    'moved to fit new or removed words does not count), "style": "same" or "changed" (the drawing technique or medium, line work, texture, ' +
    'and lettering style; colors alone do not count), "verdict": "variation" or "fork", "reason": one short sentence for the person who ' +
    'made the remix, saying what stayed the same or what changed, without calling the designs image 1 or image 2}',
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
