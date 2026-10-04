import { describe, expect, it } from "vitest";
import {
  MAX_PAGE_SIZE,
  clampPageSize,
  compareFeedPositions,
  decodeFeedCursor,
  encodeFeedCursor,
  normalizeBio,
  shelfForKind,
  verbForKind,
} from "../../convex/lib/social";

describe("Following feed cursors", () => {
  it("round-trips a position, including fractional creation times", () => {
    const position = { createdAt: 1_790_000_000_000, creationTime: 1_790_000_000_123.456 };
    expect(decodeFeedCursor(encodeFeedCursor(position))).toEqual(position);
  });

  it("rejects anything that isn't a cursor it wrote", () => {
    for (const cursor of ["", "abc", "1:", ":2", "1:2:3", "-1:2", "1e3:2", "Infinity:1"]) {
      expect(decodeFeedCursor(cursor)).toBeNull();
    }
  });

  it("orders newest first, breaking ties on creation time", () => {
    const older = { createdAt: 10, creationTime: 5 };
    const sameTimeLater = { createdAt: 10, creationTime: 6 };
    const newer = { createdAt: 11, creationTime: 1 };
    expect(compareFeedPositions(newer, older)).toBeGreaterThan(0);
    expect(compareFeedPositions(sameTimeLater, older)).toBeGreaterThan(0);
    expect(compareFeedPositions(older, older)).toBe(0);
  });
});

describe("page sizes", () => {
  it("keeps every page between one item and the cap", () => {
    expect(clampPageSize(0)).toBe(1);
    expect(clampPageSize(6.9)).toBe(6);
    expect(clampPageSize(10_000)).toBe(MAX_PAGE_SIZE);
    expect(clampPageSize(Number.NaN)).toBe(12);
  });
});

describe("bios", () => {
  it("collapses whitespace and control characters onto one line", () => {
    expect(normalizeBio("  Loud shirts\n\nfor quiet\tpeople.​ ")).toBe("Loud shirts for quiet people.");
    expect(normalizeBio(" \n ")).toBe("");
  });
});

describe("activity shelves", () => {
  it("puts originals on Works and every remix on Remixes", () => {
    expect([verbForKind("original"), shelfForKind("original")]).toEqual(["publish_original", "works"]);
    expect([verbForKind("variation"), shelfForKind("variation")]).toEqual(["publish_variation", "remixes"]);
    expect([verbForKind("fork"), shelfForKind("fork")]).toEqual(["publish_fork", "remixes"]);
  });
});
