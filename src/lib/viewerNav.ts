// Paging through designs in the large viewer. Pure functions only, so the rules for what's next,
// what to load ahead, and where to land after a design leaves the list are tested on their own.

export type Scope = "favorites" | "batch" | "session";

export const SCOPES: ReadonlyArray<Scope> = ["favorites", "batch", "session"];

export const SCOPE_LABELS: Record<Scope, string> = {
  favorites: "Favorites",
  batch: "This batch",
  session: "Whole session",
};

export type NavDesign = { id: string; batchId: string; favorite: boolean; rejected: boolean };

export function parseScope(value: unknown): Scope | undefined {
  return value === "favorites" || value === "batch" || value === "session" ? value : undefined;
}

// The finished designs of a session's batches, in page order (batches as listed, tiles by index).
export function sessionDesigns(
  batches: ReadonlyArray<{
    batchId: string;
    tiles: ReadonlyArray<{ generationId: string; status: string; url?: string; favorite: boolean; rejected?: boolean }>;
  }>,
): Array<NavDesign> {
  const designs: Array<NavDesign> = [];
  for (const batch of batches) {
    for (const tile of batch.tiles) {
      if (tile.status !== "succeeded" || !tile.url) continue;
      designs.push({ id: tile.generationId, batchId: batch.batchId, favorite: tile.favorite, rejected: tile.rejected === true });
    }
  }
  return designs;
}

// The ordered ids the viewer pages through. Favorites never include dismissed designs; a batch or
// the whole session hides them unless the member chose to show them.
export function scopeIds(
  scope: Scope,
  sources: { favorites: ReadonlyArray<NavDesign>; batch: ReadonlyArray<NavDesign>; session: ReadonlyArray<NavDesign> },
  showRejected: boolean,
): Array<string> {
  const list =
    scope === "favorites"
      ? sources.favorites.filter((design) => design.favorite && !design.rejected)
      : sources[scope].filter((design) => showRejected || !design.rejected);
  const seen = new Set<string>();
  const ids: Array<string> = [];
  for (const design of list) {
    if (seen.has(design.id)) continue;
    seen.add(design.id);
    ids.push(design.id);
  }
  return ids;
}

// The next design, or null at the end. No wrapping: the last design stays last.
export function nextId(ids: ReadonlyArray<string>, current: string): string | null {
  const index = ids.indexOf(current);
  return index >= 0 && index < ids.length - 1 ? ids[index + 1] : null;
}

export function previousId(ids: ReadonlyArray<string>, current: string): string | null {
  const index = ids.indexOf(current);
  return index > 0 ? ids[index - 1] : null;
}

// "4 / 12": 1-based place and total. index is 0 when the design isn't in the list.
export function position(ids: ReadonlyArray<string>, current: string): { index: number; total: number } {
  return { index: ids.indexOf(current) + 1, total: ids.length };
}

// The designs to load ahead, nearest first: one ahead, one behind, two ahead, two behind.
export function preloadIds(ids: ReadonlyArray<string>, current: string, radius = 2): Array<string> {
  const index = ids.indexOf(current);
  if (index < 0) return [];
  const out: Array<string> = [];
  for (let step = 1; step <= radius; step++) {
    if (index + step < ids.length) out.push(ids[index + step]);
    if (index - step >= 0) out.push(ids[index - step]);
  }
  return out;
}

// Where to go when the current design leaves the list: forward, else back, else close (null).
export function afterLeaving(ids: ReadonlyArray<string>, current: string): string | null {
  return nextId(ids, current) ?? previousId(ids, current);
}

// Whether a change takes the current design out of the scope being paged through.
export function leavesScope(scope: Scope, change: "unfavorite" | "reject", showRejected: boolean): boolean {
  if (scope === "favorites") return true;
  return change === "reject" && !showRejected;
}

// Switching scope keeps the current design when the new scope has it, else starts at the first.
export function switchTarget(ids: ReadonlyArray<string>, current: string): string | null {
  return ids.includes(current) ? current : (ids[0] ?? null);
}

export type ViewerAction = "next" | "previous" | "close" | "favorite" | "reject" | "branch" | "publish" | "transparency";

const KEYS: Record<string, ViewerAction> = {
  arrowright: "next",
  arrowleft: "previous",
  escape: "close",
  f: "favorite",
  x: "reject",
  b: "branch",
  p: "publish",
  t: "transparency",
};

type KeyTarget = { tagName?: string; isContentEditable?: boolean } | null;

// The viewer action for a key press, or null. Nothing fires while typing or with a modifier held,
// so browser shortcuts like Cmd+P still work.
export function viewerShortcut(event: {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  target?: KeyTarget | EventTarget;
}): ViewerAction | null {
  if (event.metaKey || event.ctrlKey || event.altKey) return null;
  const target = (event.target ?? null) as KeyTarget;
  if (target) {
    const tag = (target.tagName ?? "").toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select" || target.isContentEditable) return null;
  }
  return KEYS[event.key.toLowerCase()] ?? null;
}
