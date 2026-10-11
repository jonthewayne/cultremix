import { useEffect, useState } from "react";
import type { GarmentKind } from "../../../shared/config/print-products";
import type { InchPlacement, PrintArea } from "~/lib/print/shirtPlacement";
import {
  MOCKUP_HEIGHT,
  MOCKUP_WIDTH,
  areaBox,
  designBox,
  garmentDrawing,
  garmentLabel,
  garmentTones,
} from "~/lib/print/garmentMockup";
import { cn } from "~/lib/utils";

// The design on a drawn garment at its real size, for Publish: the print area as a faint dashed
// outline, the design where the placement puts it (src/lib/print/garmentMockup.ts).
export function GarmentPreview({
  kind,
  hex,
  imageUrl,
  aspect,
  placement,
  area,
  showArea = true,
  className,
}: {
  kind: GarmentKind;
  hex: string;
  imageUrl?: string;
  aspect: number;
  placement: InchPlacement;
  area: PrintArea;
  showArea?: boolean;
  className?: string;
}) {
  const drawing = garmentDrawing(kind, placement.side);
  const tones = garmentTones(hex);
  const box = designBox(kind, placement, aspect, area);
  const outline = areaBox(kind, placement.side, area);
  return (
    <svg
      viewBox={`0 0 ${MOCKUP_WIDTH} ${MOCKUP_HEIGHT}`}
      className={cn("h-full w-full", className)}
      role="img"
      aria-label={`The design on the ${placement.side} of a ${garmentLabel(kind).toLowerCase()}, ${placement.widthIn} inches wide`}
    >
      {drawing.fills.map((d, i) => (
        <path key={`f${i}`} d={d} fill={tones.fill} stroke={tones.outline} strokeWidth={6} strokeLinejoin="round" />
      ))}
      {drawing.shade.map((d, i) => (
        <path key={`s${i}`} d={d} fill={tones.inside} stroke={tones.outline} strokeWidth={5} strokeLinejoin="round" />
      ))}
      {drawing.lines.map((d, i) => (
        <path key={`l${i}`} d={d} fill="none" stroke={tones.detail} strokeWidth={10} strokeLinecap="round" strokeLinejoin="round" />
      ))}
      {showArea && (
        <rect
          x={outline.x}
          y={outline.y}
          width={outline.width}
          height={outline.height}
          fill="none"
          stroke={tones.outline}
          strokeWidth={3}
          strokeDasharray="12 12"
          opacity={0.55}
        />
      )}
      {imageUrl && (
        <image href={imageUrl} x={box.x} y={box.y} width={box.width} height={box.height} preserveAspectRatio="xMidYMid meet" />
      )}
    </svg>
  );
}

// An image's height / width once it loads (1 until then).
export function useImageAspect(url: string | undefined) {
  const [aspect, setAspect] = useState(1);
  useEffect(() => {
    if (!url || url.startsWith("fake:")) return;
    let live = true;
    const image = new Image();
    image.onload = () => {
      if (live && image.naturalWidth > 0) setAspect(image.naturalHeight / image.naturalWidth);
    };
    image.src = url;
    return () => {
      live = false;
    };
  }, [url]);
  return aspect;
}

