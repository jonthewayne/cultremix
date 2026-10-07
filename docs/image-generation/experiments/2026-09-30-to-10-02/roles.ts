import { generateText } from 'ai';
import { gateway } from '@ai-sdk/gateway';
import { namedStyles } from '/Users/starborn/Projects/CultRemix/convex/lib/prompts.ts';

// Can GPT-6 Luna read which images a request uses for their look, and how fast?
// bun --env-file=... roles.ts [effort]
const PHOTO = 'a photo: a smiling woman in a mustard sweater in a park';
const POSTER = 'art: vintage picnic illustration beneath a radiant sun';
const LION = 'art: a lion t-shirt graphic that says KING OF THE BLOCK';
const CAT = 'a photo: a gray cat on a windowsill';
type Case = { images: string[]; request: string; expect: string[]; remix?: boolean };
const CASES: Case[] = [
  { images: [PHOTO, POSTER], request: 'Reimagine image 1 in the style of image 2', expect: ['content', 'style'] },
  { images: [PHOTO, POSTER], request: 'make her look like she belongs in the second picture', expect: ['content', 'style'] },
  { images: [PHOTO, POSTER], request: "draw the woman the way the poster draws people", expect: ['content', 'style'] },
  { images: [PHOTO, POSTER], request: 'use the vibe of the picnic poster for the photo', expect: ['content', 'style'] },
  { images: [PHOTO, POSTER], request: 'put the woman from image 1 into the picnic scene from image 2', expect: ['content', 'content'] },
  { images: [PHOTO, POSTER], request: 'Combine both images into one design', expect: ['content', 'content'] },
  { images: [PHOTO, POSTER], request: "keep image 1's look but add the sun from image 2", expect: ['both', 'content'] },
  { images: [PHOTO, POSTER], request: 'not the style of image 2, just make it a clean vector portrait of image 1', expect: ['content', 'content'] },
  { images: [LION], request: 'Change the words to NIGHT SHIFT', expect: ['content'] },
  { images: [LION], request: 'a dragon in this style that says FIRE BREATHER', expect: ['style'] },
  { images: [LION], request: 'same lettering and colors but make it a tiger', expect: ['style'] },
  { images: [CAT, LION], request: 'my cat as the king, drawn exactly like the lion design', expect: ['content', 'style'] },
  { images: [CAT, LION], request: 'swap the lion for my cat', expect: ['content', 'content'] },
  { images: [PHOTO, CAT, POSTER], request: 'the woman holding the cat, in the poster style', expect: ['content', 'content', 'style'] },
  { images: [PHOTO, CAT, POSTER], request: 'images 1 and 2 in the style of image 3', expect: ['content', 'content', 'style'] },
  { images: [LION, POSTER], request: 'remix this with the colors of image 2', expect: ['content', 'style'], remix: true },
];
const SYSTEM = [
  "You read a member's request to a t-shirt design studio. The member attached numbered images. Decide what the request wants from each image:",
  "- content: work on what's in it. Its people, characters, objects, words, or layout carry into the design, possibly changed or restyled.",
  "- style: use only its look (technique, colors, line, texture, lettering style, the way it draws people) for other content. Leave out its subjects and words.",
  "- both: keep what's in it and also use its look.",
  "An image the request doesn't mention is content. An image is style only when the request uses it for how it looks, in any wording, such as \"in the style of image 2\", \"make it look like the second one\", \"the poster's vibe\", \"drawn like the lion design\", or \"a dragon in this style\". Asking to keep an image's own look makes it both. A negated style (\"not the style of image 2\") is not a style.",
  'Answer with JSON only: {"roles": [one of "content", "style", "both" for each image, in order]}.',
].join('\n');
const effort = process.argv[2] || 'low';
let right = 0, wordsRight = 0;
const times: number[] = [];
const results = await Promise.all(CASES.map(async (c) => {
  const user = 'Images:\n' + c.images.map((d, i) => (i + 1) + '. ' + d).join('\n') + (c.remix ? '\nImage 1 is the published design being remixed; it stays content.' : '') + '\n\nRequest: ' + c.request;
  const t0 = performance.now();
  const res = await generateText({ model: gateway('openai/gpt-6-luna'), system: SYSTEM, prompt: user, providerOptions: { openai: { reasoningEffort: effort } }, maxRetries: 0 } as any);
  const ms = Math.round(performance.now() - t0);
  let roles: string[] = [];
  try { roles = JSON.parse(res.text.slice(res.text.indexOf('{'), res.text.lastIndexOf('}') + 1)).roles; } catch {}
  const named = namedStyles(c.request, c.images.length, Boolean(c.remix));
  const words = c.images.map((_, i) => { const n = named.find((s) => s.n === i + 1); return !n ? 'content' : n.only ? 'style' : 'both'; });
  return { c, roles, words, ms };
}));
for (const { c, roles, words, ms } of results) {
  const ok = JSON.stringify(roles) === JSON.stringify(c.expect);
  const wok = JSON.stringify(words) === JSON.stringify(c.expect);
  if (ok) right++;
  if (wok) wordsRight++;
  times.push(ms);
  console.log((ok ? 'OK  ' : 'MISS') + ' ' + (wok ? 'ok  ' : 'miss') + ' ' + String(ms).padStart(5) + 'ms  ' + c.request + '  expect ' + c.expect.join('/') + '  luna ' + (roles || []).join('/') + '  words ' + words.join('/'));
}
times.sort((a, b) => a - b);
console.log('effort', effort, 'luna', right + '/' + CASES.length, 'phrase matcher', wordsRight + '/' + CASES.length, 'median', times[Math.floor(times.length / 2)] + 'ms', 'max', times[times.length - 1] + 'ms');

