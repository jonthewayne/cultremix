// Prints the checker's answers to concrete mix-three questions on saved designs, to compare with the boards by eye.
import { existsSync, readFileSync } from 'node:fs';
import { checkImage } from '../tests/image-e2e/judge';
const RUNS = '/Users/starborn/Projects/CultRemix/.tmp/image-e2e/runs/';
const L = '/Users/starborn/Projects/CultRemix/.tmp/limits/';
const sets: Array<[string, Array<string>]> = [
  ['zones-high', ['mix-three-high/zones2/grid-1', 'mix-three-high/zones2/grid-2'].flatMap((g) => [1, 2, 3, 4].map((i) => L + g + '/design-' + i + '.png'))],
  ['zones-med', ['mix-three/zones/grid-1', 'mix-three/zones/grid-2'].flatMap((g) => [1, 2, 3, 4].map((i) => L + g + '/design-' + i + '.png'))],
  ['history', ['20261005-0853', '20261005-0919', '20261005-1756', '20261005-1934'].flatMap((r) => [1, 2, 3, 4].map((i) => RUNS + r + '-gpt-image-2.5/mix-three/design-' + i + '.png'))],
];
const asks = [
  { id: 'b', ask: 'Is the raccoon\'s fur lavender or purple?' },
  { id: 'c', ask: 'Is there a 1970s-style landscape or sky in the design, such as mountains, a lake, pine trees, or a big sun with rays or wavy bands?' },
  { id: 'p', ask: 'Does the design show a woman or any other person?' },
];
let cents = 0;
for (const [name, files] of sets) {
  const rows = await Promise.all(files.filter((f) => existsSync(f)).map(async (f) => {
    const a = await checkImage({ model: 'openai/gpt-6-luna', wordModel: '', design: new Uint8Array(readFileSync(f)), refs: [], asks, readWords: false }).catch(() => null);
    cents += a?.costCents ?? 0;
    return f.split('/').slice(-3).join('/').replace('-gpt-image-2.5', '') + ' b=' + a?.answers.b + ' c=' + a?.answers.c + ' p=' + a?.answers.p;
  }));
  console.log('== ' + name + '\n' + rows.join('\n'));
}
console.log('cost cents', cents.toFixed(2));
