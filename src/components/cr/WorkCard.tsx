import { Link } from "@tanstack/react-router";
import { Art } from "./Art";
import { CrMark } from "./CrMark";
import { cn } from "~/lib/utils";

export type WorkCardData = {
  cr: string;
  title?: string;
  username: string;
  kind: "original" | "variation" | "fork";
  backgroundColor: string;
  artUrl?: string;
};

// A published work in a grid: its art, CR number, and creator.
export function WorkCard({ work, current = false, small = false }: { work: WorkCardData; current?: boolean; small?: boolean }) {
  return (
    <Link to="/cr/$cr" params={{ cr: work.cr }} className="group block" aria-current={current ? "page" : undefined}>
      <div
        className={cn(
          "flex aspect-square items-center justify-center overflow-hidden rounded-2xl p-[8%]",
          current && "ring-4 ring-black ring-offset-2",
        )}
        style={{ background: work.backgroundColor }}
      >
        <Art
          url={work.artUrl}
          alt={work.title ?? `CR ${work.cr}`}
          className="h-full w-auto max-w-full object-contain transition-transform duration-500 group-hover:scale-[1.04]"
        />
      </div>
      <CrMark cr={work.cr} className={cn("mt-2", small ? "text-base md:text-lg" : "text-2xl md:text-3xl")} />
      {!small && (
        <p className="text-sm">
          @{work.username}
          {work.kind === "fork" && <span className="text-neutral-500"> · new family</span>}
        </p>
      )}
    </Link>
  );
}
