import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CASES } from "../image-e2e/cases";
import { renderCatalog } from "../image-e2e/catalog";
import { FIXTURES, fixtureExists } from "../image-e2e/fixtures";

// The image test suite itself runs against the real models (bun run test:image); these checks keep
// its catalog sound without spending anything.
describe("the image test suite's catalog", () => {
  it("gives every case a unique id and only known fixtures", () => {
    const ids = CASES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    const used = new Set<string>();
    for (const c of CASES) {
      if (c.kind === "generate") {
        for (const id of [...(c.images ?? []), ...(c.mixer ?? []).map((m) => m.fixture), ...(c.shows ?? []).map((s) => s.fixture)]) used.add(id);
      }
      if (c.kind === "photo") used.add(c.design);
      if (c.kind === "notes") used.add(c.fixture);
      if (c.kind === "reader") for (const id of [...c.images, ...(c.mixer ?? [])]) used.add(id);
      if (c.kind === "compare") for (const id of [c.original, c.remix]) used.add(id);
    }
    const known = new Set(FIXTURES.map((f) => f.id));
    for (const id of used) {
      expect(known.has(id), id).toBe(true);
      expect(fixtureExists(id), id).toBe(true);
    }
  });

  it("checks something in every image case, with questions that have unique ids", () => {
    for (const c of CASES) {
      if (c.kind !== "generate" && c.kind !== "photo") continue;
      const gridAsks = c.kind === "generate" ? (c.gridAsks?.length ?? 0) : 0;
      const keeps = c.kind === "generate" && c.keeps ? 1 : 0;
      expect(c.asks.length + gridAsks + keeps + (c.words ? 1 : 0), c.id).toBeGreaterThan(0);
      const askIds = c.asks.map((ask) => ask.id);
      expect(new Set(askIds).size, c.id).toBe(askIds.length);
      if (c.kind === "generate" && c.remix?.words?.length) expect(c.images?.length, c.id).toBeGreaterThan(0);
      // The keeps check compares each design with image 1.
      if (c.kind === "generate" && c.keeps) expect(c.images?.length, c.id).toBeGreaterThan(0);
    }
  });

  it("keeps CASES.md current (bun run test:image --catalog)", () => {
    expect(readFileSync(new URL("../image-e2e/CASES.md", import.meta.url), "utf8")).toBe(renderCatalog());
  });
});
