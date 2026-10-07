import { describe, expect, it } from "vitest";
import {
  allowedChangesNote,
  checkPartChanges,
  inheritParts,
  normalizeParts,
  parseProposedParts,
  partChangeInstruction,
  partSummary,
} from "../../convex/lib/remixParts";
import type { RemixPart } from "../../convex/lib/remixParts";
import { studioPrompt } from "../../convex/lib/prompts";

const parts: Array<RemixPart> = [
  { id: "p1", kind: "character", label: "The lion", text: "a pencil-sketch lion's head", on: true },
  { id: "p2", kind: "person", label: "Santa", text: "Santa Claus", on: true, empty: "keep" },
  { id: "p3", kind: "group", label: "Elves", text: "three elves", on: true, count: 3, max: 5 },
];
const photo = (n: number) => ({ imageId: `img${n}`, key: `key${n}` });

describe("normalizeParts and the proposal", () => {
  it("keeps known kinds, trims names, and fills in a group's count and limit", () => {
    const out = normalizeParts([
      { kind: "group", label: "  The   band ", text: "four raccoons", count: 4 },
      { kind: "background" as never, label: "Sky" },
      { kind: "person", label: "", text: "nobody" },
      { kind: "person", label: "Bride", empty: "require" },
    ]);
    expect(out).toEqual([
      { id: "p1", kind: "group", label: "The band", text: "four raccoons", on: true, count: 4, max: 6 },
      { id: "p2", kind: "person", label: "Bride", text: "bride", on: true, empty: "require" },
    ]);
  });

  it("reads Luna's JSON, and nothing from an answer that isn't JSON", () => {
    expect(parseProposedParts('Here: {"parts": [{"kind": "character", "label": "The lion", "text": "a lion"}]}')?.map((p) => p.label)).toEqual(["The lion"]);
    expect(parseProposedParts('{"parts": []}')).toEqual([]);
    expect(parseProposedParts("No parts here.")).toBeNull();
  });
});

describe("checkPartChanges", () => {
  it("takes a character's new words, a person's photo, and a group's photos", () => {
    const result = checkPartChanges(parts, [
      { partId: "p1", to: "  a   wolf ", photos: [] },
      { partId: "p2", photos: [photo(1)] },
      { partId: "p3", photos: [photo(2), photo(3)] },
    ]);
    expect(result.ok && result.changes.map((c) => [c.label, c.to, c.photos.length])).toEqual([
      ["The lion", "a wolf", 0],
      ["Santa", undefined, 1],
      ["Elves", undefined, 2],
    ]);
  });

  it("refuses too many photos, a switched-off part, and an unknown one", () => {
    expect(checkPartChanges(parts, [{ partId: "p2", photos: [photo(1), photo(2)] }])).toMatchObject({ ok: false, problem: "TOO_MANY_PHOTOS", limit: 1 });
    expect(checkPartChanges([{ ...parts[0], on: false }], [{ partId: "p1", to: "a wolf", photos: [] }])).toMatchObject({ ok: false, problem: "PART_LOCKED" });
    expect(checkPartChanges(parts, [{ partId: "p9", photos: [] }])).toMatchObject({ ok: false, problem: "UNKNOWN_PART" });
  });

  it("applies a person's rule when the remix gives no photo", () => {
    const require = [{ ...parts[1], empty: "require" as const }];
    expect(checkPartChanges(require, [])).toMatchObject({ ok: false, problem: "NEEDS_PHOTO", label: "Santa" });
    const omit = [{ ...parts[1], empty: "omit" as const }];
    expect(checkPartChanges(omit, [])).toMatchObject({ ok: true, changes: [{ label: "Santa", omit: true, photos: [] }] });
    expect(checkPartChanges(parts, [])).toEqual({ ok: true, changes: [] });
  });
});

describe("the prompt's part changes", () => {
  it("writes one line per change with the photos' image numbers", () => {
    const result = checkPartChanges(parts, [
      { partId: "p1", to: "a wolf", photos: [] },
      { partId: "p2", photos: [photo(1)] },
      { partId: "p3", photos: [photo(2), photo(3), photo(4), photo(5)] },
    ]);
    if (!result.ok) throw new Error("not ok");
    const text = partChangeInstruction(parts, result.changes, new Map([["p2", [2]], ["p3", [3, 4, 5, 6]]]));
    expect(text).toContain("- The lion: replace a pencil-sketch lion's head with a wolf.");
    // People and groups are named by role; their looks come only from their photos.
    expect(text).toContain("- Santa: the person in image 2 becomes image 1's Santa: same place, pose, and outfit");
    expect(text).toContain("but with their own face, hair, skin tone, glasses, age, and expression from their photo");
    expect(text).toContain("Don't keep the original Santa's face or hair.");
    expect(text).toContain(
      "- Elves: draw exactly 4 elves (image 1 shows 3), no more and no fewer, one for each photo: 1: the person in image 3; 2: the person in image 4; 3: the person in image 5; 4: the person in image 6.",
    );
    expect(text).not.toContain("three elves");
    expect(text).toContain("Count check: 1 Santa, 4 elves, and every photo appears exactly once, as its own role.");
    expect(partSummary(result.changes)).toBe("The lion to a wolf · Santa from a photo · Elves: 4 from photos");
  });

  it("goes into a remix prompt with the photos used only for their likeness", () => {
    const text = studioPrompt({
      layout: "grid",
      instruction: "",
      attachments: [
        { kind: "art", summary: "a Santa t-shirt graphic", styleOnly: false },
        {
          kind: "photo",
          summary: "a man in a park",
          notes: "Subject and layout:\nA man on a bench in a park.\n\nPeople and characters:\nA man with a gray beard and round glasses.",
          styleOnly: false,
          partFor: "Santa",
        },
      ],
      styles: [],
      remix: true,
      partChanges: "Changes to image 1's characters (its creator made these remixable):\n- Santa: draw the person in image 2 as Santa Claus.",
    });
    expect(text).toContain("- Image 2: a man in a park (for Santa: use only the likeness of who or what is in it, never its background).");
    expect(text).toContain("Notes on image 2, for Santa");
    expect(text).toContain("A man with a gray beard and round glasses.");
    expect(text).not.toContain("A man on a bench in a park.");
    expect(text).toContain("including their likeness, except for the character changes below.");
    expect(text).toContain("Change only the characters listed above and keep everything else exactly as it is.");
    expect(text).toContain("Every one of the four makes the character changes above.");
  });
});

describe("after publishing", () => {
  it("passes the parts to a remix, with its new subject and group size", () => {
    const result = checkPartChanges(parts, [{ partId: "p1", to: "a wolf", photos: [] }, { partId: "p3", photos: [photo(1), photo(2), photo(3), photo(4), photo(5)] }]);
    if (!result.ok) throw new Error("not ok");
    const inherited = inheritParts(parts, result.changes);
    expect(inherited.map((p) => [p.label, p.text, p.count])).toEqual([
      ["The lion", "a wolf", undefined],
      ["Santa", "Santa Claus", undefined],
      ["Elves", "three elves", 5],
    ]);
  });

  it("tells the comparison which changes the creator allows", () => {
    expect(allowedChangesNote(parts)).toContain("Elves (any number of them, drawn from photos, and the room they take)");
    expect(allowedChangesNote([{ ...parts[0], on: false }])).toBe("");
  });
});
