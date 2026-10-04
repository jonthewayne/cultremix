import { describe, expect, it } from "vitest";
import {
  afterLeaving,
  leavesScope,
  nextId,
  parseScope,
  position,
  preloadIds,
  previousId,
  scopeIds,
  sessionDesigns,
  switchTarget,
  viewerShortcut,
  type NavDesign,
} from "../../src/lib/viewerNav";

const d = (id: string, batchId: string, flags: Partial<NavDesign> = {}): NavDesign => ({
  id,
  batchId,
  favorite: false,
  rejected: false,
  ...flags,
});

// Two batches of three; a2 is dismissed; b1 and a3 are favorites, b1 hearted first.
const session = [d("b1", "B", { favorite: true }), d("b2", "B"), d("b3", "B"), d("a1", "A"), d("a2", "A", { rejected: true }), d("a3", "A", { favorite: true })];
const favorites = [session[0], session[5]];
const batchA = session.filter((design) => design.batchId === "A");
const sources = { favorites, batch: batchA, session };

describe("scopes", () => {
  it("lists favorites in favorited order, a batch in tile order, and the session in page order", () => {
    expect(scopeIds("favorites", sources, false)).toEqual(["b1", "a3"]);
    expect(scopeIds("batch", sources, false)).toEqual(["a1", "a3"]);
    expect(scopeIds("session", sources, false)).toEqual(["b1", "b2", "b3", "a1", "a3"]);
  });

  it("shows dismissed designs in a batch or the session only when asked, and never in favorites", () => {
    expect(scopeIds("batch", sources, true)).toEqual(["a1", "a2", "a3"]);
    expect(scopeIds("session", sources, true)).toEqual(["b1", "b2", "b3", "a1", "a2", "a3"]);
    const stale = [...favorites, d("a2", "A", { favorite: true, rejected: true })];
    expect(scopeIds("favorites", { ...sources, favorites: stale }, true)).toEqual(["b1", "a3"]);
  });

  it("drops favorites that were just unhearted and repeats from overlapping pages", () => {
    const list = [favorites[0], d("x", "A", { favorite: false }), favorites[1], favorites[1]];
    expect(scopeIds("favorites", { ...sources, favorites: list }, false)).toEqual(["b1", "a3"]);
  });

  it("turns batches into the session's finished designs", () => {
    const designs = sessionDesigns([
      {
        batchId: "B",
        tiles: [
          { generationId: "b1", status: "succeeded", url: "u", favorite: true },
          { generationId: "b2", status: "queued", favorite: false },
          { generationId: "b3", status: "failed", favorite: false },
        ],
      },
      { batchId: "A", tiles: [{ generationId: "a1", status: "succeeded", url: "u", favorite: false, rejected: true }] },
    ]);
    expect(designs).toEqual([d("b1", "B", { favorite: true }), d("a1", "A", { rejected: true })]);
  });

  it("reads the scope from the URL and ignores anything else", () => {
    expect(parseScope("favorites")).toBe("favorites");
    expect(parseScope("batch")).toBe("batch");
    expect(parseScope("session")).toBe("session");
    expect(parseScope("everything")).toBeUndefined();
    expect(parseScope(undefined)).toBeUndefined();
  });
});

describe("paging", () => {
  const ids = ["a", "b", "c", "d", "e"];

  it("moves forward and back without wrapping", () => {
    expect(nextId(ids, "b")).toBe("c");
    expect(previousId(ids, "b")).toBe("a");
    expect(nextId(ids, "e")).toBeNull();
    expect(previousId(ids, "a")).toBeNull();
    expect(nextId(["a"], "a")).toBeNull();
    expect(previousId(["a"], "a")).toBeNull();
  });

  it("goes nowhere from a design that isn't in the list", () => {
    expect(nextId(ids, "z")).toBeNull();
    expect(previousId(ids, "z")).toBeNull();
    expect(preloadIds(ids, "z")).toEqual([]);
  });

  it("reports the place as 1-based", () => {
    expect(position(ids, "a")).toEqual({ index: 1, total: 5 });
    expect(position(ids, "d")).toEqual({ index: 4, total: 5 });
    expect(position(ids, "z")).toEqual({ index: 0, total: 5 });
  });

  it("loads two on each side, nearest first", () => {
    expect(preloadIds(ids, "c")).toEqual(["d", "b", "e", "a"]);
    expect(preloadIds(ids, "a")).toEqual(["b", "c"]);
    expect(preloadIds(ids, "e")).toEqual(["d", "c"]);
    expect(preloadIds(ids, "d")).toEqual(["e", "c", "b"]);
    expect(preloadIds(ids, "c", 1)).toEqual(["d", "b"]);
    expect(preloadIds(["a"], "a")).toEqual([]);
  });

  it("switching scope keeps the design when the new scope has it, else starts at the first", () => {
    expect(switchTarget(ids, "c")).toBe("c");
    expect(switchTarget(ids, "z")).toBe("a");
    expect(switchTarget([], "z")).toBeNull();
  });
});

describe("leaving the list", () => {
  it("unhearting in favorites moves forward, else back, else closes", () => {
    expect(leavesScope("favorites", "unfavorite", false)).toBe(true);
    expect(afterLeaving(["a", "b", "c"], "b")).toBe("c");
    expect(afterLeaving(["a", "b", "c"], "c")).toBe("b");
    expect(afterLeaving(["a"], "a")).toBeNull();
  });

  it("unhearting in a batch or the session keeps the design in view", () => {
    expect(leavesScope("batch", "unfavorite", false)).toBe(false);
    expect(leavesScope("session", "unfavorite", true)).toBe(false);
  });

  it("dismissing always leaves favorites, and leaves a batch or session only while dismissed are hidden", () => {
    expect(leavesScope("favorites", "reject", true)).toBe(true);
    expect(leavesScope("batch", "reject", false)).toBe(true);
    expect(leavesScope("session", "reject", false)).toBe(true);
    expect(leavesScope("batch", "reject", true)).toBe(false);
    expect(leavesScope("session", "reject", true)).toBe(false);
  });

  it("after a dismissal the design is gone from the list it left", () => {
    const after = session.map((design) => (design.id === "a1" ? { ...design, rejected: true } : design));
    const before = scopeIds("session", sources, false);
    const landing = afterLeaving(before, "a1");
    expect(landing).toBe("a3");
    expect(scopeIds("session", { ...sources, session: after }, false)).not.toContain("a1");
  });
});

describe("shortcuts", () => {
  const body = { tagName: "BODY" };

  it("maps arrows, Escape, and the letter keys", () => {
    expect(viewerShortcut({ key: "ArrowRight", target: body })).toBe("next");
    expect(viewerShortcut({ key: "ArrowLeft", target: body })).toBe("previous");
    expect(viewerShortcut({ key: "Escape", target: body })).toBe("close");
    expect(viewerShortcut({ key: "f", target: body })).toBe("favorite");
    expect(viewerShortcut({ key: "F", target: body })).toBe("favorite");
    expect(viewerShortcut({ key: "x", target: body })).toBe("reject");
    expect(viewerShortcut({ key: "b", target: body })).toBe("branch");
    expect(viewerShortcut({ key: "p", target: body })).toBe("publish");
    expect(viewerShortcut({ key: "t", target: body })).toBe("transparency");
    expect(viewerShortcut({ key: "q", target: body })).toBeNull();
    expect(viewerShortcut({ key: "ArrowUp", target: body })).toBeNull();
  });

  it("stays out of the way while typing", () => {
    for (const tagName of ["INPUT", "TEXTAREA", "SELECT"]) {
      expect(viewerShortcut({ key: "f", target: { tagName } })).toBeNull();
      expect(viewerShortcut({ key: "ArrowRight", target: { tagName } })).toBeNull();
    }
    expect(viewerShortcut({ key: "x", target: { tagName: "DIV", isContentEditable: true } })).toBeNull();
  });

  it("leaves browser shortcuts alone", () => {
    expect(viewerShortcut({ key: "p", metaKey: true, target: body })).toBeNull();
    expect(viewerShortcut({ key: "p", ctrlKey: true, target: body })).toBeNull();
    expect(viewerShortcut({ key: "ArrowLeft", altKey: true, target: body })).toBeNull();
  });
});
