// Scores the three medium-quality mix-three variants (control, every-design, zones) with the same
// concrete questions as mix3-q.ts, so the wording comparison is like for like. Each variant is the
// same saved prompt with only the style-mix wording changed, two grids of four designs each.
import { existsSync, readFileSync } from 'node:fs';
import { checkImage } from '../tests/image-e2e/judge';
const L = '/Users/starborn/Projects/CultRemix/.tmp/limits/mix-three/';
const variants = ['control', 'every-design', 'zones'];
const asks = [
  { id: 'b', ask: 'Is the raccoon\'s fur lavender or purple?' },
  { id: 'c', ask: 'Is there a 1970s-style landscape or sky in the design, such as mountains, a lake, pine trees, or a big sun with rays or wavy bands?' },
  { id: 'p', ask: 'Does the design show a woman or any other person?' },
];
let cents = 0;
const summary: Array<string> = [];
for (const v of variants) {
  const files = ['grid-1', 'grid-2'].flatMap((g) => [1, 2, 3, 4].map((i) => L + v + '/' + g + '/design-' + i + '.png')).filter((f) => existsSync(f));
  const rows = await Promise.all(files.map(async (f) => {
    const a = await checkImage({ model: 'openai/gpt-6-luna', wordModel: '', design: new Uint8Array(readFileSync(f)), refs: [], asks, readWords: false }).catch(() => null);
    cents += a?.costCents ?? 0;
    return { f: f.split('/').slice(-2).join('/'), b: a?.answers.b, c: a?.answers.c, p: a?.answers.p };
  }));
  console.log('== ' + v + '\n' + rows.map((r) => r.f + ' b=' + r.b + ' c=' + r.c + ' p=' + r.p).join('\n'));
  const count = (k: 'b' | 'c' | 'p') => rows.filter((r) => r[k] === true).length;
  summary.push(v + ': lavender ' + count('b') + '/' + rows.length + ', 70s scene ' + count('c') + '/' + rows.length + ', person ' + count('p') + '/' + rows.length);
}
console.log(summary.join('\n'));
console.log('cost cents', cents.toFixed(2));
