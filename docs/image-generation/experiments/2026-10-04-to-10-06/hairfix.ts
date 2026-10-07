// Reproduces the pink-hair leak with run 1934's exact prompt (its notes said 'hot pink hair'), with and without
// the new sentence, and checks each design's hair color.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { cutGrid } from '../convex/lib/gridCut';
import { gatewayImage } from '../convex/lib/imageCalls';
import { gatewayCostCents } from '../convex/lib/pricing';
import { decodeToRgba, encodePng } from '../convex/lib/resize';
import { checkImage } from '../tests/image-e2e/judge';
import { fixturePath } from '../tests/image-e2e/fixtures';
import { PIN } from '../tests/image-e2e/pin';
const BASE = '/Users/starborn/Projects/CultRemix/.tmp/image-e2e/runs/20261005-1934-gpt-image-2.5/photo-pop-art/prompt.txt';
const OUT = '/Users/starborn/Projects/CultRemix/.tmp/hairfix';
const original = readFileSync(BASE, 'utf8');
const anchor = 'and how big the head and ears are.';
if (!original.includes(anchor)) throw new Error('anchor missing');
const fixed = original.replace(anchor, anchor + ' Each person keeps their own hair color.');
const png = async (id: string) => new Uint8Array(await sharp(readFileSync(fixturePath(id))).png().toBuffer());
const images = [await png('person'), await png('pop-art')];
const variants = [['control', original], ['fixed-1', fixed], ['fixed-2', fixed]] as const;
let cents = 0;
await Promise.all(variants.map(async ([name, text]) => {
  const dir = join(OUT, name); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'prompt.txt'), text);
  const out = await gatewayImage({ text, images, size: PIN.gridSize, background: 'transparent', quality: PIN.gridQuality });
  cents += gatewayCostCents(out.providerMetadata) ?? 0;
  writeFileSync(join(dir, 'grid.png'), out.bytes);
  const cells = cutGrid(await decodeToRgba(out.bytes));
  const answers = await Promise.all(cells.map(async (cell, i) => {
    if (!cell.tile) return 'no design';
    const design = await encodePng(cell.tile);
    writeFileSync(join(dir, 'design-' + (i + 1) + '.png'), design);
    const a = await checkImage({ model: PIN.checker, wordModel: PIN.wordReader, design, refs: [], asks: [{ id: 'pink', ask: 'Is her hair pink?' }, { id: 'red', ask: 'Is her hair red, copper, or orange?' }], readWords: false });
    cents += a.costCents ?? 0;
    return 'pink=' + a.answers.pink + ' red=' + a.answers.red;
  }));
  console.log(name.padEnd(8), answers.join(' | '));
}));
console.log('cost cents', cents.toFixed(2));
