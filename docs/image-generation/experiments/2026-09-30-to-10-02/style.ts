import { generateText } from 'ai';
import { gateway } from '@ai-sdk/gateway';
import sharp from 'sharp';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { STYLE_NOTES_PROMPT } from '/Users/starborn/Projects/CultRemix/convex/lib/prompts.ts';

// bun --env-file=... style.ts <model> <image> <name> [effort]
const [, , model, imagePath, name, effort] = process.argv;
mkdirSync('out/style', { recursive: true });
// Vision models see clear pixels as black, so a transparent design goes on flat gray first.
const raw = readFileSync(imagePath);
const stats = await sharp(raw).stats();
const transparent = !stats.isOpaque && process.env.FLAT !== 'none';
const image = transparent ? await sharp(raw).flatten({ background: '#808080' }).png().toBuffer() : raw;
const ask = transparent
  ? 'Write the style notes for this image. The flat gray around the design is a transparent background, not part of the design.'
  : 'Write the style notes for this image.';
const t0 = performance.now();
const res = await generateText({
  model: gateway(model),
  system: STYLE_NOTES_PROMPT,
  messages: [{ role: 'user', content: [
    { type: 'file', data: image, mediaType: 'image/png' },
    { type: 'text', text: ask },
  ] }],
  providerOptions: effort ? { openai: { reasoningEffort: effort } } : undefined,
  maxRetries: 0,
} as any);
const seconds = Math.round((performance.now() - t0) / 100) / 10;
writeFileSync('out/style/' + name + '.txt', res.text);
const gw: any = (res.providerMetadata as any)?.gateway ?? {};
console.log(JSON.stringify({ name, model, effort, seconds, usage: res.usage, cost: gw.cost, words: res.text.split(/\s+/).length }));
console.log(res.text);
