import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { api } from "../../../convex/_generated/api";
import { FamilyTree } from "./FamilyTree";
import { familyOfCr } from "~/lib/familyTree";

// The work's family as a compact tree, with a link to the whole tree on /family/<n>. The query
// arguments match that page's first load, so going there reuses this data.
export function FamilyView({ cr }: { cr: string }) {
  const family = familyOfCr(cr);
  const data = useQuery({
    ...convexQuery(api.lineage.familyTree, { family: family ?? 0, limit: 60 }),
    enabled: family !== null,
  }).data;
  if (!data) return null;
  // Nothing to draw for a lone original that was never remixed.
  if (data.works.length + data.forks.length + data.origins.length < 2) return null;
  const count = data.works.filter((work) => !work.withdrawn).length;
  return (
    <section className="mt-20">
      <h2 className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t-2 border-black pt-4 text-sm font-bold uppercase tracking-wider">
        <span>
          Family {data.family}{" "}
          <span className="text-neutral-500">
            · {count}
            {data.more ? "+" : ""} {count === 1 ? "design" : "designs"}
          </span>
        </span>
        <Link
          to="/family/$family"
          params={{ family: String(data.family) }}
          search={{ cr }}
          className="normal-case tracking-normal underline underline-offset-4 hover:no-underline"
        >
          See the whole tree →
        </Link>
      </h2>
      <div className="mt-6">
        <FamilyTree data={data} currentCr={cr} compact />
      </div>
    </section>
  );
}
