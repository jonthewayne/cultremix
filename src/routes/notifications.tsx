import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import type { FunctionReturnType } from "convex/server";
import { useMutation } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { api } from "../../convex/_generated/api";
import { Art } from "~/components/cr/Art";
import { SiteHeader } from "~/components/cr/SiteHeader";
import { Avatar } from "~/components/social/Avatar";
import { LoadMore } from "~/components/social/LoadMore";
import { prefetchFirstPage, usePagedQuery } from "~/hooks/use-paged-query";
import { formatCents } from "~/lib/money";
import { requireAuthenticatedRoute } from "~/lib/route-guards";
import { cn } from "~/lib/utils";

const PAGE_SIZE = 20;

type Notification = FunctionReturnType<typeof api.notifications.list>["page"][number];
type WorkRef = NonNullable<Notification["work"]>;

export const Route = createFileRoute("/notifications")({
  beforeLoad: requireAuthenticatedRoute,
  loader: ({ context }) => prefetchFirstPage(context, api.notifications.list, {}, PAGE_SIZE),
  head: () => ({ meta: [{ title: "Notifications · CultRemix" }] }),
  component: NotificationsPage,
});

function NotificationsPage() {
  const status = useQuery(convexQuery(api.notifications.status, {})).data;
  const markAllRead = useMutation(api.notifications.markAllRead);
  const { items, status: pageStatus, loadMore } = usePagedQuery(api.notifications.list, {}, PAGE_SIZE);
  // When the list was last opened, kept from before this visit marks everything read, so what's
  // new stays marked while the page is open.
  const [seenUntil, setSeenUntil] = useState<number | null>(null);
  const marked = useRef(false);
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!status || marked.current) return;
    marked.current = true;
    setSeenUntil(status.lastReadAt);
    if (status.unread > 0) void markAllRead({});
  }, [status, markAllRead]);

  return (
    <div className="min-h-svh bg-white text-black">
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-4 pb-24 pt-6 md:px-10 md:pt-10">
        <h1 className="text-[13vw] font-black leading-[0.85] tracking-[-0.05em] md:text-7xl">Notifications</h1>
        {pageStatus === "LoadingFirstPage" ? (
          <p className="mt-8 text-neutral-500">Loading…</p>
        ) : items.length === 0 ? (
          <div className="mt-8">
            <p className="text-xl font-semibold text-neutral-500">Nothing yet.</p>
            <p className="mt-2 text-neutral-600">
              When someone follows you, hearts, remixes, or Backs your work, or buys a design you share in,
              you’ll hear about it here.
            </p>
          </div>
        ) : (
          <div className="mt-6">
            <ul className="divide-y-2 divide-neutral-100">
              {items.map((item) => (
                <NotificationRow
                  key={item.id}
                  item={item}
                  isNew={seenUntil !== null && item.createdAt > seenUntil}
                  now={now}
                />
              ))}
            </ul>
            <LoadMore status={pageStatus} loadMore={loadMore} className="mt-10" />
          </div>
        )}
      </main>
    </div>
  );
}

function NotificationRow({ item, isNew, now }: { item: Notification; isNew: boolean; now: number | null }) {
  const name = item.actor.username;
  const who = name ? `@${name}` : "Someone";
  // Where the row goes: your earnings for a sale, the work it's about, or the person for a follow
  // (or a work since withdrawn).
  const target = item.work;
  const isSale = item.kind === "sale";
  const body = (
    <>
      {isSale ? (
        <span
          aria-hidden
          className="inline-flex size-11 shrink-0 items-center justify-center rounded-[22%] bg-black text-2xl font-black text-white md:size-12"
        >
          $
        </span>
      ) : (
        <Avatar username={name ?? "?"} image={item.actor.image} className="size-11 md:size-12" />
      )}
      <span className="min-w-0 flex-1">
        <span className="block leading-snug">
          {isSale ? (
            <Message item={item} />
          ) : (
            <>
              <span className="font-black">{who}</span> <Message item={item} />
            </>
          )}
        </span>
        <span className="mt-0.5 flex items-center gap-2 text-sm text-neutral-500">
          {isNew && (
            <span className="rounded-full bg-black px-2 text-[11px] font-black uppercase leading-5 text-white">New</span>
          )}
          {item.sale?.test && (
            <span className="rounded-full border border-neutral-300 px-2 text-[11px] font-black uppercase leading-5 text-neutral-500">
              Test
            </span>
          )}
          {now !== null && ago(item.createdAt, now)}
        </span>
      </span>
      {target && (
        <span className="size-12 shrink-0 overflow-hidden rounded-xl bg-neutral-100 md:size-14">
          <Art url={target.thumbUrl} alt={target.title ?? `CR ${target.cr}`} className="h-full w-full object-cover" />
        </span>
      )}
    </>
  );
  const rowClass = "flex items-center gap-3 py-4 md:gap-4";

  return (
    <li>
      {isSale ? (
        <Link to="/me/earnings" className={cn(rowClass, "hover:bg-neutral-50")}>
          {body}
        </Link>
      ) : target ? (
        <Link to="/cr/$cr" params={{ cr: target.cr }} className={cn(rowClass, "hover:bg-neutral-50")}>
          {body}
        </Link>
      ) : name ? (
        <Link to="/u/$username" params={{ username: name }} className={cn(rowClass, "hover:bg-neutral-50")}>
          {body}
        </Link>
      ) : (
        <div className={rowClass}>{body}</div>
      )}
    </li>
  );
}

function Message({ item }: { item: Notification }) {
  switch (item.kind) {
    case "follow":
      return <>followed you.</>;
    case "heart":
      return item.work ? (
        <>
          hearted <Cr work={item.work} />.
        </>
      ) : (
        <>hearted your work.</>
      );
    case "remix":
      return item.work && item.parent ? (
        <>
          remixed <Cr work={item.parent} /> into <Cr work={item.work} />.
        </>
      ) : (
        <>remixed your work.</>
      );
    case "back":
      return item.work ? (
        <>
          backed <Cr work={item.work} />.
        </>
      ) : (
        <>backed your work.</>
      );
    case "sale":
      return <SaleMessage item={item} />;
  }
}

// "Someone bought Slow Roll CR 106-001. You earn $4.20." Buyers check out on Shopify, so they're
// never named. For a remix of your design, it names both.
function SaleMessage({ item }: { item: Notification }) {
  const units = item.sale?.units ?? 1;
  const bought = units > 1 ? `Someone bought ${units} of ` : "Someone bought ";
  const amount = item.sale ? <span className="font-black">{formatCents(item.sale.cents)}</span> : null;
  const earned = !item.sale ? null : item.sale.held ? (
    <> Your {amount} share is held until you get a creator number.</>
  ) : (
    <> You earn {amount}.</>
  );
  if (!item.work) {
    // A kept design is never named: "Someone bought a private remix of your Grow Slow CR 101-001."
    if (item.privateRemix && item.parent) {
      return (
        <>
          {bought}a private remix of your <Cr work={item.parent} />.{earned}
        </>
      );
    }
    return <>Someone bought a design you share in.{earned}</>;
  }
  return (
    <>
      {bought}
      <Cr work={item.work} />
      {item.parent && (
        <>
          , a remix of your <Cr work={item.parent} />
        </>
      )}
      .{earned}
    </>
  );
}

function Cr({ work }: { work: WorkRef }) {
  return (
    <>
      {work.title && <span className="font-bold">{work.title} </span>}
      <span className="whitespace-nowrap font-cr tabular-nums">CR {work.cr}</span>
    </>
  );
}

function ago(timestamp: number, now: number) {
  const minutes = Math.max(0, Math.round((now - timestamp) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} d ago`;
  return new Date(timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
