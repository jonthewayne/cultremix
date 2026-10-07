import { runOne } from './check.ts';
import { readFileSync } from 'node:fs';
import { GRID_RULES, withoutWords } from '/Users/starborn/Projects/CultRemix/convex/lib/prompts.ts';

// Style blend test: GRID_JOB=<blend-80|blend-50|blend-20> bun --env-file=... blend.ts
const SUN = 'openai/gpt-image-2.5-sunburst';
const ref = readFileSync('/Users/starborn/cultremix-imagecheck/out/ref-growslow-1024.png');
const notesA = withoutWords(readFileSync('/Users/starborn/cultremix-imagecheck/out/style/w-grow.txt', 'utf8'));
const A_TRAITS = [
  'huge warped cream bubble lettering with layered multicolor outlines',
  'heavy dark contours with fine engraved line detail and stippling',
  'a dense oval arrangement framed by curling psychedelic shapes and four-point stars',
];
// A preset style, written once by us: its notes and ranked signature traits.
const B_NAME = 'Glitter glam';
const B_NOTES = 'Y2K glam: holographic glitter and iridescent chrome surfaces; a hot pink, lilac, and silver palette with a rainbow sheen; sparkles, starbursts, and lens flares; glossy bubbly chrome lettering with pink outlines; rhinestone and gem accents.';
const B_TRAITS = [
  'holographic glitter texture on the fills',
  'glossy iridescent chrome lettering with bright highlights',
  'a hot pink, lilac, and silver palette with a rainbow sheen',
  'sparkles, starbursts, and lens flares',
];
const ask = 'A raccoon in a tiny crown that says TRASH ROYALTY. Take the design\'s words from the request; keep the reference\'s own words only if the request asks for them or gives no words. Spell these words letter for letter: TRASH ROYALTY (T-R-A-S-H R-O-Y-A-L-T-Y).';

function styleSection(shareA: number) {
  if (shareA >= 80) {
    return 'Style: image 1 leads. Study it closely and keep its technique, line work, lettering, palette, and composition, described in the notes below. ' +
      'Add a light touch of the ' + B_NAME + ' style as small, secondary accents, only these: ' + B_TRAITS.slice(0, 2).join('; ') + '. Everything else stays in image 1\'s style.\n\nImage 1 style notes:\n' + notesA;
  }
  if (shareA >= 50) {
    return 'Style: an even fusion of two styles; neither should dominate. From image 1 keep: ' + A_TRAITS.join('; ') + '. ' +
      'From the ' + B_NAME + ' style take: ' + B_TRAITS.slice(0, 3).join('; ') + '.\n\nImage 1 style notes:\n' + notesA + '\n\n' + B_NAME + ' style notes:\n' + B_NOTES;
  }
  return 'Style: the ' + B_NAME + ' style leads: ' + B_NOTES + ' Keep a light touch of image 1 as secondary accents, only these: ' + A_TRAITS.slice(0, 2).join('; ') + '. ' +
    'Use image 1 for those accents, not for the overall look.';
}

function prompt(shareA: number) {
  return [
    'Make four t-shirt graphics in one image, based on the attached reference image (image 1).',
    GRID_RULES,
    styleSection(shareA),
    'Request (this wins wherever it conflicts with the style): ' + ask + ' Keep the same style blend in all four and vary their composition.',
  ].join('\n\n');
}

const share: Record<string, number> = { 'blend-80': 80, 'blend-50': 50, 'blend-20': 20 };
const name = process.env.GRID_JOB as string;
if (!(name in share)) { console.error('unknown job', name); process.exit(2); }
console.error(prompt(share[name]));
await runOne(name, SUN, { images: [ref], text: prompt(share[name]) }, '1920x1920', true, { quality: 'high' });
