import { describe, expect, it } from "vitest";
import { BATCH_CREDITS, creditsBack } from "../../convex/lib/studioRules";
import {
  hairShape,
  namedStyles,
  noteSections,
  parseStyleNotes,
  pickSections,
  requestedWords,
  rolesFromWords,
  signatureTraits,
  styleShares,
  studioPrompt,
  withoutWords,
} from "../../convex/lib/prompts";

const POSTER = [
  "### Subject and layout",
  "A raccoon on a trash can inside an oval of mushrooms.",
  "### Words",
  "- “TRASH ROYALTY” — headline across the top.",
  "### Technique",
  "Vintage screen print with stippled grain.",
  "### Color",
  "Cream (#F5E7B8), orange (#F47A19), and near-black outlines.",
  "### Line and shading",
  "Heavy black outlines with engraved hatching.",
  "### Lettering",
  "Bubble letters with layered multicolor outlines.",
  "### People and characters",
  "Two friends with long wavy hair in patterned dresses.",
  "### Figure drawing",
  "Characters have elongated faces and long chins.",
  "### Signature traits",
  "- Huge bubble lettering",
  "- Engraved line detail",
  "- Elongated caricature faces",
].join("\n");

const GLITTER = [
  "Technique: holographic glitter and chrome.",
  "Signature traits:",
  "1. Holographic glitter on the fills",
  "2. Glossy chrome lettering",
  "3. Hot pink and lilac highlights",
].join("\n");

const PHOTO = [
  "Subject and layout: a girl laughing on a beach, framed from the waist up.",
  "Technique: a photograph with soft daylight.",
  "People and characters: round face, dimples, curly red hair, about eight years old.",
  "Figure drawing: realistic proportions.",
].join("\n");

describe("image notes", () => {
  it("reads the summary and kind lines", () => {
    const parsed = parseStyleNotes('Summary: "a photo of a girl on a beach".\nKind: photo\n\n### Technique\nPhotograph.');
    expect(parsed.summary).toBe("a photo of a girl on a beach");
    expect(parsed.kind).toBe("photo");
    expect(parsed.notes).toBe("### Technique\nPhotograph.");
  });

  it("splits sections in either heading form", () => {
    expect(noteSections(PHOTO).map((s) => s.name)).toEqual(["Subject and layout", "Technique", "People and characters", "Figure drawing"]);
    expect(pickSections(POSTER, ["Technique", "Color"])).toBe(
      "Technique:\nVintage screen print with stippled grain.\n\nColor:\nCream (#F5E7B8), orange (#F47A19), and near-black outlines.",
    );
    expect(withoutWords(POSTER)).not.toContain("TRASH ROYALTY");
  });

  it("lists the ranked signature traits", () => {
    expect(signatureTraits(POSTER)).toEqual(["Huge bubble lettering", "Engraved line detail", "Elongated caricature faces"]);
    expect(signatureTraits(GLITTER)).toEqual([
      "Holographic glitter on the fills",
      "Glossy chrome lettering",
      "Hot pink and lilac highlights",
    ]);
  });

  it("finds words written in capitals or quotes", () => {
    expect(requestedWords('A raccoon that says TRASH ROYALTY and "stay weird"')).toEqual(["stay weird", "TRASH ROYALTY"]);
  });

  it("reads the hair a style draws on anyone", () => {
    const notes = (hair: string) => `Technique: flat cartoon.\nFigure drawing: Figures about eight heads tall with big ears. ${hair}\nSignature traits:\n- Spiky hair`;
    expect(hairShape(notes("Hair: tall, jagged spikes rising about as high as the face."))).toBe("tall, jagged spikes rising about as high as the face");
    expect(hairShape(notes("\n**Hair:** one smooth solid shape with a single highlight."))).toBe("one smooth solid shape with a single highlight");
    expect(hairShape(notes("Hair: true to life."))).toBe("");
    expect(hairShape(notes("Hair: not applicable."))).toBe("");
    expect(hairShape(notes("Hair: No human hair; dense, jagged fur around the head."))).toBe("");
    // A person's own hair, under "People and characters", is likeness, not the style's hair.
    expect(hairShape("People and characters:\nHair: curly red, shoulder length.\nFigure drawing: realistic proportions.")).toBe("");
    expect(hairShape(PHOTO)).toBe("");
  });
});

describe("studio prompt", () => {
  it("turns slider values into shares", () => {
    expect(styleShares([100, 100])).toEqual([50, 50]);
    expect(styleShares([100, 50])).toEqual([67, 33]);
    expect(styleShares([80, 0, 20])).toEqual([80, 0, 20]);
    expect(styleShares([0, 0])).toEqual([0, 0]);
  });

  it("restyles a photo with one style image and keeps her likeness", () => {
    const prompt = studioPrompt({
      layout: "single",
      instruction: "Reimagine image 1 in this style",
      attachments: [
        { summary: "a photo of a girl on a beach", kind: "photo", notes: PHOTO, styleOnly: false },
        { summary: "a 70s “TRASH ROYALTY” poster", kind: "art", notes: POSTER, styleOnly: true },
      ],
      styles: [{ attachment: 2, weight: 100 }],
    });
    expect(prompt).toContain("- Image 2: a 70s poster (style only: use its look, never its subjects or words).");
    expect(prompt).toContain("otherwise keep the words from image 1. Never copy words from a style-only image.");
    expect(prompt).toContain(
      "keep the recognizable likeness of every person and animal in image 1, such as their hair, glasses, freckles, and smile, so someone who knows them would recognize them, while drawing them fully in the style, from head to toe: the style decides their proportions and shapes, such as how tall and stretched the body is and how big the head and ears are.",
    );
    expect(prompt).toContain("Style: image 2 sets the whole look.");
    // The style's way of drawing people goes in; the photo's realistic rendering stays out.
    expect(prompt).toContain("Figure drawing, required for every person and animal, head to toe: Characters have elongated faces and long chins.");
    expect(prompt).not.toContain("Figure drawing:\nrealistic proportions.");
    // Once a style is chosen, the photo's scene stays in; its look and its description of faces
    // stay out, so the style decides how faces are drawn.
    expect(prompt).toContain("a girl laughing on a beach, framed from the waist up");
    expect(prompt).not.toContain("round face, dimples");
    expect(prompt).not.toContain("a photograph with soft daylight");
    // A style image's words, subjects, and people never reach the prompt.
    expect(prompt).not.toContain("TRASH ROYALTY");
    expect(prompt).not.toContain("inside an oval of mushrooms");
    expect(prompt).not.toContain("patterned dresses");
    expect(prompt.split("\n\n").at(-1)).toMatch(/^Request \(this wins/u);
  });

  it("blends two styles by their sliders, and the smaller one has to show", () => {
    const prompt = studioPrompt({
      layout: "single",
      instruction: "A raccoon in a tiny crown that says TRASH ROYALTY",
      attachments: [
        { summary: "a glitter sample", notes: GLITTER, styleOnly: true },
        { summary: "a mushroom poster", notes: POSTER, styleOnly: true },
      ],
      styles: [
        { attachment: 1, weight: 20 },
        { attachment: 2, weight: 80 },
      ],
    });
    expect(prompt).toContain("- Image 2 (80%): leads.");
    expect(prompt).toContain(
      "- Image 1 (20%): clearly visible in every design, not a faint hint, through these traits: Holographic glitter on the fills; Glossy chrome lettering.",
    );
    expect(prompt).toContain("T-R-A-S-H R-O-Y-A-L-T-Y");
    expect(prompt).toContain("never copy words from a style image");
  });

  it("calls two equal sliders a shared lead", () => {
    const prompt = studioPrompt({
      layout: "single",
      instruction: "A cat",
      attachments: [
        { notes: GLITTER, styleOnly: true },
        { notes: POSTER, styleOnly: true },
      ],
      styles: [
        { attachment: 1, weight: 100 },
        { attachment: 2, weight: 100 },
      ],
    });
    expect(prompt).toContain("- Image 1 (50%): shares the lead with image 2.");
    expect(prompt).toContain("- Image 2 (50%): shares the lead with image 1.");
  });

  it("drops styles at zero and keeps the image's own look", () => {
    const prompt = studioPrompt({
      layout: "single",
      instruction: "Change the words to GROW WILD",
      attachments: [{ summary: "a mushroom graphic", notes: POSTER, styleOnly: false }],
      styles: [{ attachment: 1, weight: 0 }],
    });
    expect(prompt).not.toContain("Style mix");
    expect(prompt).toContain("Keep its own look unless the request asks for a different style;");
    expect(prompt).toContain("Notes on image 1");
    expect(prompt).toContain("G-R-O-W W-I-L-D");
  });

  it("writes a plain prompt with no images", () => {
    const prompt = studioPrompt({ layout: "single", instruction: "A sunset badge that says DESERT PEOPLE CLUB", attachments: [], styles: [] });
    expect(prompt).not.toContain("Attached images");
    expect(prompt).toContain("Request: A sunset badge that says DESERT PEOPLE CLUB.");
  });

  it("asks a grid for four designs that share the mix", () => {
    const prompt = studioPrompt({
      layout: "grid",
      instruction: "A raccoon",
      attachments: [{ notes: POSTER, styleOnly: true }],
      styles: [{ attachment: 1, weight: 100 }],
    });
    expect(prompt).toContain("Arrange them in a 2x2 grid");
    expect(prompt).toContain("Keep the same style mix in all four and vary their composition.");
    expect(prompt).not.toContain("shows the request's words");
  });

  it("puts a request's words on every design of a grid with images or styles", () => {
    const withStyle = studioPrompt({
      layout: "grid",
      instruction: "A smiling sun that says GOOD DAY",
      attachments: [{ notes: POSTER, styleOnly: true }],
      styles: [{ attachment: 1, weight: 100 }],
    });
    expect(withStyle).toContain("Every one of the four shows the request's words. Keep the same style mix in all four and vary their composition.");
    const single = studioPrompt({
      layout: "single",
      instruction: "A smiling sun that says GOOD DAY",
      attachments: [{ notes: POSTER, styleOnly: true }],
      styles: [{ attachment: 1, weight: 100 }],
    });
    expect(single).not.toContain("Every one of the four");
  });

  it("leaves how people are drawn to the style, without listing face shapes to keep", () => {
    const prompt = studioPrompt({
      layout: "single",
      instruction: "Reimagine image 1 in this style",
      attachments: [
        { summary: "a photo of a girl on a beach", kind: "photo", notes: PHOTO, styleOnly: false },
        { notes: POSTER, styleOnly: true },
      ],
      styles: [{ attachment: 2, weight: 100 }],
    });
    expect(prompt).toContain("while drawing them fully in the style, from head to toe: the style decides their proportions and shapes");
    // The style redraws whole bodies, not only faces.
    expect(prompt).toContain("their heads, faces, ears, bodies, and limbs take these proportions");
    expect(prompt).not.toContain("face shape");
  });

  it("keeps people's own hair unless the request asks for the style's", () => {
    const cartoon = "Technique: flat cartoon with bold outlines.\nFigure drawing: Figures about eight heads tall. Hair: tall spikes standing straight up.";
    const make = (notes: string, styleHair = false, remix = false) =>
      studioPrompt({
        layout: "grid",
        instruction: "Draw image 1 as a full-body character",
        attachments: [
          { summary: "a photo of a girl on a beach", kind: "photo", notes: PHOTO, styleOnly: false },
          { summary: "three cartoon boys", kind: "art", notes, styleOnly: true },
        ],
        styles: [{ attachment: 2, weight: 100 }],
        remix,
        styleHair,
      });
    // By default the style's hair appears nowhere: not in the required figure drawing, not in the
    // style's definition, in either way the notes write the line.
    for (const notes of [cartoon, cartoon.replace(" Hair:", "\n**Hair:**")]) {
      const prompt = make(notes);
      expect(prompt).not.toContain("tall spikes");
      expect(prompt).toContain("Figure drawing, required for every person and animal, head to toe: Figures about eight heads tall. Draw people");
    }
    // When the reader says the request asks for it, it's named in full, once.
    const hair = "Give people the style's hair: tall spikes standing straight up, in their own hair color.";
    expect(make(cartoon, true)).toContain(hair);
    expect(make(cartoon, true).split("tall spikes")).toHaveLength(2);
    expect(make(cartoon, true, true)).toContain(hair);
    expect(make(cartoon.replace("tall spikes standing straight up", "true to life"), true)).not.toContain("the style's hair");
  });
});

describe("styles named in the request", () => {
  const photo = { summary: "a photo of a girl on a beach", kind: "photo" as const, notes: PHOTO };
  const poster = { summary: "a 70s “TRASH ROYALTY” poster", kind: "art" as const, notes: POSTER };

  it("treats a style named in words exactly like a mixer style", () => {
    const instruction = "Reimagine image 1 in the style of image 2";
    const typed = studioPrompt({
      layout: "single",
      instruction,
      attachments: [{ ...photo, styleOnly: false }, { ...poster, styleOnly: false }],
      styles: [],
    });
    const mixer = studioPrompt({
      layout: "single",
      instruction,
      attachments: [{ ...photo, styleOnly: false }, { ...poster, styleOnly: true }],
      styles: [{ attachment: 2, weight: 100 }],
    });
    expect(typed).toBe(mixer);
    expect(typed).toContain("- Image 2: a 70s poster (style only: use its look, never its subjects or words).");
    expect(typed).toContain("Figure drawing, required for every person and animal, head to toe: Characters have elongated faces and long chins.");
    // The poster's people and words stay out, as they do from the mixer.
    expect(typed).not.toContain("patterned dresses");
    expect(typed).not.toContain("TRASH ROYALTY");
    expect(typed).toContain("otherwise keep the words from image 1. Never copy words from a style-only image.");
  });

  it("keeps a mixer slider that's already on, and turns one that's off back on", () => {
    const glitter = { summary: "a glitter sample", notes: GLITTER, styleOnly: true };
    const withSlider = (weight: number) =>
      studioPrompt({
        layout: "single",
        instruction: "image 1 in the style of image 2",
        attachments: [{ ...photo, styleOnly: false }, { ...poster, styleOnly: false }, glitter],
        styles: [
          { attachment: 2, weight },
          { attachment: 3, weight: 70 },
        ],
      });
    expect(withSlider(30)).toContain("- Image 3 (70%): leads.");
    expect(withSlider(0)).toContain("- Image 2 (59%): leads.");
  });

  it.each([
    ["Reimagine image 1 in the style of image 2", 2, [{ n: 2, only: true }]],
    ["image 1 in image 2's style", 2, [{ n: 2, only: true }]],
    ["Put her in the same style as image 2", 2, [{ n: 2, only: true }]],
    ["Make image 1 look like image 2", 2, [{ n: 2, only: true }]],
    ["Use image 2 as the style for image 1", 2, [{ n: 2, only: true }]],
    ["Draw image 1 with the aesthetic of the second image", 2, [{ n: 2, only: true }]],
    ["Mix the styles of images 2 and 3 into image 1", 3, [{ n: 2, only: true }, { n: 3, only: true }]],
    ["A cat in the style of image 1", 1, [{ n: 1, only: true }]],
    // Named for its look and for its content: a style, and still something to work on.
    ["Use image 2's style and keep image 2's words", 2, [{ n: 2, only: false }]],
    ["Keep image 1's look and change the words to NIGHT SHIFT", 1, [{ n: 1, only: false }]],
    // Not a style.
    ["Change the words to NIGHT SHIFT", 1, []],
    ["Change the words but not the style of image 1", 1, []],
    ["Don't use image 2's style", 2, []],
    ["Make the lion look like the cat in image 2", 2, []],
    ["Make image 1 look cooler", 1, []],
    ["Keep the look of image 1's woman but put her in a forest", 1, []],
    // Only the numbered images count.
    ["in the style of image 3", 2, []],
  ])("reads %j", (instruction, count, expected) => {
    expect(namedStyles(instruction, count)).toEqual(expected);
  });

  it("never turns the design being remixed into a style only", () => {
    expect(namedStyles("Remix it in the style of image 1", 1, true)).toEqual([{ n: 1, only: false }]);
  });
});

describe("roles read from the request", () => {
  const photo = { summary: "a photo of a girl on a beach", kind: "photo" as const, notes: PHOTO };
  const poster = { summary: "a 70s “TRASH ROYALTY” poster", kind: "art" as const, notes: POSTER };

  it("uses the reader's roles where the phrases find nothing", () => {
    const instruction = "draw the girl the way the poster draws people";
    // The phrases alone miss this request.
    expect(rolesFromWords(instruction, 2)).toEqual(["content", "content"]);
    const read = studioPrompt({
      layout: "grid",
      instruction,
      attachments: [{ ...photo, styleOnly: false }, { ...poster, styleOnly: false }],
      styles: [],
      roles: ["content", "style"],
    });
    const mixer = studioPrompt({
      layout: "grid",
      instruction,
      attachments: [{ ...photo, styleOnly: false }, { ...poster, styleOnly: true }],
      styles: [{ attachment: 2, weight: 100 }],
    });
    expect(read).toBe(mixer);
    expect(read).toContain("- Image 2: a 70s poster (style only: use its look, never its subjects or words).");
  });

  it("makes a single image a style when the request only wants its look", () => {
    const prompt = studioPrompt({
      layout: "grid",
      instruction: "a dragon in this style that says FIRE BREATHER",
      attachments: [{ ...poster, styleOnly: false }],
      styles: [],
      roles: ["style"],
    });
    expect(prompt).toContain("- Image 1: a 70s poster (style only: use its look, never its subjects or words).");
    expect(prompt).toContain("Style: image 1 sets the whole look.");
    expect(prompt).not.toContain("Keep: study");
    expect(prompt).not.toContain("TRASH ROYALTY");
  });

  it("keeps a remix's image 1 as something to work on", () => {
    const prompt = studioPrompt({
      layout: "grid",
      instruction: "in the colors of image 2",
      attachments: [{ ...poster, styleOnly: false }, { ...photo, styleOnly: false }],
      styles: [],
      remix: true,
      roles: ["style", "style"],
    });
    expect(prompt).toContain("Make four versions of the attached t-shirt graphic (image 1)");
    // Image 1 stays content (its words included); image 2 joins as a style.
    expect(prompt).toContain("- Image 1: a 70s “TRASH ROYALTY” poster.\n");
    expect(prompt).toContain("- Image 2: a photo of a girl on a beach (style only");
  });

  it("finds images past 4 and ordinals past fourth", () => {
    expect(namedStyles("put images 1 and 2 in the style of image 7", 8)).toEqual([{ n: 7, only: true }]);
    expect(namedStyles("use the look of the sixth image", 8)).toEqual([{ n: 6, only: true }]);
  });
});

describe("batch credits", () => {
  it("charges two credits for four designs and gives credits back for missing ones", () => {
    expect(BATCH_CREDITS).toBe(2);
    expect([0, 1, 2, 3, 4].map(creditsBack)).toEqual([0, 1, 1, 2, 2]);
  });
});
