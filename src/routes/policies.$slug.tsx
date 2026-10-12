import { Link, createFileRoute, notFound } from "@tanstack/react-router";
import { SiteFooter } from "~/components/cr/SiteFooter";
import { SiteHeader } from "~/components/cr/SiteHeader";
import { CONTACT_EMAIL, POLICIES, POLICIES_DRAFT, POLICIES_UPDATED, policyBySlug } from "~/lib/policies";
import { pageMeta } from "~/lib/share";

// /policies/shipping, /returns, /privacy, /terms (src/lib/policies.ts).
export const Route = createFileRoute("/policies/$slug")({
  loader: ({ params }) => {
    const policy = policyBySlug(params.slug);
    if (!policy) throw notFound();
    return policy;
  },
  head: ({ loaderData }) => ({
    meta: loaderData ? pageMeta(loaderData.title, `/policies/${loaderData.slug}`, loaderData.summary) : [{ title: "CultRemix" }],
  }),
  component: PolicyPage,
});

function PolicyPage() {
  const policy = Route.useLoaderData();
  return (
    <div className="min-h-svh bg-white text-black">
      <SiteHeader />
      <main className="max-w-3xl px-4 pb-16 md:px-10">
        <nav className="flex flex-wrap gap-x-4 gap-y-1 pt-6 text-sm font-semibold">
          {POLICIES.map((other) => (
            <Link
              key={other.slug}
              to="/policies/$slug"
              params={{ slug: other.slug }}
              className={other.slug === policy.slug ? "underline underline-offset-4" : "text-neutral-500 hover:text-black"}
            >
              {other.title}
            </Link>
          ))}
        </nav>
        <h1 className="pt-6 text-5xl font-black tracking-tight md:text-7xl">{policy.title}</h1>
        <p className="mt-4 text-xl leading-snug">{policy.summary}</p>
        {POLICIES_DRAFT && (
          <p className="mt-4 rounded-xl bg-amber-100 px-4 py-2 text-sm font-semibold text-amber-900">Draft, under review.</p>
        )}
        {policy.sections.map((section) => (
          <section key={section.heading} className="mt-10">
            <h2 className="border-t-2 border-black pt-4 text-sm font-bold uppercase tracking-wider">{section.heading}</h2>
            {section.body.map((paragraph) => (
              <p key={paragraph} className="mt-3 text-lg leading-snug">
                {paragraph}
              </p>
            ))}
          </section>
        ))}
        <p className="mt-10 text-sm text-neutral-600">
          Questions? Write to{" "}
          <a href={`mailto:${CONTACT_EMAIL}`} className="font-bold text-black underline underline-offset-4">
            {CONTACT_EMAIL}
          </a>
          . Updated {POLICIES_UPDATED}.
        </p>
      </main>
      <SiteFooter />
    </div>
  );
}

