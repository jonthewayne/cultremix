// Runs prompt variants from saved suite prompts at a chosen quality and checks each design.
// usage: bun .tmp/limits-exp.ts <spec.json>
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { cutGrid } from '../convex/lib/gridCut';
import { gatewayImage } from '../convex/lib/imageCalls';
import { gatewayCostCents } from '../convex/lib/pricing';
import { decodeToRgba, encodePng } from '../convex/lib/resize';
import { checkImage, wordsMatch } from '../tests/image-e2e/judge';
import { fixturePath } from '../tests/image-e2e/fixtures';
import { PIN } from '../tests/image-e2e/pin';
type Ask = { id: string; ask: string; expect?: boolean };
type Variant = { name: string; base: string; edits?: Array<[string, string]>; n: number; images?: Array<string> };
type Spec = { out: string; quality: 'medium' | 'high'; images: Array<string>; refs?: Array<{ image: string; as: string }>; variants: Array<Variant>; asks: Array<Ask>; words?: { has: Array<string>; not?: Array<string> }; concurrency?: number };
const spec = JSON.parse(readFileSync(process.argv[2], 'utf8')) as Spec;
// An image is a fixture id, or a path to a PNG/WebP file.
const png = async (id: string) => new Uint8Array(await sharp(readFileSync(id.includes('/') ? id : fixturePath(id))).png().toBuffer());
const refs = await Promise.all((spec.refs ?? []).map(async (r) => ({ as: r.as, bytes: await png(r.image) })));
let cents = 0;
const jobs: Array<{ v: Variant; i: number; text: string }> = [];
for (const v of spec.variants) {
  let text = readFileSync(v.base, 'utf8');
  for (const [from, to] of v.edits ?? []) {
    const n = text.split(from).length - 1;
    if (n !== 1) throw new Error(v.name + ': edit matched ' + n + ' times: ' + from.slice(0, 60));
    text = text.replace(from, to);
  }
  mkdirSync(join(spec.out, v.name), { recursive: true });
  writeFileSync(join(spec.out, v.name, 'prompt.txt'), text);
  for (let i = 1; i <= v.n; i++) jobs.push({ v, i, text });
}
const results: Record<string, Array<string>> = {};
let next = 0;
await Promise.all(Array.from({ length: spec.concurrency ?? 3 }, async () => { while (next < jobs.length) { const job = jobs[next++];
  const dir = join(spec.out, job.v.name, 'grid-' + job.i);
  mkdirSync(dir, { recursive: true });
  const images = await Promise.all((job.v.images ?? spec.images).map(png));
  let out;
  try { out = await gatewayImage({ text: job.text, images, size: PIN.gridSize, background: 'transparent', quality: spec.quality }); }
  catch (e) { (results[job.v.name] ??= []).push('grid ' + job.i + ' ERROR ' + String(e).slice(0, 100)); continue; }
  cents += gatewayCostCents(out.providerMetadata) ?? 0;
  writeFileSync(join(dir, 'grid.png'), out.bytes);
  const cells = cutGrid(await decodeToRgba(out.bytes));
  const rows = await Promise.all(cells.map(async (cell, k) => {
    if (!cell.tile) return 'd' + (k + 1) + ' no design';
    const design = await encodePng(cell.tile);
    writeFileSync(join(dir, 'design-' + (k + 1) + '.png'), design);
    const a = await checkImage({ model: PIN.checker, wordModel: PIN.wordReader, design, refs, asks: spec.asks, readWords: Boolean(spec.words) }).catch(() => null);
    if (!a) return 'd' + (k + 1) + ' checker failed';
    cents += a.costCents ?? 0;
    const misses = spec.asks.filter((q) => a.answers[q.id] !== (q.expect ?? true)).map((q) => q.id);
    if (spec.words && !wordsMatch(a.words, spec.words).ok) misses.push('words ' + JSON.stringify(a.words));
    return 'd' + (k + 1) + ' ' + (misses.length ? 'MISS ' + misses.join(', ') : 'ok');
  }));
  (results[job.v.name] ??= []).push('grid ' + job.i + ': ' + rows.join(' | '));
} }));
for (const v of spec.variants) {
  const rows = results[v.name] ?? [];
  const designs = rows.flatMap((r) => r.split(' | '));
  const ok = designs.filter((d) => / ok$/.test(d)).length;
  const missCounts: Record<string, number> = {};
  for (const d of designs) for (const m of (d.split('MISS ')[1] ?? '').split(', ').filter(Boolean)) { const key = m.startsWith('words') ? 'words' : m; missCounts[key] = (missCounts[key] ?? 0) + 1; }
  console.log(v.name + ': ' + ok + ' of ' + designs.length + ' designs pass every check; misses ' + JSON.stringify(missCounts));
  for (const r of rows) console.log('   ' + r);
}
console.log('cost cents', cents.toFixed(2));
