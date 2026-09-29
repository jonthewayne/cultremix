import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { cn } from "~/lib/utils";

// CultRemix frame for the sign-in pages: wordmark top left, big type, lots of white.
export function PublicFrame({
  children,
  className,
  maxWidth = "max-w-lg",
}: {
  children: ReactNode;
  className?: string;
  maxWidth?: "max-w-sm" | "max-w-md" | "max-w-lg";
}) {
  return (
    <main className="min-h-svh bg-white px-4 py-4 text-black md:px-10 md:py-6">
      <Link to="/" className="text-base font-black uppercase tracking-[0.2em] md:text-lg">
        CultRemix
      </Link>
      <div className={cn("mt-16 flex w-full flex-col gap-6 md:mt-24", maxWidth, className)}>{children}</div>
    </main>
  );
}
