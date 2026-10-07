// Rebuilds the Santa test batch's prompt with the current part wording and generates grids at a chosen quality.
// usage: bun .tmp/santa-exp.ts <label> <grids> <quality>
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { gatewayImage } from '../convex/lib/imageCalls';
import { studioPrompt } from '../convex/lib/prompts';
import { partChangeInstruction } from '../convex/lib/remixParts';
import type { RemixPart, PartChange } from '../convex/lib/remixParts';
import { cutGrid } from '../convex/lib/gridCut';
import { decodeToRgba, encodePng } from '../convex/lib/resize';
const [label = 'v2', gridsArg = '2', quality = 'medium'] = process.argv.slice(2);
const OUT = '/Users/starborn/Projects/CultRemix/.tmp/santa/' + label + '/';
mkdirSync(OUT, { recursive: true });
const job = JSON.parse(readFileSync('/Users/starborn/Projects/CultRemix/.tmp/santa/job1.json', 'utf8'));
const R2 = 'https://pub-9fa5537465754fb5a384ad1a5109a04f.r2.dev/';
const parts: Array<RemixPart> = [
  { id: 'p1', kind: 'person', label: 'Santa', text: 'Santa in his red suit', on: true, empty: 'keep' },
  { id: 'p2', kind: 'person', label: 'Mrs. Claus', text: 'Mrs. Claus in red', on: true, empty: 'keep' },
  { id: 'p3', kind: 'group', label: 'Elves', text: 'elves in green outfits', on: true, count: 3, max: 6 },
];
const ph = (n: number) => ({ imageId: 'x' + n, key: 'k' + n });
const changes: Array<PartChange> = [
  { partId: 'p1', kind: 'person', label: 'Santa', from: '', photos: [ph(2)] },
  { partId: 'p2', kind: 'person', label: 'Mrs. Claus', from: '', photos: [ph(3)] },
  { partId: 'p3', kind: 'group', label: 'Elves', from: '', photos: [ph(4), ph(5), ph(6), ph(7)] },
];
const partChanges = partChangeInstruction(parts, changes, new Map([['p1', [2]], ['p2', [3]], ['p3', [4, 5, 6, 7]]]));
const text = studioPrompt({ layout: 'grid', instruction: job.instruction, attachments: job.attachments, styles: job.styles, remix: job.remixOfParent, roles: job.attachments.filter((a: { styleOnly: boolean }) => !a.styleOnly).map(() => 'content'), wordChanges: job.wordChanges, partChanges });
writeFileSync(OUT + 'prompt.txt', text);
const images = await Promise.all(job.attachments.map(async (a: { key: string }) => new Uint8Array(await (await fetch(R2 + a.key)).arrayBuffer())));
let cents = 0;
await Promise.all(Array.from({ length: Number(gridsArg) }, async (_, g) => {
  const t0 = Date.now();
  const out = await gatewayImage({ text, images, size: '1920x1920', background: 'transparent', quality });
  const c = Number(JSON.stringify(out.providerMetadata).match(/"cost":"?([0-9.]+)/)?.[1] ?? 0) * 100; cents += c;
  writeFileSync(OUT + 'grid-' + (g + 1) + '.png', out.bytes);
  const cells = cutGrid(await decodeToRgba(out.bytes));
  for (const cell of cells) if (cell.tile) writeFileSync(OUT + 'grid-' + (g + 1) + '-design-' + (cell.index + 1) + '.png', await encodePng(cell.tile));
  console.log('grid', g + 1, ((Date.now() - t0) / 1000).toFixed(0) + 's', c.toFixed(1) + 'c', cells.map((c) => c.tile ? 'ok' : c.reason).join(' '));
}));
console.log('total cents', cents.toFixed(1));
