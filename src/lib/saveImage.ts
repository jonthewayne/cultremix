// Saving a design: the share sheet on phones (its "Save Image" puts it in Photos), a download
// elsewhere. The share sheet only opens during the tap itself, so callers prefetch the file
// (prefetchImage) when a menu or the viewer opens and the tap can share it right away.

const loading = new Map<string, Promise<Blob | null>>();
const ready = new Map<string, Blob>();

export function prefetchImage(url: string | undefined) {
  if (!url || url.startsWith("fake:") || loading.has(url)) return;
  const promise = fetch(url)
    .then((response) => (response.ok ? response.blob() : null))
    .then((blob) => {
      if (blob) ready.set(url, blob);
      return blob;
    })
    .catch(() => null);
  loading.set(url, promise);
}

// Images served by Convex (/img/) come back as a download with ?download=<name>.
export function downloadUrl(url: string, filename: string) {
  if (!url.includes("/img/")) return url;
  return `${url}${url.includes("?") ? "&" : "?"}download=${encodeURIComponent(filename)}`;
}

export function isTouchDevice() {
  return typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
}

function deliver(blob: Blob | null, url: string, filename: string) {
  const file = blob ? new File([blob], filename, { type: blob.type || "image/png" }) : null;
  if (file && isTouchDevice() && typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })) {
    navigator.share({ files: [file] }).catch((error: unknown) => {
      if ((error as { name?: string })?.name !== "AbortError") window.location.assign(downloadUrl(url, filename));
    });
    return;
  }
  if (blob) {
    const href = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = href;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(href), 10_000);
    return;
  }
  window.location.assign(downloadUrl(url, filename));
}

export function saveImage(url: string | undefined, filename: string) {
  if (!url || url.startsWith("fake:")) return;
  const blob = ready.get(url);
  if (blob) {
    deliver(blob, url, filename);
    return;
  }
  prefetchImage(url);
  void loading.get(url)!.then((late) => deliver(late, url, filename));
}

export function designFilename(args: { publishedCr?: string; generationId: string }) {
  return args.publishedCr ? `CultRemix-CR-${args.publishedCr}.png` : `CultRemix-${args.generationId.slice(-8)}.png`;
}
