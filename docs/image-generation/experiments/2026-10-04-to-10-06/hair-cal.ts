// How reliably the notes' Hair line describes the hair of the people shown.
// usage: bun .tmp/hair-cal.ts [trials]
import sharp from "sharp";
import { readFileSync } from "node:fs";
import { writeNotes } from "../convex/lib/notesWriter";
import { hairShape } from "../convex/lib/prompts";

const dir = "/Users/starborn/Projects/CultRemix/tests/image-e2e/fixtures/";
const trials = Number(process.argv[2] ?? 6);
const cases: Array<[string, RegExp | null, number]> = [
  ["cartoon-boys", /spik/i, trials],
  ["person", /curl/i, 3],
  ["pop-art", /wav|flow|swoop|curl/i, 3],
  ["poster-70s", /wav|flow|ribbon|long/i, 3],
  ["lion", null, 2],
  ["trash-royalty", null, 2],
];
const log = console.error; console.error = () => {};
const out: Array<string> = [];
await Promise.all(cases.map(async ([id, want, n]) => {
  const bytes = new Uint8Array(await sharp(readFileSync(dir + id + ".webp")).png().toBuffer());
  const got = await Promise.all(Array.from({ length: n }, async () => {
    const r = await writeNotes(bytes);
    return r.ok ? hairShape(r.notes) : "ERR";
  }));
  const ok = got.filter((h) => (want ? want.test(h) : h !== "ERR")).length;
  out.push((ok === n ? "ok  " : "MISS") + " " + id.padEnd(14) + " " + ok + "/" + n + "  " + got.map((h) => (h ? h.slice(0, 44) : "(none)")).join(" | "));
}));
console.error = log;
console.log(out.sort().join("\n"));

