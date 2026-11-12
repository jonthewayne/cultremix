// Makes the screen captures light enough to page through on a phone: each PNG becomes a JPEG,
// pages taller than MAX_HEIGHT keep their top part (a long feed repeats itself), and every screen
// gets a small thumbnail for the viewer's All view. Rewrites manifest.json and manifest.js.
//
//   bun scripts/screens/optimize.ts [.tmp/screens]     (capture.ts runs it at the end)
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import sharp from "sharp";

const MAX_HEIGHT = 7000;

type Manifest = { screens: Array<{ id: string; shots: Record<string, string>; thumb?: string }> } & Record<string, unknown>;

export async function optimize(outDir: string) {
  const manifestPath = join(outDir, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;
  for (const screen of manifest.screens) {
    for (const [kind, file] of Object.entries(screen.shots)) {
      if (!file.endsWith(".png")) continue;
      const source = join(outDir, file);
      if (!existsSync(source)) {
        delete screen.shots[kind];
        continue;
      }
      const image = sharp(source);
      const { width = 0, height = 0 } = await image.metadata();
      const cropped = height > MAX_HEIGHT ? image.extract({ left: 0, top: 0, width, height: MAX_HEIGHT }) : image;
      const jpeg = file.replace(/\.png$/u, ".jpg");
      await cropped.flatten({ background: "#ffffff" }).jpeg({ quality: 80, mozjpeg: true }).toFile(join(outDir, jpeg));
      rmSync(source);
      screen.shots[kind] = jpeg;
    }
    const first = screen.shots.desktop ?? screen.shots.phone;
    if (first) {
      const thumb = first.replace(/-(desktop|phone)\.jpg$/u, "-thumb.jpg");
      const { width = 0, height = 0 } = await sharp(join(outDir, first)).metadata();
      const cropHeight = Math.min(height, Math.round(width * 0.625));
      await sharp(join(outDir, first))
        .extract({ left: 0, top: 0, width, height: cropHeight })
        .resize({ width: 560 })
        .jpeg({ quality: 72, mozjpeg: true })
        .toFile(join(outDir, thumb));
      screen.thumb = thumb;
    }
  }
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  writeFileSync(join(outDir, "manifest.js"), "window.SCREENS = " + JSON.stringify(manifest) + ";\n");
}

if (import.meta.main) {
  await optimize(resolve(process.argv[2] ?? ".tmp/screens"));
  console.log("Optimized.");
}

