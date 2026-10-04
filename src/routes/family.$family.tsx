import { convexQuery } from "@convex-dev/react-query";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { Check } from "lucide-react";
import { useState } from "react";
import { api } from "../../convex/_generated/api";
import { FamilyTree } from "~/components/cr/FamilyTree";
import { SiteHeader } from "~/components/cr/SiteHeader";
import { chainSummary, familyOfCr } from "~/lib/familyTree";

// Works per load; "Show more" adds another page (the query caps the total).
const PAGE = 60;
const MAX = 240;

const familyNumber = (param: string) => (/^\d{1,9}$/u.test(param) ? Number(param) : null);

export const Route = createFileRoute("/family/$family")({
  validateSearch: (search: Record<string, unknown>): { cr?: string } =>
    typeof search.cr === "string" && familyOfCr(search.cr) !== null ? { cr: search.cr } : {},
  loader: async ({ context, params }) => {
    const family = familyNumber(params.family);
    if (family !== null && context.convexQueryClient.serverHttpClient) {
      await context.queryClient.fetchQuery(convexQuery(api.lineage.familyTree, { family, limit: PAGE })).catch(() => null);
    }
  },
  head: ({ params }) => ({ meta: [{ title: `Family ${params.family} · CultRemix` }] }),
  component: FamilyPage,
});

function FamilyPage() {
  const params = Route.useParams();
  const { cr } = Route.useSearch();
  const family = familyNumber(params.family);
  const [limit, setLimit] = useState(PAGE);
  const tree = useQuery({
    ...convexQuery(api.lineage.familyTree, { family: family ?? 0, limit }),
    enabled: family !== null,
    placeholderData: keepPreviousData,
  });
  const data = family !== null && tree.data?.family === family ? tree.data : null;
  const root = data?.works.find((work) => work.expression === 1);
  const origin = root?.parentCr ? data?.origins.find((work) => work.cr === root.parentCr) : undefined;
  const count = data?.works.filter((work) => !work.withdrawn).length ?? 0;
  const chain = data ? chainSummary(data) : null;

  return (
    <div className="min-h-svh bg-white text-black">
      <SiteHeader />
      <main className="px-4 pb-24 md:px-10">
        <h1 className="pt-8 text-5xl font-black tracking-tight md:text-7xl">
          Family <span className="font-cr">{params.family}</span>
        </h1>
        {tree.isLoading && family !== null ? null : !data ? (
          <>
            <p className="mt-6 text-xl">There’s no family with this number yet.</p>
            <Link to="/" className="mt-6 inline-block font-bold underline underline-offset-4">
              Back to the feed
            </Link>
          </>
        ) : (
          <>
            <p className="mt-4 max-w-prose text-lg leading-snug">
              {count}
              {data.more ? "+" : ""} {count === 1 ? "design" : "designs"}
              {root?.username && (
                <>
                  , started by <span className="font-bold">@{root.username}</span>
                </>
              )}
              {origin && (
                <>
                  {" "}as a fork of{" "}
                  <Link to="/cr/$cr" params={{ cr: origin.cr }} className="font-bold underline underline-offset-4">
                    CR {origin.cr}
                  </Link>
                </>
              )}
              .
            </p>
            {chain && (
              <p className="mt-2 flex items-center gap-2 text-lg font-semibold">
                <span aria-hidden className="grid size-5 place-items-center rounded-full bg-black text-white">
                  <Check strokeWidth={3} className="size-3" />
                </span>
                <ChainLine href={chain.rootTxUrl}>
                  {chain.recorded} of {chain.total}
                  {data.more ? "+" : ""} {chain.total === 1 ? "design" : "designs"} recorded on Monad
                </ChainLine>
              </p>
            )}
            <Legend chain={data.works.some((work) => work.chain)} />
            <div className="mt-8">
              <FamilyTree data={data} currentCr={cr} />
            </div>
            {data.more && limit < MAX && (
              <button
                type="button"
                onClick={() => setLimit((current) => Math.min(MAX, current + PAGE))}
                disabled={tree.isFetching}
                className="mt-8 h-12 rounded-2xl border-2 border-black px-6 font-bold transition-transform hover:-translate-y-0.5 disabled:opacity-50"
              >
                {tree.isFetching ? "Loading…" : "Show more of this family"}
              </button>
            )}
            {data.more && limit >= MAX && (
              <p className="mt-8 text-sm text-neutral-500">This family is bigger than one page can draw. Here are its first {MAX} designs.</p>
            )}
          </>
        )}
      </main>
    </div>
  );
}

// Links to the original's registration on the explorer, when there's one to link to.
function ChainLine({ href, children }: { href?: string; children: React.ReactNode }) {
  if (!href) return <span>{children}</span>;
  return (
    <a href={href} target="_blank" rel="noreferrer" className="underline underline-offset-4 hover:no-underline">
      {children}
    </a>
  );
}

function Legend({ chain }: { chain: boolean }) {
  return (
    <p className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm text-neutral-600">
      <span className="inline-flex items-center gap-2">
        <svg aria-hidden width="28" height="4"><line x1="0" y1="2" x2="28" y2="2" stroke="black" strokeWidth="2" /></svg>
        a variation, same family
      </span>
      <span className="inline-flex items-center gap-2">
        <svg aria-hidden width="28" height="4"><line x1="0" y1="2" x2="28" y2="2" stroke="#a3a3a3" strokeWidth="2" strokeDasharray="6 5" /></svg>
        a fork, which starts a new family
      </span>
      {chain && (
        <span className="inline-flex items-center gap-2">
          <span aria-hidden className="grid size-4 place-items-center rounded-full bg-black text-white">
            <Check strokeWidth={3} className="size-2.5" />
          </span>
          recorded on Monad
        </span>
      )}
    </p>
  );
}
