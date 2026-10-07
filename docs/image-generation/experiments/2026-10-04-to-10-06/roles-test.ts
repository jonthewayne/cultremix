// Runs the role reader on tricky requests several times and counts answers.
// usage (gateway key in env): bun .tmp/roles-test.ts [trials] [label]
import { readRoles } from "../convex/lib/roleReader";

type Img = { summary?: string; kind?: "photo" | "art" };
const W: Img = { kind: "photo", summary: "a smiling woman in a city park" };
const PICNIC: Img = { kind: "art", summary: "vintage-style picnic illustration beneath a sun" };
const POP: Img = { kind: "art", summary: "pop-art portrait of a woman with vivid pink hair" };
const LION: Img = { kind: "art", summary: "distressed lion-head t-shirt graphic with arched lettering" };
const CARTOON: Img = { kind: "art", summary: "three spiky-haired cartoon boys" };
const CAT: Img = { kind: "photo", summary: "a tabby cat on a sofa" };
const MUSH: Img = { kind: "art", summary: "psychedelic mushroom GROW SLOW t-shirt graphic" };

// hair: the styleHair answers that count as right (default: only false).
const cases: Array<{ images: Img[]; mixer: Img[]; ask: string; ok: string[][]; hair?: boolean[] }> = [
  { images: [W], mixer: [CARTOON], ask: "Draw image 1 as a full-body character, head to toe.", ok: [["content"]] },
  { images: [W], mixer: [CARTOON], ask: "Draw image 1 as a full-body character, head to toe, with her hair sticking straight up in spikes like the style.", ok: [["content"]], hair: [true, false] },
  { images: [W], mixer: [CARTOON], ask: "make her in this style, waving", ok: [["content"]] },
  { images: [W], mixer: [], ask: "Draw her as a full-body cartoon character", ok: [["content"]] },
  { images: [W, PICNIC], mixer: [], ask: "Reimagine image 1 in the style of image 2", ok: [["content", "style"]] },
  { images: [W, PICNIC], mixer: [], ask: "make her look like she belongs in the second picture", ok: [["content", "style"], ["content", "both"]] },
  { images: [W, PICNIC], mixer: [], ask: "draw the woman the way the poster draws people", ok: [["content", "style"]] },
  { images: [LION], mixer: [], ask: "a dragon in this style", ok: [["style"]] },
  { images: [LION, POP], mixer: [], ask: "remix this with the colors of image 2", ok: [["content", "style"]] },
  { images: [LION, CAT], mixer: [], ask: "swap the lion for my cat", ok: [["content", "content"]] },
  { images: [W, PICNIC], mixer: [], ask: "put the woman into the picnic scene", ok: [["content", "content"]] },
  { images: [MUSH], mixer: [], ask: "keep image 1's look but change the words to GROW LOUD", ok: [["both"], ["content"]] },
  { images: [W, PICNIC], mixer: [], ask: "not the style of image 2, just put her on the picnic blanket", ok: [["content", "content"]] },
  { images: [W, PICNIC], mixer: [CARTOON], ask: "put her on the picnic blanket from image 2, drawn in the style", ok: [["content", "content"]] },
  { images: [MUSH], mixer: [CARTOON], ask: "change the words to GROW LOUD", ok: [["content"]] },
  { images: [W, LION], mixer: [], ask: "draw her like the lion design", ok: [["content", "style"]] },
  { images: [W], mixer: [POP], ask: "use image 1's colors with the style", ok: [["both"]] },
  { images: [W], mixer: [CARTOON], ask: "Draw image 1 as a full-body character, head to toe, with the style's hair.", ok: [["content"]], hair: [true] },
  { images: [W], mixer: [CARTOON], ask: "give her the cartoon's spiky hair", ok: [["content"]], hair: [true] },
  { images: [W, CARTOON], mixer: [], ask: "draw image 1 in the style of image 2, with hair like image 2", ok: [["content", "style"]], hair: [true] },
  { images: [W], mixer: [CARTOON], ask: "full body, and keep her curls", ok: [["content"]] },
  { images: [W], mixer: [CARTOON], ask: "make her hair pink", ok: [["content"]] },
  { images: [W], mixer: [CARTOON], ask: "give her a mohawk", ok: [["content"]] },
  // Colors taken from another image (2026-10-05: "the colors of image 2" read as both in 2 of 8 suite tries).
  { images: [LION, POP], mixer: [], ask: "recolor the lion with image 2's palette", ok: [["content", "style"]] },
  { images: [MUSH, POP], mixer: [], ask: "use the colors from the second image", ok: [["content", "style"]] },
  { images: [LION, POP], mixer: [], ask: "keep the lion's own colors but draw it like image 2", ok: [["both", "style"]] },
  { images: [W, PICNIC], mixer: [], ask: "put her into the picnic scene, keeping the picnic's colors", ok: [["content", "both"], ["content", "content"]] },
  { images: [LION], mixer: [POP, PICNIC], ask: "Change the lion to a wolf and put style 2 on the lettering", ok: [["content"]] },
  { images: [W, PICNIC], mixer: [CARTOON], ask: "Draw image 1 in style 1", ok: [["content", "content"]] },
  { images: [W, PICNIC], mixer: [POP], ask: "Reimagine image 1 in the style of image 2, with style 1's colors", ok: [["content", "style"]] },
  { images: [W], mixer: [POP, CARTOON], ask: "make her in style 2, mostly style 1", ok: [["content"]] },
];

const trials = Number(process.argv[2] ?? 4);
const label = process.argv[3] ?? "run";
const jobs: Array<() => Promise<void>> = [];
const answers: Record<number, string[]> = {};
const times: number[] = [];
for (let c = 0; c < cases.length; c++) {
  answers[c] = [];
  for (let t = 0; t < trials; t++) {
    jobs.push(async () => {
      const k = cases[c];
      const t0 = Date.now();
      const read = await readRoles({ instruction: k.ask, images: k.images, mixer: k.mixer, remix: false });
      times.push(Date.now() - t0);
      answers[c].push(read ? read.roles.join("/") + (read.styleHair ? "+hair" : "") : "null");
    });
  }
}
const origLog = console.log;
console.log = () => {};
let next = 0;
await Promise.all(Array.from({ length: 8 }, async () => { while (next < jobs.length) await jobs[next++](); }));
console.log = origLog;
let pass = 0, total = 0;
for (let c = 0; c < cases.length; c++) {
  const k = cases[c];
  const ok = new Set(k.ok.flatMap((r) => (k.hair ?? [false]).map((h) => r.join("/") + (h ? "+hair" : ""))));
  const good = answers[c].filter((a) => ok.has(a)).length;
  pass += good; total += answers[c].length;
  const counts: Record<string, number> = {};
  for (const a of answers[c]) counts[a] = (counts[a] ?? 0) + 1;
  console.log((good === answers[c].length ? "ok  " : "MISS") + " " + good + "/" + answers[c].length + "  " + JSON.stringify(counts) + "  " + (k.mixer.length ? "[mixer] " : "") + k.ask);
}
console.log(label + ": " + pass + "/" + total + " as intended");
times.sort((a, b) => a - b);
const q = (p: number) => times[Math.min(times.length - 1, Math.floor(p * times.length))];
console.log("ms p50 " + q(0.5) + " p90 " + q(0.9) + " max " + times[times.length - 1]);
