import { usePaginatedQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { WorkCard } from "./WorkCard";

// Works remixed straight from this one (variations and forks), a page at a time.
export function DirectRemixes({ cr }: { cr: string }) {
  const { results, status, loadMore } = usePaginatedQuery(api.lineage.directRemixes, { cr }, { initialNumItems: 8 });
  if (results.length === 0) return null;
  return (
    <section className="mt-20">
      <h2 className="border-t-2 border-black pt-4 text-sm font-bold uppercase tracking-wider">Remixes of this</h2>
      <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        {results.map((work) => (
          <WorkCard key={work.cr} work={work} />
        ))}
      </div>
      {(status === "CanLoadMore" || status === "LoadingMore") && (
        <button
          type="button"
          onClick={() => loadMore(8)}
          disabled={status === "LoadingMore"}
          className="mt-8 h-12 rounded-2xl border-2 border-black px-6 font-bold transition-transform hover:-translate-y-0.5 disabled:opacity-50"
        >
          {status === "LoadingMore" ? "Loading…" : "Show more"}
        </button>
      )}
    </section>
  );
}
