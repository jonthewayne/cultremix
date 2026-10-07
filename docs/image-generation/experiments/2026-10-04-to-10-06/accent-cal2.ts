// mix-80-20's accent question asked the way the suite asks it: with style A and style B in view.
import { existsSync, readFileSync } from 'node:fs';
import sharp from 'sharp';
import { checkImage } from '../tests/image-e2e/judge';
import { fixturePath } from '../tests/image-e2e/fixtures';
const RUNS = '/Users/starborn/Projects/CultRemix/.tmp/image-e2e/runs/';
const png = async (id: string) => new Uint8Array(await sharp(readFileSync(fixturePath(id))).png().toBuffer());
const refs = [{ as: 'style A', bytes: await png('grow-slow') }, { as: 'style B', bytes: await png('pop-art') }];
// By eye: 1756 d1, d3, d4 show none of style B; everything else shows it (pink hair early on, lavender with cyan shading in 1915).
const truth = (run: string, d: number) => (run === '1756' ? (d === 2 ? null : false) : true);
const LEAD = { id: 'lead', ask: 'Does style A lead the design: its dense, finely detailed psychedelic illustration with mushrooms, swirls, and layered colored outlines?' };
const VARIANTS = [
  "Does the design also clearly show style B's look somewhere, such as Ben-Day halftone dots, neon pink, or lavender with cyan shading?",
  "Does any part of the design take style B's colors or shading, such as lavender or purple fur with cyan shadows, neon pink, or Ben-Day halftone dots?",
  "Is anything in the design colored or shaded the way style B is (lavender, cyan shadows, neon pink, or halftone dots), beyond what style A alone would give?",
];
const tally = VARIANTS.map(() => ({ right: 0, total: 0, wrong: [] as Array<string> }));
let cents = 0;
const tasks: Array<() => Promise<void>> = [];
for (const run of ['0813', '0825', '0853', '0919', '1756', '1915']) for (let d = 1; d <= 4; d++) {
  const f = RUNS + '20261005-' + run + '-gpt-image-2.5/mix-80-20/design-' + d + '.png';
  const want = truth(run, d);
  if (!existsSync(f) || want === null) continue;
  VARIANTS.forEach((ask, vi) => { for (let t = 0; t < 2; t++) tasks.push(async () => {
    const a = await checkImage({ model: 'openai/gpt-6-luna', wordModel: '', design: new Uint8Array(readFileSync(f)), refs, asks: [LEAD, { id: 'accent', ask }], readWords: false }).catch(() => null);
    cents += a?.costCents ?? 0;
    tally[vi].total++;
    if (a?.answers.accent === want) tally[vi].right++; else tally[vi].wrong.push(run + ' d' + d + '=' + a?.answers.accent);
  }); });
}
let next = 0;
await Promise.all(Array.from({ length: 10 }, async () => { while (next < tasks.length) await tasks[next++](); }));
VARIANTS.forEach((q, i) => console.log(tally[i].right + '/' + tally[i].total, q, tally[i].wrong.length ? 'WRONG: ' + tally[i].wrong.join(', ') : ''));
console.log('cost cents', cents.toFixed(2));
