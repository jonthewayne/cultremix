import type { GenericDatabaseReader } from "convex/server";
import type { DataModel, Doc, Id } from "../_generated/dataModel";
import type { EconomicLineage } from "./economics";

// A work's EconomicLineage, read from the works fields (kind, parentWorkId, familyRootId) at the
// order's economic event time and frozen onto the order line.
//
// The lineage builder (U11) is adding forks. Until a work is marked kind "fork", every remix is a
// variation in its family: the family root is familyRootId, or the first original or fork found
// walking up parentWorkId. A fork's family root is the fork itself, and its upstream is the creator
// of the work it forked (one generation only).

const MAX_WALK = 50;

// A confirmed lineage correction (convex/lineage.ts amendments) sets effectiveKind and
// effectiveParentWorkId; sales follow it from then on, as the work page's panel does. Until one
// confirms, the work's own kind and parent stand.
export function effectiveKind(work: Doc<"works">): Doc<"works">["kind"] {
  return work.effectiveKind ?? work.kind;
}
export function effectiveParent(work: Doc<"works">): Id<"works"> | undefined {
  return work.effectiveKind !== undefined ? work.effectiveParentWorkId : work.parentWorkId;
}

type Db = GenericDatabaseReader<DataModel>;

async function forkParentCreator(db: Db, fork: Doc<"works">): Promise<string | null> {
  const parentId = effectiveParent(fork);
  if (!parentId) return null;
  const parent = await db.get("works", parentId);
  return parent ? parent.creatorId : null;
}

export async function familyRoot(db: Db, work: Doc<"works">): Promise<Doc<"works"> | null> {
  if (work.effectiveKind === undefined && work.familyRootId && work.familyRootId !== work._id) {
    const root = await db.get("works", work.familyRootId);
    if (root) return root;
  }
  let current: Doc<"works"> | null = work;
  const seen = new Set<Id<"works">>();
  for (let i = 0; i < MAX_WALK && current; i++) {
    if (seen.has(current._id)) return null;
    seen.add(current._id);
    if (current._id !== work._id && effectiveKind(current) !== "variation") return current;
    const parentId = effectiveParent(current);
    if (!parentId) return current._id === work._id ? null : current;
    current = await db.get("works", parentId);
  }
  return null;
}

export async function resolveLineage(db: Db, work: Doc<"works">): Promise<EconomicLineage> {
  const creator = work.creatorId as string;
  const kind = effectiveKind(work);
  if (kind === "fork") {
    const parentCreator = await forkParentCreator(db, work);
    // A fork whose parent is gone pays its own creator in both roles.
    return { kind: "fork", creator, parentCreator: parentCreator ?? creator };
  }
  if (kind === "original" || !effectiveParent(work)) return { kind: "original", creator };
  const root = await familyRoot(db, work);
  if (!root) return { kind: "original", creator };
  if (effectiveKind(root) === "fork") {
    const parentCreator = await forkParentCreator(db, root);
    return {
      kind: "variation",
      creator,
      root: { kind: "fork", creator: root.creatorId, parentCreator: parentCreator ?? root.creatorId },
    };
  }
  return { kind: "variation", creator, root: { kind: "original", creator: root.creatorId } };
}
