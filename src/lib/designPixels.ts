import { useEffect, useState } from "react";
import { toLab } from "../../convex/lib/garments";

type Rgb = [number, number, number];

const SIZE = 64;

function rgbOf(hex: string): Rgb | null {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/iu.exec(hex);
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : null;
}

// The design's visible pixels from a small copy, for the publish dialog's contrast check.
// Transparent pixels are the shirt showing through; a design without transparency loses the
// pixels that match its own background instead. Null while loading, or when the image can't be
// read (dev placeholders, a blocked request): the check is advisory, so it just stays quiet.
export function useDesignPixels(url: string | undefined, backgroundHex: string): Array<Rgb> | null {
  const [pixels, setPixels] = useState<Array<Rgb> | null>(null);
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
        const scale = Math.min(SIZE / bitmap.width, SIZE / bitmap.height);
        const w = Math.max(1, Math.round(bitmap.width * scale));
        const h = Math.max(1, Math.round(bitmap.height * scale));
        context.drawImage(bitmap, (SIZE - w) / 2, (SIZE - h) / 2, w, h);
        bitmap.close();
        const data = context.getImageData(0, 0, SIZE, SIZE).data;
        const opaque: Array<Rgb> = [];
        let covered = 0;
        for (let i = 0; i < data.length; i += 4) {
          if (data[i + 3] < 128) continue;
          covered += 1;
          opaque.push([data[i], data[i + 1], data[i + 2]]);
        }
        let visible = opaque;
        // Nearly every pixel of the drawn area is solid: the background is painted in.
        if (covered >= w * h * 0.98) {
          const bg = rgbOf(backgroundHex);
          if (bg) {
            const bgLab = toLab(bg);
            visible = opaque.filter((pixel) => {
              const lab = toLab(pixel);
              return Math.hypot(lab[0] - bgLab[0], lab[1] - bgLab[1], lab[2] - bgLab[2]) >= 10;
            });
          }
        }
        if (live) setPixels(visible);
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
