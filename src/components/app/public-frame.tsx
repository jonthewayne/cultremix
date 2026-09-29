import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { BrandMark } from "~/components/app/brand-mark";
import { ThemeToggle } from "~/components/ui/theme-toggle";
import { cn } from "~/lib/utils";

export function PublicFrame({
  children,
  className,
  maxWidth = "max-w-sm",
}: {
  children: ReactNode;
  className?: string;
  maxWidth?: "max-w-sm" | "max-w-md" | "max-w-lg";
}) {
  return (
    <main className="relative flex min-h-svh flex-col items-center justify-center gap-6 bg-muted p-6 text-foreground md:p-10">
      <div className="absolute right-4 top-4 md:right-6 md:top-6">
        <ThemeToggle />
      </div>
      <div className={cn("flex w-full flex-col gap-6", maxWidth, className)}>
        <Link to="/login" className="self-center">
          <BrandMark />
        </Link>
        {children}
      </div>
    </main>
  );
}
