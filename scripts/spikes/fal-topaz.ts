// Live check of "Upscale for print": one real fal Topaz Transparent 4x call through the same client
// and polling the app uses (convex/lib/fal.ts, convex/lib/upscaleFlow.ts). Records latency, output
// size, price, and whether transparency survived.
//
//   bun run scripts/spikes/fal-topaz.ts            one call (the default)
//   bun run scripts/spikes/fal-topaz.ts --calls 2  two calls, the most this script will make
//
// The key is read here from ~/.config/cultremix/fal.env (FAL_KEY=...) and never printed. The test
// image is made with sharp: a transparent PNG with lettering, sent as a data URI so nothing needs
// to be hosted.

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { falClient } from "../../convex/lib/fal";
import { measureImage, pngCarriesAlpha } from "../../convex/lib/printImage";
import { UPSCALE_TIMEOUT_MS, pollDelay } from "../../convex/lib/upscaleFlow";

const MAX_CALLS = 2;
const PRICE_PER_24MP = 0.08;

function readKey() {
  const text = readFileSync(join(homedir(), ".config/cultremix/fal.env"), "utf8");
  for (const line of text.split("\n")) {
    const match = /^\s*(?:export\s+)?FAL_KEY\s*=\s*(.*)\s*$/u.exec(line);
    if (match) return match[1].replace(/^["']|["']$/gu, "");
  }
  throw new Error("FAL_KEY isn't in ~/.config/cultremix/fal.env.");
}

async function testImage(width: number, height: number) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <circle cx="${width / 2}" cy="${height / 2}" r="${height * 0.42}" fill="#d0202a"/>
    <text x="${width / 2}" y="${height * 0.5}" font-family="Helvetica" font-weight="900" font-size="${height * 0.14}" text-anchor="middle" fill="#fff4d9">CULT</text>
    <text x="${width / 2}" y="${height * 0.64}" font-family="Helvetica" font-weight="900" font-size="${height * 0.08}" text-anchor="middle" fill="#111">REMIX 101-001</text>
  </svg>`;
  return new Uint8Array(await sharp(Buffer.from(svg)).png().toBuffer());
}

async function once(client: ReturnType<typeof falClient>, source: Uint8Array) {
  const started = Date.now();
  const submission = await client.submit(`data:image/png;base64,${Buffer.from(source).toString("base64")}`);
  console.log(`  submitted, request ${submission.requestId}`);
  let polls = 0;
  for (;;) {
    polls++;
    await new Promise((resolve) => setTimeout(resolve, pollDelay(polls)));
    const status = await client.status(submission.statusUrl);
    if (status.status === "FAILED") throw new Error(`fal failed: ${status.error}`);
    if (status.status === "COMPLETED") break;
    if (Date.now() - started > UPSCALE_TIMEOUT_MS) throw new Error("Timed out.");
  }
  const latencyMs = Date.now() - started;
  const image = await client.result(submission.responseUrl);
  const response = await fetch(image.url);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const measured = await measureImage(bytes);
  const megapixels = (measured.width * measured.height) / 1e6;
  return {
    latencyS: Math.round(latencyMs / 100) / 10,
    polls,
    contentType: image.contentType ?? response.headers.get("content-type"),
    width: measured.width,
    height: measured.height,
    megabytes: Math.round((bytes.length / 1e6) * 100) / 100,
    price: `$${(Math.ceil(megapixels / 24) * PRICE_PER_24MP).toFixed(2)} (${megapixels.toFixed(1)} MP)`,
    pngAlphaChannel: pngCarriesAlpha(bytes),
    alphaKept: measured.metrics.hasAlpha,
    solid: measured.metrics.solid,
    visible: measured.metrics.visible,
    haze: measured.metrics.haze,
  };
}

const callsArg = process.argv.indexOf("--calls");
const calls = callsArg > 0 ? Number(process.argv[callsArg + 1]) : 1;
if (!Number.isInteger(calls) || calls < 1 || calls > MAX_CALLS) throw new Error(`--calls must be 1 to ${MAX_CALLS}.`);

const client = falClient({ key: readKey() });
const sizes: Array<[number, number]> = [
  [600, 600],
  [1024, 1536],
];
for (let i = 0; i < calls; i++) {
  const [width, height] = sizes[i];
  const source = await testImage(width, height);
  const input = await measureImage(source);
  console.log(`Call ${i + 1}: ${width}x${height} transparent PNG (visible ${input.metrics.visible.toFixed(3)}, haze ${input.metrics.haze.toFixed(4)})`);
  console.log(await once(client, source));
}
