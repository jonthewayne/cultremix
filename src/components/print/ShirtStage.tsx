import { useRef } from "react";
import type { GarmentKind, PrintGeometry } from "../../../shared/config/print-products";
import type { Placement } from "~/lib/print/placement";
import { MOCKUP_HEIGHT, MOCKUP_WIDTH, UNITS_PER_IN, areaBox, garmentDrawing, garmentTones } from "~/lib/print/garmentMockup";
import { clampPlacement, placedHeight } from "~/lib/print/placement";
import { cn } from "~/lib/utils";

// The product's front, drawn (src/lib/print/garmentMockup.ts, the publish preview's drawings: a tee,
// hoodie, and so on at about a size L, 32 units per inch), with its print area centered where a real
// one sits. The design sits in the area at its placed size and can be dragged; the guides show the
// area, the safe line, the center, and the top.

const UNIT = UNITS_PER_IN;
const SNAP_IN = 0.2;

// Whether light or dark lines read on a shirt color.
function isDark(hex: string) {
  const n = Number.parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 140;
}

export function ShirtStage({
  product,
  kind = "tee",
  shirtHex,
  imageUrl,
  aspect,
  placement,
  onChange,
  guides = true,
  locked = false,
  className,
}: {
  product: PrintGeometry & { name: string };
  kind?: GarmentKind;
  shirtHex: string;
  imageUrl?: string;
  aspect: number;
  placement: Placement;
  onChange?: (placement: Placement) => void;
  guides?: boolean;
  locked?: boolean;
  className?: string;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{ x: number; y: number; start: Placement; scale: number } | null>(null);
  const area = product.printArea;
  const inset = product.safeInsetIn;
  const drawing = garmentDrawing(kind, "front");
  const tones = garmentTones(shirtHex);
  const box = areaBox(kind, "front", area);
  const AREA_LEFT = box.x;
  const AREA_TOP = box.y;
  const heightIn = placedHeight(placement.widthIn, aspect);
  const line = isDark(shirtHex) ? "rgba(255,255,255,0.7)" : "rgba(0,0,0,0.55)";
  const centerX = AREA_LEFT + (area.widthIn / 2) * UNIT;
  const designCenter = placement.xIn + placement.widthIn / 2;
  const centeredNow = Math.abs(designCenter - area.widthIn / 2) < 0.01;
  const atTopNow = Math.abs(placement.yIn - inset) < 0.01;

  const onPointerDown = (event: React.PointerEvent) => {
    if (locked || !onChange || !svg.current) return;
    event.preventDefault();
    (event.target as Element).setPointerCapture(event.pointerId);
    const rect = svg.current.getBoundingClientRect();
    drag.current = { x: event.clientX, y: event.clientY, start: placement, scale: MOCKUP_WIDTH / rect.width / UNIT };
  };
  const onPointerMove = (event: React.PointerEvent) => {
    const d = drag.current;
    if (!d || !onChange) return;
    let xIn = d.start.xIn + (event.clientX - d.x) * d.scale;
    let yIn = d.start.yIn + (event.clientY - d.y) * d.scale;
    // Snap to the center and the top line.
    if (Math.abs(xIn + d.start.widthIn / 2 - area.widthIn / 2) < SNAP_IN) xIn = (area.widthIn - d.start.widthIn) / 2;
    if (Math.abs(yIn - inset) < SNAP_IN) yIn = inset;
    onChange(clampPlacement({ xIn, yIn, widthIn: d.start.widthIn }, aspect, product));
  };
  const onPointerUp = () => {
    drag.current = null;
  };

  const x = AREA_LEFT + placement.xIn * UNIT;
  const y = AREA_TOP + placement.yIn * UNIT;
  const w = placement.widthIn * UNIT;
  const h = heightIn * UNIT;

  return (
    <svg
      ref={svg}
      viewBox={`0 0 ${MOCKUP_WIDTH} ${MOCKUP_HEIGHT}`}
      className={cn("h-auto w-full touch-none select-none", className)}
      role="img"
      aria-label={`The design on a ${product.name}, ${placement.widthIn} inches wide`}
    >
      {drawing.fills.map((d) => (
        <path key={d} d={d} fill={tones.fill} stroke={tones.outline} strokeWidth="6" strokeLinejoin="round" />
      ))}
      {drawing.shade.map((d) => (
        <path key={d} d={d} fill={tones.inside} stroke={tones.outline} strokeWidth="5" strokeLinejoin="round" />
      ))}
      {drawing.lines.map((d) => (
        <path key={d} d={d} fill="none" stroke={tones.detail} strokeWidth="10" strokeLinecap="round" strokeLinejoin="round" />
      ))}

      {guides && (
        <g fill="none" stroke={line} strokeWidth="2" pointerEvents="none">
          <rect x={AREA_LEFT} y={AREA_TOP} width={area.widthIn * UNIT} height={area.heightIn * UNIT} strokeDasharray="10 8" />
          <rect
            x={AREA_LEFT + inset * UNIT}
            y={AREA_TOP + inset * UNIT}
            width={(area.widthIn - 2 * inset) * UNIT}
            height={(area.heightIn - 2 * inset) * UNIT}
            strokeDasharray="2 6"
            strokeLinecap="round"
          />
          <line
            x1={centerX}
            x2={centerX}
            y1={AREA_TOP - 14}
            y2={AREA_TOP + area.heightIn * UNIT + 14}
            strokeDasharray="4 6"
            strokeWidth={centeredNow ? 3 : 2}
            stroke={centeredNow ? "#16a34a" : line}
          />
          <line
            x1={AREA_LEFT - 14}
            x2={AREA_LEFT + area.widthIn * UNIT + 14}
            y1={AREA_TOP + inset * UNIT}
            y2={AREA_TOP + inset * UNIT}
            strokeWidth={atTopNow ? 3 : 2}
            stroke={atTopNow ? "#16a34a" : line}
          />
        </g>
      )}

      {imageUrl && !imageUrl.startsWith("fake:") ? (
        <image
          href={imageUrl}
          x={x}
          y={y}
          width={w}
          height={h}
          preserveAspectRatio="none"
          className={locked ? undefined : "cursor-grab active:cursor-grabbing"}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        />
      ) : (
        <rect
          x={x}
          y={y}
          width={w}
          height={h}
          rx="12"
          fill="rgba(0,0,0,0.15)"
          className={locked ? undefined : "cursor-grab"}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        />
      )}
      {guides && !locked && (
        <rect x={x} y={y} width={w} height={h} fill="none" stroke={line} strokeWidth="1.5" pointerEvents="none" />
      )}
    </svg>
  );
}
