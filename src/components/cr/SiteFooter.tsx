import { Link } from "@tanstack/react-router";
import { CONTACT_EMAIL, POLICIES } from "~/lib/policies";

// The public pages' footer: the store policies, the onchain page, and how to reach us.
export function SiteFooter() {
  return (
    <footer className="border-t-2 border-black px-4 py-8 text-sm md:px-10">
      <nav className="flex flex-wrap gap-x-5 gap-y-2 font-semibold">
        <Link to="/how-it-works" className="hover:underline">
          How it works
        </Link>
        {POLICIES.map((policy) => (
          <Link key={policy.slug} to="/policies/$slug" params={{ slug: policy.slug }} className="hover:underline">
            {policy.title}
          </Link>
        ))}
        <Link to="/onchain" className="hover:underline">
          On Monad
        </Link>
        <a href={`mailto:${CONTACT_EMAIL}`} className="hover:underline">
          {CONTACT_EMAIL}
        </a>
      </nav>
      <p className="mt-3 text-neutral-500">Remix culture, get paid.</p>
    </footer>
  );
}
