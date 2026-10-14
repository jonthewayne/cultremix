import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { useMutation } from "convex/react";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import { errorMessage } from "~/lib/imagePrep";

// On a work's page, for the owner: retake its model photo after changing what it comes on, its
// size, its place, or its colors (convex/photos.ts retake).
export function PhotoRetake({ cr }: { cr: string }) {
  const viewer = useQuery(convexQuery(api.identity.viewer, {})).data;
  const retake = useMutation(api.photos.retake);
  const [busy, setBusy] = useState(false);
  if (!viewer?.isOwner) return null;

  const start = async () => {
    setBusy(true);
    try {
      await retake({ cr });
      toast("New photo started. The one that's up stays until it's ready, in about a minute.");
    } catch (err) {
      toast(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <button type="button" onClick={() => void start()} disabled={busy} className="self-start text-sm font-bold underline underline-offset-4 disabled:opacity-50">
      {busy ? "Starting…" : "Retake the model photo with this size and color"}
    </button>
  );
}
