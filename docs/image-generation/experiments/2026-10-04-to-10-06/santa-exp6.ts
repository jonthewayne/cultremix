// Variant of santa-exp: Santa kept, Mrs. Claus left out, six elves from photos (needs .tmp/santa/job1.json and the family photos as images 2-7).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { gatewayImage } from '../convex/lib/imageCalls';
import { studioPrompt } from '../convex/lib/prompts';
import { partChangeInstruction } from '../convex/lib/remixParts';
import type { RemixPart, PartChange } from '../convex/lib/remixParts';
import { cutGrid } from '../convex/lib/gridCut';
import { decodeToRgba, encodePng } from '../convex/lib/resize';
const OUT = '/Users/starborn/Projects/CultRemix/.tmp/santa/v3/';
mkdirSync(OUT, { recursive: true });
const job = JSON.parse(readFileSync('/Users/starborn/Projects/CultRemix/.tmp/santa/job1.json', 'utf8'));
const R2 = 'https://pub-9fa5537465754fb5a384ad1a5109a04f.r2.dev/';
const parts: Array<RemixPart> = [
  { id: 'p1', kind: 'person', label: 'Santa', text: 'Santa in his red suit', on: true, empty: 'keep' },
  { id: 'p2', kind: 'person', label: 'Mrs. Claus', text: 'Mrs. Claus in red', on: true, empty: 'omit' },
  { id: 'p3', kind: 'group', label: 'Elves', text: 'elves in green outfits', on: true, count: 3, max: 6 },
];
const ph = (n: number) => ({ imageId: 'x' + n, key: 'k' + n });
// Attachments: design, then the six family photos all for the elves (dad and mom as elves too).
const attachments = [job.attachments[0], ...job.attachments.slice(1).map((a: object) => ({ ...a, partFor: 'Elves' }))];
const changes: Array<PartChange> = [
  { partId: 'p3', kind: 'group', label: 'Elves', from: '', photos: [2, 3, 4, 5, 6, 7].map(ph) },
  { partId: 'p2', kind: 'person', label: 'Mrs. Claus', from: '', photos: [], omit: true },
];
const partChanges = partChangeInstruction(parts, changes, new Map([['p3', [2, 3, 4, 5, 6, 7]]]));
const text = studioPrompt({ layout: 'grid', instruction: '', attachments, styles: [], remix: true, roles: attachments.map(() => 'content'), partChanges });
writeFileSync(OUT + 'prompt.txt', text);
const images = await Promise.all(attachments.map(async (a: { key: string }) => new Uint8Array(await (await fetch(R2 + a.key)).arrayBuffer())));
let cents = 0;
await Promise.all([1, 2].map(async (g) => {
  const t0 = Date.now();
  const out = await gatewayImage({ text, images, size: '1920x1920', background: 'transparent', quality: 'medium' });
  const c = Number(JSON.stringify(out.providerMetadata).match(/"cost":"?([0-9.]+)/)?.[1] ?? 0) * 100; cents += c;
  writeFileSync(OUT + 'grid-' + g + '.png', out.bytes);
  const cells = cutGrid(await decodeToRgba(out.bytes));
  for (const cell of cells) if (cell.tile) writeFileSync(OUT + 'grid-' + g + '-design-' + (cell.index + 1) + '.png', await encodePng(cell.tile));
  console.log('grid', g, ((Date.now() - t0) / 1000).toFixed(0) + 's', c.toFixed(1) + 'c', cells.map((c) => c.tile ? 'ok' : c.reason).join(' '));
}));
console.log('total cents', cents.toFixed(1));
