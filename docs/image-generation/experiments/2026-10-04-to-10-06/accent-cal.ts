// mix-80-20 checks on every saved design: the 20% pop-art style shows (accent), and its subject's hair doesn't (hair).
import { existsSync, readFileSync } from 'node:fs';
import { checkImage } from '../tests/image-e2e/judge';
const RUNS = '/Users/starborn/Projects/CultRemix/.tmp/image-e2e/runs/';
const runs = ['0813', '0825', '0853', '0919', '1756', '1915'];
// Truth by eye: early runs gave raccoons long pink hair; 1756 d1, d3, d4 show no pop-art; 1915 are lavender with cyan shading.
const truth = (run: string, d: number) => ({
  accent: run === '1756' ? (d === 2 ? null : false) : true,
  hair: ['0813', '0825', '0853', '0919'].includes(run),
});
const ACCENT = [
  "Does the design also clearly show style B's look somewhere, such as Ben-Day halftone dots, neon pink, or lavender with cyan shading?",
  'Does the design clearly show pop-art colors or technique somewhere, such as lavender or purple fur, cyan shading, neon pink, or Ben-Day halftone dots?',
];
const HAIR = [
  "Does the raccoon have long flowing hair, like a person's?",
  'Does the raccoon have long hair, like a wig or a person’s hair, beyond its own fur?',
];
const tally: Record<string, { right: number; total: number; wrong: Array<string> }> = {};
let cents = 0;
const tasks: Array<() => Promise<void>> = [];
for (const run of runs) for (let d = 1; d <= 4; d++) {
  const f = RUNS + '20261005-' + run + '-gpt-image-2.5/mix-80-20/design-' + d + '.png';
  if (!existsSync(f)) continue;
  for (let t = 0; t < 2; t++) tasks.push(async () => {
    const asks = [...ACCENT.map((ask, i) => ({ id: 'a' + i, ask })), ...HAIR.map((ask, i) => ({ id: 'h' + i, ask }))];
    const a = await checkImage({ model: 'openai/gpt-6-luna', wordModel: '', design: new Uint8Array(readFileSync(f)), refs: [], asks, readWords: false }).catch(() => null);
    cents += a?.costCents ?? 0;
    const want = truth(run, d);
    for (const ask of asks) {
      const expected = ask.id.startsWith('a') ? want.accent : want.hair;
      if (expected === null) continue;
      tally[ask.id] ??= { right: 0, total: 0, wrong: [] };
      tally[ask.id].total++;
      if (a?.answers[ask.id] === expected) tally[ask.id].right++; else tally[ask.id].wrong.push(run + ' d' + d + '=' + a?.answers[ask.id]);
    }
  });
}
let next = 0;
await Promise.all(Array.from({ length: 8 }, async () => { while (next < tasks.length) await tasks[next++](); }));
for (const [id, v] of Object.entries(tally).sort()) console.log(id, v.right + '/' + v.total, (id.startsWith('a') ? ACCENT : HAIR)[Number(id.slice(1))], v.wrong.length ? 'WRONG: ' + v.wrong.join(', ') : '');
console.log('cost cents', cents.toFixed(2));
