// Prompt wrappers for designs and model photos (kept under 1,000 characters).

export function designPrompt(args: {
  instruction: string;
  presets: Array<string>;
  hasInspiration: boolean;
  // The reference image is the published design being remixed.
  remix?: boolean;
}) {
  const ask = args.instruction.trim();
  const style = args.presets.length ? ` Style: ${args.presets.join(", ")}.` : "";
  const lead = args.remix
    ? `Remix this t-shirt graphic. Keep its layout, illustration, lettering style, and colors, and change only this: ${ask || "make a fresh variation"}. If new words are given, use exactly those words and drop the old ones.`
    : args.hasInspiration
      ? `Create a new t-shirt graphic using the reference image as inspiration. ${ask || "Keep its spirit and make it a bold, wearable graphic."}`
      : `A t-shirt graphic: ${ask}`;
  return (
    `${lead}${style} ` +
    "Output only the artwork itself on a fully transparent background: no t-shirt, no mockup, no person, no scene, no frame, no drop shadow. " +
    "Print-ready, bold, clean edges, centered, filling most of the canvas."
  ).slice(0, 1000);
}

// Who wears the shirt in the model photo: adult women, varied in background and look.
export const CASTING = [
  "a Black woman in her twenties with natural coily hair and gold hoop earrings",
  "a Black woman in her twenties with long box braids",
  "a Korean woman in her twenties with a sleek black bob",
  "a Japanese woman in her twenties with a shaggy layered haircut",
  "a Chinese woman in her twenties with long straight black hair and blunt bangs",
  "a Mexican woman in her twenties with long dark wavy hair",
  "a Mexican woman in her twenties with a slicked-back bun and bold brows",
  "a Swedish woman in her twenties with platinum blonde hair",
  "a South Asian woman in her twenties with long black hair and a small nose ring",
  "a Middle Eastern woman in her twenties with voluminous dark curls",
  "an Irish woman in her twenties with copper-red hair and freckles",
  "a Filipina woman in her twenties with a short pixie cut",
  "a Brazilian woman in her twenties with a bleached buzz cut",
  "a mixed-race woman in her twenties with curly hair and freckles",
];

// How she stands. Every pose works in any setting and keeps the graphic facing the camera.
export const POSES = [
  "walking toward the camera mid-stride",
  "leaning back against a wall with one knee bent",
  "sitting on a low ledge with her forearms resting on her knees",
  "standing square to the camera, chin up, hands at her sides",
  "mid-laugh with her head tilted and her hands in her back pockets",
  "turning back toward the camera over her shoulder, chest facing the lens",
  "looking just past the camera with one hand in her hair",
  "pushing her sunglasses up into her hair",
  "holding a coffee cup down at her side",
  "stepping forward with her weight on one leg and her hands in her front pockets",
];

// Where the shoot happens: urban and a little hip.
export const SETTINGS = [
  "on a neon-lit street corner at night",
  "in a graffiti-covered alley",
  "on a rooftop at golden hour with the skyline behind her",
  "on a tiled subway platform",
  "outside a corner bodega at dusk",
  "inside a laundromat under bright fluorescent light",
  "in the aisle of a record store",
  "at a concrete skatepark at sunset",
  "in a crosswalk on a busy downtown street",
  "in front of a bold painted mural",
  "in a parking garage under harsh overhead lights",
  "on a fire escape above a city street",
];

export type ShootLook = { casting: string; pose: string; world: string };

function hashString(value: string) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

// A stable pick for the seed that skips recently used options when it can.
export function pickFrom(options: Array<string>, seed: string, recent: Array<string | undefined>) {
  const used = new Set(recent.filter((c): c is string => Boolean(c)));
  const fresh = options.filter((c) => !used.has(c));
  const pool = fresh.length > 0 ? fresh : options;
  return pool[hashString(seed) % pool.length];
}

// Casting and setting avoid the most recent shoots; the pose varies freely.
export function pickLook(
  seed: string,
  recent: Array<{ casting?: string; world?: string }>,
): ShootLook {
  return {
    casting: pickFrom(CASTING, `${seed}:casting`, recent.slice(0, 10).map((r) => r.casting)),
    world: pickFrom(SETTINGS, `${seed}:world`, recent.slice(0, 6).map((r) => r.world)),
    pose: pickFrom(POSES, `${seed}:pose`, []),
  };
}

export function photoPrompt(
  backgroundColor: string,
  look: ShootLook = { casting: CASTING[0], pose: POSES[0], world: SETTINGS[0] },
) {
  const color = colorName(backgroundColor);
  return (
    `An editorial street-style fashion photograph of ${look.casting}, ${look.pose}, ${look.world}. ` +
    "The pose feels natural for the place. " +
    `She wears a plain ${color} crew-neck t-shirt (color ${backgroundColor}) with this exact graphic printed large on the chest, ` +
    "reproduced faithfully with no changes; no jacket or anything else covers the graphic. " +
    "House style: raw on-camera flash, 35mm film grain, candid and confident, natural skin, minimal retouching. " +
    "Framed from mid-thigh up, the shirt and print clearly visible."
  ).slice(0, 1000);
}

const NAMED: Array<[string, number, number, number]> = [
  ["off-white", 244, 241, 234],
  ["white", 255, 255, 255],
  ["black", 20, 20, 20],
  ["charcoal gray", 64, 64, 64],
  ["heather gray", 160, 160, 160],
  ["navy", 30, 40, 80],
  ["royal blue", 40, 80, 200],
  ["sky blue", 135, 190, 230],
  ["forest green", 34, 85, 50],
  ["sage green", 150, 170, 130],
  ["olive", 110, 110, 50],
  ["mustard yellow", 220, 170, 50],
  ["bright yellow", 250, 220, 60],
  ["orange", 240, 120, 40],
  ["red", 200, 40, 40],
  ["burgundy", 110, 30, 45],
  ["pink", 240, 160, 180],
  ["hot pink", 230, 60, 140],
  ["lavender", 190, 170, 220],
  ["purple", 100, 50, 140],
  ["brown", 110, 70, 40],
  ["sand", 215, 195, 160],
  ["teal", 30, 130, 130],
];

export function colorName(hex: string) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/iu.exec(hex);
  if (!m) return "off-white";
  const [r, g, b] = [m[1], m[2], m[3]].map((part) => parseInt(part, 16));
  let best = NAMED[0];
  let bestDistance = Infinity;
  for (const entry of NAMED) {
    const distance = (entry[1] - r) ** 2 + (entry[2] - g) ** 2 + (entry[3] - b) ** 2;
    if (distance < bestDistance) {
      best = entry;
      bestDistance = distance;
    }
  }
  return best[0];
}
