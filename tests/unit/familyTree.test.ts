import { describe, expect, it } from "vitest";
import {
  
  
  
  buildFamilyTree,
  familyOfCr,
  layoutTree,
  shownCount
} from "../../src/lib/familyTree";
import type {FamilyTreeData, TreeNode, TreeWork} from "../../src/lib/familyTree";

const cr = (family: number, expression: number) => `${family}-${String(expression).padStart(3, "0")}`;

function work(family: number, expression: number, parent?: string, kind?: TreeWork["kind"]): TreeWork {
  return {
    cr: cr(family, expression),
    family,
    expression,
    kind: kind ?? (parent ? (familyOfCr(parent) === family ? "variation" : "fork") : "original"),
    parentCr: parent,
    withdrawn: false,
  };
}

const data = (works: Array<TreeWork>, extra: Partial<FamilyTreeData> = {}): FamilyTreeData => ({
  family: works[0]?.family ?? 0,
  works,
  forks: [],
  origins: [],
  more: false,
  ...extra,
});

const loose = { maxDepth: 99, maxChildren: 99 };

// A compact picture of a tree: "101-001(101-002,101-003)", with "+N/M" for collapsed nodes.
function shape(nodes: Array<TreeNode>): string {
  return nodes
    .map((node) => {
      if (node.type === "more") return `+${node.siblings}/${node.designs}`;
      const label = `${node.type === "work" ? "" : `${node.type}:`}${node.work.cr}${node.current ? "*" : ""}`;
      return node.children.length ? `${label}(${shape(node.children)})` : label;
    })
    .join(",");
}

describe("familyOfCr", () => {
  it("reads the family number from a CR number", () => {
    expect(familyOfCr("101-004")).toBe(101);
    expect(familyOfCr("CR 2045-001")).toBe(2045);
    expect(familyOfCr("nope")).toBeNull();
    expect(familyOfCr("1-1")).toBeNull();
  });
});

describe("buildFamilyTree ordering", () => {
  it("puts the original at the root and each variation under its parent, in CR order", () => {
    const root = work(101, 1);
    const works = [
      work(101, 5, cr(101, 2)),
      root,
      work(101, 3, cr(101, 1)),
      work(101, 2, cr(101, 1)),
      work(101, 4, cr(101, 2)),
    ];
    expect(shape(buildFamilyTree(data(works), loose))).toBe("101-001(101-002(101-004,101-005),101-003)");
  });

  it("follows the effective parent the query sends (a corrected lineage)", () => {
    // 101-003 was recorded under 101-001 and corrected to sit under 101-002.
    const works = [work(101, 1), work(101, 2, cr(101, 1)), work(101, 3, cr(101, 2))];
    expect(shape(buildFamilyTree(data(works), loose))).toBe("101-001(101-002(101-003))");
  });

  it("makes a root of a work whose parent wasn't loaded, so nothing is dropped", () => {
    const works = [work(101, 1), work(101, 3, cr(101, 99))];
    expect(shape(buildFamilyTree(data(works), loose))).toBe("101-001,101-003");
  });

  it("survives a lineage loop in damaged data", () => {
    const works = [work(101, 2, cr(101, 3)), work(101, 3, cr(101, 2))];
    const tree = buildFamilyTree(data(works), loose);
    expect(shape(tree)).toBe("101-002(101-003)");
    expect(shownCount(tree)).toBe(2);
  });

  it("marks the current work", () => {
    const works = [work(101, 1), work(101, 2, cr(101, 1))];
    expect(shape(buildFamilyTree(data(works), { ...loose, currentCr: cr(101, 2) }))).toBe("101-001(101-002*)");
  });
});

describe("buildFamilyTree forks across families", () => {
  it("shows forks out as leaves after the in-family children, in CR order", () => {
    const works = [work(101, 1), work(101, 2, cr(101, 1))];
    const forks = [work(140, 1, cr(101, 1)), work(120, 1, cr(101, 1)), work(150, 1, cr(101, 2))];
    const tree = buildFamilyTree(data(works, { forks }), loose);
    expect(shape(tree)).toBe("101-001(101-002(fork:150-001),fork:120-001,fork:140-001)");
    const fork = tree[0].children[1];
    expect(fork.type).toBe("fork");
    expect(fork.via).toBe("fork");
    expect(fork.children).toEqual([]);
  });

  it("draws the family a fork came from above its root, with a dashed (fork) link", () => {
    const origin = work(101, 2, cr(101, 1));
    const works = [work(140, 1, origin.cr), work(140, 2, cr(140, 1))];
    const tree = buildFamilyTree(data(works, { origins: [origin] }), loose);
    expect(shape(tree)).toBe("origin:101-002(140-001(140-002))");
    expect(tree[0].children[0].via).toBe("fork");
    const layout = layoutTree(tree, { nodeWidth: 10, nodeHeight: 10, gapX: 0, gapY: 0 });
    expect(Object.fromEntries(layout.edges.map((edge) => [edge.key, edge.dashed]))).toEqual({
      "origin:101-002>140-001": true,
      "140-001>140-002": false,
    });
  });

  it("ignores forks whose parent isn't in this family", () => {
    const tree = buildFamilyTree(data([work(101, 1)], { forks: [work(140, 1, cr(130, 1))] }), loose);
    expect(shape(tree)).toBe("101-001");
  });
});

describe("buildFamilyTree collapse", () => {
  const wide = [work(101, 1), ...[2, 3, 4, 5, 6, 7].map((n) => work(101, n, cr(101, 1))), work(101, 8, cr(101, 7))];

  it("collapses children past maxChildren into a +N node counting everything under them", () => {
    const tree = buildFamilyTree(data(wide), { maxDepth: 99, maxChildren: 3 });
    // 101-005 and 101-006 hidden directly, 101-007 with its child 101-008: 3 siblings, 4 designs.
    expect(shape(tree)).toBe("101-001(101-002,101-003,101-004,+3/4)");
    const more = tree[0].children[3];
    expect(more).toMatchObject({ type: "more", parentCr: "101-001", reason: "wide" });
  });

  it("doesn't collapse at maxChildren, or to hide just one design", () => {
    expect(shape(buildFamilyTree(data(wide.slice(0, 4)), { maxDepth: 99, maxChildren: 3 }))).toBe(
      "101-001(101-002,101-003,101-004)",
    );
    expect(shape(buildFamilyTree(data(wide.slice(0, 5)), { maxDepth: 99, maxChildren: 3 }))).toBe(
      "101-001(101-002,101-003,101-004,101-005)",
    );
    // A single childless design past maxDepth shows too.
    expect(shape(buildFamilyTree(data(wide), { maxDepth: 1, maxChildren: 9 }))).toBe(
      "101-001(101-002,101-003,101-004,101-005,101-006,101-007(101-008))",
    );
  });

  it("keeps the current work's branch visible inside a collapsed row", () => {
    const tree = buildFamilyTree(data(wide), { maxDepth: 99, maxChildren: 3, currentCr: cr(101, 8) });
    expect(shape(tree)).toBe("101-001(101-002,101-003,101-007(101-008*),+3/3)");
  });

  it("collapses children of works at maxDepth", () => {
    const chain = [work(101, 1), work(101, 2, cr(101, 1)), work(101, 3, cr(101, 2)), work(101, 4, cr(101, 3))];
    const tree = buildFamilyTree(data(chain, { forks: [work(150, 1, cr(101, 3))] }), { maxDepth: 1, maxChildren: 9 });
    expect(shape(tree)).toBe("101-001(101-002(+1/3))");
    expect(tree[0].children[0].children[0]).toMatchObject({ type: "more", reason: "deep" });
  });

  it("opens a deep branch on the path to the current work", () => {
    const chain = [work(101, 1), work(101, 2, cr(101, 1)), work(101, 3, cr(101, 2)), work(101, 4, cr(101, 2))];
    const tree = buildFamilyTree(data(chain), { maxDepth: 1, maxChildren: 9, currentCr: cr(101, 3) });
    expect(shape(tree)).toBe("101-001(101-002(101-003*,101-004))");
  });

  it("shows everything under an expanded work", () => {
    const tree = buildFamilyTree(data(wide), { maxDepth: 0, maxChildren: 3, expanded: new Set([cr(101, 1)]) });
    expect(shape(tree)).toBe("101-001(101-002,101-003,101-004,101-005,101-006,101-007(101-008))");
  });

  it("marks a +N of only forks as a fork link", () => {
    const forks = [130, 140, 150].map((family) => work(family, 1, cr(101, 1)));
    const tree = buildFamilyTree(data([work(101, 1)], { forks }), { maxDepth: 99, maxChildren: 1 });
    expect(shape(tree)).toBe("101-001(fork:130-001,+2/2)");
    expect(tree[0].children[1].via).toBe("fork");
  });
});

describe("layoutTree", () => {
  const size = { nodeWidth: 100, nodeHeight: 50, gapX: 20, gapY: 30 };

  it("gives each leaf its own column and centres parents over their children", () => {
    const works = [work(101, 1), work(101, 2, cr(101, 1)), work(101, 3, cr(101, 1)), work(101, 4, cr(101, 3))];
    const layout = layoutTree(buildFamilyTree(data(works), loose), size);
    const at = (key: string) => layout.nodes.find((placed) => placed.node.key === key)!;
    expect(at("101-002")).toMatchObject({ x: 0, y: 80 });
    expect(at("101-003")).toMatchObject({ x: 120, y: 80 });
    expect(at("101-004")).toMatchObject({ x: 120, y: 160 });
    expect(at("101-001")).toMatchObject({ x: 60, y: 0 });
    expect(layout.width).toBe(220);
    expect(layout.height).toBe(210);
    expect(layout.nodes.map((placed) => placed.node.key)).toEqual(["101-001", "101-002", "101-003", "101-004"]);
    expect(layout.edges.find((edge) => edge.key === "101-001>101-003")).toEqual({
      key: "101-001>101-003",
      from: { x: 110, y: 50 },
      to: { x: 170, y: 80 },
      dashed: false,
    });
  });

  it("lays separate roots side by side and handles an empty family", () => {
    const layout = layoutTree(buildFamilyTree(data([work(101, 1), work(101, 3, cr(101, 9))]), loose), size);
    expect(layout.nodes.map((placed) => placed.x)).toEqual([0, 120]);
    expect(layoutTree([], size)).toEqual({ nodes: [], edges: [], width: 0, height: 0 });
  });
});
