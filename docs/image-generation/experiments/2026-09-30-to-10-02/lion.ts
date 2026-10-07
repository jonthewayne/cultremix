import { runOne } from './check.ts';

// A single-image test design for "change the words": a lion with one piece of lettering.
const FLARE = 'openai/gpt-image-2.5-flare';
const text = 'A t-shirt graphic: a fierce lion head facing forward with a huge flowing mane, with the words KING OF THE BLOCK ' +
  'in chunky arched varsity lettering above it. Bold vintage screen-print look with thick black outlines and a limited palette ' +
  'of gold, rust, and cream. Output only the artwork itself on a fully transparent background: no t-shirt, no mockup, no background scene. ' +
  'Print-ready, centered, filling most of the canvas. Spell the words exactly: K-I-N-G O-F T-H-E B-L-O-C-K.';
await runOne('lion-king', FLARE, text, '1024x1536', true, { quality: 'medium' });
