import { generateText } from 'ai';
import { gateway } from '@ai-sdk/gateway';
import sharp from 'sharp';
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';

// Scores each likeness-test design: bun --env-file=... judge.ts
const O = '/Users/starborn/cultremix-imagecheck/out/';
const small = async (f: string) => sharp(readFileSync(f)).flatten({ background: '#f4f1ea' }).resize(768, 768, { fit: 'inside' }).png().toBuffer();
const photo = await small(O + 'person.png');
const refs: Record<string, Buffer> = { '70s': await small(O + 'style70s.png'), pop: await small(O + 'stylePop.png') };
const SYSTEM = 'You judge illustrations. Image 1 is a photo of a real person. Image 2 is a style reference. Image 3 is a t-shirt design meant to show the person from image 1 drawn in the style of image 2. Look closely and answer with JSON only: ' +
  '{"likeness": 1-10 (would a friend instantly recognize the person from image 1? weigh face, hair shape and color, glasses, smile, gap tooth, freckles, earrings, clothing), ' +
  '"style": 1-10 (how fully image 3 is drawn the way image 2 draws things: technique, palette, line work, texture, and how it draws faces and bodies), ' +
  '"face": "style" | "between" | "photo" (are the face proportions image 2\'s way of drawing faces, or image 1\'s real proportions?), ' +
  '"hair": "photo color" | "style color" | "other", "freckles": "photo-like" | "style-like" | "none", "skin": "photo tone" | "style palette", ' +
  '"note": "one short sentence"}';
const jobs: Array<[string, string, number]> = [];
for (const s of ['70s', 'pop']) for (const w of ['current', 'broad', 'traits', 'nofacerule']) for (let i = 1; i <= 4; i++) jobs.push([s, w, i]);
const results: Array<any> = [];
async function one([s, w, i]: [string, string, number]) {
  const design = await small(O + 'lk/lk-' + s + '-' + w + '-' + i + '.png');
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await generateText({
        model: gateway('openai/gpt-6-luna'),
        system: SYSTEM,
        messages: [{ role: 'user', content: [
          { type: 'text', text: 'Image 1:' }, { type: 'file', data: photo, mediaType: 'image/png' },
          { type: 'text', text: 'Image 2:' }, { type: 'file', data: refs[s], mediaType: 'image/png' },
          { type: 'text', text: 'Image 3:' }, { type: 'file', data: design, mediaType: 'image/png' },
        ] }],
        providerOptions: { openai: { reasoningEffort: 'low' } },
        maxRetries: 0,
      } as any);
      const json = JSON.parse(res.text.slice(res.text.indexOf('{'), res.text.lastIndexOf('}') + 1));
      const row = { ...json, set: s, wording: w, i };
      results.push(row);
      appendFileSync(O + 'lk/judge.jsonl', JSON.stringify(row) + '\n');
      return;
    } catch (e: any) { console.error('retry', s, w, i, String(e?.message || e).slice(0, 120)); }
  }
}
writeFileSync(O + 'lk/judge.jsonl', '');
for (let k = 0; k < jobs.length; k += 8) await Promise.all(jobs.slice(k, k + 8).map(one));
const groups: Record<string, Array<any>> = {};
for (const r of results) (groups[r.set + ' ' + r.wording] ??= []).push(r);
for (const [g, rows] of Object.entries(groups)) {
  const avg = (k: string) => (rows.reduce((a, r) => a + Number(r[k] || 0), 0) / rows.length).toFixed(1);
  const count = (k: string, v: string) => rows.filter((r) => r[k] === v).length;
  console.log(g.padEnd(18), 'likeness', avg('likeness'), 'style', avg('style'), 'face=style', count('face', 'style') + '/' + rows.length, 'face=between', count('face', 'between'), 'hair=style', count('hair', 'style color'), 'freckles=style', count('freckles', 'style-like'), 'skin=style', count('skin', 'style palette'));
}
console.log('JUDGEDONE');

