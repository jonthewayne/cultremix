import { useEffect, useState } from "react";
import { toLab } from "../../convex/lib/garments";

type Rgb = [number, number, number];

// The design's visible pixels, and those of them at its edge (beside transparency, where the
// shirt meets the design), for the publish dialog's contrast check (convex/lib/garments.ts
// visibilityOn).
export type DesignPixels = { all: Array<Rgb>; edge: Array<Rgb> };

const SIZE = 64;

function rgbOf(hex: string): Rgb | null {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/iu.exec(hex);
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : null;
}

// Reads a size × size RGBA copy whose drawn area is drawnWidth × drawnHeight. Transparent pixels
// are the shirt showing through. A design without transparency (nearly every drawn pixel solid)
// has its background painted in, so the pixels that match backgroundHex are dropped instead and
// the design's edge is where they were.
export function readDesignPixels(
  data: ArrayLike<number>,
  size: number,
  drawnWidth: number,
  drawnHeight: number,
  backgroundHex: string,
): DesignPixels {
  const visible = new Uint8Array(size * size);
  let covered = 0;
  for (let i = 0; i < size * size; i++) {
    if (data[i * 4 + 3] >= 128) {
      visible[i] = 1;
      covered += 1;
    }
  }
  const bg = rgbOf(backgroundHex);
  if (bg && covered >= drawnWidth * drawnHeight * 0.98) {
    const bgLab = toLab(bg);
    for (let i = 0; i < size * size; i++) {
      if (!visible[i]) continue;
      const lab = toLab([data[i * 4], data[i * 4 + 1], data[i * 4 + 2]]);
      if (Math.hypot(lab[0] - bgLab[0], lab[1] - bgLab[1], lab[2] - bgLab[2]) < 10) visible[i] = 0;
    }
  }
  const open = (x: number, y: number) => x < 0 || y < 0 || x >= size || y >= size || !visible[y * size + x];
  const all: Array<Rgb> = [];
  const edge: Array<Rgb> = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      if (!visible[i]) continue;
      const pixel: Rgb = [data[i * 4], data[i * 4 + 1], data[i * 4 + 2]];
      all.push(pixel);
      if (open(x - 1, y) || open(x + 1, y) || open(x, y - 1) || open(x, y + 1)) edge.push(pixel);
    }
  }
  return { all, edge };
}

// The design's pixels from a small copy. Null while loading, or when the image can't be read (dev
// placeholders, a blocked request): the check is advisory, so it just stays quiet.
export function useDesignPixels(url: string | undefined, backgroundHex: string): DesignPixels | null {
  const [pixels, setPixels] = useState<DesignPixels | null>(null);
  useEffect(() => {
    setPixels(null);
    if (!url || url.startsWith("fake:")) return;
    let live = true;
    void (async () => {
      try {
        // A fresh CORS request: an earlier plain <img> load may be cached without CORS headers.
        const response = await fetch(url, { mode: "cors", cache: "no-store" });
        if (!response.ok) return;
        const bitmap = await createImageBitmap(await response.blob());
        const canvas = document.createElement("canvas");
        canvas.width = SIZE;
        canvas.height = SIZE;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) return;
        // Averaged shrinking: the default keeps a thin outline or border at full strength in some
        // pixels and drops it in others, which moved the check across its thresholds (October 12).
        context.imageSmoothingQuality = "high";
        const scale = Math.min(SIZE / bitmap.width, SIZE / bitmap.height);
        const w = Math.max(1, Math.round(bitmap.width * scale));
        const h = Math.max(1, Math.round(bitmap.height * scale));
        context.drawImage(bitmap, (SIZE - w) / 2, (SIZE - h) / 2, w, h);
        bitmap.close();
        const result = readDesignPixels(context.getImageData(0, 0, SIZE, SIZE).data, SIZE, w, h, backgroundHex);
        if (live) setPixels(result);
      } catch {
        // Unreadable here; no warnings.
      }
    })();
    return () => {
      live = false;
    };
  }, [url, backgroundHex]);
  return pixels;
}
