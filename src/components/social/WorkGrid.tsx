import { Link } from "@tanstack/react-router";
import type { FunctionReturnType } from "convex/server";
import type { api } from "../../../convex/_generated/api";
import { Art } from "~/components/cr/Art";
import { CrMark } from "~/components/cr/CrMark";
import { remixOfLabel } from "~/lib/familyTree";

export type FeedItem = FunctionReturnType<typeof api.feed.latest>["page"][number];

// A grid of designs: art on its color, the CR number, and the creator.
export function WorkGrid({ items, showCreator = true }: { items: Array<FeedItem>; showCreator?: boolean }) {
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-8 md:grid-cols-4 md:gap-x-4 md:gap-y-10">
      {items.map((item) => (
        <article key={item.workId} className="min-w-0">
          <Link to="/cr/$cr" params={{ cr: item.cr }} className="group block">
            <div
              className="flex aspect-square items-center justify-center overflow-hidden rounded-2xl p-[8%]"
              style={{ background: item.backgroundColor }}
            >
              <Art
                url={item.artThumbUrl ?? item.artMediumUrl ?? item.artUrl}
                alt={item.title ?? `CR ${item.cr}`}
                className="h-full w-auto max-w-full object-contain transition-transform duration-500 group-hover:scale-[1.04]"
              />
            </div>
            <CrMark cr={item.cr} className="mt-2 text-2xl md:text-3xl" />
          </Link>
          {showCreator ? (
            <Link
              to="/u/$username"
              params={{ username: item.creator.username }}
              className="mt-0.5 block truncate text-sm hover:underline"
            >
              @{item.creator.username}
            </Link>
          ) : item.parentCr ? (
            <p className="mt-0.5 truncate text-sm text-neutral-500">
              {remixOfLabel(item.cr, item.parentCr)} <span className="font-cr">CR {item.parentCr}</span>
            </p>
          ) : (
            item.title && <p className="mt-0.5 truncate text-sm">{item.title}</p>
          )}
        </article>
      ))}
    </div>
  );
}
