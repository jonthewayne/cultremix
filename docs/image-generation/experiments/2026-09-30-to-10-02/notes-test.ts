import { runOne } from './check.ts';
import { readFileSync, writeFileSync } from 'node:fs';
import { pickSections, studioPrompt } from '/Users/starborn/Projects/CultRemix/convex/lib/prompts.ts';

// Does image 1's notes help "Reimagine image 1 in the style of image 2"? VARIANT=bare drops them;
// VARIANT=layout keeps only its "Subject and layout" and "Words" sections.
// Same stored images, notes, model, size, and quality as the studio on dev.
const SUN = 'openai/gpt-image-2.5-sunburst';
const rows = readFileSync('/Users/starborn/Projects/CultRemix/.tmp/userImages.jsonl', 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const photo = rows.find((r) => r.kind === 'photo');
const style = rows.find((r) => r.kind === 'art');
const bytes = async (key: string) => new Uint8Array(await (await fetch('https://vibrant-rook-798.convex.site/img/' + key.slice(4))).arrayBuffer());
const photoBytes = await bytes(photo.key);
const styleBytes = await bytes(style.key);
const variant = process.env.VARIANT as string;
const photoNotes = variant === 'bare' ? undefined : variant === 'layout' ? pickSections(photo.notes, ['Subject and layout', 'Words']) : photo.notes;
const text = studioPrompt({
  layout: 'single',
  instruction: 'Reimagine image 1 in the style of image 2',
  attachments: [
    { summary: photo.summary, kind: photo.kind, notes: photoNotes, styleOnly: false },
    { summary: style.summary, kind: style.kind, notes: style.notes, styleOnly: false },
  ],
  styles: [],
});
writeFileSync('/Users/starborn/cultremix-imagecheck/out/notes-' + variant + '-prompt.txt', text);
await Promise.all([1, 2, 3, 4].map((i) =>
  runOne('notes-' + variant + '-' + i, SUN, { images: [photoBytes, styleBytes], text }, '1024x1536', true, { quality: 'medium' }),
));
