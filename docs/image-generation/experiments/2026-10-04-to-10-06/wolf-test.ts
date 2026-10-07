// Jon's example end to end: a published pencil-sketch lion with words, remixed with 'Change the lion to a wolf'.
// Builds the prompt with production's code (notes, request reader, studioPrompt), makes the grid, cuts it, and
// runs the production remix comparison on each design.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { batchPrompt } from '../convex/lib/batchPrompt';
import { cutGrid } from '../convex/lib/gridCut';
import { gatewayImage } from '../convex/lib/imageCalls';
import { writeNotes } from '../convex/lib/notesWriter';
import { gatewayCostCents } from '../convex/lib/pricing';
import { compareRemix } from '../convex/lib/remixCompare';
import { decodeToRgba, encodePng } from '../convex/lib/resize';
import { checkImage, wordsMatch } from '../tests/image-e2e/judge';
import { PIN } from '../tests/image-e2e/pin';
const OUT = '/Users/starborn/Projects/CultRemix/.tmp/limits/wolf';
mkdirSync(OUT, { recursive: true });
const art = new Uint8Array(readFileSync('/Users/starborn/Projects/CultRemix/.tmp/limits/lion-sketch.png'));
let cents = 0;
const notes = await writeNotes(art, PIN.vision);
if (!notes.ok) throw new Error('notes failed');
writeFileSync(join(OUT, 'notes.txt'), 'Summary: ' + notes.summary + '\nKind: ' + notes.kind + '\n\n' + notes.notes);
const request = process.argv[2] ?? 'Change the lion to a wolf';
const prompt = await batchPrompt({ instruction: request, presets: [], attachments: [{ analysis: 'ready', summary: notes.summary, kind: notes.kind, notes: notes.notes, styleOnly: false }], styles: [], remixOfParent: true });
writeFileSync(join(OUT, 'prompt.txt'), prompt.text);
console.log('roles', prompt.roles.join('/'), 'chars', prompt.text.length);
const out = await gatewayImage({ text: prompt.text, images: [art], size: PIN.gridSize, background: 'transparent', quality: process.argv[3] ?? 'medium' });
cents += gatewayCostCents(out.providerMetadata) ?? 0;
writeFileSync(join(OUT, 'grid.png'), out.bytes);
const cells = cutGrid(await decodeToRgba(out.bytes));
const rows = await Promise.all(cells.map(async (cell, k) => {
  if (!cell.tile) return 'd' + (k + 1) + ' no design';
  const design = await encodePng(cell.tile);
  writeFileSync(join(OUT, 'design-' + (k + 1) + '.png'), design);
  const [verdict, check] = await Promise.all([
    compareRemix(art, design).catch((e) => ({ verdict: 'error', reason: String(e).slice(0, 80), subject: '', layout: '', style: '', costCents: 0 })),
    checkImage({ model: PIN.checker, wordModel: PIN.wordReader, design, refs: [], asks: [{ id: 'wolf', ask: 'Does the design show a wolf?' }, { id: 'pencil', ask: 'Is it drawn as a pencil sketch, with graphite shading and visible construction lines?' }], readWords: true }),
  ]);
  cents += (verdict.costCents ?? 0) + (check.costCents ?? 0);
  const words = wordsMatch(check.words, { has: ['WILD', 'AT', 'HEART'] }).ok ? 'words ok' : 'words ' + JSON.stringify(check.words);
  return 'd' + (k + 1) + ': ' + verdict.verdict + ' (s=' + verdict.subject + ' l=' + verdict.layout + ' st=' + verdict.style + ') wolf=' + check.answers.wolf + ' pencil=' + check.answers.pencil + ' ' + words + ' | ' + verdict.reason;
}));
for (const r of rows) console.log(r);
console.log('cost cents', cents.toFixed(2));
