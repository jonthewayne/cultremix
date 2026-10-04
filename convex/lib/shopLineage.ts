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

type Db = GenericDatabaseReader<DataModel>;

async function forkParentCreator(db: Db, fork: Doc<"works">): Promise<string | null> {
  if (!fork.parentWorkId) return null;
  const parent = await db.get("works", fork.parentWorkId);
  return parent ? parent.creatorId : null;
}

async function familyRoot(db: Db, work: Doc<"works">): Promise<Doc<"works"> | null> {
  if (work.familyRootId && work.familyRootId !== work._id) {
    const root = await db.get("works", work.familyRootId);
    if (root) return root;
  }
  let current: Doc<"works"> | null = work;
  const seen = new Set<Id<"works">>();
  for (let i = 0; i < MAX_WALK && current; i++) {
    if (seen.has(current._id)) return null;
    seen.add(current._id);
    if (current._id !== work._id && current.kind !== "variation") return current;
    if (!current.parentWorkId) return current._id === work._id ? null : current;
    current = await db.get("works", current.parentWorkId);
  }
  return null;
}

export async function resolveLineage(db: Db, work: Doc<"works">): Promise<EconomicLineage> {
  const creator = work.creatorId as string;
  if (work.kind === "fork") {
    const parentCreator = await forkParentCreator(db, work);
    // A fork whose parent is gone pays its own creator in both roles.
    return { kind: "fork", creator, parentCreator: parentCreator ?? creator };
  }
  if (work.kind === "original" || !work.parentWorkId) return { kind: "original", creator };
  const root = await familyRoot(db, work);
  if (!root) return { kind: "original", creator };
  if (root.kind === "fork") {
    const parentCreator = await forkParentCreator(db, root);
    return {
      kind: "variation",
      creator,
      root: { kind: "fork", creator: root.creatorId, parentCreator: parentCreator ?? root.creatorId },
    };
  }
  return { kind: "variation", creator, root: { kind: "original", creator: root.creatorId } };
}
