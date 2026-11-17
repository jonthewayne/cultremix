import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { api } from "../../../convex/_generated/api";

// "Inspired by Jane Doe (unclaimed)" under a design's byline: the outside artists it credits,
// its own and those it inherits from earlier designs in its lineage (convex/artists.ts).
export function InspiredBy({ cr }: { cr: string }) {
  const credits = useQuery(convexQuery(api.artists.forWork, { cr })).data;
  if (!credits || credits.length === 0) return null;
  return (
    <p className="mt-2 text-base">
      Inspired by{" "}
      {credits.map((artist, i) => (
        <span key={artist.slug}>
          {i > 0 && (i === credits.length - 1 ? " and " : ", ")}
          <Link to="/artist/$slug" params={{ slug: artist.slug }} className="font-bold hover:underline">
            {artist.name}
          </Link>
          {!artist.claimed && <span className="text-neutral-600"> (unclaimed)</span>}
          {artist.via && <span className="text-neutral-600"> via CR {artist.via}</span>}
        </span>
      ))}
    </p>
  );
}
