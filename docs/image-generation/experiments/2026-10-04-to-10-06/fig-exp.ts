// Lead-style figure leak: when the pop-art portrait leads a mix, its Figure drawing notes describe 'the woman' and the
// prompt states them as a requirement, and the woman gets drawn. Variants on mix B's luna-parts prompt (control: its 3 grids):
// framed (the figure line says it's a way of drawing, never image 1's own person) and notes (figure notes rewritten in general terms).
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { gateway } from '@ai-sdk/gateway';
import { generateText } from 'ai';
import { cutGrid } from '../convex/lib/gridCut';
import { gatewayImage } from '../convex/lib/imageCalls';
import { gatewayCostCents } from '../convex/lib/pricing';
import { STYLE_NOTES_PROMPT, noteSections } from '../convex/lib/prompts';
import { onGray } from '../convex/lib/notesWriter';
import { decodeToRgba, encodePng } from '../convex/lib/resize';
import { checkImage, wordsMatch } from '../tests/image-e2e/judge';
import { fixturePath } from '../tests/image-e2e/fixtures';
import { PIN } from '../tests/image-e2e/pin';
const OUT = '/Users/starborn/Projects/CultRemix/.tmp/blend/B/';
const base = readFileSync(OUT + 'luna-parts/prompt.txt', 'utf8');
const FIG = 'Figure drawing, required for every person and animal, head to toe: ';
if (base.split(FIG).length !== 2) throw new Error('figure line not found');
const figLine = base.split('\n').find((l) => l.startsWith(FIG))!;
const oldFigure = figLine.slice(FIG.length).split(' Draw people and animals from photos this way too')[0];
export const NEW_FIG_RULE = 'Write it as a way of drawing that carries to any figure ("heads are large against narrow shoulders"), never about who this image shows ("the woman", "her") or how this picture crops or poses them.';
let cents = 0;
async function generalFigure() {
  const file = OUT + 'fig-notes-figure.txt';
  if (existsSync(file)) return readFileSync(file, 'utf8');
  const system = STYLE_NOTES_PROMPT.replace('Figure drawing: how this image draws people and animals from head to toe, compared with real anatomy.', 'Figure drawing: how this image draws people and animals from head to toe, compared with real anatomy. ' + NEW_FIG_RULE);
  if (system === STYLE_NOTES_PROMPT) throw new Error('notes prompt anchor not found');
  const { bytes } = onGray(new Uint8Array(await sharp(readFileSync(fixturePath('pop-art'))).png().toBuffer()));
  const result = await generateText({ model: gateway(PIN.vision), system, messages: [{ role: 'user', content: [{ type: 'text', text: 'Write the notes for this image.' }, { type: 'file', mediaType: 'image/png', data: bytes }] }], providerOptions: { openai: { reasoningEffort: 'low' } } });
  cents += gatewayCostCents(result.providerMetadata) ?? 0;
  const section = noteSections(result.text).find((s) => s.name === 'Figure drawing')?.text ?? '';
  const figure = section.split(/\n?\s*Hair:/u)[0].replace(/\s+/gu, ' ').trim();
  writeFileSync(file, figure);
  return figure;
}
const general = await generalFigure();
console.log('old figure:', oldFigure.slice(0, 200));
console.log('new figure:', general.slice(0, 300));
const variants: Record<string, string> = {
  framed: base.replace(FIG, 'Figure drawing, required for every person and animal the design shows, head to toe (how image 1 draws figures, as a way of drawing: never draw image 1\'s own person, and never copy its pose or cropping): '),
  notes: base.split(oldFigure).join(general),
};
if (variants.notes === base) throw new Error('notes swap failed');
const asks = [
  { id: 'lead', ask: 'Is the raccoon drawn in a pop-art comic style, with heavy black outlines, flat saturated colors, and hard-edged shading, like style A?' },
  { id: 'letters', ask: 'Are the words TRASH ROYALTY drawn as warped, inflated psychedelic letters with several layered colored outlines (such as cream, orange, yellow, and green), like style B?' },
  { id: 'scene', ask: 'Is there a 1970s-style landscape or sky in the design, such as mountains, a lake, pine trees, or a big sun with rays or wavy bands?' },
  { id: 'person', ask: 'Does the design show a woman or any other person?' },
];
const images = await Promise.all(['pop-art', 'grow-slow', 'poster-70s'].map(async (id) => new Uint8Array(await sharp(readFileSync(fixturePath(id))).png().toBuffer())));
const refs = images.map((bytes, i) => ({ as: 'style ' + 'ABC'[i], bytes }));
const jobs: Array<{ v: string; g: number }> = [];
for (const v of Object.keys(variants)) { mkdirSync(join(OUT, 'fig-' + v), { recursive: true }); writeFileSync(join(OUT, 'fig-' + v, 'prompt.txt'), variants[v]); for (let g = 1; g <= 3; g++) jobs.push({ v, g }); }
let next = 0;
await Promise.all(Array.from({ length: 3 }, async () => { while (next < jobs.length) { const job = jobs[next++];
  const dir = join(OUT, 'fig-' + job.v, 'grid-' + job.g); mkdirSync(dir, { recursive: true });
  let out;
  try { out = await gatewayImage({ text: variants[job.v], images, size: PIN.gridSize, background: 'transparent', quality: 'medium' }); } catch (e) { console.log(job.v, job.g, 'ERROR', String(e).slice(0, 100)); continue; }
  cents += gatewayCostCents(out.providerMetadata) ?? 0;
  writeFileSync(join(dir, 'grid.png'), out.bytes);
  const cells = cutGrid(await decodeToRgba(out.bytes));
  const answers = await Promise.all(cells.map(async (cell) => {
    if (!cell.tile) return { index: cell.index, missing: cell.reason };
    const design = await encodePng(cell.tile);
    writeFileSync(join(dir, 'design-' + (cell.index + 1) + '.png'), design);
    const a = await checkImage({ model: PIN.checker, wordModel: PIN.wordReader, design, refs, asks, readWords: true }).catch(() => null);
    cents += a?.costCents ?? 0;
    return { index: cell.index, answers: a?.answers, spelled: a ? wordsMatch(a.words, { has: ['TRASH', 'ROYALTY'] }).ok : null };
  }));
  writeFileSync(join(dir, 'answers.json'), JSON.stringify(answers, null, 1));
  console.log(job.v, job.g, answers.map((a) => a.answers ? Object.entries(a.answers).filter(([, x]) => x).map(([k]) => k).join('+') : a.missing).join(' | '));
} }));
console.log('cents', cents.toFixed(1));
