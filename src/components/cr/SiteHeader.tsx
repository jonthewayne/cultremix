import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { api } from "../../../convex/_generated/api";
import { DeploymentPill } from "~/components/cr/DeploymentLabel";
import { NotificationBell } from "~/components/social/NotificationBell";
import { authClient } from "~/lib/auth-client";

export function SiteHeader() {
  const viewer = useQuery(convexQuery(api.identity.viewer, {})).data;
  const [open, setOpen] = useState(false);
  const menu = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!menu.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      toggle.current?.focus();
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  const signOut = async () => {
    await authClient.signOut({ fetchOptions: { onSuccess: () => location.assign("/") } });
  };

  return (
    <header className="flex items-center justify-between gap-4 px-4 py-4 md:px-10 md:py-6">
      <div className="flex min-w-0 flex-col items-start gap-1 sm:flex-row sm:items-center sm:gap-3">
        <Link to="/" className="text-base font-black uppercase tracking-[0.2em] md:text-lg">
          CultRemix
        </Link>
        <DeploymentPill />
      </div>
      <nav className="flex items-center gap-3 text-sm font-semibold md:gap-7">
        <Link
          to="/"
          activeOptions={{ exact: true }}
          // Signed in, a phone can't fit Feed beside the bell and the account button; the
          // wordmark already goes to the feed.
          className={viewer ? "hidden h-10 items-center sm:inline-flex" : "inline-flex h-10 items-center"}
          activeProps={{ className: "underline decoration-2 underline-offset-8" }}
        >
          Feed
        </Link>
        <Link to="/studio" className="inline-flex h-10 items-center" activeProps={{ className: "underline decoration-2 underline-offset-8" }}>
          Studio
        </Link>
        {viewer && <NotificationBell />}
        {viewer ? (
          <div ref={menu} className="relative">
            <button
              ref={toggle}
              type="button"
              onClick={() => setOpen(!open)}
              aria-expanded={open}
              aria-haspopup="true"
              className="flex h-10 items-center gap-2 rounded-full border-2 border-black px-3 tabular-nums"
            >
              <span className="max-w-28 truncate">{viewer.username ? `@${viewer.username}` : "You"}</span>
              <span className="hidden text-neutral-500 sm:inline">
                {viewer.unlimited ? "Unlimited" : `${viewer.credits} credits`}
              </span>
            </button>
            {open && (
              <div className="absolute right-0 top-full z-40 mt-2 w-48 overflow-hidden rounded-2xl border-2 border-black bg-white shadow-xl">
                <p className="border-b border-neutral-200 px-4 py-3 text-xs text-neutral-500 sm:hidden">
                  {viewer.unlimited ? "Unlimited credits" : `${viewer.credits} credits left`}
                </p>
                {viewer.creatorNumber === 1 && (
                  <p className="border-b border-neutral-200 px-4 py-3 text-xs font-bold">Creator № 1</p>
                )}
                {viewer.username && (
                  <Link
                    to="/u/$username"
                    params={{ username: viewer.username }}
                    className="block px-4 py-3 hover:bg-neutral-100"
                    onClick={() => setOpen(false)}
                  >
                    Your profile
                  </Link>
                )}
                <Link to="/settings" className="block px-4 py-3 hover:bg-neutral-100" onClick={() => setOpen(false)}>
                  Settings
                </Link>
                <button type="button" onClick={() => void signOut()} className="block w-full px-4 py-3 text-left hover:bg-neutral-100">
                  Sign out
                </button>
              </div>
            )}
          </div>
        ) : (
          <Link to="/login" search={{ redirect: "/studio" }} className="inline-flex h-10 items-center rounded-full bg-black px-4 text-white">
            Sign in
          </Link>
        )}
      </nav>
    </header>
  );
}
