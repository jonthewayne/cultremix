import { Link } from "@tanstack/react-router";
import { Check, GitBranch, Heart, Hourglass } from "lucide-react";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Art } from "./Art";
import { CrMark } from "./CrMark";
import type {FamilyTreeData, TreeNode, TreeWork} from "~/lib/familyTree";
import {
  COMPACT_TREE,
  FULL_TREE,
  
  
  
  buildFamilyTree,
  layoutTree
} from "~/lib/familyTree";
import { cn } from "~/lib/utils";

const SIZES = {
  compact: { nodeWidth: 88, nodeHeight: 146, gapX: 12, gapY: 32 },
  full: { nodeWidth: 116, nodeHeight: 176, gapX: 20, gapY: 44 },
};

// A family drawn as a tree: the original at the top, each variation under its parent, forks
// (dashed) leading off to their own families, and where the family itself came from. Wide or
// deep branches fold into "+N" nodes that open in place. It scrolls sideways on a phone, and
// starts scrolled to the current work.
export function FamilyTree({ data, currentCr, compact = false }: { data: FamilyTreeData; currentCr?: string; compact?: boolean }) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const size = compact ? SIZES.compact : SIZES.full;
  const layout = useMemo(
    () => layoutTree(buildFamilyTree(data, { ...(compact ? COMPACT_TREE : FULL_TREE), expanded, currentCr }), size),
    [data, compact, expanded, currentCr, size],
  );
  const scroller = useRef<HTMLDivElement>(null);
  const focus = layout.nodes.find((placed) => placed.node.type !== "more" && placed.node.current) ?? layout.nodes.at(0);
  const focusX = useRef(0);
  focusX.current = focus ? focus.x + size.nodeWidth / 2 : 0;
  // Only when the family or the current work changes, not on every expand.
  useLayoutEffect(() => {
    const element = scroller.current;
    if (element) element.scrollLeft = Math.max(0, focusX.current - element.clientWidth / 2);
  }, [data.family, currentCr]);

  return (
    <div ref={scroller} className="-mx-4 overflow-x-auto overscroll-x-contain px-4 py-2 md:-mx-10 md:px-10">
      <div className="relative mx-auto" style={{ width: layout.width, height: layout.height }}>
        <svg aria-hidden className="absolute inset-0 overflow-visible" width={layout.width} height={layout.height}>
          {/* Elbow links: down from the parent, across between the rows, down to the child. Forks
              (dashed) go first so a shared run reads as solid. */}
          {[...layout.edges].sort((a, b) => Number(b.dashed) - Number(a.dashed)).map((edge) => {
            const mid = edge.to.y - size.gapY / 2;
            return (
              <path
                key={edge.key}
                d={`M ${edge.from.x} ${edge.from.y + 4} V ${mid} H ${edge.to.x} V ${edge.to.y}`}
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeDasharray={edge.dashed ? "6 5" : undefined}
                className={edge.dashed ? "text-neutral-400" : "text-black"}
              />
            );
          })}
        </svg>
        <ol aria-label={`Family ${data.family}`}>
          {layout.nodes.map(({ node, x, y }) => (
            <li key={node.key} className="absolute" style={{ left: x, top: y, width: size.nodeWidth, height: size.nodeHeight }}>
              <TreeNodeView
                node={node}
                compact={compact}
                onExpand={(cr) => setExpanded((open) => new Set([...open, cr]))}
              />
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

function TreeNodeView({ node, compact, onExpand }: { node: TreeNode; compact: boolean; onExpand: (cr: string) => void }) {
  if (node.type === "more") {
    return (
      <button
        type="button"
        onClick={() => onExpand(node.parentCr)}
        aria-label={`Show ${node.siblings} more (${node.designs} ${node.designs === 1 ? "design" : "designs"})`}
        className="flex aspect-square w-full flex-col items-center justify-center rounded-2xl border-2 border-dashed border-neutral-400 text-neutral-600 transition-colors hover:border-black hover:text-black"
      >
        <span className={cn("font-cr leading-none", compact ? "text-2xl" : "text-3xl")}>+{node.siblings}</span>
        <span className="mt-1 text-[11px] font-bold leading-tight">
          {node.designs} {node.designs === 1 ? "design" : "designs"}
        </span>
      </button>
    );
  }
  const { work } = node;
  if (work.withdrawn) {
    return (
      <div className="text-neutral-500" aria-label={`CR ${work.cr}, withdrawn`}>
        <div className="flex aspect-square w-full items-center justify-center rounded-2xl border-2 border-dashed border-neutral-300 text-[11px] font-bold">
          Withdrawn
        </div>
        <CrMark cr={work.cr} noTag className="mt-1.5 flex-nowrap text-sm" />
      </div>
    );
  }
  const body = (
    <>
      <Thumb work={work} current={node.current} faded={node.type !== "work"} />
      <CrMark cr={work.cr} noTag className={cn("mt-1.5 flex-nowrap", compact ? "text-[13px]" : "text-base")} />
      {node.type === "work" ? (
        <>
          <p className="truncate text-xs">@{work.username}</p>
          <Spread work={work} />
        </>
      ) : (
        <p className="text-[11px] font-bold leading-tight text-neutral-500">
          {node.type === "fork" ? `New family ${work.family} →` : `From family ${work.family}`}
        </p>
      )}
    </>
  );
  const link =
    node.type === "work" ? (
      <Link to="/cr/$cr" params={{ cr: work.cr }} className="group block" aria-current={node.current ? "page" : undefined}>
        {body}
      </Link>
    ) : (
      <Link
        to="/family/$family"
        params={{ family: String(work.family) }}
        search={{ cr: work.cr }}
        className="group block"
        aria-label={node.type === "fork" ? `CR ${work.cr} started family ${work.family}` : `Forked from CR ${work.cr}, family ${work.family}`}
      >
        {body}
      </Link>
    );
  if (!work.chain) return link;
  return (
    <div className="relative">
      {link}
      <ChainMark work={work} compact={compact} />
    </div>
  );
}

// On the thumbnail's corner: a solid check once the work is registered on Monad, a quiet dashed
// hourglass while it's on its way. On the full page it links to the transaction.
function ChainMark({ work, compact }: { work: TreeWork; compact: boolean }) {
  const recorded = work.chain === "recorded";
  const label = recorded ? `CR ${work.cr} is recorded on Monad` : `CR ${work.cr} is waiting to be recorded on Monad`;
  const className = cn(
    "absolute right-1.5 top-1.5 grid place-items-center rounded-full",
    compact ? "size-5" : "size-6",
    recorded ? "bg-black text-white ring-2 ring-white" : "border-2 border-dashed border-neutral-400 bg-white/90 text-neutral-500",
  );
  const icon = recorded ? (
    <Check aria-hidden strokeWidth={3} className={compact ? "size-3" : "size-3.5"} />
  ) : (
    <Hourglass aria-hidden className={compact ? "size-2.5" : "size-3"} />
  );
  if (!compact && work.chainTxUrl) {
    return (
      <a href={work.chainTxUrl} target="_blank" rel="noreferrer" title={`${label}. View the transaction.`} className={cn(className, "hover:scale-110")}>
        {icon}
        <span className="sr-only">{label}. View the transaction.</span>
      </a>
    );
  }
  return (
    <span title={label} className={className}>
      {icon}
      <span className="sr-only">{label}</span>
    </span>
  );
}

function Thumb({ work, current, faded }: { work: TreeWork; current: boolean; faded: boolean }) {
  return (
    <div
      className={cn(
        "flex aspect-square w-full items-center justify-center overflow-hidden rounded-2xl p-[8%]",
        current && "ring-4 ring-black ring-offset-2",
        faded && "opacity-80 transition-opacity group-hover:opacity-100",
      )}
      style={{ background: work.backgroundColor }}
    >
      <Art
        url={work.thumbUrl}
        alt={work.title ?? `CR ${work.cr}`}
        className="h-full w-auto max-w-full object-contain transition-transform duration-500 group-hover:scale-[1.04]"
      />
    </div>
  );
}

// How far it spread: published direct remixes and hearts.
function Spread({ work }: { work: TreeWork }) {
  const remixes = `${work.remixes ?? 0}${work.remixesMore ? "+" : ""}`;
  const hearts = work.hearts ?? 0;
  return (
    <p
      className="mt-0.5 flex items-center gap-2 text-[11px] font-bold tabular-nums text-neutral-500"
      title={`${remixes} ${remixes === "1" ? "remix" : "remixes"} · ${hearts} ${hearts === 1 ? "heart" : "hearts"}`}
    >
      <span className="inline-flex items-center gap-0.5">
        <GitBranch aria-hidden className="size-3" />
        <span className="sr-only">Remixes: </span>
        {remixes}
      </span>
      <span className="inline-flex items-center gap-0.5">
        <Heart aria-hidden className="size-3" />
        <span className="sr-only">Hearts: </span>
        {hearts}
      </span>
    </p>
  );
}
