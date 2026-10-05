import { hairShape, noteSections } from "../../convex/lib/prompts";

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

export type GenerateCase = Base & {
  kind: "generate";
  // The studio's numbered images, image 1 first.
  images?: Array<string>;
  // The style mixer. A fixture that's also a numbered image uses its number.
  mixer?: Array<{ fixture: string; weight: number }>;
  request: string;
  // Image 1 is a published design being remixed; words are edits to its remixable-word boxes
  // ("to" empty removes the piece).
  remix?: { words?: Array<{ from: string; to: string }> };
  shows?: Array<Shown>;
  asks: Array<Ask>;
  // Asked once about the whole grid.
  gridAsks?: Array<Ask>;
  words?: WordsCheck;
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
const sameDesign = (what: string): Ask => ({
  id: "same-design",
  ask: `Apart from its words, which are meant to differ, does it keep the original's design: ${what}?`,
  min: 3,
});

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
    supports: "With a style image that has its own words (GROW SLOW), every design spells the request's words letter for letter and borrows none of the style's. Known limit: on 2026-10-05 three of four designs read GRASH or GROW for TRASH (the style's letterforms leak into new words), so this is tracked, not promised.",
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
    supports: "A style image in the mixer sets the whole look for a new subject in all four designs, without its own subject or words. Known limit: with a lion as the style, a wolf takes on a lion's mane in about half the designs (2026-10-05).",
    since: "2026-09-30",
    mixer: [{ fixture: "lion", weight: 100 }],
    request: "A wolf that says MOON CLUB",
    shows: [{ fixture: "lion", as: "the style image" }],
    words: { has: ["MOON", "CLUB"], not: ["KING", "BLOCK"] },
    asks: [
      { id: "wolf", ask: "Does the design show a wolf?" },
      { id: "no-lion", ask: "Is the main animal a lion rather than a wolf?", expect: false, min: 3 },
      { id: "style", ask: "Is it drawn in the style of the style image: detailed engraved fur in gold, brown, and black, with arched lettering?" },
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
      { id: "dragon", ask: "Does the design show a dragon?" },
      { id: "no-lion", ask: "Is the main creature a lion rather than a dragon?", expect: false },
      { id: "style", ask: "Is it drawn in the style of the style image: detailed gold, brown, and black rendering with arched lettering?" },
    ],
  },
  {
    kind: "generate",
    id: "mix-80-20",
    group: "styles",
    title: "Two styles at 80/20",
    supports: "A style at 20% still shows plainly in every design while the 80% style leads.",
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
      { id: "accent", ask: "Does the design also clearly show style B's look somewhere, such as Ben-Day halftone dots, neon pink, or lavender with cyan shading?" },
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
    status: "known-limit",
    title: "Three styles at 50/25/25",
    supports: "Three styles each show in every design. Known limit: the model gives each style about three visible levels, and the third style tends to land in one design instead of blending into each.",
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
      { id: "b", ask: "Does the design clearly show style B's look, such as Ben-Day halftone dots, neon pink, or lavender with cyan shading?" },
      { id: "c", ask: "Does the design clearly show style C's look: muted 1970s mustard, olive, and rust colors with soft grain?" },
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
    shows: [{ fixture: "grow-slow", as: "the original" }],
    words: { has: ["GROW", "LOUD"], not: ["SLOW"] },
    asks: [sameDesign("the same mushrooms, layout, and warped bubble lettering")],
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
    shows: [{ fixture: "offline-luxury", as: "the original" }],
    words: { has: ["UNPLUGGED", "IS", "THE", "NEW", "FLEX"], not: ["OFFLINE", "LUXURY"] },
    asks: [sameDesign("the same curling wave and vintage lettering style")],
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
    shows: [{ fixture: "grow-loud", as: "the original" }],
    words: { has: ["GROW", "BOLD"], not: ["LOUD"] },
    asks: [sameDesign("the same mushrooms, layout, and warped bubble lettering")],
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
    shows: [{ fixture: "grow-slow", as: "the original" }],
    words: { has: ["GROW", "SLOW", "SINCE", "1999"] },
    asks: [sameDesign("the same mushrooms, layout, and warped bubble lettering")],
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
    shows: [{ fixture: "grow-slow", as: "the original" }],
    words: { has: ["GROW", "WILD", "AND", "FREE"], not: ["SLOW"] },
    asks: [sameDesign("the same mushrooms and warped bubble lettering")],
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
    asks: [{ id: "panel", ask: "Is the design a solid rectangular poster panel?" }],
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
      { id: "heads-tall", describe: "Figure drawing says how many heads tall", test: (n) => /heads?\s+tall/iu.test(section(n, "Figure drawing")) },
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
    // Read as "both" in 7 of 8 tries on 2026-10-05; the eighth said "style". Two tries per run, one must match.
    ["reader-own-colors", "\"Use image 1's colors with the style\"", ["person"], ["pop-art"], "use image 1's colors with the style", [["both"]], undefined, 1],
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
    since: id.includes("hair") || id.includes("curls") || id.includes("mohawk") || id.includes("mixer") || id.includes("this-style") ? "2026-10-04" : "2026-10-02",
    images,
    mixer,
    request,
    roles,
    styleHair,
    min,
  }));
}

// How far a remix moved from its original (convex/lib/remixJudge.ts), 2026-10-05.
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
    ["grow-slow", "grow-slow-pixel", "either", "Redrawn as pixel art, same layout and colors"],
    ["lion", "dragon", "fork", "The subject replaced"],
    ["grow-slow", "grow-slow-cactus", "fork", "The mushrooms replaced by a cactus, same lettering"],
    ["person", "person-cartoon", "fork", "A photo redrawn as a full-body cartoon"],
    ["person", "person-70s", "fork", "A photo redrawn as a 70s poster"],
    ["grow-slow", "slow-roll-night", "fork", "An unrelated design"],
  ];
  return rows.map(([original, remix, expect, title]) => ({
    kind: "compare",
    id: `compare-${original}-to-${remix}`,
    group: "compare",
    title,
    supports: "Comparing a remix with its original: the same design with changes is a variation; a new design (new subject, layout, or style) may be a fork.",
    since: "2026-10-05",
    original,
    remix,
    expect,
  }));
}
