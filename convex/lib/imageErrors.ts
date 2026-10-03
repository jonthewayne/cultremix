// Tells a request the image provider's content filter refused apart from other
// failures: OpenAI's image moderation error (through the AI Gateway, or as the
// ChatGPT backend's failed event), or a model that answered with a refusal
// sentence and no image.
const FILTER_PATTERNS = [/safety system/i, /moderation[_ ]blocked/i, /content[_ ]policy/i, /safety[_ ]violations?/i];
const REFUSAL = /\b(?:can['’]?t|cannot|won['’]?t|unable to|not able to) (?:help|create|make|generate|produce|draw)\b/i;

// Prefix of the error thrown when the model replies in words without an image.
export const NO_IMAGE_REPLY = "The image service answered without an image:";

// A grid quarter the cutter couldn't use (convex/lib/gridCut.ts).
export const GRID_MERGED = "Grid: two designs ran together.";
export const GRID_EMPTY = "Grid: this quarter came back empty.";

export function isBlockedError(error: string | undefined) {
  if (!error) return false;
  if (FILTER_PATTERNS.some((pattern) => pattern.test(error))) return true;
  return error.startsWith(NO_IMAGE_REPLY) && REFUSAL.test(error);
}

// What the studio shows for a failed design. The raw error stays in generations.error: a
// provider's error text, or the model's own reply on the ChatGPT path, can quote the prompt.
export function publicTileError(error: string | undefined) {
  if (!error) return undefined;
  if (error === "Timed out.") return "It took too long.";
  if (error === GRID_MERGED) return "This one ran into the design next to it.";
  if (error === GRID_EMPTY) return "This one came out empty.";
  if (error === "Generation is paused.") return "Generation is paused right now.";
  if (error.startsWith("Image unavailable") || error.startsWith("Image fetch failed")) {
    return "One of the images couldn't be loaded.";
  }
  return "The image service had a problem.";
}
