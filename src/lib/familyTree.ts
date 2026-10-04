// Builds and lays out a CR family as a tree (the /family/<n> page and the work page's compact
// tree). Pure: the data comes from api.lineage.familyTree, and nothing here touches Convex.

export type TreeWork = {
  cr: string;
  family: number;
  expression: number;
  kind: "original" | "variation" | "fork";
  // The effective parent (after any confirmed lineage correction), in any family.
  parentCr?: string;
  withdrawn: boolean;
  title?: string;
  username?: string;
  backgroundColor?: string;
  thumbUrl?: string;
  // Published direct remixes (variations and forks); remixesMore when there are more than counted.
  remixes?: number;
  remixesMore?: boolean;
  hearts?: number;
  // Registered on Monad ("recorded"), or queued and on its way ("recording"); absent otherwise.
  chain?: "recorded" | "recording";
  chainTxUrl?: string;
};

export type FamilyTreeData = {
  family: number;
  // This family's works in CR order.
  works: Array<TreeWork>;
  // Works in other families whose parent is one of `works`: forks that started new families.
  forks: Array<TreeWork>;
  // Works in other families that one of `works` was forked from.
  origins: Array<TreeWork>;
  // The family (or its forks) has more than was loaded.
  more: boolean;
};

export type TreeNode =
  | { type: "work"; key: string; work: TreeWork; via: Via; current: boolean; children: Array<TreeNode> }
  // A fork that started its own family: a leaf that links to that family's tree.
  | { type: "fork"; key: string; work: TreeWork; via: "fork"; current: boolean; children: [] }
  // Where the family came from: drawn above the root it was forked into.
  | { type: "origin"; key: string; work: TreeWork; via: null; current: boolean; children: Array<TreeNode> }
  // Collapsed branches. `siblings` designs are hidden directly; `designs` counts them with
  // everything under them. Expanding `parentCr` shows them.
  | { type: "more"; key: string; parentCr: string; reason: "wide" | "deep"; siblings: number; designs: number; via: Via; children: [] };

type Via = "variation" | "fork" | null;

export type TreeOptions = {
  // Children of a work this deep (the family root is depth 0) start collapsed.
  maxDepth: number;
  // At most this many children of one work show before the rest collapse into a "+N" node
  // (never a "+1": one more than this shows them all).
  maxChildren: number;
  // Works whose children are all shown, whatever the limits.
  expanded?: ReadonlySet<string>;
  // The work being looked at: highlighted, and its branch is always open.
  currentCr?: string;
};

export const COMPACT_TREE: Omit<TreeOptions, "currentCr" | "expanded"> = { maxDepth: 2, maxChildren: 3 };
export const FULL_TREE: Omit<TreeOptions, "currentCr" | "expanded"> = { maxDepth: 6, maxChildren: 8 };

// "123-004" -> 123. Matches convex/lib/r2.ts parseCr, which isn't browser-safe to import.
export function familyOfCr(cr: string): number | null {
  const match = /^(?:CR\s*)?(\d{3,})-(\d{3,})$/iu.exec(cr.trim());
  return match ? Number(match[1]) : null;
}

// How a remix names its parent, the same words as the work page: a remix in its parent's family
// is a variation; one that started a new family was forked.
export function remixOfLabel(cr: string, parentCr: string): string {
  return familyOfCr(cr) === familyOfCr(parentCr) ? "Variation of" : "Forked from";
}

const byCr = (a: TreeWork, b: TreeWork) => a.family - b.family || a.expression - b.expression;

export function buildFamilyTree(data: FamilyTreeData, options: TreeOptions): Array<TreeNode> {
  const works = new Map(data.works.map((work) => [work.cr, work]));
  const origins = new Map(data.origins.map((work) => [work.cr, work]));
  const kids = new Map<string, Array<TreeWork>>();
  const add = (parent: string, child: TreeWork) => {
    const list = kids.get(parent) ?? [];
    list.push(child);
    kids.set(parent, list);
  };
  for (const work of data.works) if (work.parentCr && works.has(work.parentCr)) add(work.parentCr, work);
  // In-family children first, then forks out; each group in CR order.
  for (const list of kids.values()) list.sort(byCr);
  const forksOf = new Map<string, Array<TreeWork>>();
  for (const fork of [...data.forks].sort(byCr)) {
    if (!fork.parentCr || !works.has(fork.parentCr) || works.has(fork.cr)) continue;
    forksOf.set(fork.parentCr, [...(forksOf.get(fork.parentCr) ?? []), fork]);
  }
  const childrenOf = (cr: string) => [...(kids.get(cr) ?? []), ...(forksOf.get(cr) ?? [])];

  // Designs at and under a work (forks count as one each: their families are drawn elsewhere).
  const sizes = new Map<string, number>();
  const sizeOf = (work: TreeWork, seen: Set<string>): number => {
    const known = sizes.get(work.cr);
    if (known !== undefined) return known;
    if (seen.has(work.cr) || !works.has(work.cr)) return 1;
    seen.add(work.cr);
    const size = 1 + childrenOf(work.cr).reduce((sum, child) => sum + sizeOf(child, seen), 0);
    sizes.set(work.cr, size);
    return size;
  };

  // The current work's in-family ancestors stay open so it's always on screen.
  const path = new Set<string>();
  for (let cr = options.currentCr; cr && works.has(cr) && !path.has(cr); cr = works.get(cr)!.parentCr) path.add(cr);
  const expanded = options.expanded ?? new Set<string>();
  const maxChildren = Math.max(1, options.maxChildren);

  const placed = new Set<string>();
  const viaOf = (work: TreeWork): Via => (work.kind === "fork" ? "fork" : "variation");
  const node = (work: TreeWork, depth: number, via: Via): TreeNode => {
    placed.add(work.cr);
    const current = work.cr === options.currentCr;
    if (!works.has(work.cr)) return { type: "fork", key: `fork:${work.cr}`, work, via: "fork", current, children: [] };
    const all = childrenOf(work.cr).filter((child) => !placed.has(child.cr));
    const open = expanded.has(work.cr);
    const more = (hidden: Array<TreeWork>, reason: "wide" | "deep"): TreeNode => ({
      type: "more",
      key: `more:${work.cr}`,
      parentCr: work.cr,
      reason,
      siblings: hidden.length,
      designs: hidden.reduce((sum, child) => sum + sizeOf(child, new Set()), 0),
      via: hidden.every((child) => child.kind === "fork" || !works.has(child.cr)) ? "fork" : "variation",
      children: [],
    });
    let shown = all;
    let tail: TreeNode | null = null;
    // A "+1" takes the same room as the design it hides, so a lone design is just shown.
    const loneLeaf = all.length === 1 && sizeOf(all[0], new Set()) === 1;
    if (!open && all.length > 0 && !loneLeaf && depth >= options.maxDepth && !path.has(work.cr)) {
      shown = [];
      tail = more(all, "deep");
    } else if (!open && all.length > maxChildren + 1) {
      shown = all.slice(0, maxChildren);
      const onPath = all.findIndex((child) => path.has(child.cr));
      if (onPath >= maxChildren) shown = [...all.slice(0, maxChildren - 1), all[onPath]];
      const kept = new Set(shown.map((child) => child.cr));
      tail = more(all.filter((child) => !kept.has(child.cr)), "wide");
    }
    for (const child of shown) placed.add(child.cr);
    const children = shown.map((child) => node(child, depth + 1, works.has(child.cr) ? viaOf(child) : "fork"));
    return { type: "work", key: work.cr, work, via, current, children: tail ? [...children, tail] : children };
  };

  // Roots: works whose parent isn't in this family's loaded works, in CR order. Works only
  // reachable through a loop (damaged data) become roots too, so nothing is dropped.
  const roots: Array<TreeNode> = [];
  const originNodes = new Map<string, Extract<TreeNode, { type: "origin" }>>();
  const rootOf = (work: TreeWork) => {
    const origin = work.parentCr ? origins.get(work.parentCr) : undefined;
    const child = node(work, 0, origin ? "fork" : null);
    if (!origin) return roots.push(child);
    const existing = originNodes.get(origin.cr);
    if (existing) return existing.children.push(child);
    const top: Extract<TreeNode, { type: "origin" }> = { type: "origin", key: `origin:${origin.cr}`, work: origin, via: null, current: origin.cr === options.currentCr, children: [child] };
    originNodes.set(origin.cr, top);
    roots.push(top);
  };
  const sorted = [...data.works].sort(byCr);
  const reached = new Set<string>();
  const reach = (cr: string) => {
    if (reached.has(cr)) return;
    reached.add(cr);
    for (const child of kids.get(cr) ?? []) reach(child.cr);
  };
  const rootWorks: Array<TreeWork> = [];
  for (const work of sorted) {
    if (work.parentCr && works.has(work.parentCr)) continue;
    rootWorks.push(work);
    reach(work.cr);
  }
  for (const work of sorted) {
    if (reached.has(work.cr)) continue;
    rootWorks.push(work);
    reach(work.cr);
  }
  for (const work of rootWorks) rootOf(work);
  return roots;
}

export type PlacedNode = { node: TreeNode; x: number; y: number };
export type TreeEdge = { key: string; from: { x: number; y: number }; to: { x: number; y: number }; dashed: boolean };
export type TreeLayout = { nodes: Array<PlacedNode>; edges: Array<TreeEdge>; width: number; height: number };

// Top-down layout: each leaf takes the next column and each parent sits centred over its
// children. x and y are the top-left corner of a node's box.
export function layoutTree(
  roots: Array<TreeNode>,
  size: { nodeWidth: number; nodeHeight: number; gapX: number; gapY: number },
): TreeLayout {
  const nodes: Array<PlacedNode> = [];
  const edges: Array<TreeEdge> = [];
  const columnWidth = size.nodeWidth + size.gapX;
  const rowHeight = size.nodeHeight + size.gapY;
  let column = 0;
  let depthMax = 0;
  const place = (node: TreeNode, depth: number): PlacedNode => {
    depthMax = Math.max(depthMax, depth);
    const children = node.children.map((child) => place(child, depth + 1));
    const x = children.length ? (children[0].x + children.at(-1)!.x) / 2 : column++ * columnWidth;
    const placed = { node, x, y: depth * rowHeight };
    nodes.push(placed);
    for (const child of children) {
      edges.push({
        key: `${node.key}>${child.node.key}`,
        from: { x: x + size.nodeWidth / 2, y: placed.y + size.nodeHeight },
        to: { x: child.x + size.nodeWidth / 2, y: child.y },
        dashed: child.node.via === "fork",
      });
    }
    return placed;
  };
  for (const root of roots) place(root, 0);
  return {
    // Parents before children, in reading order, so the DOM order follows the tree.
    nodes: nodes.sort((a, b) => a.y - b.y || a.x - b.x),
    edges,
    width: Math.max(0, column * columnWidth - size.gapX),
    height: roots.length ? depthMax * rowHeight + size.nodeHeight : 0,
  };
}

// How many designs a built tree shows (works, forks and origins; not the "+N" nodes).
export function shownCount(roots: Array<TreeNode>): number {
  return roots.reduce((sum, node) => sum + (node.type === "more" ? 0 : 1) + shownCount(node.children), 0);
}

// The family page's onchain line: how many of the loaded designs (not withdrawn) are recorded on
// Monad, and the original's explorer entry. Null until at least one is.
export function chainSummary(data: FamilyTreeData): { recorded: number; total: number; rootTxUrl?: string } | null {
  const live = data.works.filter((work) => !work.withdrawn);
  const recorded = live.filter((work) => work.chain === "recorded").length;
  if (recorded === 0) return null;
  const root = live.find((work) => work.expression === 1 && work.chain === "recorded");
  return { recorded, total: live.length, ...(root?.chainTxUrl && { rootTxUrl: root.chainTxUrl }) };
}
