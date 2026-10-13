import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { Share } from "lucide-react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import { cn } from "~/lib/utils";

// Phones get their own share sheet; everywhere else the link goes to the clipboard. A signed-in
// member's link carries ?ref=<their username>, so a sale it brings pays them the affiliate share
// (economics v2; the first link a buyer arrives with counts for 30 days).
export function ShareButton({
  path,
  title,
  size = "md",
  className,
}: {
  path: string;
  title: string;
  size?: "sm" | "md";
  className?: string;
}) {
  const viewer = useQuery(convexQuery(api.identity.viewer, {})).data;
  const ref = viewer?.username?.toLowerCase();
  const onClick = async () => {
    const link = new URL(path, window.location.origin);
    if (ref) link.searchParams.set("ref", ref);
    const url = link.toString();
    if (prefersShareSheet()) {
      try {
        await navigator.share({ title, url });
        return;
      } catch (error) {
        // Closing the sheet isn't a failure. Anything else falls back to copying.
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copied", ref ? { description: "It’s your link: when it brings a buyer, you get a share." } : undefined);
    } catch {
      toast("Here’s the link", { description: url });
    }
  };

  return (
    <button
      type="button"
      onClick={() => void onClick()}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border-2 border-black font-black transition-colors hover:bg-neutral-100",
        size === "sm" ? "h-10 px-3.5 text-sm" : "h-11 px-4 text-base",
        className,
      )}
    >
      <Share aria-hidden className={size === "sm" ? "size-4" : "size-5"} strokeWidth={2.5} />
      Share
    </button>
  );
}

export function prefersShareSheet() {
  return (
    typeof navigator.share === "function" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(pointer: coarse)").matches
  );
}
