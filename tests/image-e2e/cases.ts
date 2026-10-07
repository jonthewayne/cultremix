import { hairShape, noteSections } from "../../convex/lib/prompts";
import type { RemixPart } from "../../convex/lib/remixParts";

// Every capability the image pipeline aims to support, as cases the suite can rerun: the image model
// with our prompts (generate, photo), and the GPT-6 Luna steps around it (notes, reader, compare).
// Each case says what it supports, when we first tested it, and how a run checks it. CASES.md is
// rendered from this file (bun run test:image --catalog).

export type Group = "words" | "styles" | "people" | "remix" | "layout" | "photo" | "notes" | "reader" | "compare";
// known-limit: tracked for future models; failing doesn't fail a run.
export type Status = "supported" | "known-limit";

type Base = {
  id: string;
  group: Group;
  title: string;
  // The capability, in product terms.
  supports: string;
  // When we first tested it.
  since: string;
  status?: Status;
};

// A question the checker answers about each design. expect defaults to true, and min (how many of
// the four designs must match) to all four.
export type Ask = { id: string; ask: string; expect?: boolean; min?: number };
// Words the checker reads on each design: every word in has, none in not.
export type WordsCheck = { has: Array<string>; not?: Array<string>; min?: number };
// An image the checker sees next to each design, and what the questions call it.
export type Shown = { fixture: string; as: string };
// For a remix that should keep its design: the app's own remix comparison (convex/lib/remixCompare.ts)
// looks at each design next to image 1 and must call it the same design (a variation) with these parts
// unchanged, in at least min of the four designs (default all four). Calibrated 2026-10-05 on designs
// from four earlier runs: 66 of 66 word remixes read as variations with the same subject and style,
// and all kept their layout except three with a removed word; a cactus or dragon in place of the
// subject read as a new subject, and a pixel-art redraw as a new style (three tries each).
export type KeepsCheck = { parts: Array<"subject" | "layout" | "style">; min?: number };

// "subject, layout, and style"
export function keepsParts(keeps: KeepsCheck) {
  const parts = keeps.parts;
  return parts.length > 1 ? `${parts.slice(0, -1).join(", ")}${parts.length > 2 ? "," : ""} and ${parts[parts.length - 1]}` : (parts[0] ?? "");
}

export type GenerateCase = Base & {
  kind: "generate";
  // The studio's numbered images, image 1 first.
  images?: Array<string>;
  // The style mixer. A fixture that's also a numbered image uses its number.
  mixer?: Array<{ fixture: string; weight: number }>;
  request: string;
  // Image 1 is a published design being remixed; words are edits to its remixable-word boxes
  // ("to" empty removes the piece). parts are the design's remixable parts as its creator set them
  // up, and fill is what the remix gives them: photos (fixtures) and, for a character, new words.
  remix?: {
    words?: Array<{ from: string; to: string }>;
    parts?: { list: Array<RemixPart>; fill: Array<{ partId: string; photos?: Array<string>; to?: string }> };
  };
  shows?: Array<Shown>;
  asks: Array<Ask>;
  // Asked once about the whole grid.
  gridAsks?: Array<Ask>;
  words?: WordsCheck;
  keeps?: KeepsCheck;
};

// The model photo: one 1024x1024 photo of someone wearing the design.
export type PhotoCase = Base & { kind: "photo"; design: string; shirt: string; asks: Array<Ask>; words?: WordsCheck };

export type Notes = { summary?: string; kind?: "photo" | "art"; notes: string };
export type NotesCase = Base & {
  kind: "notes";
  fixture: string;
  expect: Array<{ id: string; describe: string; test: (notes: Notes) => boolean }>;
};

type Role = "content" | "style" | "both";
export type ReaderCase = Base & {
  kind: "reader";
  images: Array<string>;
  // Fixtures added only in the style mixer.
  mixer?: Array<string>;
  request: string;
  // Accepted answers for the numbered images' roles, and for whether the request asks for the
  // style's hair (default: no).
  roles: Array<Array<Role>>;
  styleHair?: Array<boolean>;
  // How many of the tries must answer as accepted (default: every try).
  min?: number;
};

export type CompareCase = Base & { kind: "compare"; original: string; remix: string; expect: "variation" | "fork" | "either" };

export type Case = GenerateCase | PhotoCase | NotesCase | ReaderCase | CompareCase;

const section = (n: Notes, name: string) => noteSections(n.notes).find((s) => s.name === name)?.text ?? "";
const quotedPieces = (text: string) => text.split("\n").filter((line) => /["“„«]/u.test(line)).length;

export const CASES: Array<Case> = [
  // ---- Words ----
  {
    kind: "generate",
    id: "words-from-text",
    group: "words",
    title: "Words from a request alone",
    supports: "A design made from a request alone spells its words exactly, in four clearly different compositions.",
    since: "2026-10-02",
    request: "A sunset badge that says DESERT PEOPLE CLUB",
    words: { has: ["DESERT", "PEOPLE", "CLUB"] },
    asks: [{ id: "desert", ask: "Does the design show a desert scene or a sun?" }],
    gridAsks: [{ id: "varied", ask: "Are the four designs clearly different from each other in composition or layout?" }],
  },
  {
    kind: "generate",
    id: "words-not-from-style",
    group: "words",
    status: "known-limit",
    title: "The request's words, never the style's",
    supports:
      "With a style image that has its own words (GROW SLOW), every design spells the request's words letter for letter and borrows none of the style's. Known limit: the style's letterforms sometimes leak into the new words, often in all four designs of a grid (GRASH, TrROH, TRROSH in 2 of 7 suite runs on 2026-10-05). A retest of the same prompt gave 20 of 20 designs right, so two candidate fixes (a copy of the style image with its words removed, and an instruction to letter every word fresh) couldn't be told apart from it. Checking each design's spelling after it's made would catch it.",
    since: "2026-10-01",
    mixer: [{ fixture: "grow-slow", weight: 100 }],
    request: "A raccoon in a tiny crown that says TRASH ROYALTY",
    shows: [{ fixture: "grow-slow", as: "the style image" }],
    words: { has: ["TRASH", "ROYALTY"], not: ["GROW", "SLOW", "GRASH"] },
    asks: [
      { id: "raccoon", ask: "Does the design show a raccoon wearing a crown?" },
      { id: "style", ask: "Is it drawn in the style of the style image: warped cream bubble lettering with layered colored outlines and dense psychedelic illustration?" },
    ],
  },
  {
    kind: "generate",
    id: "words-change-one-image",
    group: "words",
    title: "Change the words on one image",
    supports: "One image and \"change the words\" keeps the image's subject and lettering style and swaps only the words.",
    since: "2026-10-01",
    images: ["lion"],
    request: "Change the words to NIGHT SHIFT",
    shows: [{ fixture: "lion", as: "the original image" }],
    words: { has: ["NIGHT", "SHIFT"], not: ["KING", "BLOCK"] },
    asks: [
      { id: "lion", ask: "Does the design show a lion drawn the way the original image draws its lion: golden-brown detailed fur and mane with dark outlines?" },
      { id: "lettering", ask: "Is the lettering bold cream varsity capitals with dark outlines, like the original image's lettering?" },
    ],
  },

  // ---- Styles ----
  {
    kind: "generate",
    id: "style-copy",
    group: "styles",
    status: "known-limit",
    title: "A style from the mixer",
    supports:
      "A style image in the mixer sets the whole look for a new subject in all four designs, without its own subject, its subject's body parts, or its words. Known limit: at high quality a wolf drawn in the lion's style takes a lion-like mane in about half the designs (2026-10-05). The notes no longer list the mane as a trait, which cleared it at medium quality (12 of 12 wolves), but at high quality the mane comes from the style image itself: removing every mention of it from the prompt, or forbidding a style subject's body parts (which made it worse), left it in about half.",
    since: "2026-09-30",
    mixer: [{ fixture: "lion", weight: 100 }],
    request: "A wolf that says MOON CLUB",
    shows: [{ fixture: "lion", as: "the style image" }],
    words: { has: ["MOON", "CLUB"], not: ["KING", "BLOCK"] },
    asks: [
      { id: "wolf", ask: "Does the design show a wolf?" },
      { id: "no-lion", ask: "Is the main animal a lion rather than a wolf?", expect: false, min: 3 },
      { id: "no-mane", ask: "Does the animal have a lion's mane: a thick ring of long, flowing hair framing its whole face?", expect: false, min: 3 },
      // Without "with arched lettering", which failed wolves drawn in the style with their lettering on a
      // banner below (2026-10-05: 22 of 22 right on saved designs, 15 of 22 before).
      { id: "style", ask: "Is it drawn in the style of the style image: detailed engraved fur strokes in gold, brown, and black with heavy black outlines and a distressed print texture?" },
    ],
  },
  {
    kind: "generate",
    id: "style-named-in-words",
    group: "styles",
    title: "\"In the style of image 2\"",
    supports: "Naming an image's style in words works like adding it to the mixer: the design takes its look, never its people or words.",
    since: "2026-10-02",
    images: ["person", "poster-70s"],
    request: "Reimagine image 1 in the style of image 2",
    shows: [
      { fixture: "person", as: "the photo" },
      { fixture: "poster-70s", as: "the style image" },
    ],
    asks: [
      { id: "likeness", ask: "Is the woman from the photo recognizable, with round glasses and short curly red hair?" },
      { id: "style", ask: "Is it drawn like the style image: a 1970s illustrated poster look in muted mustard, olive, and rust?" },
      { id: "one-person", ask: "Does the design show more than one person?", expect: false },
    ],
  },
  {
    kind: "generate",
    id: "style-of-one-image",
    group: "styles",
    title: "\"A dragon in this style\"",
    supports: "A single image named only for its look becomes a style: a new subject drawn its way, without its own subject or words.",
    since: "2026-10-02",
    images: ["lion"],
    request: "A dragon in this style that says FIRE BREATHER",
    shows: [{ fixture: "lion", as: "the style image" }],
    words: { has: ["FIRE", "BREATHER"], not: ["KING", "BLOCK"] },
    asks: [
      // One design of four may borrow the lion's mane (a ring of spikes around a dragon's face), which
      // reads as half lion (2026-10-05, run 1756: one design, "not a dragon" and "a lion" in some tries).
      // style-copy tracks the same leak where it's worse.
      { id: "dragon", ask: "Does the design show a dragon?", min: 3 },
      { id: "no-lion", ask: "Is the main creature a lion rather than a dragon?", expect: false, min: 3 },
      { id: "style", ask: "Is it drawn in the style of the style image: detailed gold, brown, and black rendering with arched lettering?" },
    ],
  },
  {
    kind: "generate",
    id: "mix-80-20",
    group: "styles",
    title: "Two styles at 80/20",
    supports:
      "A style at 20% still shows plainly in every design while the 80% style leads, through its way of drawing rather than its subject: until 2026-10-05 the pop-art style mostly showed as its woman's long pink hair on the raccoon.",
    since: "2026-09-30",
    mixer: [
      { fixture: "grow-slow", weight: 80 },
      { fixture: "pop-art", weight: 20 },
    ],
    request: "A raccoon in a tiny crown that says TRASH ROYALTY",
    shows: [
      { fixture: "grow-slow", as: "style A" },
      { fixture: "pop-art", as: "style B" },
    ],
    words: { has: ["TRASH", "ROYALTY"] },
    asks: [
      { id: "lead", ask: "Does style A lead the design: its dense, finely detailed psychedelic illustration with mushrooms, swirls, and layered colored outlines?" },
      // Since 2026-10-05 the notes write a style's traits as ways of drawing (cyan shadows, halftone
      // dots) instead of things its image shows (pink hair, a dotted background); those carried no
      // pop-art into the raccoon in 3 of 4 designs of run 1756. This wording answered 42 of 46 saved
      // designs right; "Does the design also clearly show style B's look somewhere" answered 38.
      { id: "accent", ask: "Does any part of the design take style B's colors or shading, such as lavender or purple fur with cyan shadows, neon pink, or Ben-Day halftone dots?" },
      // The style's subject stays out: people and animals get a style's hair only when asked (45 of 48
      // right on saved designs, missing some pink hair, never inventing it).
      { id: "no-wig", ask: "Does the raccoon have long flowing hair, like a person's?", expect: false, min: 3 },
    ],
  },
  {
    kind: "generate",
    id: "mix-50-50",
    group: "styles",
    title: "Two styles at 50/50",
    supports: "Two styles at equal shares blend, each plainly visible in every design.",
    since: "2026-09-30",
    mixer: [
      { fixture: "grow-slow", weight: 100 },
      { fixture: "poster-70s", weight: 100 },
    ],
    request: "A smiling sun that says GOOD DAY",
    shows: [
      { fixture: "grow-slow", as: "style A" },
      { fixture: "poster-70s", as: "style B" },
    ],
    words: { has: ["GOOD", "DAY"] },
    asks: [
      { id: "a", ask: "Does the design clearly show style A's look: warped bubble lettering with layered colored outlines, or psychedelic swirls?" },
      { id: "b", ask: "Does the design also clearly show style B's look: soft 1970s illustration with grainy texture, airbrushed gradients, or rolling hills and landscape?", min: 3 },
    ],
  },
  {
    kind: "generate",
    id: "mix-three",
    group: "styles",
    title: "Three styles at 50/25/25",
    supports:
      "Three styles each show in every design, without the style images' own people. Since 2026-10-05 each smaller style gets a part of every design (the second colors the main subject, the third goes around it); before, the model gave a smaller style a design of its own and drew its image's woman or picnickers there (7 of 16 designs over four runs). With parts, 16 of 16 designs had the pop-art coloring on the raccoon and none had a person.",
    since: "2026-09-30",
    mixer: [
      { fixture: "grow-slow", weight: 100 },
      { fixture: "pop-art", weight: 50 },
      { fixture: "poster-70s", weight: 50 },
    ],
    request: "A raccoon in a tiny crown that says TRASH ROYALTY",
    shows: [
      { fixture: "grow-slow", as: "style A" },
      { fixture: "pop-art", as: "style B" },
      { fixture: "poster-70s", as: "style C" },
    ],
    words: { has: ["TRASH", "ROYALTY"] },
    asks: [
      { id: "a", ask: "Is the design mostly in the style of style A: warped bubble lettering with layered colored outlines?" },
      // Concrete and asked about the design alone: with three references in view the checker missed
      // lavender raccoons. Asked alone it matched the boards: lavender on all 16 new designs and on none
      // of the 16 old ones (2026-10-05).
      { id: "b", ask: "Is the raccoon's fur lavender or purple?" },
      { id: "c", ask: "Is there a 1970s-style landscape or sky in the design, such as mountains, a lake, pine trees, or a big sun with rays or wavy bands?", min: 3 },
      { id: "no-person", ask: "Does the design show a woman or any other person?", expect: false },
    ],
  },

  // ---- People ----
  {
    kind: "generate",
    id: "photo-70s-poster",
    group: "people",
    title: "A photo drawn as a 70s poster",
    supports: "A person from a photo stays recognizable while a style redraws them, face proportions included.",
    since: "2026-10-01",
    images: ["person"],
    mixer: [{ fixture: "poster-70s", weight: 100 }],
    request: "Reimagine image 1 in this style",
    shows: [
      { fixture: "person", as: "the photo" },
      { fixture: "poster-70s", as: "the style image" },
    ],
    asks: [
      { id: "likeness", ask: "Is the woman from the photo recognizable, with round glasses and short curly red hair?", min: 3 },
      { id: "style", ask: "Is she drawn like the style image: a 1970s illustrated poster in muted mustard, olive, and rust?" },
      { id: "faces", ask: "Is her face drawn longer and narrower than in the photo, the way the style image draws faces?", min: 3 },
      { id: "not-photo", ask: "Is the design a realistic photograph rather than an illustration?", expect: false },
    ],
  },
  {
    kind: "generate",
    id: "photo-pop-art",
    group: "people",
    title: "A photo drawn as pop art",
    supports: "The same with a pop-art portrait: the style's palette and dots, and her own hair color unless the request asks otherwise.",
    since: "2026-10-02",
    images: ["person"],
    mixer: [{ fixture: "pop-art", weight: 100 }],
    request: "Reimagine image 1 in this style",
    shows: [
      { fixture: "person", as: "the photo" },
      { fixture: "pop-art", as: "the style image" },
    ],
    asks: [
      { id: "likeness", ask: "Is the woman from the photo recognizable, with round glasses and curly hair?" },
      { id: "style", ask: "Is she drawn like the style image: a pop-art comic look with flat bright color, heavy black outlines, and lavender or cyan skin?" },
      { id: "own-hair-color", ask: "Is her hair pink?", expect: false, min: 3 },
    ],
  },
  {
    kind: "generate",
    id: "photo-pop-art-pink-hair",
    group: "people",
    title: "A hair color on request",
    supports: "A request can change a person's hair color while the style redraws them and her likeness stays: the prompt keeps each person's own hair color only unless the request says otherwise.",
    since: "2026-10-05",
    images: ["person"],
    mixer: [{ fixture: "pop-art", weight: 100 }],
    request: "Reimagine image 1 in this style, with bright pink hair",
    shows: [{ fixture: "person", as: "the photo" }],
    asks: [
      { id: "pink", ask: "Is her hair pink?", min: 3 },
      { id: "likeness", ask: "Is the woman from the photo recognizable, with round glasses and curly hair?" },
    ],
  },
  {
    kind: "generate",
    id: "whole-figure",
    group: "people",
    title: "A whole-body style, her own hair",
    supports: "A cartoon style redraws a person head to toe (long thin legs, big ears) while she keeps her glasses and her own hair.",
    since: "2026-10-04",
    images: ["person"],
    mixer: [{ fixture: "cartoon-boys", weight: 100 }],
    request: "Draw image 1 as a full-body character, head to toe.",
    shows: [
      { fixture: "person", as: "the photo" },
      { fixture: "cartoon-boys", as: "the cartoon style image" },
    ],
    asks: [
      { id: "full-body", ask: "Is she shown full body, from head to toe?" },
      { id: "legs", ask: "Are her legs long and thin like the figures in the cartoon style image?", min: 3 },
      { id: "ears", ask: "Are her ears large and sticking out from her head, like the figures in the cartoon style image?", min: 2 },
      { id: "glasses", ask: "Is she wearing glasses?", min: 3 },
      { id: "own-hair", ask: "Is her hair drawn as tall pointed spikes standing straight up?", expect: false, min: 3 },
    ],
  },
  {
    kind: "generate",
    id: "style-hair-when-asked",
    group: "people",
    title: "The style's hair when asked",
    supports: "Asking for the style's hair gives the person the style's hair shape in her own hair color, keeping her glasses.",
    since: "2026-10-04",
    images: ["person"],
    mixer: [{ fixture: "cartoon-boys", weight: 100 }],
    request: "Draw image 1 as a full-body character, head to toe, with the style's hair.",
    shows: [
      { fixture: "person", as: "the photo" },
      { fixture: "cartoon-boys", as: "the cartoon style image" },
    ],
    asks: [
      { id: "spikes", ask: "Is her hair drawn as tall pointed spikes standing straight up?", min: 3 },
      { id: "glasses", ask: "Is she wearing glasses?", min: 3 },
      { id: "hair-color", ask: "Is her hair red or orange?", min: 3 },
    ],
  },

  // ---- Remix ----
  {
    kind: "generate",
    id: "remix-words",
    group: "remix",
    title: "Remix one word",
    supports: "Changing a remixable word (SLOW to LOUD) puts the new word in all four designs and keeps everything else.",
    since: "2026-10-04",
    images: ["grow-slow"],
    remix: { words: [{ from: "SLOW", to: "LOUD" }] },
    request: "",
    words: { has: ["GROW", "LOUD"], not: ["SLOW"] },
    keeps: { parts: ["subject", "layout", "style"] },
    asks: [],
  },
  {
    kind: "generate",
    id: "remix-two-lines",
    group: "remix",
    title: "Remix two of three lines",
    supports: "Two changed lines at once, with the kept line, the art, and the lettering unchanged.",
    since: "2026-10-04",
    images: ["offline-luxury"],
    remix: { words: [{ from: "OFFLINE", to: "UNPLUGGED" }, { from: "LUXURY", to: "FLEX" }] },
    request: "",
    words: { has: ["UNPLUGGED", "IS", "THE", "NEW", "FLEX"], not: ["OFFLINE", "LUXURY"] },
    keeps: { parts: ["subject", "layout", "style"] },
    asks: [],
  },
  {
    kind: "generate",
    id: "remix-of-remix",
    group: "remix",
    title: "Remix a remix",
    supports: "A remix of a remix changes its own words (LOUD to BOLD) the same way.",
    since: "2026-10-04",
    images: ["grow-loud"],
    remix: { words: [{ from: "LOUD", to: "BOLD" }] },
    request: "",
    words: { has: ["GROW", "BOLD"], not: ["LOUD"] },
    keeps: { parts: ["subject", "layout", "style"] },
    asks: [],
  },
  {
    kind: "generate",
    id: "remix-free-text",
    group: "remix",
    title: "Remix in words, not boxes",
    supports: "A remix asked in words (a new background) keeps the subject, words, and look, and makes the change.",
    since: "2026-10-04",
    images: ["slow-roll-night"],
    remix: {},
    request: "a sunny daytime beach with a big sun instead of the night sky, moon, and stars",
    shows: [{ fixture: "slow-roll-night", as: "the original" }],
    words: { has: ["SLOW", "ROLL"] },
    asks: [
      { id: "snail", ask: "Does the design show the same snail riding a skateboard as the original?" },
      { id: "beach", ask: "Is the scene a sunny daytime beach?" },
      { id: "no-night", ask: "Does the design show a dark night sky or a moon?", expect: false, min: 3 },
    ],
  },
  {
    kind: "generate",
    id: "remix-words-keep-look",
    group: "remix",
    title: "A word remix keeps the look",
    supports: "Without a style, a word remix keeps the original's look exactly.",
    since: "2026-10-04",
    images: ["trash-royalty"],
    remix: { words: [{ from: "ROYALTY", to: "COUTURE" }] },
    request: "",
    shows: [{ fixture: "trash-royalty", as: "the original" }],
    words: { has: ["TRASH", "COUTURE"], not: ["ROYALTY"] },
    asks: [
      { id: "raccoon", ask: "Does the design show the same raccoon with a crown and sunglasses?" },
      { id: "look", ask: "Does it keep the original's look: graffiti lettering with neon pink and cyan spray splatter?" },
    ],
  },
  {
    kind: "generate",
    id: "remix-words-with-style",
    group: "remix",
    title: "A word remix with a style",
    supports: "A style in the mixer restyles a remix while its composition, subjects, and new words stay.",
    since: "2026-10-04",
    images: ["trash-royalty"],
    mixer: [{ fixture: "pop-art", weight: 100 }],
    remix: { words: [{ from: "ROYALTY", to: "COUTURE" }] },
    request: "",
    shows: [
      { fixture: "trash-royalty", as: "the original" },
      { fixture: "pop-art", as: "the style image" },
    ],
    words: { has: ["TRASH", "COUTURE"], not: ["ROYALTY"] },
    asks: [
      { id: "raccoon", ask: "Does the design show a raccoon with a crown and sunglasses?" },
      { id: "style", ask: "Does it show the style image's pop-art look, such as lavender or cyan coloring or Ben-Day halftone dots?", min: 3 },
    ],
  },
  {
    kind: "generate",
    id: "remix-add-words",
    group: "remix",
    title: "Add words in a remix",
    supports: "A remix can add words in its request (SINCE 1999) and keep the design's own words.",
    since: "2026-10-04",
    images: ["grow-slow"],
    remix: {},
    request: 'Add the words "SINCE 1999" in small letters under the mushroom.',
    words: { has: ["GROW", "SLOW", "SINCE", "1999"] },
    keeps: { parts: ["subject", "layout", "style"] },
    asks: [],
  },
  {
    kind: "generate",
    id: "remix-longer-and-removed",
    group: "remix",
    title: "Longer words and a removed word",
    supports: "A box can take much longer words (fitted smaller or over more lines), and an emptied box removes its words.",
    since: "2026-10-04",
    images: ["grow-slow"],
    remix: { words: [{ from: "GROW", to: "GROW WILD AND FREE" }, { from: "SLOW", to: "" }] },
    request: "",
    words: { has: ["GROW", "WILD", "AND", "FREE"], not: ["SLOW"] },
    // Removing a word moves the lettering, so the layout may change.
    keeps: { parts: ["subject", "style"] },
    asks: [],
  },
  {
    kind: "generate",
    id: "remix-swap-character",
    group: "remix",
    title: "Swap the character",
    supports:
      "A remix that swaps the main character (a pencil-sketch lion to a wolf) keeps the sketch style, the layout, and the words, and stays a variation of the original.",
    since: "2026-10-05",
    images: ["lion-sketch"],
    remix: {},
    request: "Change the lion to a wolf",
    words: { has: ["WILD", "AT", "HEART"] },
    keeps: { parts: ["layout", "style"] },
    asks: [
      { id: "wolf", ask: "Does the design show a wolf?" },
      { id: "no-lion", ask: "Is the animal a lion rather than a wolf?", expect: false },
      { id: "sketch", ask: "Is it drawn as a graphite pencil sketch with hatched shading?" },
    ],
  },
  {
    kind: "generate",
    id: "remix-parts-family",
    group: "remix",
    title: "A family as Santa, Mrs. Claus, and the elves",
    supports:
      "A remix fills a design's remixable people and group with photos: dad becomes Santa, mom Mrs. Claus, and four relatives become the elves where the design has three, each recognizable, in the design's look, and it stays a variation.",
    since: "2026-10-06",
    images: ["santa-elves"],
    remix: {
      parts: {
        list: [
          { id: "p1", kind: "person", label: "Santa", text: "Santa in his red suit", on: true, empty: "keep" },
          { id: "p2", kind: "person", label: "Mrs. Claus", text: "Mrs. Claus in red", on: true, empty: "keep" },
          { id: "p3", kind: "group", label: "Elves", text: "elves in green outfits", on: true, count: 3, max: 6 },
        ],
        fill: [
          { partId: "p1", photos: ["family-dad"] },
          { partId: "p2", photos: ["family-mom"] },
          { partId: "p3", photos: ["family-girl", "family-boy", "family-toddler", "family-grandma"] },
        ],
      },
    },
    request: "",
    words: { has: ["MERRY", "BRIGHT"] },
    keeps: { parts: ["style"] },
    asks: [
      { id: "four-elves", ask: "Are there exactly four elves (characters in green elf outfits and pointed hats), no more and no fewer?" },
      { id: "santa-dad", ask: "Does Santa have a short dark beard and rectangular glasses, rather than a long white beard?" },
      { id: "mrs-claus-mom", ask: "Does Mrs. Claus have long curly auburn or red hair?" },
      { id: "braids", ask: "Is one of the elves a girl with two blond braids?" },
      { id: "grandma", ask: "Is one of the elves an older woman with short white hair and round glasses?" },
    ],
  },
  {
    kind: "generate",
    id: "remix-parts-group-size",
    group: "remix",
    title: "More elves, Mrs. Claus left out",
    supports:
      "A group takes as many photos as the creator allows (six elves where the design has three), a person with no photo is left out when the creator's rule says so, and the remix still reads as a variation because the creator opened those parts.",
    since: "2026-10-06",
    images: ["santa-elves"],
    remix: {
      parts: {
        list: [
          { id: "p1", kind: "person", label: "Santa", text: "Santa in his red suit", on: true, empty: "keep" },
          { id: "p2", kind: "person", label: "Mrs. Claus", text: "Mrs. Claus in red", on: true, empty: "omit" },
          { id: "p3", kind: "group", label: "Elves", text: "elves in green outfits", on: true, count: 3, max: 6 },
        ],
        fill: [{ partId: "p3", photos: ["family-dad", "family-mom", "family-girl", "family-boy", "family-toddler", "family-grandma"] }],
      },
    },
    request: "",
    words: { has: ["MERRY", "BRIGHT"] },
    keeps: { parts: ["style"] },
    asks: [
      { id: "six-elves", ask: "Are there exactly six elves (characters in green elf outfits and pointed hats), no more and no fewer?" },
      { id: "no-mrs-claus", ask: "Is there a Mrs. Claus, or any woman in a red Santa-style dress who isn't an elf?", expect: false },
      { id: "santa-kept", ask: "Does Santa have a long white beard?" },
      { id: "elf-dad", ask: "Is one of the elves a man with a short dark beard and rectangular glasses?" },
    ],
  },

  // ---- Layout ----
  {
    kind: "generate",
    id: "color-blocks",
    group: "layout",
    title: "Solid color panels",
    supports: "Designs that are solid rectangles still come back on a transparent background, and the cutter cuts all four.",
    since: "2026-10-02",
    request: "A solid rectangular retro gig poster for a band called THE NIGHT OWLS, filling a full panel of color",
    words: { has: ["NIGHT", "OWLS"] },
    // Asked alone, "Is the design a solid rectangular poster panel?" said no to a red poster with a
    // cream frame inside it 5 of 6 times; this wording answered 46 of 46 right on every saved panel
    // and on cut-out designs (2026-10-05).
    asks: [{ id: "panel", ask: "Is the design one filled rectangle with straight outer edges, like a printed poster, even if it has a border or a frame inside it?" }],
  },
  {
    kind: "generate",
    id: "four-images",
    group: "layout",
    title: "Four images in one call",
    supports: "One call takes several images and uses each one's subject: asked for a sticker per image, the grid comes back as one design per image, each in its own image's look.",
    since: "2026-10-02",
    images: ["lion", "cat-photo", "person", "slow-roll-night"],
    request: "A sticker sheet with one sticker for each attached image, each showing that image's main subject drawn the way that image draws it",
    asks: [],
    gridAsks: [
      { id: "all", ask: "Across the four designs, do a lion, a cat, a woman with curly red hair and glasses, and a snail on a skateboard all appear?" },
    ],
  },

  // ---- Model photo ----
  {
    kind: "photo",
    id: "model-photo",
    group: "photo",
    title: "Model photo",
    supports: "A street-style photo of a model wearing the design, with the graphic reproduced faithfully.",
    since: "2026-09-29",
    design: "grow-slow",
    shirt: "#efe6d2",
    words: { has: ["GROW", "SLOW"] },
    asks: [
      { id: "worn", ask: "Is a person wearing a t-shirt with the design printed on the front?" },
      { id: "faithful", ask: "Does the printed graphic match the design: the same mushrooms and lettering?" },
      { id: "photo", ask: "Is it a realistic photograph?" },
    ],
  },

  // ---- Notes (GPT-6 Luna) ----
  {
    kind: "notes",
    id: "notes-words-grow-slow",
    group: "notes",
    title: "Notes read stylized lettering",
    supports: "The notes quote warped bubble lettering exactly.",
    since: "2026-10-01",
    fixture: "grow-slow",
    expect: [{ id: "words", describe: "Words quotes GROW and SLOW", test: (n) => /\bGROW\b/u.test(section(n, "Words")) && /\bSLOW\b/u.test(section(n, "Words")) }],
  },
  {
    kind: "notes",
    id: "notes-words-lines",
    group: "notes",
    title: "Notes read stacked lines",
    supports: "The notes quote every line of stacked typography.",
    since: "2026-10-04",
    fixture: "offline-luxury",
    expect: [
      {
        id: "words",
        describe: "Words quotes OFFLINE, IS THE NEW, and LUXURY",
        test: (n) => ["OFFLINE", "IS THE NEW", "LUXURY"].every((w) => section(n, "Words").toUpperCase().includes(w)),
      },
    ],
  },
  {
    kind: "notes",
    id: "notes-words-arched",
    group: "notes",
    title: "Notes read arched lettering",
    supports: "The notes quote arched varsity lettering exactly.",
    since: "2026-10-01",
    fixture: "lion",
    expect: [{ id: "words", describe: "Words quotes KING OF THE BLOCK", test: (n) => section(n, "Words").toUpperCase().includes("KING OF THE BLOCK") }],
  },
  {
    kind: "notes",
    id: "notes-newspaper",
    group: "notes",
    title: "Notes list every piece of text",
    supports: "On a newspaper page, the notes list the masthead, headline, and many separate pieces of text.",
    since: "2026-09-30",
    fixture: "newspaper",
    expect: [
      { id: "masthead", describe: "Words quotes THE DAILY REMIX", test: (n) => section(n, "Words").toUpperCase().includes("THE DAILY REMIX") },
      { id: "headline", describe: "Words quotes LOCAL CAT ELECTED MAYOR", test: (n) => section(n, "Words").toUpperCase().includes("LOCAL CAT ELECTED MAYOR") },
      { id: "pieces", describe: "Words lists at least 10 separate pieces", test: (n) => quotedPieces(section(n, "Words")) >= 10 },
    ],
  },
  {
    kind: "notes",
    id: "notes-figure",
    group: "notes",
    title: "Notes describe how a style draws people",
    supports: "For a cartoon style, Figure drawing gives proportions in numbers and its Hair line names the style's spiky hair.",
    since: "2026-10-04",
    fixture: "cartoon-boys",
    expect: [
      // Either "seven to eight heads tall" or "heads about one-sixth of their total height" (2 of 6 runs on 2026-10-05).
      {
        id: "heads-tall",
        describe: "Figure drawing says how many heads tall, or the head's share of the height",
        test: (n) => /heads?\s+tall|\b(one|a)[-\s](third|quarter|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\b|\b1\/\d+\b/iu.test(section(n, "Figure drawing")),
      },
      { id: "hair", describe: "its Hair line names spikes", test: (n) => /spik/iu.test(hairShape(n.notes)) },
    ],
  },
  {
    kind: "notes",
    id: "notes-photo",
    group: "notes",
    title: "Notes on a photo of a person",
    supports: "A photo is marked as a photo, and its Hair line describes her own curls.",
    since: "2026-10-04",
    fixture: "person",
    expect: [
      { id: "kind", describe: "Kind is photo", test: (n) => n.kind === "photo" },
      { id: "hair", describe: "its Hair line describes her curls", test: (n) => /curl/iu.test(hairShape(n.notes)) },
    ],
  },
  {
    kind: "notes",
    id: "notes-hair-portrait",
    group: "notes",
    title: "Notes describe a portrait's hair",
    supports: "The Hair line describes the hair's shape and texture without its color, so a request can ask for it on someone else.",
    since: "2026-10-04",
    fixture: "pop-art",
    expect: [{ id: "hair", describe: "its Hair line describes long waves or locks, without a color", test: (n) => /wav|lock|flow|swoop|curl/iu.test(hairShape(n.notes)) && !/pink/iu.test(hairShape(n.notes)) }],
  },
  {
    kind: "notes",
    id: "notes-hair-poster",
    group: "notes",
    title: "Notes describe a poster's hair",
    supports: "The Hair line describes how the poster draws hair, long flowing waves, so a request can ask for it.",
    since: "2026-10-04",
    fixture: "poster-70s",
    expect: [{ id: "hair", describe: "its Hair line describes long flowing waves", test: (n) => /wav|flow|ribbon|long/iu.test(hairShape(n.notes)) }],
  },
  ...readerCases(),
  ...compareCases(),
];

// What a request wants from each numbered image (convex/lib/roleReader.ts), 23 requests written to
// be tricky (2026-10-02, extended 2026-10-04).
function readerCases(): Array<ReaderCase> {
  const ADDED_OCT_5 = new Set(["reader-colors-second", "reader-keep-own-colors"]);
  const rows: Array<[string, string, Array<string>, Array<string>, string, Array<Array<Role>>, Array<boolean>?, number?]> = [
    ["reader-mixer-plain", "A plain request with a mixer style", ["person"], ["cartoon-boys"], "Draw image 1 as a full-body character, head to toe.", [["content"]]],
    ["reader-mixer-hair-words", "Spiky hair described in words", ["person"], ["cartoon-boys"], "Draw image 1 as a full-body character, head to toe, with her hair sticking straight up in spikes like the style.", [["content"]], [true, false]],
    ["reader-this-style", "\"In this style\" means the mixer", ["person"], ["cartoon-boys"], "make her in this style, waving", [["content"]]],
    ["reader-cartoon-no-style", "A style in words, no style image", ["person"], [], "Draw her as a full-body cartoon character", [["content"]]],
    ["reader-style-of-image-2", "\"In the style of image 2\"", ["person", "poster-70s"], [], "Reimagine image 1 in the style of image 2", [["content", "style"]]],
    ["reader-belongs", "\"Belongs in the second picture\"", ["person", "poster-70s"], [], "make her look like she belongs in the second picture", [["content", "style"], ["content", "both"]]],
    ["reader-draws-people", "\"The way the poster draws people\"", ["person", "poster-70s"], [], "draw the woman the way the poster draws people", [["content", "style"]]],
    ["reader-dragon", "\"A dragon in this style\"", ["lion"], [], "a dragon in this style", [["style"]]],
    ["reader-colors", "\"The colors of image 2\"", ["lion", "pop-art"], [], "remix this with the colors of image 2", [["content", "style"]]],
    ["reader-swap", "\"Swap the lion for my cat\"", ["lion", "cat-photo"], [], "swap the lion for my cat", [["content", "content"]]],
    ["reader-into-scene", "\"Put the woman into the picnic scene\"", ["person", "poster-70s"], [], "put the woman into the picnic scene", [["content", "content"]]],
    ["reader-keep-look", "\"Keep image 1's look\"", ["grow-slow"], [], "keep image 1's look but change the words to GROW LOUD", [["both"], ["content"]]],
    ["reader-negated", "\"Not the style of image 2\"", ["person", "poster-70s"], [], "not the style of image 2, just put her on the picnic blanket", [["content", "content"]]],
    ["reader-scene-and-mixer", "A scene from image 2, the mixer's style", ["person", "poster-70s"], ["cartoon-boys"], "put her on the picnic blanket from image 2, drawn in the style", [["content", "content"]]],
    ["reader-words-and-mixer", "Change the words, with a mixer style", ["grow-slow"], ["cartoon-boys"], "change the words to GROW LOUD", [["content"]]],
    ["reader-like-lion", "\"Draw her like the lion design\"", ["person", "lion"], [], "draw her like the lion design", [["content", "style"]]],
    // Read as "both" in 7 of 8 tries on 2026-10-05, and 6 of 6 after the reader learned who the subject
    // is when a request borrows colors. Two tries per run, one must match.
    ["reader-own-colors", "\"Use image 1's colors with the style\"", ["person"], ["pop-art"], "use image 1's colors with the style", [["both"]], undefined, 1],
    // Read as "both" in 5 of 6 tries before that change, which would have drawn the pop-art woman
    // too; 5 of 6 as "style" after (2026-10-05).
    ["reader-colors-second", "\"Use the colors from the second image\"", ["grow-slow", "pop-art"], [], "use the colors from the second image", [["content", "style"]], undefined, 1],
    ["reader-keep-own-colors", "\"Keep the lion's own colors, drawn like image 2\"", ["lion", "pop-art"], [], "keep the lion's own colors but draw it like image 2", [["both", "style"]]],
    ["reader-style-hair", "\"With the style's hair\"", ["person"], ["cartoon-boys"], "Draw image 1 as a full-body character, head to toe, with the style's hair.", [["content"]], [true]],
    ["reader-cartoon-hair", "\"The cartoon's spiky hair\"", ["person"], ["cartoon-boys"], "give her the cartoon's spiky hair", [["content"]], [true]],
    ["reader-hair-like-image-2", "\"Hair like image 2\"", ["person", "cartoon-boys"], [], "draw image 1 in the style of image 2, with hair like image 2", [["content", "style"]], [true]],
    ["reader-keep-curls", "\"Keep her curls\"", ["person"], ["cartoon-boys"], "full body, and keep her curls", [["content"]], [false]],
    ["reader-pink-hair", "\"Make her hair pink\"", ["person"], ["cartoon-boys"], "make her hair pink", [["content"]], [false]],
    ["reader-mohawk", "\"Give her a mohawk\"", ["person"], ["cartoon-boys"], "give her a mohawk", [["content"]], [false]],
  ];
  return rows.map(([id, title, images, mixer, request, roles, styleHair, min]) => ({
    kind: "reader",
    id,
    group: "reader",
    title,
    supports: "The request reader decides what the request wants from each image (what's in it, only its look, or both) and whether it asks for the style's hair.",
    since: ADDED_OCT_5.has(id)
      ? "2026-10-05"
      : id.includes("hair") || id.includes("curls") || id.includes("mohawk") || id.includes("mixer") || id.includes("this-style")
        ? "2026-10-04"
        : "2026-10-02",
    images,
    mixer,
    request,
    roles,
    styleHair,
    min,
  }));
}

// How far a remix moved from its original (convex/lib/remixJudge.ts), 2026-10-05. A design is its look
// and its layout: a swapped subject is a variation, a full restyle a fork (Jon, 2026-10-05).
function compareCases(): Array<CompareCase> {
  const rows: Array<[string, string, CompareCase["expect"], string]> = [
    ["grow-slow", "grow-loud", "variation", "One word changed"],
    ["grow-loud", "grow-bold", "variation", "A remix of a remix, one word changed"],
    ["grow-slow", "since-1999", "variation", "A small line of words added"],
    ["grow-slow", "grow-wild-free", "variation", "Words reworked and one removed"],
    ["offline-luxury", "unplugged-flex", "variation", "Two lines changed"],
    ["trash-royalty", "trash-couture", "variation", "One word changed"],
    ["slow-roll-night", "slow-roll-beach", "variation", "A new background, same subject and words"],
    ["lion", "lion-night-shift", "variation", "All the words changed"],
    ["grow-slow", "grow-slow", "variation", "Identical"],
    ["trash-royalty", "trash-couture-pop", "either", "Restyled with pop art, same layout and lettering"],
    ["trash-royalty", "trash-couture-70s", "either", "Restyled with a 70s poster, same layout and lettering"],
    ["lion", "dragon", "variation", "The subject swapped, same look and layout"],
    ["grow-slow", "grow-slow-cactus", "variation", "The mushrooms swapped for a cactus, same look and lettering"],
    ["lion-sketch", "wolf-sketch", "variation", "A pencil-sketch lion swapped for a wolf"],
    ["grow-slow", "grow-slow-pixel", "fork", "Redrawn as pixel art, same layout and colors"],
    ["person", "person-cartoon", "fork", "A photo redrawn as a full-body cartoon"],
    ["person", "person-70s", "fork", "A photo redrawn as a 70s poster"],
    ["grow-slow", "slow-roll-night", "fork", "An unrelated design"],
  ];
  return rows.map(([original, remix, expect, title]) => ({
    kind: "compare",
    id: `compare-${original}-to-${remix}`,
    group: "compare",
    title,
    supports:
      "Comparing a remix with its original: a design is its look and its layout, so new words, a swapped subject, new colors, or a new background keep it a variation, while a full restyle or a rebuilt layout may be a fork.",
    since: "2026-10-05",
    original,
    remix,
    expect,
  }));
}
