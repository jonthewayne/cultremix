import { useEffect, useRef, useState } from "react";
import { applyKnockout, borderColor, clampTolerance, parseHex, toHex } from "~/lib/print/knockout";
import { cn } from "~/lib/utils";

// Knock out a background color. The preview runs here on a smaller copy with the same code the
// server uses on the full image.

const PREVIEW_SIDE = 480;
export const CHECKER: React.CSSProperties = {
  backgroundColor: "#ffffff",
  backgroundImage: "conic-gradient(#e5e5e5 25%, transparent 0 50%, #e5e5e5 0 75%, transparent 0)",
  backgroundSize: "16px 16px",
};

type Source = { width: number; height: number; pixels: Uint8ClampedArray };

export function KnockoutTool({
  imageUrl,
  busy,
  onApply,
}: {
  imageUrl?: string;
  busy: boolean;
  onApply: (params: { color: string; tolerance: number; fromEdges: boolean }) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [source, setSource] = useState<Source | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [color, setColor] = useState("#ffffff");
  const [tolerance, setTolerance] = useState(12);
  const [fromEdges, setFromEdges] = useState(true);
  const [cleared, setCleared] = useState<number | null>(null);

  // Load a small copy of the image and guess the background from its border.
  useEffect(() => {
    setSource(null);
    setUnavailable(false);
    if (!imageUrl || imageUrl.startsWith("fake:")) {
      setUnavailable(true);
      return;
    }
    let live = true;
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => {
      if (!live) return;
      const scale = Math.min(1, PREVIEW_SIDE / Math.max(image.naturalWidth, image.naturalHeight));
      const width = Math.max(1, Math.round(image.naturalWidth * scale));
      const height = Math.max(1, Math.round(image.naturalHeight * scale));
      const scratch = document.createElement("canvas");
      scratch.width = width;
      scratch.height = height;
      const context = scratch.getContext("2d", { willReadFrequently: true });
      if (!context) return setUnavailable(true);
      context.drawImage(image, 0, 0, width, height);
      try {
        const pixels = context.getImageData(0, 0, width, height).data;
        setSource({ width, height, pixels });
        const guess = borderColor(pixels, width, height);
        if (guess) setColor(toHex(guess));
      } catch {
        setUnavailable(true);
      }
    };
    image.onerror = () => {
      if (live) setUnavailable(true);
    };
    image.src = imageUrl;
    return () => {
      live = false;
    };
  }, [imageUrl]);

  // Redraw the preview whenever a setting changes.
  useEffect(() => {
    const rgb = parseHex(color);
    if (!source || !rgb || !canvas.current) return;
    const pixels = new Uint8ClampedArray(source.pixels);
    const visible = countVisible(pixels);
    const removed = applyKnockout(pixels, source.width, source.height, { color: rgb, tolerance, fromEdges });
    setCleared(visible ? removed / visible : 0);
    canvas.current.width = source.width;
    canvas.current.height = source.height;
    canvas.current.getContext("2d")?.putImageData(new ImageData(pixels, source.width, source.height), 0, 0);
  }, [source, color, tolerance, fromEdges]);

  // Tap the preview to take the color under your finger.
  const pickColor = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!source) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.min(source.width - 1, Math.floor(((event.clientX - rect.left) / rect.width) * source.width));
    const y = Math.min(source.height - 1, Math.floor(((event.clientY - rect.top) / rect.height) * source.height));
    const i = (y * source.width + x) * 4;
    if (source.pixels[i + 3] === 0) return;
    setColor(toHex({ r: source.pixels[i], g: source.pixels[i + 1], b: source.pixels[i + 2] }));
  };

  return (
    <div className="flex flex-col gap-4">
      {unavailable ? (
        <p className="rounded-xl bg-muted p-4 text-sm text-muted-foreground">The preview can’t load this image, but knocking out still works.</p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border" style={CHECKER}>
          <canvas
            ref={canvas}
            onPointerDown={pickColor}
            className={cn("mx-auto block h-auto max-h-80 w-auto max-w-full cursor-crosshair", !source && "h-40")}
          />
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm font-bold">
          <input
            type="color"
            value={color}
            onChange={(event) => setColor(event.target.value)}
            className="h-10 w-12 cursor-pointer rounded-lg border border-border bg-background"
          />
          <span className="font-mono text-xs uppercase">{color}</span>
        </label>
        <p className="text-xs text-muted-foreground">Tap the preview to pick a color.</p>
      </div>
      <label className="flex flex-col gap-2 text-sm font-bold">
        <span className="flex justify-between">
          Tolerance <span className="tabular-nums text-muted-foreground">{tolerance}</span>
        </span>
        <input
          type="range"
          min={0}
          max={60}
          value={tolerance}
          onChange={(event) => setTolerance(clampTolerance(Number(event.target.value)))}
          className="w-full accent-foreground"
        />
      </label>
      <label className="flex items-center gap-3 text-sm">
        <input type="checkbox" checked={fromEdges} onChange={(event) => setFromEdges(event.target.checked)} className="h-5 w-5 accent-foreground" />
        Only where it touches the edges <span className="text-muted-foreground">(keeps the same color inside the art)</span>
      </label>
      {cleared !== null && (
        <p className="text-sm text-muted-foreground">Clears {Math.round(cleared * 100)}% of what shows.</p>
      )}
      <button
        type="button"
        disabled={busy || !parseHex(color)}
        onClick={() => onApply({ color, tolerance, fromEdges })}
        className="h-12 rounded-2xl bg-foreground font-black text-background transition-transform hover:-translate-y-0.5 disabled:translate-y-0 disabled:opacity-40"
      >
        Knock it out
      </button>
    </div>
  );
}

function countVisible(pixels: Uint8ClampedArray) {
  let count = 0;
  for (let i = 3; i < pixels.length; i += 4) if (pixels[i] > 0) count++;
  return count;
}
