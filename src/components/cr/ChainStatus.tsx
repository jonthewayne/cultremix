import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

// Where a work's onchain registration stands, under its fingerprint on the work page, and how
// anyone can check it (/onchain).
export function ChainStatus({ workId }: { workId: Id<"works"> }) {
  return (
    <>
      <RegistrationStatus workId={workId} />
      <p className="mt-2">
        <Link to="/onchain" className="underline underline-offset-4 hover:no-underline">
          What’s on Monad, and how to check it →
        </Link>
      </p>
    </>
  );
}

function RegistrationStatus({ workId }: { workId: Id<"works"> }) {
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
  if (data.status === "pending") {
    return (
      <p className="mt-2 font-semibold">
        {data.registryLive
          ? `Waiting to be registered on ${data.networkName}`
          : `Queued for ${data.networkName}: it's recorded once the registry goes live.`}
      </p>
    );
  }
  return <p className="mt-2 font-semibold text-neutral-500">Not registered on {data.networkName} yet</p>;
}
