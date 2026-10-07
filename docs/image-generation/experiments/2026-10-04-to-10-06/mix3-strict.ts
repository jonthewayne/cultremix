// Asks the same concrete questions of every saved three-style mix (the model deciding vs written parts,
// at high and medium quality), with a stricter color question: a faint purple cast on gray fur does not count.
// All prompts list the pop-art style's lavender skin among its traits, so lavender fur is a fair marker.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { checkImage } from '../tests/image-e2e/judge';
const RUNS = '/Users/starborn/Projects/CultRemix/.tmp/image-e2e/runs/';
const L = '/Users/starborn/Projects/CultRemix/.tmp/limits/';
const grids = (dir: string) => ['grid-1', 'grid-2'].flatMap((g) => [1, 2, 3, 4].map((i) => dir + '/' + g + '/design-' + i + '.png'));
const runs = (names: Array<string>) => names.flatMap((r) => [1, 2, 3, 4].map((i) => RUNS + r + '-gpt-image-2.5/mix-three/design-' + i + '.png'));
const sets: Array<[string, Array<string>]> = [
  ['high, model decides (6 suite runs)', runs(['20261005-0813', '20261005-0825', '20261005-0853', '20261005-0919', '20261005-1756', '20261005-1934'])],
  ['high, written parts (2 grids + 2 suite runs)', [...grids(L + 'mix-three-high/zones2'), ...runs(['20261006-0350', '20261006-0423'])]],
  ['medium, model decides', grids(L + 'mix-three/control')],
  ['medium, model decides + all three in every design', grids(L + 'mix-three/every-design')],
  ['medium, written parts', grids(L + 'mix-three/zones')],
];
const asks = [
  { id: 'b', ask: 'Is the raccoon\'s fur clearly lavender or purple? Answer no if the fur is gray, brown, or black and white with at most a faint purple tint.' },
  { id: 'c', ask: 'Is there a 1970s-style landscape or sky in the design, such as mountains, a lake, pine trees, or a big sun with rays or wavy bands?' },
  { id: 'p', ask: 'Does the design show a woman or any other person?' },
];
let cents = 0;
const lines: Array<string> = [];
const summary: Array<string> = [];
for (const [name, all] of sets) {
  const files = all.filter((f) => existsSync(f));
  const rows: Array<{ f: string; b?: boolean | null; c?: boolean | null; p?: boolean | null }> = [];
  for (let i = 0; i < files.length; i += 8) {
    rows.push(...(await Promise.all(files.slice(i, i + 8).map(async (f) => {
      const a = await checkImage({ model: 'openai/gpt-6-luna', wordModel: '', design: new Uint8Array(readFileSync(f)), refs: [], asks, readWords: false }).catch(() => null);
      cents += a?.costCents ?? 0;
      return { f: f.replace(RUNS, '').replace(L, '').replace('-gpt-image-2.5', ''), b: a?.answers.b, c: a?.answers.c, p: a?.answers.p };
    }))));
  }
  lines.push('== ' + name, ...rows.map((r) => r.f + ' lavender=' + r.b + ' scene=' + r.c + ' person=' + r.p));
  const n = rows.length;
  const count = (test: (r: (typeof rows)[number]) => boolean) => rows.filter(test).length + '/' + n;
  summary.push(name + ': clearly lavender ' + count((r) => r.b === true) + ', 70s scene ' + count((r) => r.c === true) + ', a person ' + count((r) => r.p === true) + ', all three styles and no person ' + count((r) => r.b === true && r.c === true && r.p !== true));
}
writeFileSync('/Users/starborn/Projects/CultRemix/.tmp/limits/mix-three-strict.txt', lines.join('\n') + '\n\n' + summary.join('\n') + '\n');
console.log(lines.join('\n'));
console.log(summary.join('\n'));
console.log('cost cents', cents.toFixed(2));
