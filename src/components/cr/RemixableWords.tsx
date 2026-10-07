import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../../convex/_generated/api";
import { changeSummary } from "../../../convex/lib/remixWords";
import type { Id } from "../../../convex/_generated/dataModel";

// Under a remix's lineage: the words it changed from its parent. Works signed out. Editing what's
// remixable lives in RemixableParts.tsx.
export function WordChangesNote({ workId }: { workId: Id<"works"> }) {
  const changes = useQuery(convexQuery(api.remixFields.forWork, { workId })).data?.changes ?? [];
  if (changes.length === 0) return null;
  return <p className="mt-2 text-lg">Changed the words: <span className="font-bold">{changeSummary(changes)}</span></p>;
}

