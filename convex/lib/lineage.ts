// Effective lineage (V1 plan "Lineage amendments", R17-R19, INV-21). Pure: callers pass a loader, so
// the same rules run in Convex functions and in unit tests.
//
// A work's original parent and kind never change. A confirmed amendment sets its effective parent
// and kind; everything that walks lineage (trails, direct remixes, economics) uses those.
//
// CR rules: an original starts a family (expression 1, no parent); a variation joins its parent's
// family as the next expression; a fork starts a new family (expression 1) and credits its parent,
// which is in another family. So a family's only non-variation is its expression 1, its root.
import type { EconomicLineage } from "./economics";

export type WorkKind = "original" | "variation" | "fork";

// Amendment validation walks at most this many works, starting with the new parent (the
// registry's bound; registration itself has no depth limit).
export const MAX_AMENDMENT_HOPS = 64;
// Work pages show at most this many ancestors.
export const MAX_TRAIL = 64;

export type LineageWork = {
  id: string;
  family: number;
  expression: number;
  creator: string;
  kind: WorkKind;
  parentId?: string;
  // Set once an amendment confirms (effectiveKind set means amended).
  effectiveKind?: WorkKind;
  effectiveParentId?: string;
  // Published or withdrawn: it has a CR number and a public record.
  registered: boolean;
};

export type Loader = (id: string) => Promise<LineageWork | null> | LineageWork | null;

export class LineageError extends Error {
  constructor(
    public code: "cycle" | "missing",
    message: string,
  ) {
    super(message);
  }
}

export function effectiveOf(work: LineageWork): { kind: WorkKind; parentId?: string } {
  if (work.effectiveKind !== undefined) return { kind: work.effectiveKind, parentId: work.effectiveParentId };
  return { kind: work.kind, parentId: work.effectiveParentId ?? work.parentId };
}

export type TrailStep = {
  work: LineageWork;
  // How the step below reached this work: the child was a variation of it or forked from it.
  via: "variation" | "fork";
};

// Ancestors from the parent up to the origin (the first work with no effective parent), crossing
// forks. Nearest first. Stops after `max` ancestors with truncated: true; refuses a cycle.
export async function effectiveAncestors(
  work: LineageWork,
  load: Loader,
  max = MAX_TRAIL,
): Promise<{ steps: Array<TrailStep>; truncated: boolean }> {
  const seen = new Set([work.id]);
  const steps: Array<TrailStep> = [];
  let child = effectiveOf(work);
  while (child.parentId) {
    if (steps.length >= max) return { steps, truncated: true };
    if (seen.has(child.parentId)) throw new LineageError("cycle", "This lineage loops back on itself.");
    seen.add(child.parentId);
    const parent = await load(child.parentId);
    if (!parent) throw new LineageError("missing", "A work in this lineage is missing.");
    steps.push({ work: parent, via: child.kind === "fork" ? "fork" : "variation" });
    child = effectiveOf(parent);
  }
  return { steps, truncated: false };
}

// Who a sale of this work pays, by role, for recipientShares (convex/lib/economics.ts). A
// variation's family root is its family's expression 1 (loadFamilyRoot), however long the chain.
export async function economicLineage(
  work: LineageWork,
  load: Loader,
  loadFamilyRoot: (family: number) => Promise<LineageWork | null> | LineageWork | null,
): Promise<EconomicLineage> {
  const own = effectiveOf(work);
  if (own.kind === "original") return { kind: "original", creator: work.creator };
  if (own.kind === "fork") {
    const parent = own.parentId ? await load(own.parentId) : null;
    if (!parent) throw new LineageError("missing", "This fork's parent is missing.");
    return { kind: "fork", creator: work.creator, parentCreator: parent.creator };
  }
  const root = await loadFamilyRoot(work.family);
  if (!root || root.id === work.id) throw new LineageError("missing", "This family's first work is missing.");
  const rootLineage = effectiveOf(root);
  if (rootLineage.kind === "original") {
    return { kind: "variation", creator: work.creator, root: { kind: "original", creator: root.creator } };
  }
  if (rootLineage.kind === "fork") {
    const upstream = rootLineage.parentId ? await load(rootLineage.parentId) : null;
    if (!upstream) throw new LineageError("missing", "The family's fork parent is missing.");
    return {
      kind: "variation",
      creator: work.creator,
      root: { kind: "fork", creator: root.creator, parentCreator: upstream.creator },
    };
  }
  throw new LineageError("missing", "This family's first work is not an original or a fork.");
}

// Where a newly published remix goes. A variation joins the parent's family; a fork starts a new
// one. Without a parent it's an original.
export function publishPlacement(
  parent: { id: string; family: number } | null,
  mode: "variation" | "fork" = "variation",
): { kind: WorkKind; family: "new" | number; parentId?: string } {
  if (!parent) return { kind: "original", family: "new" };
  if (mode === "fork") return { kind: "fork", family: "new", parentId: parent.id };
  return { kind: "variation", family: parent.family, parentId: parent.id };
}

// Variation or fork, for a remix being published. A remix that changed only the parent's
// remixable words (its boxes, or nothing at all) on the parent's own art stays a variation and
// can't be published as a fork: a fork gives its creator a bigger share (convex/lib/economics.ts),
// so a word swap can't claim one. Anything more (words in the request, style buttons, more images,
// a style, or other art as image 1) may start a new family, and the publish dialog suggests it.
export function remixChangedOnlyWords(
  batch: {
    instruction: string;
    presets: Array<string>;
    inspirationKey?: string;
    images?: Array<{ key: string }>;
    styles?: Array<{ weight: number }>;
  },
  parentArtKey: string | undefined,
) {
  const onParentArt = Boolean(parentArtKey) && batch.inspirationKey === parentArtKey;
  const images = batch.images ? batch.images.length : batch.inspirationKey ? 1 : 0;
  const styled = (batch.styles ?? []).some((style) => style.weight > 0);
  return onParentArt && images <= 1 && !styled && !batch.instruction.trim() && batch.presets.length === 0;
}

export type AmendmentRefusal =
  | "not_registered"
  | "no_change"
  | "kind_change"
  | "original_with_parent"
  | "missing_parent"
  | "parent_not_registered"
  | "self_parent"
  | "fork_same_family"
  | "variation_other_family"
  | "cycle"
  | "too_deep";

const REFUSALS: Record<AmendmentRefusal, string> = {
  not_registered: "That work isn't published.",
  no_change: "That's already its lineage.",
  kind_change: "Only an original can become a fork, and a fork an original. A variation keeps its kind.",
  original_with_parent: "An original has no parent.",
  missing_parent: "Pick the parent work.",
  parent_not_registered: "The new parent isn't published.",
  self_parent: "A work can't be its own parent.",
  fork_same_family: "A fork's parent must be in another family.",
  variation_other_family: "A variation's parent must be in its own family.",
  cycle: "That parent descends from this work, so the lineage would loop.",
  too_deep: `The new parent's lineage is longer than ${MAX_AMENDMENT_HOPS} works.`,
};

export function refusalMessage(code: AmendmentRefusal) {
  return REFUSALS[code];
}

// Mirrors the registry's amendLineage rules: the work is registered; kind changes only original <->
// fork; an original has no parent; a fork's parent is registered, not the work, and in another
// family; a variation's parent is registered and in the work's family. For a new parent, walk its
// effective ancestors (at most MAX_AMENDMENT_HOPS works, the new parent first) and refuse if the
// walk meets the work or runs past the bound.
export async function validateAmendment(
  work: LineageWork,
  change: { newKind: WorkKind; newParentId?: string },
  load: Loader,
): Promise<{ ok: true } | { ok: false; code: AmendmentRefusal; message: string }> {
  const refuse = (code: AmendmentRefusal) => ({ ok: false as const, code, message: REFUSALS[code] });
  if (!work.registered) return refuse("not_registered");
  const current = effectiveOf(work);
  const { newKind, newParentId } = change;
  if (current.kind !== newKind) {
    const allowed =
      (current.kind === "original" && newKind === "fork") || (current.kind === "fork" && newKind === "original");
    if (!allowed) return refuse("kind_change");
  }
  if (newKind === "original") {
    if (newParentId) return refuse("original_with_parent");
    if (current.kind === "original") return refuse("no_change");
    return { ok: true };
  }
  if (!newParentId) return refuse("missing_parent");
  if (newParentId === work.id) return refuse("self_parent");
  if (current.kind === newKind && current.parentId === newParentId) return refuse("no_change");
  const parent = await load(newParentId);
  if (!parent || !parent.registered) return refuse("parent_not_registered");
  if (newKind === "fork" && parent.family === work.family) return refuse("fork_same_family");
  if (newKind === "variation" && parent.family !== work.family) return refuse("variation_other_family");
  let cursor: string | undefined = newParentId;
  let hops = 0;
  while (cursor) {
    if (cursor === work.id) return refuse("cycle");
    hops += 1;
    if (hops > MAX_AMENDMENT_HOPS) return refuse("too_deep");
    const node: LineageWork | null = cursor === parent.id ? parent : await load(cursor);
    if (!node) return refuse("parent_not_registered");
    cursor = effectiveOf(node).parentId;
  }
  return { ok: true };
}
