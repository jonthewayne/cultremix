// Prompts for designs (convex/imageGen.ts) and model photos. The studio caps the creator's own
// text at 600 characters; the wrapped prompt is never cut, since the image models accept 32,000.
// docs/image-generation/README.md explains the parts in order: our rules, the attached images and
// what to keep from them, the style mix from the studio's sliders, then the creator's request,
// which wins wherever they conflict.

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
// What an image contains (kept when it's an image to work on) and how it looks (used when it's a style).
// A person's likeness is content; the way an image draws faces and bodies is style.
const CONTENT_SECTIONS = ["Subject and layout", "Words", "People and characters"];
const STYLE_SECTIONS = ["Technique", "Color", "Line and shading", "Lettering", "Figure drawing", "Signature traits"];

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
  // Added in the style mixer only: its look is used, never its subjects or words.
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

// One design (layout "single") or four in a grid. attachments are every image sent with the
// call, in order: the studio's numbered images first, then images added only in the style mixer.
export function studioPrompt(args: {
  layout: "single" | "grid";
  instruction: string;
  attachments: Array<PromptImage>;
  styles: Array<PromptStyle>;
  // Image 1 is the published design being remixed.
  remix?: boolean;
}) {
  const grid = args.layout === "grid";
  const ask = sentence(args.instruction);
  const images = args.attachments.map((image, i) => ({ ...image, n: i + 1 }));
  const work = images.filter((image) => !image.styleOnly);
  const shares = styleShares(args.styles.map((s) => s.weight));
  const mix = args.styles
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
      keep =
        `Keep: study ${whose} closely. Unless the request changes them, keep image ${first}'s composition and structure, and keep every person and animal in ${whose} recognizable ` +
        "by what identifies them: hair color, texture, and length; skin tone; glasses; freckles, moles, and other marks; facial hair; apparent age; " +
        "expression; and clothing. Don't keep their real face shape, features, or proportions: redraw their faces and bodies the way the style draws people, " +
        "even where that stretches or simplifies them.";
    } else {
      keep =
        `Keep: study ${whose} closely. Unless the request changes them, keep image ${first}'s composition and structure, and keep the likeness of every person and animal in ${whose} recognizable: face shape, features, skin tone, hair, and age. ` +
        `Keep ${work.length > 1 ? "the images'" : "its"} own look unless the request asks for a different style.`;
    }
    parts.push(keep);
    for (const image of work) {
      const notes = mix.length > 0 ? pickSections(image.notes, CONTENT_SECTIONS) : image.notes?.trim();
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

const NAMED: Array<[string, number, number, number]> = [
  ["off-white", 244, 241, 234],
  ["white", 255, 255, 255],
  ["black", 20, 20, 20],
  ["charcoal gray", 64, 64, 64],
  ["heather gray", 160, 160, 160],
  ["navy", 30, 40, 80],
  ["royal blue", 40, 80, 200],
  ["sky blue", 135, 190, 230],
  ["forest green", 34, 85, 50],
  ["sage green", 150, 170, 130],
  ["olive", 110, 110, 50],
  ["mustard yellow", 220, 170, 50],
  ["bright yellow", 250, 220, 60],
  ["orange", 240, 120, 40],
  ["red", 200, 40, 40],
  ["burgundy", 110, 30, 45],
  ["pink", 240, 160, 180],
  ["hot pink", 230, 60, 140],
  ["lavender", 190, 170, 220],
  ["purple", 100, 50, 140],
  ["brown", 110, 70, 40],
  ["sand", 215, 195, 160],
  ["teal", 30, 130, 130],
];

export function colorName(hex: string) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/iu.exec(hex);
  if (!m) return "off-white";
  const [r, g, b] = [m[1], m[2], m[3]].map((part) => parseInt(part, 16));
  let best = NAMED[0];
  let bestDistance = Infinity;
  for (const entry of NAMED) {
    const distance = (entry[1] - r) ** 2 + (entry[2] - g) ** 2 + (entry[3] - b) ** 2;
    if (distance < bestDistance) {
      best = entry;
      bestDistance = distance;
    }
  }
  return best[0];
}
