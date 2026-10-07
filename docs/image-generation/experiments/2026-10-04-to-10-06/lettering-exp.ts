// Mix B: a style placed on the lettering is described by its Lettering notes alone (its line and its style definition),
// so its whole-drawing traits don't take over. Same prompt as fig-notes otherwise; same questions.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { cutGrid } from '../convex/lib/gridCut';
import { gatewayImage } from '../convex/lib/imageCalls';
import { gatewayCostCents } from '../convex/lib/pricing';
import { noteSections } from '../convex/lib/prompts';
import { decodeToRgba, encodePng } from '../convex/lib/resize';
import { checkImage, wordsMatch } from '../tests/image-e2e/judge';
import { fixturePath } from '../tests/image-e2e/fixtures';
import { PIN } from '../tests/image-e2e/pin';
const OUT = '/Users/starborn/Projects/CultRemix/.tmp/blend/B/';
const base = readFileSync(OUT + 'fig-notes/prompt.txt', 'utf8');
const notes = readFileSync('/Users/starborn/Projects/CultRemix/.tmp/image-e2e/runs/20261006-0423-gpt-image-2.5/notes/grow-slow.txt', 'utf8').split('\n').slice(3).join('\n');
const lettering = noteSections(notes).find((s) => s.name === 'Lettering')!.text.replace(/\s+/gu, ' ').trim();
const line = /(- Image 2 \(30%\): in the lettering of every design \(its letterforms, outlines, colors, and effects\)), through these traits: [^\n]*/u;
if (!line.test(base)) throw new Error('image 2 line not found');
let text = base.replace(line, (_, head) => head + ', through its lettering only: ' + lettering + ' Everything else in the design (the subject, its line work, shading, and colors) follows the leading style.');
const defStart = text.indexOf('\nImage 2:\n');
const defEnd = text.indexOf('\n\nImage 3:\n', defStart);
if (defStart < 0 || defEnd < 0) throw new Error('definition not found');
text = text.slice(0, defStart) + '\nImage 2 (for the lettering only):\nLettering:\n' + lettering + text.slice(defEnd);
const dir0 = join(OUT, 'lettering-only'); mkdirSync(dir0, { recursive: true }); writeFileSync(join(dir0, 'prompt.txt'), text);
const images = await Promise.all(['pop-art', 'grow-slow', 'poster-70s'].map(async (id) => new Uint8Array(await sharp(readFileSync(fixturePath(id))).png().toBuffer())));
const refs = images.map((bytes, i) => ({ as: 'style ' + 'ABC'[i], bytes }));
const asks = [
  { id: 'domA', ask: 'Is this design mostly in the look of style A (more than of style B or style C)?' },
  { id: 'domB', ask: 'Is this design mostly in the look of style B (more than of style A or style C)?' },
  { id: 'lav', ask: "Is the raccoon's fur clearly lavender or purple? Answer no if the fur is gray, brown, or black and white with at most a faint purple tint." },
  { id: 'letters', ask: 'Are the words TRASH ROYALTY drawn as warped, inflated psychedelic letters with several layered colored outlines (such as cream, orange, yellow, and green), like style B?' },
  { id: 'scene', ask: 'Is there a 1970s-style landscape or sky in the design, such as mountains, a lake, pine trees, or a big sun with rays or wavy bands?' },
  { id: 'person', ask: 'Does the design show a woman or any other person?' },
];
let cents = 0;
const all: Array<Record<string, boolean | null>> = [];
await Promise.all([1, 2, 3].map(async (g) => {
  const dir = join(dir0, 'grid-' + g); mkdirSync(dir, { recursive: true });
  const out = await gatewayImage({ text, images, size: PIN.gridSize, background: 'transparent', quality: 'medium' });
  cents += gatewayCostCents(out.providerMetadata) ?? 0;
  writeFileSync(join(dir, 'grid.png'), out.bytes);
  const cells = cutGrid(await decodeToRgba(out.bytes));
  await Promise.all(cells.map(async (cell) => {
    if (!cell.tile) return;
    const design = await encodePng(cell.tile);
    writeFileSync(join(dir, 'design-' + (cell.index + 1) + '.png'), design);
    const a = await checkImage({ model: PIN.checker, wordModel: PIN.wordReader, design, refs, asks, readWords: true }).catch(() => null);
    cents += a?.costCents ?? 0;
    if (a) all.push({ ...a.answers, spelled: wordsMatch(a.words, { has: ['TRASH', 'ROYALTY'] }).ok });
  }));
}));
const n = (id: string) => all.filter((a) => a[id] === true).length;
const summary = 'lettering-only designs ' + all.length + ' | mostly pop-art (the 50% lead) ' + n('domA') + ' | mostly GROW SLOW ' + n('domB') + ' | lavender ' + n('lav') + ' | psychedelic letters ' + n('letters') + ' | 70s scene ' + n('scene') + ' | person ' + n('person') + ' | spelled ' + n('spelled');
writeFileSync(join(dir0, 'scores.txt'), summary + '\n');
console.log(summary);
console.log('cents', cents.toFixed(1));
