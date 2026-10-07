// Mix B: which style each design is mostly in, and whether the raccoon is clearly lavender, for the figure-note variants
// (their own run asked other questions) and luna-parts, with the same checker and style images.
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { checkImage } from '../tests/image-e2e/judge';
import { fixturePath } from '../tests/image-e2e/fixtures';
import { PIN } from '../tests/image-e2e/pin';
const OUT = '/Users/starborn/Projects/CultRemix/.tmp/blend/B/';
const images = await Promise.all(['pop-art', 'grow-slow', 'poster-70s'].map(async (id) => new Uint8Array(await sharp(readFileSync(fixturePath(id))).png().toBuffer())));
const refs = images.map((bytes, i) => ({ as: 'style ' + 'ABC'[i], bytes }));
const asks = [
  { id: 'domA', ask: 'Is this design mostly in the look of style A (more than of style B or style C)?' },
  { id: 'domB', ask: 'Is this design mostly in the look of style B (more than of style A or style C)?' },
  { id: 'lav', ask: "Is the raccoon's fur clearly lavender or purple? Answer no if the fur is gray, brown, or black and white with at most a faint purple tint." },
];
let cents = 0;
const lines: Array<string> = [];
for (const v of ['luna-parts', 'fig-framed', 'fig-notes']) {
  const dir = join(OUT, v);
  const files = readdirSync(dir).filter((d) => d.startsWith('grid-')).flatMap((g) => [1, 2, 3, 4].map((i) => join(dir, g, 'design-' + i + '.png'))).filter((f) => existsSync(f));
  const answers = await Promise.all(files.map(async (f) => {
    const a = await checkImage({ model: PIN.checker, wordModel: '', design: new Uint8Array(readFileSync(f)), refs, asks, readWords: false }).catch(() => null);
    cents += a?.costCents ?? 0;
    return a?.answers ?? {};
  }));
  const n = (id: string) => answers.filter((a) => a[id] === true).length;
  lines.push(v.padEnd(11) + ' designs ' + answers.length + ' | mostly pop-art (the 50% lead) ' + n('domA') + ' | mostly GROW SLOW (30%) ' + n('domB') + ' | clearly lavender raccoon ' + n('lav'));
}
writeFileSync(OUT + 'dominance.txt', lines.join('\n') + '\n');
console.log(lines.join('\n'));
console.log('cents', cents.toFixed(2));
