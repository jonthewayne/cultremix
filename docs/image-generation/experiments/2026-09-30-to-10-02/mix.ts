import { runOne } from './check.ts';
import { readFileSync } from 'node:fs';
import { GRID_RULES, withoutWords } from '/Users/starborn/Projects/CultRemix/convex/lib/prompts.ts';

// Slider-driven style mix: every source has a 0-10 value; shares come from the values.
// GRID_JOB=<mix-80-20|mix-3way> bun --env-file=... mix.ts
const SUN = 'openai/gpt-image-2.5-sunburst';
const ref = readFileSync('/Users/starborn/cultremix-imagecheck/out/ref-growslow-1024.png');
type Source = { name: string; value: number; notes: string; traits: Array<string> };
const growSlow: Omit<Source, 'value'> = {
  name: 'Image 1',
  notes: withoutWords(readFileSync('/Users/starborn/cultremix-imagecheck/out/style/w-grow.txt', 'utf8')) as string,
  traits: ['huge warped cream bubble lettering with layered multicolor outlines', 'heavy dark contours with fine engraved line detail and stippling', 'a dense oval arrangement framed by curling psychedelic shapes and four-point stars'],
};
const glitter: Omit<Source, 'value'> = {
  name: 'Glitter glam',
  notes: 'Y2K glam: holographic glitter and iridescent chrome surfaces; a hot pink, lilac, and silver palette with a rainbow sheen; sparkles, starbursts, and lens flares; glossy bubbly chrome lettering with pink outlines; rhinestone and gem accents.',
  traits: ['holographic glitter texture on the fills and lettering', 'glossy chrome highlights on the letters', 'hot pink and lilac highlights with a rainbow sheen', 'sparkles and starbursts'],
};
const woodblock: Omit<Source, 'value'> = {
  name: 'Woodblock print',
  notes: 'Japanese ukiyo-e woodblock print: flat areas of indigo, cream, and rust; visible wood-grain texture in the color areas; bold carved outlines of uneven width; stylized curling waves and clouds; a limited palette on warm paper.',
  traits: ['visible wood-grain texture in the color areas', 'bold carved outlines of uneven width', 'indigo, cream, and rust color areas', 'stylized curling waves and clouds'],
};

// The largest share leads; every other source with a value above zero must be clearly visible.
function styleMix(sources: Array<Source>) {
  const used = sources.filter((s) => s.value > 0);
  const total = used.reduce((n, s) => n + s.value, 0);
  const ranked = used.map((s) => ({ ...s, share: Math.round((100 * s.value) / total) })).sort((a, b) => b.share - a.share);
  const lines = ranked.map((s, i) => {
    if (i === 0 && s.share >= 100) return '- ' + s.name + ' (100%): the only style. Match it closely.';
    if (i === 0 || s.share >= ranked[0].share - 10)
      return '- ' + s.name + ' (' + s.share + '%): ' + (i === 0 ? 'leads' : 'shares the lead') + '. It sets the technique, line work, lettering shapes, composition, and level of detail' + (s.share < 60 ? ', together with the next style' : '') + '.';
    const n = s.share >= 25 ? 3 : 2;
    return '- ' + s.name + ' (' + s.share + '%): clearly visible in every design, not a faint hint, through these traits: ' + s.traits.slice(0, n).join('; ') + '.';
  });
  const defs = ranked.map((s) => s.name + ':\n' + s.notes).join('\n\n');
  return 'Style mix: how much each style shapes the designs. Blend them in these proportions; a style with a smaller share still shows plainly.\n' + lines.join('\n') + '\n\nStyle definitions:\n' + defs;
}

const ask = 'A raccoon in a tiny crown that says TRASH ROYALTY. Take the design\'s words from the request; keep the reference\'s own words only if the request asks for them or gives no words. Spell these words letter for letter: TRASH ROYALTY (T-R-A-S-H R-O-Y-A-L-T-Y).';
function prompt(sources: Array<Source>) {
  return [
    'Make four t-shirt graphics in one image. Image 1 is attached: a psychedelic mushroom t-shirt graphic.',
    GRID_RULES,
    styleMix(sources),
    'Request (this wins wherever it conflicts with the style mix): ' + ask + ' Keep the same style mix in all four and vary their composition.',
  ].join('\n\n');
}

const jobs: Record<string, Array<Source>> = {
  'mix-80-20': [{ ...growSlow, value: 8 }, { ...glitter, value: 2 }],
  'mix-3way': [{ ...growSlow, value: 10 }, { ...glitter, value: 5 }, { ...woodblock, value: 5 }],
};
const name = process.env.GRID_JOB as string;
if (!jobs[name]) { console.error('unknown job', name); process.exit(2); }
console.error(prompt(jobs[name]));
await runOne(name, SUN, { images: [ref], text: prompt(jobs[name]) }, '1920x1920', true, { quality: 'high' });
