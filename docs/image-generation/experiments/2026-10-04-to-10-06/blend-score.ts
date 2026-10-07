// Scores .tmp/blend: for each mix and variant, how many designs show every style, copy a person, and spell the words;
// for range, whether each corner leans on its assigned style. Writes .tmp/blend/scores.txt.
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const OUT = '/Users/starborn/Projects/CultRemix/.tmp/blend/';
type Row = { index: number; answers?: Record<string, boolean | null>; spelled?: boolean | null; missing?: string };
const lines: Array<string> = [];
for (const mix of ['A', 'B']) {
  for (const v of ['rank', 'luna-parts', 'luna-blend', 'range']) {
    const dir = join(OUT, mix, v);
    if (!existsSync(dir)) continue;
    const rows: Array<Row> = readdirSync(dir).filter((d) => d.startsWith('grid-') && existsSync(join(dir, d, 'answers.json'))).flatMap((d) => JSON.parse(readFileSync(join(dir, d, 'answers.json'), 'utf8')) as Array<Row>);
    const got = rows.filter((r) => r.answers);
    const n = rows.length;
    const yes = (id: string) => got.filter((r) => r.answers![id] === true).length;
    const styled = mix === 'A' ? (r: Row) => r.answers!.lead === true && r.answers!.popart === true && r.answers!.scene === true : (r: Row) => r.answers!.lead === true && r.answers!.letters === true && r.answers!.scene === true;
    const all = got.filter((r) => styled(r) && r.answers!.person !== true).length;
    const detail = mix === 'A' ? 'psychedelic letters ' + yes('lead') + ', lavender raccoon ' + yes('popart') : 'pop-art raccoon ' + yes('lead') + ', psychedelic letters ' + yes('letters');
    let line = mix + ' ' + v.padEnd(10) + ' designs ' + n + ': all three styles and no person ' + all + '/' + n + ' (' + detail + ', 70s scene ' + yes('scene') + ', person ' + yes('person') + ', spelled ' + got.filter((r) => r.spelled).length + ')';
    if (v === 'range') {
      const lean = ['domA', 'domB', 'domC'];
      const hits = got.filter((r) => r.index < 3 && r.answers![lean[r.index]] === true).length;
      const corners = got.filter((r) => r.index < 3).length;
      line += '; corners leaning on their style ' + hits + '/' + corners;
    }
    lines.push(line);
  }
}
writeFileSync(join(OUT, 'scores.txt'), lines.join('\n') + '\n');
console.log(lines.join('\n'));
