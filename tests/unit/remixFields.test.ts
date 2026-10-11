import { describe, expect, it } from "vitest";
import {
  changeSummary,
  checkWordChanges,
  inheritRemixFields,
  maxLengthFor,
  proposeRemixFields,
  snapWordsToRequest,
  wordChangeInstruction,
  wordPieces,
} from "../../convex/lib/remixFields";
import type { RemixField } from "../../convex/lib/remixFields";
import { studioPrompt } from "../../convex/lib/prompts";

const notes = (words: Array<string>) =>
  ["### Subject and layout", "A mushroom under a rainbow.", "### Words", ...words, "### Technique", "Screen print."].join("\n");

const MUSHROOM = notes([
  "- “GROW SLOW” — headline; arched across the top; largest; chunky cream letters with a brown outline.",
  "- “EST. 1992” — date; small, under the mushroom; brown serif caps.",
  "- “TAKE IT",
  "EASY” — tagline on two lines at the bottom; medium; hand-lettered script.",
  "- “Good Vibes Co.” — label on the mushroom's cap; tiny; white sans.",
  "- “No. 7” — label on the stem; tiny; white sans.",
]);

describe("wordPieces and proposeRemixFields", () => {
  it("proposes one field per piece in the notes' order, labelled by role, numbering repeats", () => {
    const fields = proposeRemixFields(MUSHROOM);
    expect(fields.map((f) => [f.id, f.label, f.text])).toEqual([
      ["t1", "Headline", "GROW SLOW"],
      ["t2", "Date", "EST. 1992"],
      ["t3", "Tagline", "TAKE IT\nEASY"],
      ["t4", "Label", "Good Vibes Co."],
      ["t5", "Label 2", "No. 7"],
    ]);
    expect(fields.every((f) => f.kind === "text" && f.on)).toBe(true);
  });

  it("lets a box take up to 80 characters, or the piece's own length when that's longer", () => {
    expect(maxLengthFor("GROW SLOW")).toBe(80);
    expect(maxLengthFor("No. 7")).toBe(80);
    expect(maxLengthFor("x".repeat(120))).toBe(120);
    expect(proposeRemixFields(MUSHROOM)[0].maxLength).toBe(80);
  });

  it("keeps line breaks written as a slash or \\n", () => {
    const pieces = wordPieces(notes(['- "TAKE IT / EASY" — tagline.', '- "ONE\\nTWO" — subhead.']));
    expect(pieces.map((p) => p.text)).toEqual(["TAKE IT\nEASY", "ONE\nTWO"]);
  });

  it("keeps inner quotes, apostrophes, numbers, and punctuation exactly", () => {
    const fields = proposeRemixFields(
      notes([
        '- “SAY "HI" TO MOM!” — headline, top.',
        "- \"DON'T PANIC\" — tagline, bottom.",
        '- "$4.99 / 100% COTTON, #1?" — caption.',
        "1. **“Est. ’92”** (date) small at the bottom.",
      ]),
    );
    expect(fields.map((f) => f.text)).toEqual(['SAY "HI" TO MOM!', "DON'T PANIC", "$4.99\n100% COTTON, #1?", "Est. ’92"]);
    expect(fields.map((f) => f.label)).toEqual(["Headline", "Tagline", "Caption", "Date"]);
  });

  it("reads the role written before the quote", () => {
    const fields = proposeRemixFields(notes(['- Headline: "BIG", top.', '- Signature: "jo", bottom right.']));
    expect(fields.map((f) => f.label)).toEqual(["Headline", "Name"]);
  });

  it("calls a piece with no role Text", () => {
    const fields = proposeRemixFields(notes(['- "HELLO" — centered, huge, red.', '- "AGAIN" — under it.']));
    expect(fields.map((f) => f.label)).toEqual(["Text", "Text 2"]);
  });

  it("starts body copy and pieces past the eighth switched off", () => {
    const lines = Array.from({ length: 10 }, (_, i) => `- "WORD ${i + 1}" — label.`);
    lines.splice(1, 0, '- "Once upon a time there was" — body copy, four more lines in small serif.');
    const fields = proposeRemixFields(notes(lines));
    expect(fields).toHaveLength(11);
    expect(fields[1]).toMatchObject({ label: "Body", on: false });
    expect(fields.map((f) => f.on)).toEqual([true, false, true, true, true, true, true, true, false, false, false]);
  });

  it("gives a design with no words no fields", () => {
    expect(proposeRemixFields(notes(["None."]))).toEqual([]);
    expect(proposeRemixFields(notes(["- A tiny signature, too small to read with confidence."]))).toEqual([]);
    expect(proposeRemixFields("### Subject and layout\nA cat.")).toEqual([]);
    expect(proposeRemixFields(undefined)).toEqual([]);
    expect(proposeRemixFields("")).toEqual([]);
  });

  it("survives malformed notes", () => {
    expect(proposeRemixFields("no headings at all, just “QUOTED” text")).toEqual([]);
    expect(proposeRemixFields(notes(['- "UNCLOSED quote that never ends', "- more", "- and more"]))).toEqual([]);
    expect(proposeRemixFields(notes(['- "" — empty.', '- "OK" — headline.']))).toMatchObject([{ id: "t1", text: "OK" }]);
  });

  it("reads Words: sections written inline", () => {
    const fields = proposeRemixFields('Subject and layout: a cat.\nWords: "MEOW" — headline.\nTechnique: vector.');
    expect(fields.map((f) => f.text)).toEqual(["MEOW"]);
  });
});

const FIELDS: Array<RemixField> = [
  { id: "t1", kind: "text", label: "Headline", text: "GROW SLOW", maxLength: 14, on: true },
  { id: "t2", kind: "text", label: "Date", text: "EST. 1992", maxLength: 14, on: true },
  { id: "t3", kind: "text", label: "Label", text: "Good Vibes Co.", maxLength: 21, on: false },
];

describe("checkWordChanges", () => {
  it("records what changed against the stored text and drops unchanged entries", () => {
    const result = checkWordChanges(FIELDS, [
      { fieldId: "t1", text: "  GROW WILD " },
      { fieldId: "t2", text: "EST. 1992" },
    ]);
    expect(result).toEqual({ ok: true, changes: [{ fieldId: "t1", label: "Headline", from: "GROW SLOW", to: "GROW WILD" }] });
  });

  it("refuses unknown ids, fields without a box, repeats, and text over 80 characters", () => {
    expect(checkWordChanges(FIELDS, [{ fieldId: "t9", text: "X" }])).toMatchObject({ ok: false, problem: "UNKNOWN_FIELD" });
    expect(checkWordChanges(FIELDS, [{ fieldId: "t3", text: "Bad Vibes" }])).toMatchObject({ ok: false, problem: "FIELD_LOCKED" });
    expect(checkWordChanges(FIELDS, [{ fieldId: "t1", text: "A" }, { fieldId: "t1", text: "B" }])).toMatchObject({ ok: false, problem: "REPEATED" });
    // Stored before the looser limit, the headline's own cap was 14; it now takes 80.
    expect(checkWordChanges(FIELDS, [{ fieldId: "t1", text: "x".repeat(81) }])).toMatchObject({ ok: false, problem: "TOO_LONG", label: "Headline", limit: 80 });
    expect(checkWordChanges(FIELDS, [{ fieldId: "t1", text: "GROW REALLY WILD AND FREE ALL SUMMER LONG" }])).toMatchObject({ ok: true });
  });

  it("reads an emptied box as removing its words", () => {
    expect(checkWordChanges(FIELDS, [{ fieldId: "t2", text: "   " }])).toEqual({
      ok: true,
      changes: [{ fieldId: "t2", label: "Date", from: "EST. 1992", to: "" }],
    });
  });
});

describe("wordChangeInstruction", () => {
  const changes = [{ fieldId: "t1", label: "Headline", from: "GROW SLOW", to: "GROW WILD" }];

  it("replaces each changed piece letter for letter and keeps every other piece", () => {
    const text = wordChangeInstruction(FIELDS, changes);
    expect(text).toContain('- Headline: replace "GROW SLOW" with "GROW WILD", spelled letter for letter: G-R-O-W W-I-L-D.');
    expect(text).toContain("Keep this piece's size and placement.");
    expect(text).toContain('Keep every other piece of text exactly as it is, letter for letter:\n- Date: "EST. 1992"\n- Label: "Good Vibes Co."');
    // How the new words look is studioPrompt's call: image 1's own lettering, or a mixer style.
    expect(text).not.toContain("palette");
    expect(text).not.toContain("slash");
  });

  it("marks line breaks with a slash and spells across them", () => {
    const text = wordChangeInstruction(
      [{ id: "t1", kind: "text", label: "Tagline", text: "TAKE IT\nEASY", maxLength: 18, on: true }],
      [{ fieldId: "t1", label: "Tagline", from: "TAKE IT\nEASY", to: "STAY\nWEIRD" }],
    );
    expect(text).toContain('replace "TAKE IT / EASY" with "STAY / WEIRD", spelled letter for letter: S-T-A-Y W-E-I-R-D.');
    expect(text).toContain("A slash in quoted text marks a line break.");
    expect(text).not.toContain("Keep every other piece");
  });

  it("is empty without changes", () => {
    expect(wordChangeInstruction(FIELDS, [])).toBe("");
  });

  it("removes an emptied piece and fits longer words into a piece's place", () => {
    const text = wordChangeInstruction(FIELDS, [
      { fieldId: "t1", label: "Headline", from: "GROW SLOW", to: "GROW SLOW AND STEADY ALL SUMMER" },
      { fieldId: "t2", label: "Date", from: "EST. 1992", to: "" },
    ]);
    expect(text).toContain(
      '- Headline: replace "GROW SLOW" with "GROW SLOW AND STEADY ALL SUMMER", spelled letter for letter: G-R-O-W S-L-O-W A-N-D S-T-E-A-D-Y A-L-L S-U-M-M-E-R. Put it where this piece is, in the same lettering; it\'s longer, so fit it by setting it smaller or over more lines.',
    );
    expect(text).toContain('- Date: remove "EST. 1992" completely, and let the rest of the design fill its place so nothing looks missing.');
    expect(text).toContain('Keep every other piece of text exactly as it is, letter for letter:\n- Label: "Good Vibes Co."');
  });

  it("goes into the remix prompt before the request", () => {
    const prompt = studioPrompt({
      layout: "grid",
      instruction: "",
      attachments: [{ summary: "a mushroom graphic", kind: "art", styleOnly: false }],
      styles: [],
      remix: true,
      wordChanges: wordChangeInstruction(FIELDS, changes),
    });
    expect(prompt.indexOf("Word changes in image 1")).toBeGreaterThan(prompt.indexOf("Keep: study image 1"));
    expect(prompt.indexOf("Word changes in image 1")).toBeLessThan(prompt.indexOf("Request ("));
    expect(prompt).toContain("Change only the words listed above and keep everything else exactly as it is.");
    expect(prompt).toContain("Make the word changes above exactly");
    expect(prompt).toContain(
      "Each changed piece keeps its typography, color, and effects. Keep the composition, the drawing, the palette, and the transparent background as they are in image 1.",
    );
    expect(prompt).not.toContain("Make a fresh variation.");
    // Without word changes, the free-text remix is as before.
    const plain = studioPrompt({ layout: "grid", instruction: "", attachments: [{ kind: "art", styleOnly: false }], styles: [], remix: true });
    expect(plain).toContain("Make a fresh variation.");
    expect(plain).not.toContain("Word changes");
  });

  it("keeps the request and its spelling alongside the word changes", () => {
    const prompt = studioPrompt({
      layout: "grid",
      instruction: "make the mushroom blue",
      attachments: [{ kind: "art", styleOnly: false }],
      styles: [],
      remix: true,
      wordChanges: wordChangeInstruction(FIELDS, changes),
    });
    expect(prompt).toContain("make the mushroom blue.");
    expect(prompt).toContain("G-R-O-W W-I-L-D");
  });

  it("leaves the old words out of image 1's notes and asks for the new words in all four designs", () => {
    const notes = 'Subject and layout:\nMushrooms between two lines of lettering.\n\nWords:\n- "GROW SLOW" (headline)\n\nLettering:\nBubbly 70s letters.';
    const attachments = [{ kind: "art" as const, styleOnly: false, notes }];
    const prompt = studioPrompt({
      layout: "grid",
      instruction: "",
      attachments,
      styles: [],
      remix: true,
      wordChanges: wordChangeInstruction(FIELDS, changes),
    });
    expect(prompt).toContain("Bubbly 70s letters.");
    expect(prompt).not.toContain('- "GROW SLOW" (headline)');
    expect(prompt).toContain("Every one of the four shows the changed words; none of them keeps the old words.");
    // A free-text remix keeps image 1's Words notes, and has no all-four rule.
    const plain = studioPrompt({ layout: "grid", instruction: "", attachments, styles: [], remix: true });
    expect(plain).toContain('- "GROW SLOW" (headline)');
    expect(plain).not.toContain("none of them keeps the old words");
  });

  it("restyles a word remix when a style is in the mixer, keeping its composition and words", () => {
    const notes = 'Subject and layout:\nMushrooms between two lines of lettering.\n\nWords:\n- "GROW SLOW" (headline)\n\nLettering:\nBubbly 70s letters.';
    const style = { summary: "a 70s landscape poster", kind: "art" as const, styleOnly: true, notes: "Technique:\nFlat screen print.\n\nColor:\nMustard and rust." };
    const attachments = [{ kind: "art" as const, styleOnly: false, notes }, style];
    const prompt = studioPrompt({
      layout: "grid",
      instruction: "",
      attachments,
      styles: [{ attachment: 2, weight: 100 }],
      remix: true,
      wordChanges: wordChangeInstruction(FIELDS, changes),
    });
    expect(prompt).toContain("Style: image 2 sets the whole look.");
    expect(prompt).toContain("but draw all of it fully in the style below");
    expect(prompt).toContain("Letter each changed piece in the style above");
    expect(prompt).toContain("Change the words listed above, and draw the whole design in the style mix.");
    expect(prompt).toContain("Keep the same style mix in all four. Every one of the four shows the changed words");
    // Nothing asks to keep image 1's own look, which is what made a 100% style vanish.
    expect(prompt).not.toContain("lettering style, colors, texture");
    expect(prompt).not.toContain("Each changed piece keeps its typography");
    expect(prompt).not.toContain("keep everything else exactly as it is");
    expect(prompt).not.toContain("Bubbly 70s letters.");
    expect(prompt).toContain("Mushrooms between two lines of lettering.");
    // A free-text remix with a style redraws it in the style.
    const restyle = studioPrompt({ layout: "grid", instruction: "", attachments, styles: [{ attachment: 2, weight: 100 }], remix: true });
    expect(restyle).toContain("Redraw image 1 in the style mix, keeping its composition, subjects, and words.");
    expect(restyle).not.toContain("Make a fresh variation.");
  });
});

describe("inheritRemixFields and changeSummary", () => {
  it("keeps the parent's ids, labels, and switches with the new text, and drops removed pieces", () => {
    const fields = inheritRemixFields(FIELDS, [{ fieldId: "t1", to: "GROW WILD" }]);
    expect(fields).toEqual([
      { ...FIELDS[0], text: "GROW WILD", maxLength: 80 },
      { ...FIELDS[1], maxLength: 80 },
      { ...FIELDS[2], maxLength: 80 },
    ]);
    expect(inheritRemixFields(FIELDS, [{ fieldId: "t2", to: "" }]).map((f) => f.id)).toEqual(["t1", "t3"]);
  });

  it("reads as plain words", () => {
    expect(changeSummary([{ from: "GROW SLOW", to: "GROW WILD" }, { from: "TAKE IT\nEASY", to: "STAY\nWEIRD" }])).toBe(
      "GROW SLOW to GROW WILD; TAKE IT EASY to STAY WEIRD",
    );
    expect(changeSummary([{ from: "EST. 1992", to: "" }])).toBe("removed EST. 1992");
  });
});

describe("snapWordsToRequest", () => {
  // CR 108-001 on dev: asked to say FAR OUT, read as TAROUT.
  const notes = [
    "Summary: a 70s concert poster of a woman",
    "Subject and layout: a portrait framed by swirling waves.",
    "Words:",
    '- "TAROUT" (headline), chunky groovy letters arched under the portrait, the largest text',
    '- "Since 1969" (tagline), small, at the bottom',
    'Lettering: the headline is bubbly; "TAROUT" here is outside the Words section.',
  ].join("\n");

  it("gives a reading a letter off the asked words their spelling, in the reading's capitals", () => {
    const fixed = snapWordsToRequest(notes, ["FAR OUT"]);
    expect(fixed).toContain('- "FAR OUT" (headline)');
    expect(fixed).toContain('"TAROUT" here is outside the Words section.');
    expect(proposeRemixFields(fixed)[0]).toMatchObject({ label: "Headline", text: "FAR OUT" });
    expect(snapWordsToRequest(notes, ["far out"])).toContain('- "FAR OUT" (headline)');
    expect(snapWordsToRequest(notes.replace('"TAROUT"', '"Tar out"'), ["Far Out"])).toContain('- "Far Out" (headline)');
  });

  it("keeps exact readings, distant text, and short words as read", () => {
    const lineBreak = notes.replace('"TAROUT"', '"FAR / OUT"');
    expect(snapWordsToRequest(lineBreak, ["FAR OUT"])).toBe(lineBreak);
    expect(snapWordsToRequest(notes, ["GROW SLOW"])).toBe(notes);
    expect(snapWordsToRequest(notes, [])).toBe(notes);
    const short = notes.replace('"TAROUT"', '"ARM"');
    expect(snapWordsToRequest(short, ["ART"])).toBe(short);
  });

  it("allows two letters off for long phrases and picks the closest asked words", () => {
    const long = notes.replace('"TAROUT"', '"STAY WIERD FOREVER"');
    expect(snapWordsToRequest(long, ["STAY WEIRD FOREVER", "STAY WILD"])).toContain('"STAY WEIRD FOREVER"');
    const far = notes.replace('"TAROUT"', '"STAY WIRED FOR NOW"');
    expect(snapWordsToRequest(far, ["STAY WEIRD FOREVER"])).toBe(far);
  });
});
