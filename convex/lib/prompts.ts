// Prompts for designs (convex/imageGen.ts) and model photos. The studio caps the creator's own
// text at 600 characters; the wrapped prompt is never cut, since the image models accept 32,000.
// docs/image-generation/README.md explains the parts in order: our rules, the attached images and
// what to keep from them, the style mix from the studio's sliders, then the creator's request,
// which wins wherever they conflict.
// Server only: Convex functions build every prompt, and no browser code imports this file
// (tests/unit/clientBoundary.test.ts).

import { colorName } from "./colors";

// Ends the creator's text as a sentence whether or not they typed the period.
function sentence(text: string) {
  const t = text.trim();
  return !t || /[.!?…"')\]]$/u.test(t) ? t : `${t}.`;
}

// ---- Image notes, written once per image by convex/imageNotes.ts ----

export const STYLE_NOTES_PROMPT = [
  "You write notes that let an image model reuse what's in a reference image and match its style in new t-shirt graphics. " +
    "Study the image closely and describe exactly what you see, precisely enough that an illustrator who never saw it could match it. " +
    "Describe; don't praise or interpret. Skip any heading that doesn't apply.",
  "",
  "Start with two lines:",
  'Summary: a few words naming the image, such as "a photo of a girl on a beach" or "a psychedelic mushroom t-shirt graphic".',
  "Kind: photo (a photograph of real people, animals, places, or things) or art (anything drawn, painted, designed, or rendered).",
  "",
  "Then these headings:",
  "Subject and layout: what it shows and how it's arranged.",
  "Words: every separate piece of text, most prominent first, one per line: the exact text in quotes, read letter by letter, " +
    "keeping its line breaks, numbers, and punctuation; its role (headline, subhead, tagline, label, date, byline, caption, body copy, signature); " +
    "where it sits; its size compared with the rest; and its lettering style, color, and effects. For long body copy, quote the first line " +
    "and describe the rest (how many lines or columns, size, typeface). If a piece is too small or stylized to read with confidence, say so instead of guessing.",
  "Technique: the medium or process it looks like (for example screen print, vector, brush and ink, woodcut, airbrush, 3D render, photograph), its texture, grain, halftone, or distressing, how many colors, and flat fills or gradients.",
  "Color: the palette as color names with hex codes, and where each one is used.",
  "Line and shading: outline weight and color, the character of the lines, and how shadows and highlights are drawn.",
  "Lettering: the overall lettering approach: letterforms, weight, width, spacing, and case; how the text pieces relate in size and style; " +
    "how they're arranged (arched, stacked, on a banner) and sit with the art; and effects such as outlines, drop shadows, 3D, gradients, or texture. " +
    "Refer to each piece by its role, such as the headline; don't quote it here.",
  "People and characters: who is in it and what makes each one recognizable: face shape, eyes, nose, mouth, hair, skin tone, " +
    "freckles or other marks, glasses, facial hair, apparent age, expression, pose, and clothing. Describe the person, not the drawing style. " +
    "Never name or guess who a real person is.",
  "Figure drawing: how this image draws people and animals compared with real proportions: head shape and length, face length, chin, nose, " +
    "eyes (size, and whether they're dots or detailed), neck, limbs, hands, and body shape. Say plainly what is exaggerated or simplified and by " +
    "how much, using numbers where you can, such as \"heads about twice as long as they are wide, with long pointed chins\". " +
    "If nothing is exaggerated, write only \"Realistic proportions.\"",
  "Signature traits: the three to five things that most make this style recognizable, most important first, one per line starting with a dash.",
  "",
  "Quote text only under Words. Write plain, short sentences under the other headings, about 300 words for them together, with no introduction. " +
    "The Words list can be as long as the text requires.",
].join("\n");

const SECTION_NAMES = [
  "Subject and layout",
  "Words",
  "Technique",
  "Color",
  "Line and shading",
  "Lettering",
  "People and characters",
  "Figure drawing",
  "Signature traits",
] as const;
const SECTION =
  /^\s*(?:#+\s*|\*\*)?(Subject and layout|Words|Technique|Colou?r|Line and shading|Lettering|People and characters|Figure drawing|Signature traits)\b\**:?\**\s*(.*)$/iu;
// How an image looks, used when it's a style. A person's likeness is content; the way an image
// draws faces and bodies is style.
const STYLE_SECTIONS = ["Technique", "Color", "Line and shading", "Lettering", "Figure drawing", "Signature traits"];
// With a style, an image to work on sends only its scene and its words. Its "People and characters"
// notes describe real faces ("a softly rounded face, small chin"), which held faces back from the
// style's way of drawing them, and the model keeps people recognizable from the image itself.
// Tested 2026-10-01: a photo in a 70s poster style gave round faces in 8 of 8 designs with all of
// its notes and the poster's longer faces without the people notes, with hair, glasses, freckles,
// and clothing kept either way. Without any notes the faces stretched most, but the photo's setting
// gave way to the poster's.
const CONTENT_WITH_STYLE = ["Subject and layout", "Words"];

function canonicalSection(name: string) {
  const lower = name.toLowerCase();
  if (lower === "colour") return "Color";
  return SECTION_NAMES.find((s) => s.toLowerCase() === lower) ?? name;
}

// The notes' sections by heading, in either "### Words" or "Words: …" form.
export function noteSections(notes: string) {
  const sections: Array<{ name: string; lines: Array<string> }> = [];
  let current: { name: string; lines: Array<string> } | null = null;
  for (const line of notes.split("\n")) {
    const match = SECTION.exec(line);
    if (match) {
      current = { name: canonicalSection(match[1]), lines: match[2]?.trim() ? [match[2].trim()] : [] };
      sections.push(current);
    } else if (current) {
      current.lines.push(line);
    }
  }
  return sections.map((s) => ({ name: s.name, text: s.lines.join("\n").trim() }));
}

// Only the named sections, as "Name:" blocks. Notes with no recognizable headings come back whole.
export function pickSections(notes: string | undefined, names: ReadonlyArray<string>) {
  if (!notes?.trim()) return "";
  const sections = noteSections(notes);
  if (sections.length === 0) return notes.trim();
  return sections
    .filter((s) => names.includes(s.name) && s.text)
    .map((s) => `${s.name}:\n${s.text}`)
    .join("\n\n");
}

// The notes without their "Words" section.
export function withoutWords(notes?: string) {
  if (!notes) return notes;
  return pickSections(notes, SECTION_NAMES.filter((name) => name !== "Words"));
}

// The ranked "Signature traits", one per item.
export function signatureTraits(notes: string | undefined) {
  if (!notes) return [];
  const section = noteSections(notes).find((s) => s.name === "Signature traits")?.text ?? "";
  const items = section
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^([-*•]|\d+[.)])\s+/u.test(line))
    .map((line) => line.replace(/^([-*•]|\d+[.)])\s+/u, ""));
  const list = items.length > 0 ? items : section.split(/;|\.\s+/u);
  return list
    .map((item) => item.trim().replace(/\.$/u, ""))
    .filter((item) => item.length > 3)
    .slice(0, 5);
}

// The vision model's reply: "Summary:" and "Kind:" lines, then the notes.
export function parseStyleNotes(text: string) {
  let summary: string | undefined;
  let kind: "photo" | "art" | undefined;
  const rest: Array<string> = [];
  for (const line of text.split("\n")) {
    const s = /^\s*(?:\*\*)?Summary(?:\*\*)?:\s*(.+)$/iu.exec(line);
    const k = /^\s*(?:\*\*)?Kind(?:\*\*)?:\s*\**\s*(photo|art)\b/iu.exec(line);
    if (!summary && s) {
      summary = s[1].replace(/\*\*/gu, "").replace(/^["“]|["”]\.?$/gu, "").replace(/\.$/u, "").trim().slice(0, 120);
      continue;
    }
    if (!kind && k) {
      kind = k[1].toLowerCase() as "photo" | "art";
      continue;
    }
    rest.push(line);
  }
  return { summary: summary || undefined, kind, notes: rest.join("\n").trim() };
}

// ---- Words ----

// Words the creator wrote in capitals or quotes, such as 'a raccoon that says TRASH ROYALTY'.
export function requestedWords(text: string): Array<string> {
  const found: Array<string> = [];
  for (const m of text.matchAll(/["“]([^"”]{1,80})["”]/gu)) found.push(m[1].trim());
  for (const m of text.matchAll(/\b[A-Z][A-Z0-9'’&!?.,-]*(?:\s+[A-Z0-9][A-Z0-9'’&!?.,-]*)*/gu)) {
    const phrase = m[0].replace(/[.,]+$/u, "").trim();
    if (phrase.replace(/[^A-Z]/gu, "").length >= 2) found.push(phrase);
  }
  return [...new Set(found)];
}

// Letter-by-letter spelling for those words; image models copy nearby letterforms otherwise
// (tested: a reference reading GROW turned TRASH into GRASH in all four designs).
function spelling(ask: string) {
  const words = requestedWords(ask);
  if (words.length === 0) return "";
  const spelled = words.map((w) => `${w} (${w.split(/\s+/u).map((part) => [...part].join("-")).join(" ")})`);
  return ` Spell these words letter for letter: ${spelled.join("; ")}.`;
}

// ---- Layout rules ----

const DESIGN_RULES =
  "Output only the artwork itself on a fully transparent background: no t-shirt, no mockup, no one wearing it, " +
  "no background scene, no border around the canvas, no drop shadow. Print-ready, bold, clean edges, centered, " +
  "filling most of the canvas.";

// Four designs in one image, a 2x2 grid that convex/lib/gridCut.ts cuts apart.
export const GRID_RULES =
  "Arrange them in a 2x2 grid on a fully transparent background: one complete graphic centered in each quarter, " +
  "each about 80% of its quarter, with wide empty space between graphics. Nothing may touch or cross the middle " +
  "of the canvas or its edges. No grid lines, dividers, or boxes around the quarters, and no labels, numbers, " +
  "t-shirts, mockups, models wearing the designs, or background scenes. Print-ready, bold, clean edges.";

// ---- The studio prompt ----

// Slider values (0-100) as shares of the mix: zeros drop out and two equal values split evenly.
export function styleShares(weights: ReadonlyArray<number>) {
  const total = weights.reduce((sum, w) => sum + Math.max(0, w), 0);
  return weights.map((w) => (total > 0 && w > 0 ? Math.round((100 * w) / total) : 0));
}

export type PromptImage = {
  summary?: string;
  kind?: "photo" | "art";
  notes?: string;
  // Added only in the style mixer: its look is used, never its subjects or words. studioPrompt
  // also treats a numbered image this way when the request names it only for its look.
  styleOnly: boolean;
};
// attachment: the 1-based number of the image the style comes from.
export type PromptStyle = { attachment: number; weight: number };

function styleMixSection(mix: Array<{ n: number; share: number; notes?: string }>) {
  // The leading style's way of drawing people, stated as a requirement: without it, a photo's
  // realistic face wins (tested: a poster of elongated faces gave eight realistic portraits).
  const figures = figureDrawing(mix[0].notes);
  const figureLine = figures
    ? `\nFigure drawing, required for every person and animal: ${figures} Draw people from photos this way too, even though the photos show realistic proportions; a realistic face is wrong here.`
    : "";
  if (mix.length === 1) {
    const only = mix[0];
    return (
      `Style: image ${only.n} sets the whole look. Study it closely and match it precisely: technique, line work, color, lettering, ` +
      `and its figure drawing.${figureLine}`
    );
  }
  const lead = mix[0].share;
  const lines = mix.map((style, i) => {
    const sharesLead = style.share >= lead - 10;
    if (i === 0 || sharesLead) {
      const others = mix.filter((other) => other !== style && other.share >= lead - 10);
      const role = others.length > 0 ? `shares the lead with ${others.map((o) => `image ${o.n}`).join(" and ")}` : "leads";
      return `- Image ${style.n} (${style.share}%): ${role}. It sets the technique, line work, color, lettering, figure drawing (the proportions of faces and bodies), and level of detail.`;
    }
    const traits = signatureTraits(style.notes).slice(0, style.share >= 25 ? 3 : 2);
    const how = traits.length > 0 ? `these traits: ${traits.join("; ")}` : "its most recognizable traits: technique, palette, and texture";
    return `- Image ${style.n} (${style.share}%): clearly visible in every design, not a faint hint, through ${how}.`;
  });
  return (
    "Style mix: how much each style shapes the result. Blend them in these proportions; a style with a smaller share still shows plainly.\n" +
    lines.join("\n") +
    figureLine
  );
}

// The notes' "Figure drawing" section, unless it says the proportions are realistic.
export function figureDrawing(notes: string | undefined) {
  if (!notes) return "";
  const text = noteSections(notes).find((s) => s.name === "Figure drawing")?.text.replace(/\s+/gu, " ").trim() ?? "";
  if (!text || /^realistic proportions\b/iu.test(text) || /^no (people|figures|characters)\b/iu.test(text)) return "";
  return text;
}

// ---- Styles named in the request ----

// "Reimagine image 1 in the style of image 2" names image 2 for its look. The server treats that
// exactly like adding image 2 in the style mixer, so a member can say it either way; the studio
// itself never reads the request. Recognized: "the style/look/aesthetic/vibe of image 2", "same
// style as image 2", "image 2's style", "drawn/look like image 2", "image 2 as the style", lists
// ("images 2 and 3"), and "the second image". "Keep image 1's look" and "not the style of image 1"
// don't turn an image into a style.
const REF_NOUN = "(?:images?|imgs?|pics?|pictures?|photos?)";
const IMAGE_REF = new RegExp(
  String.raw`\b${REF_NOUN}\s*(?:#\s*|no\.?\s*|number\s+)?([1-9])\b((?:\s*(?:,\s*(?:and\s+|&\s*)?|and\s+|&\s*|\+\s*|or\s+)(?:${REF_NOUN}\s*)?(?:#\s*)?[1-9]\b)*)` +
    String.raw`|\b(?:the\s+)?(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|1st|2nd|3rd|[4-9]th)\s+(?:image|picture|photo|pic)s?\b`,
  "giu",
);
const ORDINAL: Record<string, number> = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9,
  "1st": 1, "2nd": 2, "3rd": 3, "4th": 4, "5th": 5, "6th": 6, "7th": 7, "8th": 8, "9th": 9,
};
const STYLE_KIND = String.raw`(?:(?:art|drawing|illustration|visual|graphic|painting|design)\s+)?`;
const STYLE_WORD = "(?:style|styles|look|looks|aesthetic|vibe|feel|technique)";
// Right before the reference: "in the style of", "the look from", "same style as", "drawn like".
const STYLE_BEFORE = new RegExp(String.raw`\b${STYLE_KIND}${STYLE_WORD}\s+(?:of|from|in|as(?:\s+in)?|like)\s+(?:the\s+)?$`, "iu");
const LIKE_BEFORE =
  /\b(?:styled|drawn|painted|rendered|illustrated|done|made|designed|look|looks|looking|feel|feels)\s+(?:(?:more|just|exactly|a\s+bit|a\s+lot|a\s+little)\s+)?like\s+(?:the\s+)?$/iu;
// Right after it: "image 2's style", "image 2 style", "image 2's look" (a bare "look" is a verb),
// or "image 2 as the style".
const STYLE_AFTER = new RegExp(
  String.raw`^(?:\s*(?:'s|’s|'|’)\s*(?:own\s+)?${STYLE_KIND}${STYLE_WORD}|\s+${STYLE_KIND}(?:style|styles|aesthetic|vibe|technique)|\s+(?:as|for)\s+(?:the\s+|a\s+|its\s+|my\s+|our\s+)?${STYLE_KIND}${STYLE_WORD})\b`,
  "iu",
);
// "the look of image 1's woman" is about the woman, not image 1's look.
const PART_AFTER = /^\s*(?:'s|’s|'|’)\s+[a-z]/iu;
const NEGATED =
  /\b(?:not|no|never|without|don't|don’t|dont|do\s+not|instead\s+of|rather\s+than|except)\s+(?:(?:use|using|in|with|the|a|an|any|of|same|its|copy|copying|keep|keeping)\s+){0,3}$/iu;
const KEEPING = /\b(?:keep|keeping|preserve|preserving|maintain|maintaining|retain|retaining)\s+(?:(?:the|its|their|same|original|all|of)\s+){0,3}$/iu;

// The numbered images (1..count) the request names for their look. only: named for nothing else,
// so its subjects and words stay out, as with a mixer style. A remix's image 1 is the design being
// remixed and always stays something to work on.
export function namedStyles(instruction: string, count: number, remix = false) {
  const style = new Set<number>();
  const alsoContent = new Set<number>();
  for (const match of instruction.matchAll(IMAGE_REF)) {
    const numbers = match[1]
      ? [match[1], ...[...(match[2] ?? "").matchAll(/[1-9]/gu)].map((m) => m[0])].map(Number)
      : [ORDINAL[match[3].toLowerCase()]];
    const before = instruction.slice(0, match.index);
    const after = instruction.slice(match.index + match[0].length);
    const lead = STYLE_BEFORE.exec(before) ?? LIKE_BEFORE.exec(before);
    const ownLook = STYLE_AFTER.test(after);
    const named = ownLook || (lead !== null && !PART_AFTER.test(after));
    const head = ownLook || !lead ? before : before.slice(0, lead.index);
    for (const n of numbers) {
      if (!named || NEGATED.test(head)) {
        alsoContent.add(n);
        continue;
      }
      style.add(n);
      if (KEEPING.test(head)) alsoContent.add(n);
    }
  }
  return [...style]
    .filter((n) => n >= 1 && n <= count)
    .sort((a, b) => a - b)
    .map((n) => ({ n, only: !alsoContent.has(n) && !(remix && n === 1) }));
}

// What the request wants from each numbered image: what's in it (content), only its look (style),
// or both. GPT-6 Luna reads this from the request (convex/lib/roleReader.ts); namedStyles' phrases
// are the fallback when it can't.
export type ImageRole = "content" | "style" | "both";

export function rolesFromWords(instruction: string, count: number, remix = false): Array<ImageRole> {
  const named = namedStyles(instruction, count, remix);
  return Array.from({ length: count }, (_, i) => {
    const style = named.find((s) => s.n === i + 1);
    return !style ? "content" : style.only ? "style" : "both";
  });
}

// One design (layout "single") or four in a grid. attachments are every image sent with the
// call, in order: the studio's numbered images first, then images added only in the style mixer.
export function studioPrompt(args: {
  layout: "single" | "grid";
  instruction: string;
  attachments: Array<PromptImage>;
  styles: Array<PromptStyle>;
  // Image 1 is the published design being remixed.
  remix?: boolean;
  // What the request wants from each numbered image, when the role reader decided; otherwise the
  // request's phrases decide (namedStyles).
  roles?: Array<ImageRole>;
}) {
  const grid = args.layout === "grid";
  const ask = sentence(args.instruction);
  // A style named in the request joins the mix like a mixer style: at full strength, or at its
  // slider's value when the mixer already has it on.
  let numbered = 0;
  while (numbered < args.attachments.length && !args.attachments[numbered].styleOnly) numbered++;
  const named = args.roles
    ? args.roles
        .slice(0, numbered)
        .flatMap((role, i) => (role === "content" ? [] : [{ n: i + 1, only: role === "style" && !(args.remix && i === 0) }]))
    : namedStyles(args.instruction, numbered, args.remix);
  const images = args.attachments.map((image, i) => ({
    ...image,
    styleOnly: image.styleOnly || named.some((s) => s.n === i + 1 && s.only),
    n: i + 1,
  }));
  const styleArgs = [...args.styles];
  for (const { n } of named) {
    const at = styleArgs.findIndex((s) => s.attachment === n);
    if (at < 0) styleArgs.push({ attachment: n, weight: 100 });
    else if (styleArgs[at].weight <= 0) styleArgs[at] = { attachment: n, weight: 100 };
  }
  const work = images.filter((image) => !image.styleOnly);
  const shares = styleShares(styleArgs.map((s) => s.weight));
  const mix = styleArgs
    .map((s, i) => ({ n: s.attachment, share: shares[i], notes: images[s.attachment - 1]?.notes }))
    .filter((s) => s.share > 0 && s.n >= 1 && s.n <= images.length)
    .sort((a, b) => b.share - a.share || a.n - b.n);
  const parts: Array<string> = [];

  if (args.remix) {
    parts.push(grid ? "Make four versions of the attached t-shirt graphic (image 1) in one image." : "Remix the attached t-shirt graphic (image 1).");
  } else if (images.length > 0) {
    parts.push(grid ? "Make four t-shirt graphics in one image." : "Make a t-shirt graphic.");
  } else {
    parts.push(grid ? "Make four different t-shirt graphics in one image." : "A t-shirt graphic.");
  }
  parts.push(grid ? GRID_RULES : DESIGN_RULES);

  if (images.length > 0) {
    const legend = images.map((image) => {
      // A style image's own words stay out of the prompt, its name included.
      const named = image.styleOnly ? image.summary?.replace(/\s*["“][^"”]*["”]/gu, "").trim() : image.summary;
      const what = named || (image.kind === "photo" ? "a photo" : "an image");
      return `- Image ${image.n}: ${what}${image.styleOnly ? " (style only: use its look, never its subjects or words)" : ""}.`;
    });
    parts.push(`Attached images:\n${legend.join("\n")}`);
  }

  if (work.length > 0) {
    const first = work[0].n;
    const whose = work.length > 1 ? "the images" : `image ${first}`;
    let keep: string;
    if (args.remix) {
      keep = `Keep: study image ${first} closely and keep everything the request doesn't change: its layout, illustration, lettering style, colors, texture, and how any people or characters are drawn, including their likeness.`;
    } else if (mix.length > 0) {
      // Tested 2026-10-02 (a photo in a 70s poster style and in a pop-art style, four wordings,
      // four designs each): listing the traits that identify a person, saying only "recognizable
      // likeness", and dropping a rule against keeping real face shapes all scored the same for
      // likeness and style; every wording took the style's face proportions, skin palette, and
      // freckle treatment and kept her glasses, curls, and smile. This is the broad wording with
      // examples. No wording recolored her red hair to the style's pink; a request can ask for that.
      keep =
        `Keep: study ${whose} closely. Unless the request changes them, keep image ${first}'s composition and structure, and keep the recognizable likeness ` +
        `of every person and animal in ${whose}, such as their hair, glasses, and freckles, so someone who knows them would recognize them, ` +
        "while drawing them fully in the style.";
    } else {
      keep =
        `Keep: study ${whose} closely. Unless the request changes them, keep image ${first}'s composition and structure, and keep the likeness of every person and animal in ${whose} recognizable: face shape, features, skin tone, hair, and age. ` +
        `Keep ${work.length > 1 ? "the images'" : "its"} own look unless the request asks for a different style; if it does, draw everything that way, ` +
        "people included, and keep them recognizable within it.";
    }
    parts.push(keep);
    for (const image of work) {
      const notes = mix.length > 0 ? pickSections(image.notes, CONTENT_WITH_STYLE) : image.notes?.trim();
      if (notes) parts.push(`Notes on image ${image.n} (a checklist; where they differ from the image, follow the image):\n${notes}`);
    }
  }

  if (mix.length > 0) {
    parts.push(styleMixSection(mix));
    const definitions = mix
      .map((style) => ({ n: style.n, text: pickSections(style.notes, STYLE_SECTIONS) }))
      .filter((d) => d.text)
      .map((d) => `Image ${d.n}:\n${d.text}`);
    if (definitions.length > 0) {
      parts.push(`Style definitions (where they differ from the images, follow the images):\n\n${definitions.join("\n\n")}`);
    }
  }

  const words = spelling(ask);
  if (images.length === 0) {
    const vary = grid ? " Make the four clearly different in composition, lettering, and color." : "";
    parts.push(`Request: ${ask} Spell any words exactly as given.${words}${vary}`);
  } else {
    const fallback = args.remix
      ? "Make a fresh variation."
      : work.length > 0
        ? `Make a fresh take on image ${work[0].n}.`
        : "Make a bold new graphic in this style.";
    const workNames = work.map((image) => `image ${image.n}`).join(" and ");
    const styleOnlyCount = images.length - work.length;
    const neverCopy = styleOnlyCount > 0 ? " Never copy words from a style-only image." : "";
    const wordRule = work.length > 0
      ? ` If the request gives new words, use exactly those and drop the old ones; otherwise keep the words from ${workNames}.${neverCopy}`
      : " Spell any words exactly as given, and never copy words from a style image.";
    const vary = !grid
      ? ""
      : args.remix
        ? " Vary only small details between the four."
        : mix.length > 0
          ? " Keep the same style mix in all four and vary their composition."
          : " Vary the composition between the four.";
    parts.push(`Request (this wins wherever it conflicts with the images or the style mix): ${ask || fallback}${wordRule}${words}${vary}`);
  }
  return parts.join("\n\n");
}

// Who wears the shirt in the model photo: adult women, varied in background and look.
export const CASTING = [
  "a Black woman in her twenties with natural coily hair and gold hoop earrings",
  "a Black woman in her twenties with long box braids",
  "a Korean woman in her twenties with a sleek black bob",
  "a Japanese woman in her twenties with a shaggy layered haircut",
  "a Chinese woman in her twenties with long straight black hair and blunt bangs",
  "a Mexican woman in her twenties with long dark wavy hair",
  "a Mexican woman in her twenties with a slicked-back bun and bold brows",
  "a Swedish woman in her twenties with platinum blonde hair",
  "a South Asian woman in her twenties with long black hair and a small nose ring",
  "a Middle Eastern woman in her twenties with voluminous dark curls",
  "an Irish woman in her twenties with copper-red hair and freckles",
  "a Filipina woman in her twenties with a short pixie cut",
  "a Brazilian woman in her twenties with a bleached buzz cut",
  "a mixed-race woman in her twenties with curly hair and freckles",
];

// How she stands. Every pose works in any setting and keeps the graphic facing the camera.
export const POSES = [
  "walking toward the camera mid-stride",
  "leaning back against a wall with one knee bent",
  "sitting on a low ledge with her forearms resting on her knees",
  "standing square to the camera, chin up, hands at her sides",
  "mid-laugh with her head tilted and her hands in her back pockets",
  "turning back toward the camera over her shoulder, chest facing the lens",
  "looking just past the camera with one hand in her hair",
  "pushing her sunglasses up into her hair",
  "holding a coffee cup down at her side",
  "stepping forward with her weight on one leg and her hands in her front pockets",
];

// Where the shoot happens: urban and a little hip.
export const SETTINGS = [
  "on a neon-lit street corner at night",
  "in a graffiti-covered alley",
  "on a rooftop at golden hour with the skyline behind her",
  "on a tiled subway platform",
  "outside a corner bodega at dusk",
  "inside a laundromat under bright fluorescent light",
  "in the aisle of a record store",
  "at a concrete skatepark at sunset",
  "in a crosswalk on a busy downtown street",
  "in front of a bold painted mural",
  "in a parking garage under harsh overhead lights",
  "on a fire escape above a city street",
];

export type ShootLook = { casting: string; pose: string; world: string };

function hashString(value: string) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

// A stable pick for the seed that skips recently used options when it can.
export function pickFrom(options: Array<string>, seed: string, recent: Array<string | undefined>) {
  const used = new Set(recent.filter((c): c is string => Boolean(c)));
  const fresh = options.filter((c) => !used.has(c));
  const pool = fresh.length > 0 ? fresh : options;
  return pool[hashString(seed) % pool.length];
}

// Casting and setting avoid the most recent shoots; the pose varies freely.
export function pickLook(
  seed: string,
  recent: Array<{ casting?: string; world?: string }>,
): ShootLook {
  return {
    casting: pickFrom(CASTING, `${seed}:casting`, recent.slice(0, 10).map((r) => r.casting)),
    world: pickFrom(SETTINGS, `${seed}:world`, recent.slice(0, 6).map((r) => r.world)),
    pose: pickFrom(POSES, `${seed}:pose`, []),
  };
}

export function photoPrompt(
  backgroundColor: string,
  look: ShootLook = { casting: CASTING[0], pose: POSES[0], world: SETTINGS[0] },
) {
  const color = colorName(backgroundColor);
  return (
    `An editorial street-style fashion photograph of ${look.casting}, ${look.pose}, ${look.world}. ` +
    "The pose feels natural for the place. " +
    `She wears a plain ${color} crew-neck t-shirt (color ${backgroundColor}) with this exact graphic printed large on the chest, ` +
    "reproduced faithfully with no changes; no jacket or anything else covers the graphic. " +
    "House style: raw on-camera flash, 35mm film grain, candid and confident, natural skin, minimal retouching. " +
    "Framed from mid-thigh up, the shirt and print clearly visible."
  );
}
