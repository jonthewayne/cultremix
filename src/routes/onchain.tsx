import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { api } from "../../convex/_generated/api";
import { SiteHeader } from "~/components/cr/SiteHeader";

// /onchain: what CultRemix records on Monad, what it leaves off, and how to check a work.
export const Route = createFileRoute("/onchain")({
  loader: async ({ context }) => {
    if (context.convexQueryClient.serverHttpClient) {
      await context.queryClient.fetchQuery(convexQuery(api.provenance.registry, {})).catch(() => null);
    }
  },
  head: () => ({
    meta: [
      { title: "On Monad · CultRemix" },
      { name: "description", content: "What CultRemix records on Monad, and how to check a design yourself." },
    ],
  }),
  component: OnchainPage,
});

function OnchainPage() {
  const registry = useQuery(convexQuery(api.provenance.registry, {})).data;
  return (
    <div className="min-h-svh bg-white text-black">
      <SiteHeader />
      <main className="max-w-3xl px-4 pb-24 md:px-10">
        <h1 className="pt-8 text-5xl font-black tracking-tight md:text-7xl">On Monad</h1>
        <p className="mt-4 text-xl leading-snug">
          Every design on CultRemix gets a public record on Monad. Anyone can see where a design came from, and check it
          for themselves, without taking our word for it.
        </p>

        <Section title="What we record">
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <span className="font-bold">Each design:</span> its ID, its CR number, the design it came from, whether it’s
              an original, a variation or a fork, its fingerprint, and its creator’s wallet.
            </li>
            <li>
              <span className="font-bold">Lineage corrections:</span> when a design’s parent is fixed, the change is added
              in order. The first record stays as it was.
            </li>
            <li>
              <span className="font-bold">Backs:</span> each one, in the order it happened.
            </li>
            <li>
              <span className="font-bold">The economics rules:</span> the fingerprint of{" "}
              <a href="/economics/v1.json" className="font-bold underline underline-offset-4">
                the rules every sale follows
              </a>
              , so they can’t quietly change.
            </li>
          </ul>
        </Section>

        <Section title="What we don’t">
          <ul className="list-disc space-y-2 pl-5">
            <li>No money moves through it. Sales and payouts happen off the chain.</li>
            <li>No personal details. No names, emails, or addresses. A wallet address is the only thing tied to you.</li>
            <li>Not the art itself, just its fingerprint.</li>
          </ul>
        </Section>

        <Section title="Where it lives">
          {registry && (
            <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-[auto_1fr]">
              <dt className="font-bold">Network</dt>
              <dd>
                {registry.networkName}
                {registry.testnet && <span className="text-neutral-500"> · a test network, so these records are practice runs</span>}
              </dd>
              <dt className="font-bold">Registry</dt>
              <dd>
                {registry.address ? (
                  registry.addressUrl ? (
                    <a href={registry.addressUrl} target="_blank" rel="noreferrer" className="break-all font-mono text-sm underline underline-offset-4">
                      {registry.address}
                    </a>
                  ) : (
                    <span className="break-all font-mono text-sm">{registry.address}</span>
                  )
                ) : (
                  <span>Not deployed yet. New designs wait in line and are recorded once it is.</span>
                )}
              </dd>
              {registry.explorerUrl && (
                <>
                  <dt className="font-bold">Explorer</dt>
                  <dd className="break-all">
                    <a href={registry.explorerUrl} target="_blank" rel="noreferrer" className="underline underline-offset-4">
                      {registry.explorerUrl.replace(/^https:\/\//u, "")}
                    </a>
                  </dd>
                </>
              )}
            </dl>
          )}
        </Section>

        <Section title="Check a design yourself">
          <ol className="list-decimal space-y-3 pl-5">
            <li>
              On a design’s page, find its <span className="font-bold">Fingerprint</span>. It’s the SHA-256 of the design’s
              print file.
            </li>
            <li>Open the registry on the explorer and find its Read Contract tab.</li>
            <li>
              Call <Code>workIdAt</Code> with the two parts of the CR number. For CR 101-002, that’s 101 and 2.
            </li>
            <li>
              Call <Code>getWork</Code> with the ID you get back. Its <Code>contentHash</Code> is the fingerprint with 0x in
              front. <Code>creator</Code> is the wallet that signed it, and <Code>parentId</Code> is the design it came from.
            </li>
          </ol>
          <p className="mt-4 text-neutral-600">
            Each design’s page also shows whether it’s recorded yet, with a link to its transaction. Its family tree marks
            every design that is.
          </p>
        </Section>

        <Link to="/" className="mt-12 inline-block font-bold underline underline-offset-4">
          Back to the feed
        </Link>
      </main>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-12 text-lg leading-snug">
      <h2 className="mb-4 border-t-2 border-black pt-4 text-sm font-bold uppercase tracking-wider">{title}</h2>
      {children}
    </section>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return <code className="rounded-md bg-neutral-100 px-1.5 py-0.5 font-mono text-base">{children}</code>;
}
