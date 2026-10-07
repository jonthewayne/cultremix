// Calibrates a style-copy 'style' question without 'arched lettering', on saved wolves (all in the lion's style) and other designs.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import sharp from 'sharp';
import { checkImage } from '../tests/image-e2e/judge';
import { fixturePath } from '../tests/image-e2e/fixtures';
const RUNS = '/Users/starborn/Projects/CultRemix/.tmp/image-e2e/runs/';
const fx = async (id: string) => new Uint8Array(await sharp(readFileSync(fixturePath(id))).png().toBuffer());
const refs = [{ as: 'the style image', bytes: await fx('lion') }];
const QS = [
  'Is it drawn in the style of the style image: detailed engraved fur in gold, brown, and black, with arched lettering?',
  'Is it drawn in the style of the style image: detailed engraved fur strokes in gold, brown, and black with heavy black outlines and a distressed print texture?',
];
const wolves = readdirSync(RUNS).filter((d) => d.includes('mane-a') || d.startsWith('20261005-1934')).flatMap((d) => [1, 2, 3, 4].map((i) => RUNS + d + '/style-copy/design-' + i + '.png')).filter((f) => existsSync(f));
const items: Array<{ label: string; bytes: () => Promise<Uint8Array>; truth: boolean }> = [
  ...wolves.map((f) => ({ label: f.slice(RUNS.length + 9, RUNS.length + 22) + ' ' + f.slice(-5, -4), bytes: async () => new Uint8Array(readFileSync(f)), truth: true })),
  ...['grow-slow', 'trash-royalty', 'cartoon-boys', 'poster-70s', 'lion-sketch', 'wolf-sketch'].map((id) => ({ label: id, bytes: () => fx(id), truth: false })),
];
const tally = QS.map(() => ({ right: 0, total: 0, wrong: [] as Array<string> }));
let cents = 0;
const tasks = items.flatMap((item) => QS.map((ask, qi) => async () => {
  const a = await checkImage({ model: 'openai/gpt-6-luna', wordModel: '', design: await item.bytes(), refs, asks: [{ id: 'style', ask }], readWords: false }).catch(() => null);
  cents += a?.costCents ?? 0;
  tally[qi].total++;
  if (a?.answers.style === item.truth) tally[qi].right++; else tally[qi].wrong.push(item.label + '=' + a?.answers.style);
}));
let next = 0;
await Promise.all(Array.from({ length: 10 }, async () => { while (next < tasks.length) await tasks[next++](); }));
QS.forEach((q, i) => console.log(tally[i].right + '/' + tally[i].total, q, tally[i].wrong.length ? 'WRONG: ' + tally[i].wrong.join(', ') : ''));
console.log('cost cents', cents.toFixed(2));
