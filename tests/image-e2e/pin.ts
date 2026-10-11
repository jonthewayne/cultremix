import {
  DEFAULT_QUALITY,
  GRID_SIZE,
  IMAGE_MODEL_TEXT_ONLY,
  IMAGE_MODEL_WITH_IMAGES,
  PHOTO_SIZE,
  VISION_MODEL,
  WORD_READER_MODEL,
} from "../../convex/lib/models";

// What the suite runs against by default: production's own models and settings
// (convex/lib/models.ts), so a passing run says what ships works. The baseline for this pin is
// baselines/<name>.json. Changing production's models means a new pin name and a new baseline
// (README.md, "Trying a new model").
export const PIN = {
  name: "gpt-image-2.5",
  imageWithImages: IMAGE_MODEL_WITH_IMAGES,
  imageTextOnly: IMAGE_MODEL_TEXT_ONLY,
  gridSize: GRID_SIZE,
  gridQuality: DEFAULT_QUALITY.grid,
  photoSize: PHOTO_SIZE,
  photoQuality: DEFAULT_QUALITY.photo,
  // Notes, the request reader, and the remix comparison.
  vision: VISION_MODEL,
  // The suite's own checker, which looks at each design and answers the cases' questions.
  checker: VISION_MODEL,
  // The word reader, which spells out each design's lettering (at low thinking, judge.ts): the one
  // the studio's spelling check uses (convex/lib/models.ts says why it's Gemini). If it's retired,
  // the suite reports its image cases as couldn't run until models.ts picks another.
  wordReader: WORD_READER_MODEL,
} as const;
