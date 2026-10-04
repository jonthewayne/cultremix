import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

// Where a work's onchain registration stands, under its fingerprint on the work page.
export function ChainStatus({ workId }: { workId: Id<"works"> }) {
  const { data } = useQuery(convexQuery(api.provenance.forWork, { workId }));
  if (!data) return null;
  const link = data.txUrl && (
    <a href={data.txUrl} target="_blank" rel="noreferrer" className="font-bold underline underline-offset-4">
      View transaction
    </a>
  );
  if (data.status === "confirmed") {
    return (
      <p className="mt-2 font-semibold">
        Registered on {data.networkName}
        {link && <> · {link}</>}
      </p>
    );
  }
  if (data.status === "submitted") {
    return (
      <p className="mt-2 font-semibold">
        Registering on {data.networkName}…{link && <> · {link}</>}
      </p>
    );
  }
  if (data.status === "pending") return <p className="mt-2 font-semibold">Waiting to be registered on {data.networkName}</p>;
  return <p className="mt-2 font-semibold text-neutral-500">Not registered on {data.networkName} yet</p>;
}
