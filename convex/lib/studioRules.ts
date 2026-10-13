// The studio's rules, shared by the Convex functions and the studio page (safe in the browser;
// tests/unit/clientBoundary.test.ts). docs/image-generation/README.md explains the numbers.

// A batch is one 2x2 grid call (high quality, about 10-11¢ of image cost) cut into four designs.
export const DESIGNS_PER_BATCH = 4;
export const BATCH_CREDITS = 2;

// Credits back when designs don't come out of a batch: 1 for one or two missing, 2 for three or
// four, so a batch that fails or is blocked costs nothing.
export function creditsBack(missing: number) {
  const share = (Math.max(0, Math.min(missing, DESIGNS_PER_BATCH)) * BATCH_CREDITS) / DESIGNS_PER_BATCH;
  return Math.ceil(share);
}

// Numbered images to work on, and styles in the mixer. One call took 16 images in testing, with
// every image's subject kept; these leave room under that.
export const MAX_IMAGES = 8;
export const MAX_STYLES = 4;

// The request box holds this many characters, and the server keeps no more of a request.
export const MAX_REQUEST = 600;

// Sessions count their batches up to this; past it the studio shows "100+".
export const BATCH_COUNT_CAP = 100;

// Compare shows two to four designs side by side.
export const COMPARE_MIN = 2;
export const COMPARE_MAX = 4;

// The image models an admin can pick in the studio; members always get the first. A mix makes the
// four designs with separate calls: two GPT Image 2.5, one Nano Banana 2.1, one Recraft V4.1.
export const ENGINES = [
  { key: "gpt", name: "GPT Image 2.5" },
  { key: "nano-banana", name: "Nano Banana 2.1" },
  { key: "recraft", name: "Recraft V4.1" },
  { key: "mix", name: "Mix of all three" },
] as const;
export type Engine = (typeof ENGINES)[number]["key"];
export type SingleEngine = Exclude<Engine, "mix">;
export const MIX_ENGINES: ReadonlyArray<SingleEngine> = ["gpt", "gpt", "nano-banana", "recraft"];

export function engineName(engine: Engine) {
  return ENGINES.find((e) => e.key === engine)?.name ?? "GPT Image 2.5";
}

// GPT Image 2.5 and Nano Banana make a batch in one grid call; Recraft and a mix make four calls,
// one credit each.
export function engineMakesGrid(engine: Engine) {
  return engine === "gpt" || engine === "nano-banana";
}
