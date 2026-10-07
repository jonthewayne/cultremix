// Signature traits written by the notes prompt, several times per style image.
import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import { writeNotes } from '../convex/lib/notesWriter';
import { signatureTraits } from '../convex/lib/prompts';
import { fixturePath } from '../tests/image-e2e/fixtures';
const ids = (process.argv[2] ?? 'pop-art,poster-70s,cartoon-boys,lion,grow-slow').split(',');
const trials = Number(process.argv[3] ?? 3);
const png = async (id: string) => new Uint8Array(await sharp(readFileSync(fixturePath(id))).png().toBuffer());
const rows: Array<string> = [];
const tasks = ids.flatMap((id) => Array.from({ length: trials }, (_, t) => async () => {
  const r = await writeNotes(await png(id), 'openai/gpt-6-luna');
  rows.push(id + ' #' + (t + 1) + ': ' + (r.ok ? signatureTraits(r.notes).join(' | ') : 'FAILED'));
}));
let next = 0;
await Promise.all(Array.from({ length: 8 }, async () => { while (next < tasks.length) await tasks[next++](); }));
for (const row of rows.sort()) console.log(row);
