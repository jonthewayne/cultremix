import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// The suite's reference images, in tests/image-e2e/fixtures/<id>.webp (at most 1024 px on a side,
// like the studio's uploads). Every one was made by CultRemix's own image calls: made-up people and
// our own designs, so they're safe in this public repository. `what` is how the suite describes
// each image where production would use its notes' summary (the request reader's cases).
export type Fixture = { id: string; what: string; kind: "photo" | "art"; origin: string };

export const FIXTURES: Array<Fixture> = [
  // Inputs made for the image checks (~/cultremix-imagecheck, GPT Image 2.5 Flare).
  { id: "person", kind: "photo", what: "a photo of a made-up woman with short copper-red curls, round glasses, freckles, and a gap-tooth smile in a park", origin: "Flare, 2026-09-30" },
  { id: "poster-70s", kind: "art", what: "a 1970s poster of two friends at a picnic under a big sun, drawn as elongated caricatures", origin: "Flare, 2026-09-30" },
  { id: "pop-art", kind: "art", what: "a pop-art comic portrait of a made-up woman with neon-pink hair and Ben-Day dot freckles", origin: "Flare, 2026-10-02" },
  { id: "lion", kind: "art", what: "a distressed lion-head t-shirt graphic with arched lettering KING OF THE BLOCK", origin: "Flare, 2026-10-01" },
  { id: "newspaper", kind: "photo", what: "a photo of a vintage newspaper front page, THE DAILY REMIX", origin: "Flare, 2026-09-30" },
  { id: "cat-photo", kind: "photo", what: "a photo of an orange cat sitting on laundromat washing machines", origin: "Flare, 2026-09-29" },
  // Published designs on dev (members' studio designs).
  { id: "grow-slow", kind: "art", what: "a psychedelic mushroom t-shirt graphic, GROW SLOW (CR 101-001)", origin: "dev works/101/001" },
  { id: "grow-loud", kind: "art", what: "a psychedelic mushroom t-shirt graphic, GROW LOUD (CR 101-003, a remix of GROW SLOW)", origin: "dev works/101/003" },
  { id: "offline-luxury", kind: "art", what: "a vintage ocean-wave typography graphic, OFFLINE IS THE NEW LUXURY (CR 102-001)", origin: "dev works/102/001" },
  { id: "trash-royalty", kind: "art", what: "a graffiti raccoon in a crown and sunglasses, TRASH ROYALTY (CR 103-001)", origin: "dev works/103/001" },
  { id: "slow-roll-night", kind: "art", what: "a neon snail on a skateboard under a night sky, SLOW ROLL (CR 104-001)", origin: "dev works/104/001" },
  { id: "cartoon-boys", kind: "art", what: "a cartoon of three tall boys with spiky hair, huge ears, and hoodies", origin: "dev studio, 2026-10-04" },
  // Designs whose lettering leaked from their style image, GROW SLOW: TRASH drawn as TrROH, TRROW, and TRROSH.
  { id: "trash-royalty-trroh", kind: "art", what: "a psychedelic raccoon in a crown whose lettering reads TrROH ROYALTY, a misspelled TRASH ROYALTY", origin: "suite run 20261005-1915, words-not-from-style design 1" },
  { id: "trash-royalty-trrow", kind: "art", what: "the psychedelic raccoon in a crown with its lettering reading TRROW ROYALTY, TRASH three letters off", origin: "suite run 20261005-1915, words-not-from-style design 2" },
  // Heavy script lettering that reads wrong without its request (WANDA as MAMA); the image model
  // also drew the prompt's closing "Nothing else", which makes a third line the request never asked for.
  { id: "wanda-knows-best", kind: "art", what: "heavy white brush-script lettering with black shadows and speckled grain: Wanda, Knows best, Nothing else", origin: "Flare, 2026-10-11" },
  { id: "trash-royalty-trrosh", kind: "art", what: "the psychedelic raccoon in a crown with its lettering reading TRROSH ROYALTY, TRASH two letters off", origin: "suite run 20261005-1915, words-not-from-style design 3" },
  // Remixes made on dev, for the remix comparison.
  { id: "since-1999", kind: "art", what: "GROW SLOW with SINCE 1999 added under the mushroom", origin: "dev studio, 2026-10-04" },
  { id: "grow-wild-free", kind: "art", what: "the mushroom design reading GROW WILD AND FREE", origin: "dev studio, 2026-10-04" },
  { id: "grow-bold", kind: "art", what: "the mushroom design reading GROW BOLD", origin: "dev studio, 2026-10-04" },
  { id: "unplugged-flex", kind: "art", what: "the wave design reading UNPLUGGED IS THE NEW FLEX", origin: "dev studio, 2026-10-04" },
  { id: "trash-couture", kind: "art", what: "the raccoon design reading TRASH COUTURE", origin: "dev studio, 2026-10-04" },
  { id: "trash-couture-pop", kind: "art", what: "TRASH COUTURE restyled with the pop-art portrait", origin: "dev studio, 2026-10-04" },
  { id: "trash-couture-70s", kind: "art", what: "TRASH COUTURE restyled with the 70s poster", origin: "dev studio, 2026-10-04" },
  { id: "slow-roll-beach", kind: "art", what: "SLOW ROLL with a sunny beach instead of the night sky", origin: "dev studio, 2026-10-04" },
  { id: "lion-night-shift", kind: "art", what: "the lion design reading NIGHT SHIFT", origin: "dev studio, 2026-10-01" },
  { id: "dragon", kind: "art", what: "a dragon in the lion design's style, FIRE BREATHER", origin: "dev studio, 2026-10-02" },
  { id: "person-cartoon", kind: "art", what: "the woman from the photo as a full-body cartoon", origin: "dev studio, 2026-10-04" },
  { id: "person-70s", kind: "art", what: "the woman from the photo drawn as a 1970s poster", origin: "dev studio, 2026-10-02" },
  { id: "grow-slow-pixel", kind: "art", what: "GROW SLOW redrawn as pixel art, same layout and colors", origin: "dev studio, 2026-10-05" },
  { id: "grow-slow-cactus", kind: "art", what: "GROW SLOW's lettering and frame around a desert cactus instead of the mushrooms", origin: "dev studio, 2026-10-05" },
  // A character swap in the same look (Jon's example: a hand-drawn lion with words, changed to a wolf).
  { id: "lion-sketch", kind: "art", what: "a pencil sketch of a lion's head under hand-lettered WILD AT HEART", origin: "Flare, 2026-10-05" },
  { id: "wolf-sketch", kind: "art", what: "the pencil-sketch lion design with a wolf in its place", origin: "remix of lion-sketch, Sunburst, 2026-10-05" },
  // Remixable parts: a design with Santa, Mrs. Claus, and three elves, and a made-up family whose
  // photos fill its parts (Jon's example: a family as Santa's elves).
  { id: "santa-elves", kind: "art", what: "a vintage storybook Santa, Mrs. Claus, and three elves over a MERRY & BRIGHT banner", origin: "dev studio, Sunburst, 2026-10-06" },
  { id: "family-dad", kind: "photo", what: "a photo of a made-up man in his forties with a short dark beard, rectangular glasses, and a gray hoodie", origin: "Sunburst, 2026-10-06" },
  { id: "family-mom", kind: "photo", what: "a photo of a made-up woman in her forties with long curly auburn hair and freckles", origin: "Sunburst, 2026-10-06" },
  { id: "family-girl", kind: "photo", what: "a photo of a made-up girl about eight with two blond braids and a gap-toothed smile", origin: "Sunburst, 2026-10-06" },
  { id: "family-boy", kind: "photo", what: "a photo of a made-up boy about twelve with short black hair and a red baseball cap", origin: "Sunburst, 2026-10-06" },
  { id: "family-toddler", kind: "photo", what: "a photo of a made-up toddler with curly brown hair in a blue striped shirt", origin: "Sunburst, 2026-10-06" },
  { id: "family-grandma", kind: "photo", what: "a photo of a made-up woman in her seventies with short white hair and round glasses", origin: "Sunburst, 2026-10-06" },
];

export const FIXTURE_DIR = fileURLToPath(new URL("./fixtures", import.meta.url));

export function fixture(id: string) {
  const found = FIXTURES.find((f) => f.id === id);
  if (!found) throw new Error(`No fixture "${id}".`);
  return found;
}

export function fixturePath(id: string) {
  return join(FIXTURE_DIR, `${id}.webp`);
}

export function fixtureExists(id: string) {
  return existsSync(fixturePath(id));
}
