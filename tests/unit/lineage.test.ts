import { describe, expect, it } from "vitest";
import { ECONOMIC_CONFIG_V1, recipientShares } from "../../convex/lib/economics";
import {
  LineageError,
  MAX_AMENDMENT_HOPS,
  economicLineage,
  effectiveAncestors,
  effectiveOf,
  publishPlacement,
  validateAmendment,
} from "../../convex/lib/lineage";
import type { LineageWork } from "../../convex/lib/lineage";

function store(works: Array<LineageWork>) {
  const byId = new Map(works.map((work) => [work.id, work]));
  return {
    load: (id: string) => byId.get(id) ?? null,
    familyRoot: (family: number) => works.find((work) => work.family === family && work.expression === 1) ?? null,
    get: (id: string) => byId.get(id)!,
  };
}

const w = (fields: Partial<LineageWork> & Pick<LineageWork, "id" | "family" | "expression">): LineageWork => ({
  creator: `user-${fields.id}`,
  kind: "original",
  registered: true,
  ...fields,
});

// 101-001 original by A; 101-002 variation of it by B; 102-001 fork of 101-002 by C;
// 102-002 variation of 102-001 by D; 102-003 variation of 102-002 by E; 103-001 fork of 102-003 by F.
const tree = () =>
  store([
    w({ id: "a", family: 101, expression: 1, creator: "A" }),
    w({ id: "b", family: 101, expression: 2, creator: "B", kind: "variation", parentId: "a" }),
    w({ id: "c", family: 102, expression: 1, creator: "C", kind: "fork", parentId: "b" }),
    w({ id: "d", family: 102, expression: 2, creator: "D", kind: "variation", parentId: "c" }),
    w({ id: "e", family: 102, expression: 3, creator: "E", kind: "variation", parentId: "d" }),
    w({ id: "f", family: 103, expression: 1, creator: "F", kind: "fork", parentId: "e" }),
  ]);

// A straight line of n variations above `top`: chain-1 is the root, chain-n the newest.
function chain(n: number) {
  const works = [w({ id: "chain-1", family: 200, expression: 1 })];
  for (let i = 2; i <= n; i += 1) {
    works.push(w({ id: `chain-${i}`, family: 200, expression: i, kind: "variation", parentId: `chain-${i - 1}` }));
  }
  return store(works);
}

describe("effectiveAncestors", () => {
  it("walks up the family and across forks to the origin, nearest first", async () => {
    const s = tree();
    const { steps, truncated } = await effectiveAncestors(s.get("f"), s.load);
    expect(steps.map((step) => [step.work.id, step.via])).toEqual([
      ["e", "fork"],
      ["d", "variation"],
      ["c", "variation"],
      ["b", "fork"],
      ["a", "variation"],
    ]);
    expect(truncated).toBe(false);
  });

  it("has no ancestors for an original", async () => {
    const s = tree();
    expect((await effectiveAncestors(s.get("a"), s.load)).steps).toEqual([]);
  });

  it("follows the effective parent once amended", async () => {
    const s = store([
      w({ id: "x", family: 1, expression: 1 }),
      w({ id: "y", family: 2, expression: 1 }),
      w({ id: "z", family: 3, expression: 1, kind: "fork", parentId: "x", effectiveKind: "fork", effectiveParentId: "y" }),
    ]);
    expect((await effectiveAncestors(s.get("z"), s.load)).steps.map((step) => step.work.id)).toEqual(["y"]);
  });

  it("stops at an amended-to-original work even though it has an original parent", async () => {
    const s = store([
      w({ id: "x", family: 1, expression: 1 }),
      w({ id: "z", family: 3, expression: 1, kind: "fork", parentId: "x", effectiveKind: "original" }),
    ]);
    expect(effectiveOf(s.get("z"))).toEqual({ kind: "original", parentId: undefined });
    expect((await effectiveAncestors(s.get("z"), s.load)).steps).toEqual([]);
  });

  it("refuses a cycle", async () => {
    const s = store([
      w({ id: "p", family: 1, expression: 1, kind: "fork", parentId: "q" }),
      w({ id: "q", family: 2, expression: 1, kind: "fork", parentId: "p" }),
    ]);
    await expect(effectiveAncestors(s.get("p"), s.load)).rejects.toMatchObject({ code: "cycle" });
  });

  it("refuses a missing ancestor", async () => {
    const s = store([w({ id: "p", family: 1, expression: 2, kind: "variation", parentId: "gone" })]);
    await expect(effectiveAncestors(s.get("p"), s.load)).rejects.toBeInstanceOf(LineageError);
  });

  it("stops at the bound and says so", async () => {
    const s = chain(70);
    const { steps, truncated } = await effectiveAncestors(s.get("chain-70"), s.load, 64);
    expect(steps).toHaveLength(64);
    expect(truncated).toBe(true);
    const full = await effectiveAncestors(s.get("chain-65"), s.load, 64);
    expect(full.steps).toHaveLength(64);
    expect(full.truncated).toBe(false);
  });
});

describe("publishPlacement (variation vs fork numbering)", () => {
  it("makes an original without a parent", () => {
    expect(publishPlacement(null)).toEqual({ kind: "original", family: "new" });
    expect(publishPlacement(null, "fork")).toEqual({ kind: "original", family: "new" });
  });
  it("puts a variation in the parent's family by default", () => {
    expect(publishPlacement({ id: "p", family: 104 })).toEqual({ kind: "variation", family: 104, parentId: "p" });
  });
  it("starts a new family for a fork", () => {
    expect(publishPlacement({ id: "p", family: 104 }, "fork")).toEqual({ kind: "fork", family: "new", parentId: "p" });
  });
});

describe("validateAmendment", () => {
  const base = () =>
    store([
      w({ id: "a", family: 101, expression: 1 }),
      w({ id: "b", family: 101, expression: 2, kind: "variation", parentId: "a" }),
      w({ id: "b2", family: 101, expression: 3, kind: "variation", parentId: "a" }),
      w({ id: "c", family: 102, expression: 1, kind: "fork", parentId: "b" }),
      w({ id: "d", family: 102, expression: 2, kind: "variation", parentId: "c" }),
      w({ id: "g", family: 105, expression: 1 }),
      w({ id: "h", family: 106, expression: 1, registered: false }),
    ]);
  const check = async (id: string, newKind: LineageWork["kind"], newParentId?: string, s = base()) =>
    validateAmendment(s.get(id), { newKind, newParentId }, s.load);

  it("lets an original become a fork of a work in another family", async () => {
    expect(await check("g", "fork", "a")).toEqual({ ok: true });
  });
  it("lets a fork become an original", async () => {
    expect(await check("c", "original")).toEqual({ ok: true });
  });
  it("lets a fork move to another parent", async () => {
    expect(await check("c", "fork", "g")).toEqual({ ok: true });
  });
  it("lets a variation move to another parent in its family", async () => {
    expect(await check("b2", "variation", "b")).toEqual({ ok: true });
  });

  it.each([
    ["b", "fork", "g", "kind_change"],
    ["b", "original", undefined, "kind_change"],
    ["g", "variation", "a", "kind_change"],
    ["c", "original", "a", "original_with_parent"],
    ["g", "original", undefined, "no_change"],
    ["c", "fork", "b", "no_change"],
    ["c", "fork", undefined, "missing_parent"],
    ["c", "fork", "c", "self_parent"],
    ["c", "fork", "h", "parent_not_registered"],
    ["c", "fork", "missing", "parent_not_registered"],
    ["c", "fork", "d", "fork_same_family"],
    ["g", "fork", "g", "self_parent"],
    ["b2", "variation", "g", "variation_other_family"],
  ] as const)("refuses %s -> %s of %s (%s)", async (id, kind, parent, code) => {
    expect(await check(id, kind, parent)).toMatchObject({ ok: false, code });
  });

  it("refuses a parent that descends from the work", async () => {
    // a is an original; making it a fork of c (which descends from a via b) would loop.
    const s = store([
      w({ id: "a", family: 101, expression: 1 }),
      w({ id: "b", family: 101, expression: 2, kind: "variation", parentId: "a" }),
      w({ id: "c", family: 102, expression: 1, kind: "fork", parentId: "b" }),
    ]);
    expect(await check("a", "fork", "c", s)).toMatchObject({ ok: false, code: "cycle" });
  });

  it("refuses an unregistered work", async () => {
    const s = store([w({ id: "x", family: 1, expression: 1, registered: false }), w({ id: "y", family: 2, expression: 1 })]);
    expect(await check("x", "fork", "y", s)).toMatchObject({ ok: false, code: "not_registered" });
  });

  it(`accepts a new parent whose walk is ${MAX_AMENDMENT_HOPS} works and refuses ${MAX_AMENDMENT_HOPS + 1}`, async () => {
    const works = chain(65);
    const target = w({ id: "t", family: 300, expression: 1 });
    const s = store([target, ...Array.from({ length: 65 }, (_, i) => works.get(`chain-${i + 1}`))]);
    // chain-64's walk: chain-64 .. chain-1 = 64 works.
    expect(await check("t", "fork", "chain-64", s)).toEqual({ ok: true });
    // chain-65's walk is 65 works.
    expect(await check("t", "fork", "chain-65", s)).toMatchObject({ ok: false, code: "too_deep" });
  });
});

describe("economicLineage", () => {
  it("credits an original's creator alone", async () => {
    const s = tree();
    expect(await economicLineage(s.get("a"), s.load, s.familyRoot)).toEqual({ kind: "original", creator: "A" });
  });
  it("credits a variation's family root", async () => {
    const s = tree();
    expect(await economicLineage(s.get("b"), s.load, s.familyRoot)).toEqual({
      kind: "variation",
      creator: "B",
      root: { kind: "original", creator: "A" },
    });
  });
  it("credits a fork's parent as upstream", async () => {
    const s = tree();
    expect(await economicLineage(s.get("c"), s.load, s.familyRoot)).toEqual({
      kind: "fork",
      creator: "C",
      parentCreator: "B",
    });
  });
  it("credits a variation in a fork family three ways, however deep", async () => {
    const s = tree();
    const expected = { kind: "fork", creator: "C", parentCreator: "B" };
    expect(await economicLineage(s.get("d"), s.load, s.familyRoot)).toEqual({ kind: "variation", creator: "D", root: expected });
    expect(await economicLineage(s.get("e"), s.load, s.familyRoot)).toEqual({ kind: "variation", creator: "E", root: expected });
  });
  it("carries upstream credit one fork generation only", async () => {
    const s = tree();
    expect(await economicLineage(s.get("f"), s.load, s.familyRoot)).toEqual({ kind: "fork", creator: "F", parentCreator: "E" });
  });
  it("uses the amended lineage", async () => {
    const s = store([
      w({ id: "x", family: 1, expression: 1, creator: "X" }),
      w({ id: "y", family: 2, expression: 1, creator: "Y", kind: "fork", parentId: "x", effectiveKind: "original" }),
    ]);
    expect(await economicLineage(s.get("y"), s.load, s.familyRoot)).toEqual({ kind: "original", creator: "Y" });
  });
  it("refuses a variation whose family root is missing", async () => {
    const s = store([w({ id: "v", family: 9, expression: 2, kind: "variation", parentId: "gone" })]);
    await expect(economicLineage(s.get("v"), s.load, s.familyRoot)).rejects.toBeInstanceOf(LineageError);
  });

  it("gives panel shares that sum to 100% for every work in the tree", async () => {
    const s = tree();
    for (const id of ["a", "b", "c", "d", "e", "f"]) {
      const shares = recipientShares(await economicLineage(s.get(id), s.load, s.familyRoot), ECONOMIC_CONFIG_V1);
      expect(shares.reduce((sum, share) => sum + share.bps, 0)).toBe(10000);
    }
  });
  it("sums one person's roles when they hold two", async () => {
    const s = store([
      w({ id: "x", family: 1, expression: 1, creator: "X" }),
      w({ id: "y", family: 1, expression: 2, creator: "X", kind: "variation", parentId: "x" }),
    ]);
    const shares = recipientShares(await economicLineage(s.get("y"), s.load, s.familyRoot));
    expect(shares).toEqual([{ who: "X", roles: expect.arrayContaining(["creator", "family_root"]), bps: 10000 }]);
  });
});
