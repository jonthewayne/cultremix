import { useEffect, useRef, useState } from "react";
import { cn } from "~/lib/utils";

// "See what goes to the printer": the art as it is, stretched to its print size, against the
// print file, in one box with a draggable divider. Both images are placed by where they sit on
// the print file's canvas, so the same pixel lines up on both sides.

export type Region = { left: number; top: number; width: number; height: number };
// An image, the part of the print canvas (in print-file pixels) it covers, and its own width.
export type Layer = { url: string; region: Region; pixelWidth?: number };

function placeStyle(region: Region, view: Region): React.CSSProperties {
  return {
    position: "absolute",
    left: `${((region.left - view.left) / view.width) * 100}%`,
    top: `${((region.top - view.top) / view.height) * 100}%`,
    width: `${(region.width / view.width) * 100}%`,
    height: `${(region.height / view.height) * 100}%`,
    maxWidth: "none",
  };
}

// The url once it has loaded, else the fallback (a smaller copy) meanwhile.
export function useLoaded(url: string | undefined, fallback?: string) {
  const [loaded, setLoaded] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (!url) return;
    let live = true;
    const image = new Image();
    image.onload = () => {
      if (live) setLoaded(url);
    };
    image.src = url;
    return () => {
      live = false;
    };
  }, [url]);
  return loaded === url ? url : fallback;
}

export function CompareView({
  before,
  after,
  view,
  background,
  pixelated = false,
  beforeLabel = "Your art, stretched",
  afterLabel = "Print file",
  className,
  style,
}: {
  before: Layer;
  after: Layer;
  view: Region;
  background: string;
  pixelated?: boolean;
  beforeLabel?: string;
  afterLabel?: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [split, setSplit] = useState(0.5);
  const dragging = useRef(false);

  const moveTo = (clientX: number) => {
    const rect = box.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    setSplit(Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)));
  };
  const rendering = pixelated ? "pixelated" : "auto";

  return (
    <div
      ref={box}
      className={cn("relative w-full touch-none select-none overflow-hidden rounded-2xl border border-border", className)}
      style={{ aspectRatio: `${view.width} / ${view.height}`, background, cursor: "ew-resize", ...style }}
      onPointerDown={(event) => {
        dragging.current = true;
        event.currentTarget.setPointerCapture(event.pointerId);
        moveTo(event.clientX);
      }}
      onPointerMove={(event) => {
        if (dragging.current) moveTo(event.clientX);
      }}
      onPointerUp={() => {
        dragging.current = false;
      }}
      onPointerCancel={() => {
        dragging.current = false;
      }}
    >
      <img src={before.url} alt={beforeLabel} draggable={false} style={{ ...placeStyle(before.region, view), imageRendering: rendering }} />
      <div className="absolute inset-0" style={{ clipPath: `inset(0 0 0 ${split * 100}%)`, background }}>
        <img src={after.url} alt={afterLabel} draggable={false} style={placeStyle(after.region, view)} />
      </div>

      <div className="pointer-events-none absolute inset-y-0" style={{ left: `${split * 100}%` }}>
        <div className="absolute inset-y-0 -left-px w-0.5 bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.5)]" />
        <div
          role="slider"
          tabIndex={0}
          aria-label="Compare the art and the print file"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(split * 100)}
          className="pointer-events-auto absolute top-1/2 flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-black bg-white text-sm font-black text-black shadow-lg"
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft") setSplit((s) => Math.max(0, s - 0.05));
            if (event.key === "ArrowRight") setSplit((s) => Math.min(1, s + 0.05));
          }}
        >
          ‹›
        </div>
      </div>

      <span className="pointer-events-none absolute left-2 top-2 rounded-lg bg-black/75 px-2 py-1 text-xs font-bold text-white">
        {beforeLabel}
      </span>
      <span className="pointer-events-none absolute right-2 top-2 rounded-lg bg-black/75 px-2 py-1 text-xs font-bold text-white">
        {afterLabel}
      </span>
    </div>
  );
}

// One image placed by where it sits on the print canvas, framed by `view`: the whole design, with
// nothing to compare it against.
export function PlacedView({
  layer,
  view,
  background,
  alt,
  className,
  style,
}: {
  layer: Layer;
  view: Region;
  background: string;
  alt: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className={cn("relative w-full overflow-hidden rounded-2xl border border-border", className)}
      style={{ aspectRatio: `${view.width} / ${view.height}`, background, ...style }}
    >
      <img src={layer.url} alt={alt} draggable={false} style={placeStyle(layer.region, view)} />
    </div>
  );
}

// A 100% crop: one print-file pixel to one screen pixel, the art blown up to match, pixel for pixel.
// The small map picks which part to look at.
export function CropZoom({
  before,
  after,
  design,
  mapUrl,
  background,
  beforeLabel,
  afterLabel = "Print file, 100%",
}: {
  before: Layer;
  after: Layer;
  // Where the design sits on the canvas: the map shows this part.
  design: Region;
  mapUrl: string;
  background: string;
  beforeLabel?: string;
  afterLabel?: string;
}) {
  const holder = useRef<HTMLDivElement>(null);
  const [side, setSide] = useState(360);
  const [center, setCenter] = useState({ x: 0.5, y: 0.5 });
  const dragging = useRef(false);

  useEffect(() => {
    const element = holder.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setSide(Math.max(200, Math.min(480, Math.floor(element.clientWidth)))));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const w = Math.min(side, design.width);
  const h = Math.min(side, design.height);
  const left = Math.round(Math.min(design.left + design.width - w, Math.max(design.left, design.left + center.x * design.width - w / 2)));
  const top = Math.round(Math.min(design.top + design.height - h, Math.max(design.top, design.top + center.y * design.height - h / 2)));
  const view = { left, top, width: w, height: h };
  const stretch = before.pixelWidth ? before.region.width / before.pixelWidth : Number.NaN;

  const pick = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setCenter({
      x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
    });
  };

  return (
    <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_9rem]">
      <div ref={holder} className="min-w-0">
        <CompareView
          before={before}
          after={after}
          view={view}
          background={background}
          pixelated
          beforeLabel={beforeLabel ?? (Number.isFinite(stretch) ? `Art at ${Math.round(stretch * 10) / 10}×` : "Your art")}
          afterLabel={afterLabel}
          style={{ width: w, maxWidth: "100%" }}
        />
      </div>
      <div className="max-w-40 sm:max-w-none">
        <div
          className="relative cursor-crosshair touch-none overflow-hidden rounded-xl border border-border"
          style={{ aspectRatio: `${design.width} / ${design.height}`, background }}
          onPointerDown={(event) => {
            dragging.current = true;
            event.currentTarget.setPointerCapture(event.pointerId);
            pick(event);
          }}
          onPointerMove={(event) => {
            if (dragging.current) pick(event);
          }}
          onPointerUp={() => {
            dragging.current = false;
          }}
        >
          <img src={mapUrl} alt="" draggable={false} className="absolute inset-0 h-full w-full" />
          <div
            className="pointer-events-none absolute border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.6)]"
            style={{
              left: `${((left - design.left) / design.width) * 100}%`,
              top: `${((top - design.top) / design.height) * 100}%`,
              width: `${(w / design.width) * 100}%`,
              height: `${(h / design.height) * 100}%`,
            }}
          />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">Tap the map to look somewhere else.</p>
      </div>
    </div>
  );
}
