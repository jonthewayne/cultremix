import { describe, expect, it } from "vitest";
import {
  changeSummary,
  checkWordChanges,
  inheritRemixFields,
  maxLengthFor,
  proposeRemixFields,
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

  it("caps text at about one and a half times its length, never under 12", () => {
    expect(maxLengthFor("GROW SLOW")).toBe(14);
    expect(maxLengthFor("No. 7")).toBe(12);
    expect(maxLengthFor("A MUCH LONGER HEADLINE HERE")).toBe(41);
    expect(proposeRemixFields(MUSHROOM)[0].maxLength).toBe(14);
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

  it("refuses unknown ids, switched-off fields, empty text, repeats, and text over the cap", () => {
    expect(checkWordChanges(FIELDS, [{ fieldId: "t9", text: "X" }])).toMatchObject({ ok: false, problem: "UNKNOWN_FIELD" });
    expect(checkWordChanges(FIELDS, [{ fieldId: "t3", text: "Bad Vibes" }])).toMatchObject({ ok: false, problem: "FIELD_LOCKED" });
    expect(checkWordChanges(FIELDS, [{ fieldId: "t1", text: "   " }])).toMatchObject({ ok: false, problem: "EMPTY" });
    expect(checkWordChanges(FIELDS, [{ fieldId: "t1", text: "A" }, { fieldId: "t1", text: "B" }])).toMatchObject({ ok: false, problem: "REPEATED" });
    expect(checkWordChanges(FIELDS, [{ fieldId: "t1", text: "GROW REALLY WILD" }])).toMatchObject({ ok: false, problem: "TOO_LONG", label: "Headline" });
    expect(checkWordChanges(FIELDS, [{ fieldId: "t1", text: "GROW SO WILD!" }])).toMatchObject({ ok: true });
  });
});

describe("wordChangeInstruction", () => {
  const changes = [{ fieldId: "t1", label: "Headline", from: "GROW SLOW", to: "GROW WILD" }];

  it("replaces each changed piece letter for letter and keeps every other piece", () => {
    const text = wordChangeInstruction(FIELDS, changes);
    expect(text).toContain('- Headline: replace "GROW SLOW" with "GROW WILD", spelled letter for letter: G-R-O-W W-I-L-D.');
    expect(text).toContain("Keep this piece's typography, size, color, effects, and placement.");
    expect(text).toContain('Keep every other piece of text exactly as it is, letter for letter:\n- Date: "EST. 1992"\n- Label: "Good Vibes Co."');
    expect(text).toContain("Keep the composition, the drawing, the palette, and the transparent background");
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
});

describe("inheritRemixFields and changeSummary", () => {
  it("keeps the parent's ids, labels, switches, and caps with the new text", () => {
    const fields = inheritRemixFields(FIELDS, [{ fieldId: "t1", to: "GROW WILD" }]);
    expect(fields).toEqual([{ ...FIELDS[0], text: "GROW WILD" }, FIELDS[1], FIELDS[2]]);
  });

  it("reads as plain words", () => {
    expect(changeSummary([{ from: "GROW SLOW", to: "GROW WILD" }, { from: "TAKE IT\nEASY", to: "STAY\nWEIRD" }])).toBe(
      "GROW SLOW to GROW WILD; TAKE IT EASY to STAY WEIRD",
    );
  });
});
