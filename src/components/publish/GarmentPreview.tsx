import { useEffect, useState } from "react";
import type { GarmentKind } from "../../../shared/config/print-products";
import type { InchPlacement, PrintArea } from "~/lib/print/shirtPlacement";
import {
  MOCKUP_HEIGHT,
  MOCKUP_WIDTH,
  areaBox,
  designBox,
  frontBox,
  garmentDrawing,
  garmentLabel,
  garmentTones,
} from "~/lib/print/garmentMockup";
import { markPlacement } from "~/lib/print/shirtPlacement";
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
  xIn,
  label,
  className,
}: {
  kind: GarmentKind;
  hex: string;
  imageUrl?: string;
  aspect: number;
  placement: InchPlacement;
  area: PrintArea;
  showArea?: boolean;
  // Places the design this far from the print area's left edge instead of centering it (a chest mark).
  xIn?: number;
  label?: string;
  className?: string;
}) {
  const drawing = garmentDrawing(kind, placement.side);
  const tones = garmentTones(hex);
  const box =
    xIn === undefined || placement.side !== "front"
      ? designBox(kind, placement, aspect, area)
      : frontBox(kind, { xIn, yIn: placement.yIn, widthIn: placement.widthIn }, aspect, area);
  const outline = areaBox(kind, placement.side, area);
  return (
    <svg
      viewBox={`0 0 ${MOCKUP_WIDTH} ${MOCKUP_HEIGHT}`}
      className={cn("h-full w-full", className)}
      role="img"
      aria-label={label ?? `The design on the ${placement.side} of a ${garmentLabel(kind).toLowerCase()}, ${placement.widthIn} inches wide`}
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
        <g opacity={0.85}>
          <rect
            x={outline.x}
            y={outline.y}
            width={outline.width}
            height={outline.height}
            fill="none"
            stroke={tones.area}
            strokeWidth={4}
            strokeDasharray="14 10"
          />
          {/* Its size in the bottom corner, where a design near the top doesn't cover it. */}
          <text x={outline.x + 12} y={outline.y + outline.height - 14} fontSize={30} fontWeight={700} fill={tones.area}>
            {area.widthIn} × {area.heightIn} in
          </text>
        </g>
      )}
      {imageUrl && (
        <image href={imageUrl} x={box.x} y={box.y} width={box.width} height={box.height} preserveAspectRatio="xMidYMid meet" />
      )}
    </svg>
  );
}

// The front of the garment with a back print's chest mark: the same design, small, over the
// wearer's left chest (src/lib/print/shirtPlacement.ts markPlacement).
export function ChestMarkPreview({
  kind,
  hex,
  imageUrl,
  aspect,
  markIn,
  area,
  className,
}: {
  kind: GarmentKind;
  hex: string;
  imageUrl?: string;
  aspect: number;
  markIn: number;
  // The front print area.
  area: PrintArea;
  className?: string;
}) {
  const mark = markPlacement(markIn, aspect, area);
  return (
    <GarmentPreview
      kind={kind}
      hex={hex}
      imageUrl={imageUrl}
      aspect={aspect}
      placement={{ side: "front", widthIn: mark.widthIn, yIn: mark.yIn }}
      xIn={mark.xIn}
      area={area}
      showArea={false}
      label={`The front of the ${garmentLabel(kind).toLowerCase()}, with the design ${mark.widthIn} inches wide on the chest`}
      className={className}
    />
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
