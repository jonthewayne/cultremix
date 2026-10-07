import { runOne } from './check.ts';
import { readFileSync, writeFileSync } from 'node:fs';
import { studioPrompt } from '/Users/starborn/Projects/CultRemix/convex/lib/prompts.ts';

// Photo + style likeness test with the app's own prompt: GRID_JOB=<name> bun --env-file=... likeness.ts
const rows = readFileSync('/Users/starborn/Projects/CultRemix/.tmp/userImages.jsonl', 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const photo = rows.find((r) => r.kind === 'photo');
const style = rows.find((r) => r.kind === 'art');
const SUN = 'openai/gpt-image-2.5-sunburst';
const photoBytes = readFileSync('/Users/starborn/cultremix-imagecheck/out/person.png');
const styleBytes = readFileSync('/Users/starborn/cultremix-imagecheck/out/style70s.png');
const text = studioPrompt({
  layout: 'single',
  instruction: 'Reimagine image 1 in this style',
  attachments: [
    { summary: photo.summary, kind: photo.kind, notes: photo.notes, styleOnly: false },
    { summary: style.summary, kind: style.kind, notes: style.notes, styleOnly: true },
  ],
  styles: [{ attachment: 2, weight: 100 }],
});
const name = process.env.GRID_JOB as string;
writeFileSync('/Users/starborn/cultremix-imagecheck/out/' + name + '-prompt.txt', text);
await runOne(name, SUN, { images: [photoBytes, styleBytes], text }, '1024x1536', true, { quality: 'medium' });
