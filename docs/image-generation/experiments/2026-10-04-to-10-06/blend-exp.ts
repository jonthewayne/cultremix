// Blending experiment: four ways to mix three styles, on two mixes, scored with the same questions.
// Variants: rank (production: each smaller style gets a part by its rank), luna-parts (GPT-6 Luna picks each
// smaller style's part from its notes), luna-blend (Luna writes one blended style description), range (the four
// designs lean on each style in turn, the fourth blends them).
// usage: bun .tmp/blend-exp.ts <grids per variant> [mix] [variant]
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { gateway } from '@ai-sdk/gateway';
import { generateText } from 'ai';
import { cutGrid } from '../convex/lib/gridCut';
import { gatewayImage } from '../convex/lib/imageCalls';
import { gatewayCostCents } from '../convex/lib/pricing';
import { studioPrompt, noteSections } from '../convex/lib/prompts';
import { decodeToRgba, encodePng } from '../convex/lib/resize';
import { checkImage, wordsMatch } from '../tests/image-e2e/judge';
import { fixturePath } from '../tests/image-e2e/fixtures';
import { PIN } from '../tests/image-e2e/pin';
const OUT = '/Users/starborn/Projects/CultRemix/.tmp/blend/';
const NOTES = '/Users/starborn/Projects/CultRemix/.tmp/image-e2e/runs/20261006-0423-gpt-image-2.5/notes/';
const REQUEST = 'A raccoon in a tiny crown that says TRASH ROYALTY.';
type Ask = { id: string; ask: string };
type Mix = { name: string; fixtures: Array<string>; weights: Array<number>; asks: Array<Ask> };
const DOMINANT: Array<Ask> = [
  { id: 'domA', ask: 'Is this design mostly in the look of style A (more than of style B or style C)?' },
  { id: 'domB', ask: 'Is this design mostly in the look of style B (more than of style A or style C)?' },
  { id: 'domC', ask: 'Is this design mostly in the look of style C (more than of style A or style B)?' },
];
const PERSON: Ask = { id: 'person', ask: 'Does the design show a woman or any other person?' };
const SCENE: Ask = { id: 'scene', ask: 'Is there a 1970s-style landscape or sky in the design, such as mountains, a lake, pine trees, or a big sun with rays or wavy bands?' };
const MIXES: Array<Mix> = [
  { name: 'A', fixtures: ['grow-slow', 'pop-art', 'poster-70s'], weights: [100, 50, 50], asks: [
    { id: 'lead', ask: 'Are the words drawn as warped, inflated psychedelic letters with several layered colored outlines, like style A?' },
    { id: 'popart', ask: "Is the raccoon's fur clearly lavender or purple? Answer no if the fur is gray, brown, or black and white with at most a faint purple tint." },
    SCENE, PERSON, ...DOMINANT ] },
  { name: 'B', fixtures: ['pop-art', 'grow-slow', 'poster-70s'], weights: [100, 60, 40], asks: [
    { id: 'lead', ask: 'Is the raccoon drawn in a pop-art comic style, with heavy black outlines, flat saturated colors, and hard-edged shading, like style A?' },
    { id: 'letters', ask: 'Are the words TRASH ROYALTY drawn as warped, inflated psychedelic letters with several layered colored outlines (such as cream, orange, yellow, and green), like style B?' },
    SCENE, PERSON, ...DOMINANT ] },
];
const notesOf = (id: string) => readFileSync(NOTES + id + '.txt', 'utf8');
const field = (text: string, name: string) => (new RegExp('^' + name + ': (.*)$', 'm').exec(text)?.[1] ?? '').trim();
const body = (text: string) => text.split('\n').slice(3).join('\n');
const styleNotes = (id: string) => noteSections(body(notesOf(id))).filter((s) => ['Technique', 'Color', 'Line and shading', 'Lettering', 'Figure drawing', 'Signature traits'].includes(s.name)).map((s) => s.name + ':\n' + s.text).join('\n\n');
function basePrompt(mix: Mix) {
  return studioPrompt({
    layout: 'grid', instruction: REQUEST,
    attachments: mix.fixtures.map((id) => ({ summary: field(notesOf(id), 'Summary'), kind: field(notesOf(id), 'Kind') as 'art', notes: body(notesOf(id)), styleOnly: true })),
    styles: mix.weights.map((weight, i) => ({ attachment: i + 1, weight, position: i + 1 })),
  });
}
async function luna(system: string, prompt: string) {
  const result = await generateText({ model: gateway(PIN.vision), system, prompt, providerOptions: { openai: { reasoningEffort: 'low' } }, maxRetries: 1 });
  return { text: result.text, cents: gatewayCostCents(result.providerMetadata) ?? 0 };
}
const PARTS: Record<string, string> = {
  subject: 'on the main subject of every design (its coloring, shading, and face)',
  around: 'around the subject in every design (a backdrop, frame, or ornaments, and the print texture)',
  lettering: 'in the lettering of every design (its letterforms, outlines, colors, and effects)',
  accents: 'in small accents in every design',
};
const RANK_PARTS = ['on the main subject of every design (its coloring, shading, and face)', 'around the subject in every design (a backdrop, frame, or ornaments, and the print texture)', 'in the lettering of every design (its colors and effects)', 'in small accents in every design'];
let lunaCents = 0;
async function lunaParts(mix: Mix, base: string) {
  const system = ['You place each smaller style of a t-shirt design\'s style mix in the part of the design where its signature traits show best.',
    'Parts: subject (the main subject\'s coloring, shading, and face), around (a backdrop, frame, or ornaments, and the print texture), lettering (the words\' letterforms, outlines, colors, and effects), accents (small accents).',
    'The leading style sets the overall technique. Give each smaller style a different part when you can, choosing by what the style is known for: a style known for its lettering goes on the lettering, one known for its color and shading on the subject, one known for its scenery or texture around it.',
    'Answer with JSON only: {"parts": {"2": "subject" | "around" | "lettering" | "accents", ...}} keyed by image number.'].join('\n');
  const smaller = mix.fixtures.map((id, i) => ({ id, n: i + 1 })).slice(1);
  const prompt = 'Request: ' + REQUEST + '\n\nLeading style, image 1:\n' + styleNotes(mix.fixtures[0]) + '\n\n' + smaller.map((s) => 'Smaller style, image ' + s.n + ':\n' + styleNotes(s.id)).join('\n\n');
  const out = await luna(system, prompt); lunaCents += out.cents;
  const parsed = JSON.parse(out.text.slice(out.text.indexOf('{'), out.text.lastIndexOf('}') + 1)) as { parts: Record<string, string> };
  let text = base;
  for (const s of smaller) {
    const chosen = PARTS[parsed.parts[String(s.n)]];
    const line = new RegExp('(- Image ' + s.n + ' \\(\\d+%\\): )(.*?)(, through )');
    if (!chosen || !line.test(text)) throw new Error('luna-parts: no part for image ' + s.n + ' ' + out.text);
    text = text.replace(line, (_, a, _b, c) => a + chosen + c);
  }
  if (Object.values(parsed.parts).includes('lettering')) text = text.replace('It sets the technique, line work, color, lettering, figure drawing', 'It sets the technique, line work, color, figure drawing');
  return { text, note: JSON.stringify(parsed.parts) };
}
async function lunaBlend(mix: Mix, base: string) {
  const shares = mix.weights.map((w) => Math.round((100 * w) / mix.weights.reduce((a, b) => a + b, 0)));
  const system = ['You write one style description for an image model that blends several reference styles into a single look for a t-shirt design, in the given proportions.',
    'Merge them into one coherent look: say which style\'s technique, line work, palette, lettering, and way of drawing figures leads, and how each smaller style shows, in proportion to its share, so each one is plainly visible.',
    'Write plain instructions under the headings Technique, Color, Line and shading, Lettering, Figure drawing, and Signature traits, about 250 words in all. Never mention the style images\' own subjects, people, or words.'].join('\n');
  const prompt = mix.fixtures.map((id, i) => 'Image ' + (i + 1) + ' (' + shares[i] + '%):\n' + styleNotes(id)).join('\n\n');
  const out = await luna(system, prompt); lunaCents += out.cents;
  const parts = base.split('\n\n');
  const mixAt = parts.findIndex((p) => p.startsWith('Style mix:'));
  const defAt = parts.findIndex((p) => p.startsWith('Style definitions'));
  const blended = 'Style: one look blended from the attached style images (' + mix.fixtures.map((_, i) => 'image ' + (i + 1) + ' ' + shares[i] + '%').join(', ') + '), described below. Every design shows this whole blend.\n\n' + out.text.trim();
  const kept = parts.filter((_, i) => i !== mixAt && i !== defAt && !(defAt >= 0 && i > defAt && !parts[i].startsWith('Request')));
  kept.splice(mixAt, 0, blended);
  return { text: kept.join('\n\n'), note: out.text.trim() };
}
function range(mix: Mix, base: string) {
  const shares = mix.weights.map((w) => Math.round((100 * w) / mix.weights.reduce((a, b) => a + b, 0)));
  const parts = base.split('\n\n');
  const mixAt = parts.findIndex((p) => p.startsWith('Style mix:'));
  parts[mixAt] = 'Style mix: show the range of this mix across the four designs. The top-left design leans on image 1\'s style, the top-right on image 2\'s, the bottom-left on image 3\'s, and the bottom-right blends all three in these proportions: ' + mix.fixtures.map((_, i) => 'image ' + (i + 1) + ' ' + shares[i] + '%').join(', ') + '. A design that leans on one style still shows a touch of the others.';
  return { text: parts.join('\n\n').replace(' Keep the same style mix in all four and vary their composition.', ' Vary their composition.'), note: '' };
}
const png = async (id: string) => new Uint8Array(await sharp(readFileSync(fixturePath(id))).png().toBuffer());
const [gridsArg = '3', onlyMix, onlyVariant] = process.argv.slice(2);
let cents = 0;
for (const mix of MIXES.filter((m) => !onlyMix || m.name === onlyMix)) {
  const base = basePrompt(mix);
  if (base.includes(RANK_PARTS[2]) === false && mix.name === 'B') console.log('note: rank B has no lettering part');
  const variants: Record<string, { text: string; note: string }> = {
    rank: { text: base, note: '' },
    'luna-parts': await lunaParts(mix, base),
    'luna-blend': await lunaBlend(mix, base),
    range: range(mix, base),
  };
  const images = await Promise.all(mix.fixtures.map(png));
  const refs = images.map((bytes, i) => ({ as: 'style ' + 'ABC'[i], bytes }));
  const jobs: Array<{ v: string; g: number }> = [];
  for (const v of Object.keys(variants)) {
    if (onlyVariant && v !== onlyVariant) continue;
    const dir = join(OUT, mix.name, v); mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'prompt.txt'), variants[v].text);
    if (variants[v].note) writeFileSync(join(dir, 'luna.txt'), variants[v].note);
    for (let g = 1; g <= Number(gridsArg); g++) if (!existsSync(join(dir, 'grid-' + g, 'answers.json'))) jobs.push({ v, g });
  }
  let next = 0;
  await Promise.all(Array.from({ length: 4 }, async () => { while (next < jobs.length) { const job = jobs[next++];
    const dir = join(OUT, mix.name, job.v, 'grid-' + job.g); mkdirSync(dir, { recursive: true });
    let out;
    try { out = await gatewayImage({ text: variants[job.v].text, images, size: PIN.gridSize, background: 'transparent', quality: 'medium' }); }
    catch (e) { console.log(mix.name, job.v, job.g, 'ERROR', String(e).slice(0, 120)); continue; }
    cents += gatewayCostCents(out.providerMetadata) ?? 0;
    writeFileSync(join(dir, 'grid.png'), out.bytes);
    const cells = cutGrid(await decodeToRgba(out.bytes));
    const answers = await Promise.all(cells.map(async (cell) => {
      if (!cell.tile) return { index: cell.index, missing: cell.reason };
      const design = await encodePng(cell.tile);
      writeFileSync(join(dir, 'design-' + (cell.index + 1) + '.png'), design);
      const a = await checkImage({ model: PIN.checker, wordModel: PIN.wordReader, design, refs, asks: mix.asks, readWords: true }).catch(() => null);
      cents += a?.costCents ?? 0;
      return { index: cell.index, answers: a?.answers, words: a?.words, spelled: a ? wordsMatch(a.words, { has: ['TRASH', 'ROYALTY'] }).ok : null };
    }));
    writeFileSync(join(dir, 'answers.json'), JSON.stringify(answers, null, 1));
    console.log(mix.name, job.v, 'grid', job.g, 'done');
  } }));
}
console.log('cents', (cents + lunaCents).toFixed(1));
