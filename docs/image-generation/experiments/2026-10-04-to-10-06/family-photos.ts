// Makes made-up family photos for the Santa test: plain phone-style portraits of fictional people.
import { gatewayImage } from '../convex/lib/imageCalls';
import { mkdirSync, writeFileSync } from 'node:fs';
const OUT = '/Users/starborn/Projects/CultRemix/.tmp/family/';
mkdirSync(OUT, { recursive: true });
const people = {
  dad: 'a man in his forties with a short dark beard, rectangular glasses, and a gray hoodie',
  mom: 'a woman in her forties with long curly auburn hair, freckles, and a green sweater',
  girl: 'a girl about eight with two blond braids and a gap-toothed smile, in a yellow t-shirt',
  boy: 'a boy about twelve with short black hair, brown skin, and a red baseball cap',
  grandma: 'a woman in her seventies with short white hair, round glasses, and pearl earrings',
  toddler: 'a toddler about three with curly brown hair and chubby cheeks, in a blue striped shirt',
};
await Promise.all(Object.entries(people).map(async ([name, who]) => {
  const t0 = Date.now();
  const out = await gatewayImage({ text: `A casual smartphone photo of ${who}, head and shoulders, smiling at the camera, in a living room. A real photograph, natural light. This is a fictional person.`, images: [], size: '1024x1024', background: 'opaque', quality: 'medium' });
  writeFileSync(OUT + name + '.png', out.bytes);
  console.log(name, ((Date.now() - t0) / 1000).toFixed(0) + 's', JSON.stringify(out.providerMetadata).match(/"cost":"?([0-9.]+)/)?.[1]);
}));
