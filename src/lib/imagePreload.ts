// Loading pictures before they're needed, so paging lands on a design that's already drawn. Each
// picture is fetched and decoded once; the most recent ones are held so the browser keeps them.

const KEEP = 40;
const held = new Map<string, HTMLImageElement>();
const ready = new Set<string>();

export function isPreloaded(url: string | undefined): boolean {
  return Boolean(url && ready.has(url));
}

export function preloadImage(url: string | undefined): void {
  if (typeof window === "undefined" || !url || url.startsWith("fake:")) return;
  const existing = held.get(url);
  if (existing) {
    // Most recently wanted goes last, so it's the last to be let go.
    held.delete(url);
    held.set(url, existing);
    return;
  }
  const image = new Image();
  image.decoding = "async";
  image.src = url;
  held.set(url, image);
  const done = () => {
    if (held.get(url) === image) ready.add(url);
  };
  if (typeof image.decode === "function") image.decode().then(done, () => held.delete(url));
  else image.onload = done;
  while (held.size > KEEP) {
    const oldest = held.keys().next().value as string;
    held.delete(oldest);
    ready.delete(oldest);
  }
}
