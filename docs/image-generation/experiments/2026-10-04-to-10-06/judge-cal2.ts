// Calibrates the remix comparison's new rule (a design is its look and layout) on fixture pairs and saved designs.
import { existsSync, readFileSync } from 'node:fs';
import sharp from 'sharp';
import { compareRemix } from '../convex/lib/remixCompare';
import { fixturePath } from '../tests/image-e2e/fixtures';
const RUNS = '/Users/starborn/Projects/CultRemix/.tmp/image-e2e/runs/';
const fx = async (id: string) => new Uint8Array(await sharp(readFileSync(fixturePath(id))).png().toBuffer());
const file = (f: string) => async () => new Uint8Array(readFileSync(f));
type Want = 'variation' | 'fork' | 'either';
type Job = { group: string; label: string; original: () => Promise<Uint8Array>; remix: () => Promise<Uint8Array>; want: Want };
const jobs: Array<Job> = [];
const pairs: Array<[string, string, Want]> = [
  ['grow-slow', 'grow-loud', 'variation'], ['grow-loud', 'grow-bold', 'variation'], ['grow-slow', 'since-1999', 'variation'],
  ['grow-slow', 'grow-wild-free', 'variation'], ['offline-luxury', 'unplugged-flex', 'variation'], ['trash-royalty', 'trash-couture', 'variation'],
  ['slow-roll-night', 'slow-roll-beach', 'variation'], ['lion', 'lion-night-shift', 'variation'], ['grow-slow', 'grow-slow', 'variation'],
  ['lion', 'dragon', 'variation'], ['grow-slow', 'grow-slow-cactus', 'variation'],
  ['grow-slow', 'grow-slow-pixel', 'fork'], ['person', 'person-cartoon', 'fork'], ['person', 'person-70s', 'fork'], ['grow-slow', 'slow-roll-night', 'fork'],
  ['trash-royalty', 'trash-couture-pop', 'either'], ['trash-royalty', 'trash-couture-70s', 'either'],
];
for (const [a, b, want] of pairs) for (let t = 0; t < 3; t++) jobs.push({ group: 'pair ' + a + ' > ' + b, label: 'try ' + (t + 1), original: () => fx(a), remix: () => fx(b), want });
const saved: Array<[string, string, Array<string>, Want]> = [
  ['word remixes', 'grow-slow', ['remix-words', 'remix-add-words', 'remix-longer-and-removed'], 'variation'],
  ['word remixes', 'offline-luxury', ['remix-two-lines'], 'variation'],
  ['word remixes', 'grow-loud', ['remix-of-remix'], 'variation'],
  ['word remixes', 'trash-royalty', ['remix-words-keep-look'], 'variation'],
  ['dragon in lion style', 'lion', ['style-of-one-image'], 'variation'],
  ['wolf in lion style', 'lion', ['style-copy'], 'either'],
  ['raccoon in mushroom style', 'grow-slow', ['words-not-from-style'], 'either'],
  ['remix restyled pop-art 100', 'trash-royalty', ['remix-words-with-style'], 'either'],
  ['photo to pop art', 'person', ['photo-pop-art'], 'fork'],
  ['photo to cartoon', 'person', ['whole-figure'], 'fork'],
];
for (const [group, original, cases, want] of saved) for (const run of ['20261005-0853', '20261005-1756', '20261005-1934']) for (const c of cases) for (let d = 1; d <= 4; d++) {
  const f = RUNS + run + '-gpt-image-2.5/' + c + '/design-' + d + '.png';
  if (existsSync(f)) jobs.push({ group, label: run.slice(9) + ' ' + c + ' d' + d, original: () => fx(original), remix: file(f), want });
}
let cents = 0, next = 0;
const rows: Array<{ job: Job; verdict: string; aspects: string; reason: string }> = [];
await Promise.all(Array.from({ length: 10 }, async () => { while (next < jobs.length) { const job = jobs[next++];
  let verdict = 'error', aspects = '', reason = '';
  for (let attempt = 0; attempt < 3 && verdict === 'error'; attempt++) {
    try { const r = await compareRemix(await job.original(), await job.remix()); cents += r.costCents ?? 0; verdict = r.verdict; aspects = 's=' + r.subject + ' l=' + r.layout + ' st=' + r.style; reason = r.reason; }
    catch (e) { reason = String(e).slice(0, 80); }
  }
  rows.push({ job, verdict, aspects, reason });
} }));
const groups = [...new Set(jobs.map((j) => j.group))];
let right = 0, judged = 0;
for (const g of groups) {
  const rs = rows.filter((r) => r.job.group === g);
  const want = rs[0].job.want;
  const counts: Record<string, number> = {};
  for (const r of rs) counts[r.verdict] = (counts[r.verdict] ?? 0) + 1;
  const ok = rs.filter((r) => r.verdict !== 'error' && (want === 'either' || r.verdict === want)).length;
  if (want !== 'either') { right += ok; judged += rs.filter((r) => r.verdict !== 'error').length; }
  console.log((want === 'either' ? 'info' : ok === rs.length ? 'ok  ' : 'MISS') + ' ' + g.padEnd(42) + ' want ' + want.padEnd(9) + JSON.stringify(counts));
  for (const r of rs) if (want !== 'either' && r.verdict !== want) console.log('       ' + r.job.label + ': ' + r.verdict + ' ' + r.aspects + ' | ' + r.reason);
  if (want === 'either') for (const r of rs.slice(0, 3)) console.log('       e.g. ' + r.job.label + ': ' + r.verdict + ' ' + r.aspects + ' | ' + r.reason);
}
console.log('as expected', right, 'of', judged, '| calls', jobs.length, '| cost cents', cents.toFixed(2));
