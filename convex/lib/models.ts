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

export function imageModelFor(imageCount: number) {
  return imageCount > 0 ? IMAGE_MODEL_WITH_IMAGES : IMAGE_MODEL_TEXT_ONLY;
}

// Canvas sizes. 1920x1920 is the largest square GPT Image 2.5 makes without experimental sizes.
export const GRID_SIZE = "1920x1920";
export const DESIGN_SIZE = "1024x1536";
export const PHOTO_SIZE = "1024x1024";

// Default qualities; GRID_QUALITY, IMAGE_QUALITY, and PHOTO_QUALITY override them. High looks
// clearly better on illustrations (docs/image-generation/README.md).
export const DEFAULT_QUALITY = { grid: "high", design: "medium", photo: "medium" } as const;
