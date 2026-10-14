import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { useMutation } from "convex/react";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { errorMessage } from "~/lib/imagePrep";

// On a work's page, for admins who manage (ops and the owner): put the design on the homepage's
// Featured feed, or take it off (convex/feed.ts setFeatured). A new design starts in Latest only.
export function HomeFeature({ workId }: { workId: Id<"works"> }) {
  const state = useQuery(convexQuery(api.feed.homeState, { workId })).data;
  const setFeatured = useMutation(api.feed.setFeatured);
  const [busy, setBusy] = useState(false);
  if (!state) return null;

  const toggle = async () => {
    setBusy(true);
    try {
      await setFeatured({ workId, featured: !state.featured });
      toast(state.featured ? "Taken off the homepage. It's still in Latest." : "Featured on the homepage.");
    } catch (err) {
      toast(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="border-t-2 border-black pt-4 text-sm">
      <p className="font-bold uppercase tracking-wider">Homepage</p>
      <p className="mt-1 text-neutral-600">
        {state.featured
          ? "Featured: it's on the feed the homepage opens on."
          : "Not featured: it's in Latest and on its creator's profile, but not on the feed the homepage opens on."}
      </p>
      <button
        type="button"
        disabled={busy}
        onClick={() => void toggle()}
        className="mt-3 inline-flex h-11 items-center rounded-xl border-2 border-black px-4 font-bold disabled:opacity-50"
      >
        {state.featured ? "Take it off the homepage" : "Feature it on the homepage"}
      </button>
    </div>
  );
}
