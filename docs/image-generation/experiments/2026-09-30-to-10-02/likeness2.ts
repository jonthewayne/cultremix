import { runOne } from './check.ts';
import { generateText } from 'ai';
import { gateway } from '@ai-sdk/gateway';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { STYLE_NOTES_PROMPT, parseStyleNotes, studioPrompt } from '/Users/starborn/Projects/CultRemix/convex/lib/prompts.ts';

// Likeness wording test (2026-10-02): which "Keep" wording keeps a person recognizable while a
// style restyles them? bun --env-file=... likeness2.ts style | run <style> <wording>
const OUT = '/Users/starborn/cultremix-imagecheck/out';
const SUN = 'openai/gpt-image-2.5-sunburst';
const FLARE = 'openai/gpt-image-2.5-flare';
mkdirSync(OUT + '/lk', { recursive: true });
const step = process.argv[2];

async function notesFor(file: string) {
  const res = await generateText({
    model: gateway('openai/gpt-6-luna'),
    system: STYLE_NOTES_PROMPT,
    messages: [{ role: 'user', content: [
      { type: 'file', data: readFileSync(file), mediaType: 'image/png' },
      { type: 'text', text: 'Write the notes for this image.' },
    ] }],
    providerOptions: { openai: { reasoningEffort: 'low' } },
    maxRetries: 0,
  } as any);
  return parseStyleNotes(res.text);
}

if (step === 'style') {
  const r = await runOne('stylePop', FLARE,
    'A pop-art comic portrait poster of a fictional young woman, head and shoulders. Her hair is electric neon pink, drawn as big flat ' +
    'swooping shapes with thick black outlines. Her skin is flat lavender with cyan shadow shapes, her lips hot orange, and her freckles ' +
    'are drawn as large round Ben-Day dots in hot orange across her nose and cheeks. Oversized glossy eyes, a tiny nose, a heavy black ' +
    'outline on everything, flat color with no gradients, a lemon-yellow halftone dot background. Bold Roy Lichtenstein-inspired comic ' +
    'style with a neon palette. No words.',
    '1024x1536', false, { quality: 'medium' });
  if (!r.ok) process.exit(1);
  const notes = await notesFor(OUT + '/stylePop.png');
  writeFileSync(OUT + '/lk/pop-notes.json', JSON.stringify(notes, null, 1));
  console.log(notes.summary, notes.kind);
  console.log(notes.notes);
} else if (step === 'run') {
  const [, , , styleName, wording] = process.argv;
  const rows = readFileSync('/Users/starborn/Projects/CultRemix/.tmp/userImages.jsonl', 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const photo = rows.find((r) => r.kind === 'photo');
  const style = styleName === 'pop'
    ? JSON.parse(readFileSync(OUT + '/lk/pop-notes.json', 'utf8'))
    : rows.find((r) => r.kind === 'art');
  const styleBytes = readFileSync(styleName === 'pop' ? OUT + '/stylePop.png' : OUT + '/style70s.png');
  const photoBytes = readFileSync(OUT + '/person.png');
  let text = studioPrompt({
    layout: 'single',
    instruction: 'Reimagine image 1 in this style',
    attachments: [
      { summary: photo.summary, kind: photo.kind, notes: photo.notes, styleOnly: false },
      { summary: style.summary, kind: style.kind, notes: style.notes, styleOnly: true },
    ],
    styles: [{ attachment: 2, weight: 100 }],
  });
  const parts = text.split('\n\n');
  const at = parts.findIndex((p) => p.startsWith('Keep:'));
  const current = parts[at];
  const head = "Keep: study image 1 closely. Unless the request changes them, keep image 1's composition and structure, ";
  const variants: Record<string, string> = {
    current,
    broad: head + 'and keep the recognizable likeness of every person and animal in image 1, so someone who knows them would recognize them, while drawing them fully in the style.',
    traits: head + 'and keep the recognizable likeness of every person and animal in image 1, such as their hair, glasses, and freckles, so someone who knows them would recognize them, while drawing them fully in the style.',
    nofacerule: current.replace(/ Don't keep their real face shape, features, or proportions: redraw their faces and bodies the way the style draws people, even where that stretches or simplifies them\./, ''),
  };
  if (wording === 'nofacerule' && variants.nofacerule === current) throw new Error('face rule sentence not found');
  parts[at] = variants[wording];
  text = parts.join('\n\n');
  const name = 'lk-' + styleName + '-' + wording;
  writeFileSync(OUT + '/lk/' + name + '-prompt.txt', text);
  await Promise.all([1, 2, 3, 4].map((i) =>
    runOne('lk/' + name + '-' + i, SUN, { images: [photoBytes, styleBytes], text }, '1024x1536', true, { quality: 'medium' }),
  ));
} else {
  console.log('steps: style | run <70s|pop> <current|broad|traits|nofacerule>');
}

