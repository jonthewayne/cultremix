import { Link, useRouter } from "@tanstack/react-router";
import { useEffect } from "react";
import type { ErrorComponentProps } from "@tanstack/react-router";
import { SiteHeader } from "~/components/cr/SiteHeader";
import { reportClientError } from "~/lib/clientErrors";
import { cn } from "~/lib/utils";

// The page for an address that leads nowhere: an unknown CR number, family, member, or path.
// `mark` is what was asked for, shown big and faded so it's clear what wasn't found; mono for
// numbers (CR numbers, 404), plain type for names.
export function NotFoundPage({
  mark = "404",
  message = "Nothing here.",
  mono = true,
}: {
  mark?: string;
  message?: string;
  mono?: boolean;
}) {
  // An unknown path has no route head of its own, so the tab would keep the home page's title.
  useEffect(() => {
    document.title = "Not found · CultRemix";
  }, []);
  return (
    <div className="min-h-svh bg-white text-black">
      <SiteHeader />
      <main className="px-4 pb-24 pt-12 md:px-10 md:pt-16">
        <p
          className={cn(
            "text-6xl text-neutral-300 [overflow-wrap:anywhere] md:text-8xl",
            mono ? "font-cr leading-[0.9]" : "font-black leading-none tracking-tight",
          )}
        >
          {mark}
        </p>
        <p className="mt-6 text-xl md:text-2xl">{message}</p>
        <Link
          to="/"
          className="mt-8 inline-flex h-12 items-center rounded-2xl bg-black px-6 text-lg font-black text-white transition-transform hover:-translate-y-0.5"
        >
          Back to the feed
        </Link>
      </main>
    </div>
  );
}

// When a page fails to load. No header here: the header's own queries may be what failed.
export function ErrorPage({ error, reset }: ErrorComponentProps) {
  const router = useRouter();
  // The error behind it goes to Admin, Overview (src/lib/clientErrors.ts).
  useEffect(() => reportClientError(error, "page"), [error]);
  return (
    <div className="min-h-svh bg-white px-4 py-16 text-black md:px-10">
      <Link to="/" className="text-base font-black uppercase tracking-[0.2em] md:text-lg">
        CultRemix
      </Link>
      <p className="mt-12 text-5xl font-black tracking-tight md:text-7xl">Something slipped.</p>
      <p className="mt-6 max-w-prose text-xl">This page didn’t load. Try again in a moment.</p>
      <div className="mt-8 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => {
            reset();
            void router.invalidate();
          }}
          className="inline-flex h-12 items-center rounded-2xl bg-black px-6 text-lg font-black text-white"
        >
          Try again
        </button>
        <a href="/" className="inline-flex h-12 items-center rounded-2xl border-2 border-black px-6 text-lg font-black">
          Back to the feed
        </a>
      </div>
    </div>
  );
}
