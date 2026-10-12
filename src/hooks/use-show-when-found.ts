import { useRouter } from "@tanstack/react-router";
import { useEffect } from "react";

// For a page the server answered with a 404 because its loader found nothing yet: the not-found
// view keeps the same live query open and passes its data here, and once the thing exists, the
// route's loaders run again and the page shows. A design opened from its reveal a moment before it
// finished publishing (about a second and a half) would otherwise stay on "isn't published" until
// a reload; the publish end-to-end test found it on October 11.
export function useShowWhenFound(found: unknown) {
  const router = useRouter();
  useEffect(() => {
    if (found) void router.invalidate();
  }, [found, router]);
}
