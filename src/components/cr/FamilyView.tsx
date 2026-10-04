import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../../convex/_generated/api";
import { WorkCard } from "./WorkCard";

// Every published work sharing this one's family number, in CR order.
export function FamilyView({ cr }: { cr: string }) {
  const family = useQuery(convexQuery(api.lineage.family, { cr })).data;
  if (!family || family.works.length < 2) return null;
  return (
    <section className="mt-20">
      <h2 className="border-t-2 border-black pt-4 text-sm font-bold uppercase tracking-wider">
        Family {family.family} <span className="text-neutral-500">· {family.works.length}{family.more ? "+" : ""} designs</span>
      </h2>
      <div className="mt-6 grid grid-cols-4 gap-3 sm:grid-cols-6 md:grid-cols-8">
        {family.works.map((work) => (
          <WorkCard key={work.cr} work={work} current={work.cr === cr} small />
        ))}
      </div>
    </section>
  );
}
