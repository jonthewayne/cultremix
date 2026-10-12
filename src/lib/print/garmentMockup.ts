import { GARMENT_KINDS } from "../../../shared/config/print-products";
import { areaPlacement } from "./shirtPlacement";
import type { GarmentKind } from "../../../shared/config/print-products";
import type { InchPlacement, PrintArea, PrintSide } from "./shirtPlacement";

// Drawn garments (about a size L, laid flat) for the publish preview, with the print area where a
// real one sits. Units are 32 per inch in a 1000 x 1160 space, so a placement in inches lands where it
// would on the real garment. Shared by the browser and Convex; nothing here may import server code.

export const MOCKUP_WIDTH = 1000;
export const MOCKUP_HEIGHT = 1160;
export const UNITS_PER_IN = 32;

export type GarmentDrawing = {
  // Filled with the garment color and outlined, in order (behind first).
  fills: Array<string>;
  // Drawn on top: a hood's inside (filled a shade darker), seams, ribbing, a pocket.
  shade: Array<string>;
  lines: Array<string>;
  // Where the print area's top edge sits.
  areaTop: number;
};

// Adds dy to every y in a path written in absolute M/L/C/Q commands (numbers come in x, y pairs).
function lower(d: string, dy: number) {
  let index = 0;
  return d.replace(/-?\d+(\.\d+)?/gu, (n) => (index++ % 2 === 1 ? String(Number(n) + dy) : n));
}

const TEE_FRONT = "M395 92 C415 176 585 176 605 92 L795 128 L962 318 L850 434 L835 402 L842 1050 Q500 1072 158 1050 L165 402 L150 434 L38 318 L205 128 Z";
const TEE_BACK = "M395 92 C428 122 572 122 605 92 L795 128 L962 318 L850 434 L835 402 L842 1050 Q500 1072 158 1050 L165 402 L150 434 L38 318 L205 128 Z";
const LONG_FRONT = "M395 92 C415 176 585 176 605 92 L795 128 L898 300 L985 930 L900 955 L842 470 L842 1050 Q500 1072 158 1050 L158 470 L100 955 L15 930 L102 300 L205 128 Z";
const LONG_BACK = "M395 92 C428 122 572 122 605 92 L795 128 L898 300 L985 930 L900 955 L842 470 L842 1050 Q500 1072 158 1050 L158 470 L100 955 L15 930 L102 300 L205 128 Z";
const TANK_FRONT = "M372 92 C400 200 600 200 628 92 L700 98 L712 280 Q745 400 842 432 L842 1050 Q500 1072 158 1050 L158 432 Q255 400 288 280 L300 98 Z";
const TANK_BACK = "M372 92 C410 150 590 150 628 92 L700 98 L712 260 Q745 380 842 412 L842 1050 Q500 1072 158 1050 L158 412 Q255 380 288 260 L300 98 Z";
const RIB_HEM = "M162 1004 Q500 1026 838 1004";
const RIB_CUFFS = ["M908 912 L980 890", "M92 912 L20 890"];

// Hoodies are drawn lower, leaving room for the hood.
const HOODIE_FRONT = "M372 175 C410 262 590 262 628 175 L800 205 L900 380 L985 1000 L900 1025 L842 540 L842 1110 Q500 1132 158 1110 L158 540 L100 1025 L15 1000 L100 380 L200 205 Z";
const HOODIE_BACK = "M372 175 C420 200 580 200 628 175 L800 205 L900 380 L985 1000 L900 1025 L842 540 L842 1110 Q500 1132 158 1110 L158 540 L100 1025 L15 1000 L100 380 L200 205 Z";

const DY = 30;

const DRAWINGS: Record<GarmentKind, Record<PrintSide, GarmentDrawing>> = {
  tee: {
    front: { fills: [lower(TEE_FRONT, DY)], shade: [], lines: [lower("M395 92 C415 176 585 176 605 92", DY)], areaTop: 200 + DY },
    back: { fills: [lower(TEE_BACK, DY)], shade: [], lines: [lower("M395 92 C428 122 572 122 605 92", DY)], areaTop: 160 + DY },
  },
  longsleeve: {
    front: { fills: [lower(LONG_FRONT, DY)], shade: [], lines: [lower("M395 92 C415 176 585 176 605 92", DY)], areaTop: 200 + DY },
    back: { fills: [lower(LONG_BACK, DY)], shade: [], lines: [lower("M395 92 C428 122 572 122 605 92", DY)], areaTop: 160 + DY },
  },
  sweatshirt: {
    front: {
      fills: [lower(LONG_FRONT, DY)],
      shade: [],
      lines: [lower("M395 92 C415 176 585 176 605 92", DY), lower(RIB_HEM, DY), ...RIB_CUFFS.map((d) => lower(d, DY))],
      areaTop: 210 + DY,
    },
    back: {
      fills: [lower(LONG_BACK, DY)],
      shade: [],
      lines: [lower("M395 92 C428 122 572 122 605 92", DY), lower(RIB_HEM, DY), ...RIB_CUFFS.map((d) => lower(d, DY))],
      areaTop: 170 + DY,
    },
  },
  hoodie: {
    front: {
      fills: ["M330 178 C310 40 400 10 500 10 C600 10 690 40 670 178 Z", HOODIE_FRONT],
      shade: ["M372 175 C365 80 430 55 500 55 C570 55 635 80 628 175 C590 250 410 250 372 175 Z"],
      lines: [
        "M470 248 L462 380",
        "M530 248 L538 380",
        "M320 764 L680 764 L745 952 L255 952 Z",
        lower(RIB_HEM, 60),
        ...RIB_CUFFS.map((d) => lower(d, 70)),
      ],
      areaTop: 300,
    },
    back: {
      fills: [HOODIE_BACK, "M372 175 C340 330 420 380 500 380 C580 380 660 330 628 175 C580 200 420 200 372 175 Z"],
      shade: [],
      lines: [lower(RIB_HEM, 60), ...RIB_CUFFS.map((d) => lower(d, 70))],
      areaTop: 412,
    },
  },
  tank: {
    front: { fills: [lower(TANK_FRONT, DY)], shade: [], lines: [lower("M372 92 C400 200 600 200 628 92", DY)], areaTop: 232 + DY },
    back: { fills: [lower(TANK_BACK, DY)], shade: [], lines: [lower("M372 92 C410 150 590 150 628 92", DY)], areaTop: 180 + DY },
  },
};

export function garmentDrawing(kind: GarmentKind, side: PrintSide): GarmentDrawing {
  return DRAWINGS[kind][side];
}

export function garmentLabel(kind: GarmentKind) {
  return GARMENT_KINDS[kind].label;
}

export type Box = { x: number; y: number; width: number; height: number };

// The print area on the drawn garment.
export function areaBox(kind: GarmentKind, side: PrintSide, area: PrintArea): Box {
  const width = area.widthIn * UNITS_PER_IN;
  const height = area.heightIn * UNITS_PER_IN;
  return { x: (MOCKUP_WIDTH - width) / 2, y: garmentDrawing(kind, side).areaTop, width, height };
}

// The design on the drawn garment. aspect = height / width of the design image.
export function designBox(kind: GarmentKind, placement: InchPlacement, aspect: number, area: PrintArea): Box {
  const box = areaBox(kind, placement.side, area);
  const placed = areaPlacement(placement, area);
  return {
    x: box.x + placed.xIn * UNITS_PER_IN,
    y: box.y + placed.yIn * UNITS_PER_IN,
    width: placed.widthIn * UNITS_PER_IN,
    height: placed.widthIn * aspect * UNITS_PER_IN,
  };
}

// A design placed anywhere on the drawn front, from the print area's top-left corner in inches (a
// back print's chest mark).
export function frontBox(kind: GarmentKind, placed: { xIn: number; yIn: number; widthIn: number }, aspect: number, area: PrintArea): Box {
  const box = areaBox(kind, "front", area);
  return {
    x: box.x + placed.xIn * UNITS_PER_IN,
    y: box.y + placed.yIn * UNITS_PER_IN,
    width: placed.widthIn * UNITS_PER_IN,
    height: placed.widthIn * aspect * UNITS_PER_IN,
  };
}

function rgb(hex: string): [number, number, number] {
  const clean = /^#?([0-9a-f]{6})$/iu.exec(hex.trim())?.[1] ?? "ffffff";
  return [0, 2, 4].map((i) => parseInt(clean.slice(i, i + 2), 16)) as [number, number, number];
}

function toHex([r, g, b]: [number, number, number]) {
  return `#${[r, g, b].map((n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0")).join("")}`;
}

function luminance(hex: string) {
  const [r, g, b] = rgb(hex);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

// The garment's fill, its outline and details (a shade darker, or lighter on a dark garment), and
// a backdrop it stands out from.
export function garmentTones(hex: string) {
  const light = luminance(hex) > 0.6;
  const base = rgb(hex);
  const shade = (amount: number) => toHex(base.map((c) => (light ? c * (1 - amount) : c + (255 - c) * amount)) as [number, number, number]);
  return { fill: toHex(base), outline: shade(0.22), detail: shade(0.14), inside: shade(0.3), backdrop: light ? "#dcdcd8" : "#f2f2ef" };
}

// The drawn garment as an SVG document, without the design (a server can composite it on top).
export function garmentSvg(kind: GarmentKind, side: PrintSide, hex: string, scale = 1) {
  const drawing = garmentDrawing(kind, side);
  const tones = garmentTones(hex);
  const w = MOCKUP_WIDTH * scale;
  const h = MOCKUP_HEIGHT * scale;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${MOCKUP_WIDTH} ${MOCKUP_HEIGHT}">` +
    `<rect width="${MOCKUP_WIDTH}" height="${MOCKUP_HEIGHT}" fill="${tones.backdrop}"/>` +
    drawing.fills.map((d) => `<path d="${d}" fill="${tones.fill}" stroke="${tones.outline}" stroke-width="6" stroke-linejoin="round"/>`).join("") +
    drawing.shade.map((d) => `<path d="${d}" fill="${tones.inside}" stroke="${tones.outline}" stroke-width="5" stroke-linejoin="round"/>`).join("") +
    drawing.lines.map((d) => `<path d="${d}" fill="none" stroke="${tones.detail}" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>`).join("") +
    "</svg>"
  );
}
