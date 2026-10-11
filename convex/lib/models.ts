// The models CultRemix makes and reads images with, named once. Production calls read these, and
// the image test suite (tests/image-e2e) pins its baseline to them, so changing a model is a
// one-line edit here that the suite can check first (tests/image-e2e/README.md).

// GPT Image 2.5 through the CultRemix Gateway: Sunburst for any call that sends images, Flare for
// designs made from words alone.
export const IMAGE_MODEL_WITH_IMAGES = "openai/gpt-image-2.5-sunburst";
export const IMAGE_MODEL_TEXT_ONLY = "openai/gpt-image-2.5-flare";

// GPT-6 Luna reads images and requests: each image's notes, what a request wants from each image,
// and how far a remix moved from its original.
export const VISION_MODEL = "openai/gpt-6-luna";

// Gemini 3.1 Pro reads a design's lettering letter for letter: the studio's spelling check
// (convex/spelling.ts) and the image suite's word reader. OpenAI's models read what a design
// probably meant: on five hard designs, three reads each, GPT-6 Luna read TRRSH as TRASH and a clear
// LOUD as SLOW (6 of 15 wrong), and GPT-6 and 6.1 Sol read TRRSH as TRASH every time. Gemini 3.1 Pro
// read all 15 letter for letter, at its default thinking (about 1¢ a read) and at low thinking (about
// 0.3¢, 7 to 18 s). No model reliably caught an E missing its bottom bar (FIRF): 1 read in 10 did
// (2026-10-05). It's a preview model; if it's retired, pick another here.
export const WORD_READER_MODEL = "google/gemini-3.1-pro-preview";

export function imageModelFor(imageCount: number) {
  return imageCount > 0 ? IMAGE_MODEL_WITH_IMAGES : IMAGE_MODEL_TEXT_ONLY;
}

// Other models admins can try in the studio (docs/image-generation/README.md, "Other models").
// Nano Banana 2.1 returns opaque JPEGs, so its designs are drawn on a key color that
// convex/lib/chromaKey.ts clears. Recraft V4.1 takes words only through the gateway, so it works
// from the images' notes.
export const NANO_BANANA_MODEL = "google/gemini-nano-banana-2.1";
export const RECRAFT_MODEL = "recraft/recraft-v4.1";
// A Nano Banana grid is 2048x2048; a single Nano Banana design is portrait, like GPT's.
export const NANO_BANANA_GRID = { aspectRatio: "1:1", imageSize: "2K" } as const;
export const NANO_BANANA_DESIGN = { aspectRatio: "2:3", imageSize: "2K" } as const;
// Through the gateway Recraft V4.1 takes only 1024x1024 (1024x1536, 1024x1280, 2048x2048, and
// others were refused, 2026-10-06).
export const RECRAFT_SIZE = "1024x1024";

// Canvas sizes. 1920x1920 is the largest square GPT Image 2.5 makes without experimental sizes.
export const GRID_SIZE = "1920x1920";
export const DESIGN_SIZE = "1024x1536";
export const PHOTO_SIZE = "1024x1024";

// Default qualities; GRID_QUALITY, IMAGE_QUALITY, and PHOTO_QUALITY override them. High looks
// clearly better on illustrations (docs/image-generation/README.md).
export const DEFAULT_QUALITY = { grid: "high", design: "medium", photo: "medium" } as const;
