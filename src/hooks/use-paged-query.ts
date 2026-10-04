import { convexQuery } from "@convex-dev/react-query";
import type { ConvexQueryClient } from "@convex-dev/react-query";
import { useQueries } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import type {
  FunctionArgs,
  FunctionReference,
  FunctionReturnType,
  PaginationOptions,
  PaginationResult,
} from "convex/server";
import { useCallback, useEffect, useRef, useState } from "react";

// One pattern for every public list: each page is its own live query, so a heart or a new design
// shows up without a refetch. Load more pins the last page at the cursor the next page starts
// from (endCursor), which keeps pages joined edge to edge while the data underneath changes.

type PagedQuery = FunctionReference<
  "query",
  "public",
  { paginationOpts: PaginationOptions },
  PaginationResult<unknown>
>;
type ExtraArgs<Query extends PagedQuery> = Omit<FunctionArgs<Query>, "paginationOpts">;
type Item<Query extends PagedQuery> = FunctionReturnType<Query>["page"][number];
type PageSpec = { cursor: string | null; endCursor?: string };

export type PagedStatus = "LoadingFirstPage" | "CanLoadMore" | "LoadingMore" | "Exhausted";

function pageOptions<Query extends PagedQuery>(
  query: Query,
  args: ExtraArgs<Query>,
  pageSize: number,
  spec: PageSpec,
) {
  // convexToJson rejects undefined, so endCursor is only present when set.
  const paginationOpts: PaginationOptions =
    spec.endCursor === undefined
      ? { numItems: pageSize, cursor: spec.cursor }
      : { numItems: pageSize, cursor: spec.cursor, endCursor: spec.endCursor };
  // Typed as the general paged query; callers read pages back as FunctionReturnType<Query>.
  return convexQuery(query as PagedQuery, { ...args, paginationOpts });
}

// Server only: fetches the first page during SSR so it arrives with the HTML. In the browser the
// page subscribes as soon as it renders, so a navigation never waits on this.
export async function prefetchFirstPage<Query extends PagedQuery>(
  context: { queryClient: QueryClient; convexQueryClient: ConvexQueryClient },
  query: Query,
  args: ExtraArgs<Query>,
  pageSize: number,
) {
  if (!context.convexQueryClient.serverHttpClient) return;
  try {
    await context.queryClient.fetchQuery(pageOptions(query, args, pageSize, { cursor: null }));
  } catch {
    // The browser will load it.
  }
}

export function usePagedQuery<Query extends PagedQuery>(
  query: Query,
  args: ExtraArgs<Query> | "skip",
  pageSize: number,
) {
  const argsKey = args === "skip" ? "skip" : JSON.stringify(args);
  const [state, setState] = useState<{ key: string; pages: Array<PageSpec> }>({
    key: argsKey,
    pages: [{ cursor: null }],
  });
  const pages = state.key === argsKey ? state.pages : [{ cursor: null }];
  if (state.key !== argsKey) setState({ key: argsKey, pages });

  const results = useQueries({
    queries:
      args === "skip"
        ? []
        : pages.map((spec) => pageOptions(query, args, pageSize, spec)),
  });

  // A pinned page gets a new query key; its last data stands in until the new one arrives.
  const lastData = useRef<{ key: string; pages: Array<FunctionReturnType<Query> | undefined> }>({
    key: argsKey,
    pages: [],
  });
  if (lastData.current.key !== argsKey) lastData.current = { key: argsKey, pages: [] };
  const data = results.map((result, index) => {
    const value = result.data as FunctionReturnType<Query> | undefined;
    if (value !== undefined) lastData.current.pages[index] = value;
    return value ?? lastData.current.pages[index];
  });

  // A cursor can go stale (after a deploy, say). Start over from the top.
  const failed = results.some((result) => result.isError);
  useEffect(() => {
    if (failed) setState({ key: argsKey, pages: [{ cursor: null }] });
  }, [failed, argsKey]);

  const last = data[data.length - 1];
  const status: PagedStatus =
    args === "skip" || data[0] === undefined
      ? "LoadingFirstPage"
      : last === undefined
        ? "LoadingMore"
        : last.isDone
          ? "Exhausted"
          : "CanLoadMore";

  const items = data.flatMap((page) => (page?.page ?? []) as Array<Item<Query>>);

  const loadMore = useCallback(() => {
    if (status !== "CanLoadMore" || !last) return;
    const next = last.continueCursor;
    setState((current) => {
      if (current.key !== argsKey) return current;
      const tail = current.pages[current.pages.length - 1];
      if (tail.endCursor !== undefined) return current;
      return {
        key: argsKey,
        pages: [...current.pages.slice(0, -1), { ...tail, endCursor: next }, { cursor: next }],
      };
    });
  }, [status, last, argsKey]);

  return { items, status, loadMore };
}
