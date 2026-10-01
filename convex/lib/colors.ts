// Names for shirt colors, shared by the model-photo prompt and the shop page. Kept apart from
// prompts.ts so browser code can name a color without loading any prompt text.

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
