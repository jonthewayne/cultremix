import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { api } from "../../convex/_generated/api";
import { SiteFooter } from "~/components/cr/SiteFooter";
import { SiteHeader } from "~/components/cr/SiteHeader";
import { pageMeta } from "~/lib/share";

// /how-it-works: what CultRemix is, step by step, for a first visit (judges included). The home
// page links it beside Open the studio, and the footer on every public page.
export const Route = createFileRoute("/how-it-works")({
  // Whether the registry is live, for step 5, rendered with the page.
  loader: async ({ context }) => {
    if (context.convexQueryClient.serverHttpClient) {
      await context.queryClient.fetchQuery(convexQuery(api.provenance.registry, {})).catch(() => null);
    }
  },
  head: () => ({
    meta: pageMeta(
      "How it works",
      "/how-it-works",
      "Make a design, publish it with a permanent CR number, let anyone remix it, and share in every sale. Each design's lineage is recorded on Monad.",
    ),
  }),
  component: HowItWorksPage,
});

const linkClass = "font-bold underline underline-offset-4";

function HowItWorksPage() {
  const registry = useQuery(convexQuery(api.provenance.registry, {})).data;
  return (
    <div className="min-h-svh bg-white text-black">
      <SiteHeader />
      <main className="max-w-3xl px-4 pb-24 md:px-10">
        <h1 className="pt-8 text-5xl font-black tracking-tight md:text-7xl">How it works</h1>
        <p className="mt-4 text-xl leading-snug">
          CultRemix is a studio and shop for remixable shirt art. Every design gets a permanent number, every remix
          stays in its design’s family, and when a shirt sells, the people behind it share in the sale.
        </p>

        <Step number={1} title="Make it">
          <p>
            In the{" "}
            <Link to="/studio" className={linkClass}>
              studio
            </Link>
            , add a few images, mix their styles, and say what you want. One press makes four designs, ready to print.
          </p>
        </Step>

        <Step number={2} title="Publish it">
          <p>
            Your favorite gets a CR number, like CR 101-001, which is its name for good. It gets a shop page and a photo
            of someone wearing it, and its fingerprint, the SHA-256 of its file, is fixed from then on.
          </p>
        </Step>

        <Step number={3} title="Remix it">
          <p>
            On any design, Remix this lets you change what its creator opened to remixing: its words, and on some designs
            a character to swap or people to put yourself in place of. A remix joins the design’s family as the next
            number, CR 101-002, or starts a new family that credits the design it came from. Once a design has remixes,
            its page shows the family as a tree.
          </p>
        </Step>

        <Step number={4} title="Share in the sale">
          <p>
            Designs go on shirts, printed to order. 15% of every sale goes to the people behind the design: an
            original’s creator gets all of it, and a remix splits it with the designs it came from. That’s 15% of the
            price before tax and shipping. Share a design and your link pays you 5% of what it sells, and a brand
            that owns a family gets its own cut, both on top of the creators’ 15%. The split is{" "}
            <a href="/economics/v2.json" className={linkClass}>
              a public file
            </a>{" "}
            anyone can check. While buying isn’t open yet, a design’s page takes your email instead.
          </p>
        </Step>

        <Step number={5} title="Recorded on Monad">
          <p>
            Each design is recorded on Monad: its fingerprint, the design it came from, and its creator’s wallet, along
            with the rules every sale follows. Anyone can check where a design came from without taking our word for it.
            Nobody needs a wallet app or MON: CultRemix keeps a wallet for each member and pays the gas.{" "}
            <Link to="/onchain" className={linkClass}>
              What’s on Monad
            </Link>
          </p>
          {registry && !registry.address && (
            <p className="mt-3 text-neutral-600">
              The registry isn’t live on {registry.networkName} yet. Until it is, new designs wait in line and are recorded
              once it goes up.
            </p>
          )}
        </Step>

        <section id="try-it" className="mt-12 scroll-mt-6 text-lg leading-snug">
          <h2 className="mb-4 border-t-2 border-black pt-4 text-sm font-bold uppercase tracking-wider">Try it</h2>
          <p>
            Open any design in the{" "}
            <Link to="/" className={linkClass}>
              feed
            </Link>
            : its CR number, fingerprint, family, and who shares in a sale are all on its page. To make and remix designs,{" "}
            <Link to="/login" className={linkClass}>
              sign in
            </Link>
            .
          </p>
          <p className="mt-3">
            Judging the Monad hackathon? Sign in with the email and password we sent you: on the sign-in page, tap Have a
            password? Sign in with it. You start with 40 credits, and each batch of four designs takes 2.
          </p>
        </section>

        <Link to="/" className={`mt-12 inline-block ${linkClass}`}>
          Back to the feed
        </Link>
      </main>
      <SiteFooter />
    </div>
  );
}

function Step({ number, title, children }: { number: number; title: string; children: React.ReactNode }) {
  return (
    <section className="mt-12 text-lg leading-snug">
      <h2 className="mb-4 flex items-baseline gap-3 border-t-2 border-black pt-4">
        <span className="font-cr text-3xl tabular-nums">{number}</span>
        <span className="text-2xl font-black tracking-tight">{title}</span>
      </h2>
      {children}
    </section>
  );
}
