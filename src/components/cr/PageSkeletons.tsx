import { cn } from "~/lib/utils";

// Placeholders shaped like the page that's loading, shown on a client navigation before its data
// arrives (server-rendered pages arrive with their data). Same layout as the real page, so nothing
// jumps when it fills in.

function Block({ className }: { className?: string }) {
  return <div aria-hidden className={cn("animate-pulse rounded-2xl bg-neutral-100", className)} />;
}

// A work page: the art and the model photo side by side, then the CR number and the buy box.
export function WorkPageSkeleton() {
  return (
    <main className="px-4 pb-24 md:px-10" aria-busy="true" aria-label="Loading the design">
      <div className="grid grid-cols-1 gap-2 pt-4 sm:grid-cols-2 md:gap-4">
        <Block className="aspect-square" />
        <Block className="aspect-square" />
      </div>
      <section className="mt-8 grid gap-10 md:mt-12 md:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] md:gap-16">
        <div className="space-y-4">
          <Block className="h-16 w-3/4 md:h-24" />
          <Block className="h-6 w-1/3" />
          <Block className="h-11 w-56 rounded-full" />
        </div>
        <div className="space-y-4">
          <Block className="h-14 w-1/2" />
          <Block className="h-11 w-full" />
          <Block className="h-14 w-full" />
        </div>
      </section>
    </main>
  );
}

// A profile: avatar and name, counts, the shelf tabs, and a grid.
export function ProfileSkeleton() {
  return (
    <main className="px-4 pb-24 md:px-10" aria-busy="true" aria-label="Loading the profile">
      <div className="flex items-center gap-4 pt-6 md:gap-7 md:pt-10">
        <Block className="size-20 rounded-[22%] md:size-32" />
        <Block className="h-12 w-2/3 md:h-20" />
      </div>
      <Block className="mt-6 h-6 w-64" />
      <Block className="mt-12 h-8 w-full max-w-md md:mt-16" />
      <ShelfSkeleton />
    </main>
  );
}

// A grid of designs while the first page loads.
export function ShelfSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="mt-8 grid grid-cols-2 gap-4 md:grid-cols-4" aria-busy="true" aria-label="Loading">
      {Array.from({ length: count }, (_, i) => (
        <Block key={i} className="aspect-square" />
      ))}
    </div>
  );
}

// Feed rows on the home page while the first page loads.
export function FeedSkeleton() {
  return (
    <div className="space-y-16" aria-busy="true" aria-label="Loading the feed">
      {[0, 1].map((i) => (
        <div key={i} className="space-y-4">
          <div className="grid grid-cols-2 gap-2 md:gap-4">
            <Block className="aspect-square" />
            <Block className="aspect-square" />
          </div>
          <Block className="h-12 w-1/2" />
          <Block className="h-5 w-1/3" />
        </div>
      ))}
    </div>
  );
}
