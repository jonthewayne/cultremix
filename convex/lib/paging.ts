import type { PaginationOptions } from "convex/server";

// Every paginated list in the studio uses these: a page size the server caps, so no browser can
// ask for an unbounded page, and the empty last page sent to signed-out callers and strangers.

export const EMPTY_PAGE = { page: [], isDone: true, continueCursor: "" };

export function cappedPage(opts: PaginationOptions, max: number): PaginationOptions {
  const numItems = Number.isFinite(opts.numItems) ? Math.floor(opts.numItems) : max;
  return { ...opts, numItems: Math.min(Math.max(1, numItems), max) };
}
