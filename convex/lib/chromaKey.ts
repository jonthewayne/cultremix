// Clears a flat key-color background from an opaque image, for image models that can't make a
// transparent background (Nano Banana 2.1 paints one black when asked). The prompt asks for a flat
// magenta or green background (convex/lib/prompts.ts keyedPrompt); this clears the background region
// connected to the image's border and unmixes the key color out of soft edges, so a pencil line's
// gray stays gray instead of picking up a pink fringe. Background showing through holes in the
// artwork (inside an O, between a crown's points) is nearly pure key color, which the prompt keeps
// out of the artwork, so those patches clear too; a pink detail stays, since even hot pink is far
// from the key. The key is measured from the image's border, because the model's magenta isn't
// always pure (one design's was about 6% off, which left a faint pink panel with a fixed key).
// docs/image-generation/README.md, "Other models".
import type { Rgba } from "./gridCut";

export type KeyColor = "magenta" | "green";

// How much of the key a pixel holds, 0-255: for magenta, how far red and blue both rise above green.
function spillOf(r: number, g: number, b: number, key: KeyColor) {
  return key === "green" ? g - Math.max(r, b) : Math.min(r, b) - g;
}

// Spill at or above REACH joins the background when it touches it, so the fill follows a soft
// blend from the key into the artwork (a pencil sketch's shading faded into magenta left a purple
// ring with 40); neutral pixels, JPEG noise included, stay under it. A pixel with at least CLEAR of
// the key's own spill is fully clear (JPEG noise keeps a flat background from matching exactly).
// Below FLOOR it's artwork. EDGE pixels past the background are unmixed too, for anti-aliased
// outlines. A hole starts at HOLE of the key's spill (hot pink #FF69B4 is 75 of 255) and grows
// through HOLE_REACH.
const REACH = 12;
const CLEAR = 0.92;
const FLOOR = 10;
const EDGE = 2;
const HOLE = 0.7;
const HOLE_REACH = 0.25;
// The border must be mostly key color, or the model ignored the background and nothing is keyed.
const MIN_KEY_SPILL = 100;

// The background's own color: the median of the border pixels that hold the key.
function measuredKey(image: Rgba, key: KeyColor): [number, number, number] | null {
  const { width, height, data } = image;
  const reds: Array<number> = [];
  const greens: Array<number> = [];
  const blues: Array<number> = [];
  let border = 0;
  const look = (i: number) => {
    border++;
    const d = i * 4;
    if (spillOf(data[d], data[d + 1], data[d + 2], key) < MIN_KEY_SPILL) return;
    reds.push(data[d]);
    greens.push(data[d + 1]);
    blues.push(data[d + 2]);
  };
  for (let x = 0; x < width; x += 3) {
    look(x);
    look((height - 1) * width + x);
  }
  for (let y = 0; y < height; y += 3) {
    look(y * width);
    look(y * width + width - 1);
  }
  if (reds.length < border / 2) return null;
  const median = (values: Array<number>) => values.sort((a, b) => a - b)[values.length >> 1];
  return [median(reds), median(greens), median(blues)];
}

export function keyOut(image: Rgba, key: KeyColor): Rgba {
  const { width, height, data } = image;
  const count = width * height;
  const keyRgb = measuredKey(image, key);
  if (!keyRgb) return image;
  const [kr, kg, kb] = keyRgb;
  const keySpill = spillOf(kr, kg, kb, key);
  const spill = new Int16Array(count);
  for (let i = 0; i < count; i++) spill[i] = spillOf(data[i * 4], data[i * 4 + 1], data[i * 4 + 2], key);

  // The background: key-colored pixels reachable from the border, then holes inside the artwork.
  const region = new Uint8Array(count);
  const stack = new Int32Array(count);
  let top = 0;
  let reach = REACH;
  const seed = (i: number) => {
    if (!region[i] && spill[i] >= reach) {
      region[i] = 1;
      stack[top++] = i;
    }
  };
  const fill = () => {
    while (top > 0) {
      const i = stack[--top];
      const x = i % width;
      if (x > 0) seed(i - 1);
      if (x < width - 1) seed(i + 1);
      if (i >= width) seed(i - width);
      if (i < count - width) seed(i + width);
    }
  };
  for (let x = 0; x < width; x++) {
    seed(x);
    seed((height - 1) * width + x);
  }
  for (let y = 0; y < height; y++) {
    seed(y * width);
    seed(y * width + width - 1);
  }
  fill();
  reach = Math.round(HOLE_REACH * keySpill);
  const hole = HOLE * keySpill;
  for (let i = 0; i < count; i++) {
    if (!region[i] && spill[i] >= hole) {
      seed(i);
      fill();
    }
  }

  // The edge band: pixels within EDGE of the background.
  let band = region;
  for (let step = 0; step < EDGE; step++) {
    const next = new Uint8Array(band);
    for (let i = 0; i < count; i++) {
      if (band[i]) continue;
      const x = i % width;
      if ((x > 0 && band[i - 1]) || (x < width - 1 && band[i + 1]) || (i >= width && band[i - width]) || (i < count - width && band[i + width])) {
        next[i] = 1;
      }
    }
    band = next;
  }

  const clear = CLEAR * keySpill;
  const out = new Uint8Array(data);
  for (let i = 0; i < count; i++) {
    if (!band[i]) continue;
    const s = spill[i];
    const d = i * 4;
    if (s <= FLOOR) continue;
    if (s >= clear) {
      out[d] = out[d + 1] = out[d + 2] = out[d + 3] = 0;
      continue;
    }
    // observed = a * color + (1 - a) * key, where the color itself holds no key.
    const a = 1 - s / keySpill;
    out[d] = Math.max(0, Math.min(255, Math.round((data[d] - (1 - a) * kr) / a)));
    out[d + 1] = Math.max(0, Math.min(255, Math.round((data[d + 1] - (1 - a) * kg) / a)));
    out[d + 2] = Math.max(0, Math.min(255, Math.round((data[d + 2] - (1 - a) * kb) / a)));
    out[d + 3] = Math.round(a * (data[d + 3] / 255) * 255);
  }
  return { width, height, data: out };
}

// The share of pixels that are clear (alpha under 8): a transparent design has plenty.
export function clearShare(image: Rgba) {
  const { data } = image;
  let clear = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] < 8) clear++;
  return clear / (data.length / 4);
}

