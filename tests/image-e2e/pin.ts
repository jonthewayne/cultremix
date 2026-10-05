import {
  DEFAULT_QUALITY,
  GRID_SIZE,
  IMAGE_MODEL_TEXT_ONLY,
  IMAGE_MODEL_WITH_IMAGES,
  PHOTO_SIZE,
  VISION_MODEL,
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
  // The suite's word reader, which spells out each design's lettering (at low thinking, judge.ts).
  // OpenAI's models read what a design probably meant: on five hard designs, three reads each, GPT-6
  // Luna read TRRSH as TRASH and a clear LOUD as SLOW (6 of 15 wrong), and GPT-6 and 6.1 Sol read TRRSH
  // as TRASH every time. Gemini 3.1 Pro read all 15 letter for letter, at its default thinking (about
  // 1¢ a read) and at low thinking (about 0.3¢, 7 to 18 s). No model reliably caught an E missing its
  // bottom bar (FIRF): 1 read in 10 did (2026-10-05). It's a preview model; if it's retired, the
  // suite reports its image cases as couldn't run, and this line picks another.
  wordReader: "google/gemini-3.1-pro-preview",
} as const;
