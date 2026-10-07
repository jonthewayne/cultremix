import { runOne } from './check.ts';
import { generateText } from 'ai';
import { gateway } from '@ai-sdk/gateway';
import sharp from 'sharp';
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from 'node:fs';

// How many images can one Sunburst call take, and does each still come through?
// bun --env-file=... imgcount.ts prep | run <n> | judge <n>
const O = '/Users/starborn/cultremix-imagecheck/out/';
mkdirSync(O + 'count', { recursive: true });
const SUN = 'openai/gpt-image-2.5-sunburst';
const FLARE = 'openai/gpt-image-2.5-flare';
const ICONS: Array<[string, string]> = [
  ['hydrant', 'a red fire hydrant'], ['duck', 'a yellow rubber duck'], ['cactus', 'a green cactus in a terracotta pot'],
  ['whale', 'a blue whale'], ['pizza', 'a slice of pepperoni pizza'],
];
const IMAGES: Array<[string, string]> = [
  ['lion-king.png', 'a lion with the words KING OF THE BLOCK'],
  ['person.png', 'a woman with short red curls and round glasses'],
  ['seed-02-mushrooms.png', 'a cluster of mushrooms'],
  ['seed-04-laundromat-cat.png', 'a cat in a laundromat'],
  ['seed-05-hotrod.png', 'a hot rod car'],
  ['seed-06-wave.png', 'a breaking ocean wave'],
  ['flare-text.png', 'a cat riding a skateboard through planets'],
  ['newspaper.png', 'a newspaper front page'],
  ['seed-03-desert.png', 'a desert scene'],
  ['stylePop.png', 'a pop-art woman with pink hair'],
  ['style70s.png', 'two women at a picnic under a big sun'],
  ...ICONS.map(([name, what]) => ['count/icon-' + name + '.png', what] as [string, string]),
];
const step = process.argv[2];
if (step === 'prep') {
  await Promise.all(ICONS.map(([name, what]) => runOne('count/icon-' + name, FLARE, 'A simple flat sticker illustration of ' + what + ', bold outline, centered, plain white background. No words.', '1024x1024', false, { quality: 'low' })));
} else if (step === 'run') {
  const n = Number(process.argv[3]);
  const list = IMAGES.slice(0, n);
  const images = await Promise.all(list.map(async ([f]) => sharp(readFileSync(O + f)).resize(1024, 1024, { fit: 'inside' }).flatten({ background: '#ffffff' }).png().toBuffer()));
  const legend = list.map(([, what], i) => '- Image ' + (i + 1) + ': ' + what + '.').join('\n');
  const text = 'Make a t-shirt graphic: a sticker sheet with exactly ' + n + ' die-cut stickers, one for each attached image, each showing that image\'s main subject drawn the way that image draws it. Every image must appear once.\n\nAttached images:\n' + legend +
    '\n\nOutput only the artwork on a fully transparent background: no t-shirt, no mockup, no border. Print-ready, bold, clean edges.';
  writeFileSync(O + 'count/n' + n + '-prompt.txt', text);
  await runOne('count/n' + n, SUN, { images, text }, '1024x1536', true, { quality: 'medium' });
} else if (step === 'judge') {
  const n = Number(process.argv[3]);
  const list = IMAGES.slice(0, n);
  const design = await sharp(readFileSync(O + 'count/n' + n + '.png')).flatten({ background: '#f4f1ea' }).resize(1024, 1024, { fit: 'inside' }).png().toBuffer();
  const res = await generateText({
    model: gateway('openai/gpt-6-luna'),
    system: 'You check a sticker-sheet design. For each listed subject, say whether a sticker clearly showing it appears. Answer JSON only: {"found": [numbers of the subjects that appear], "missing": [numbers that do not], "stickers": total number of stickers you count}.',
    messages: [{ role: 'user', content: [
      { type: 'file', data: design, mediaType: 'image/png' },
      { type: 'text', text: 'Subjects:\n' + list.map(([, what], i) => (i + 1) + '. ' + what).join('\n') },
    ] }],
    providerOptions: { openai: { reasoningEffort: 'low' } },
    maxRetries: 0,
  } as any);
  const json = JSON.parse(res.text.slice(res.text.indexOf('{'), res.text.lastIndexOf('}') + 1));
  appendFileSync(O + 'count/judge.jsonl', JSON.stringify({ n, ...json }) + '\n');
  console.log(JSON.stringify({ n, ...json }));
}

