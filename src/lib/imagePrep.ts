export const DEFAULT_BG = "#f4f1ea";

export function toHex(r: number, g: number, b: number) {
  return `#${[r, g, b].map((n) => Math.round(n).toString(16).padStart(2, "0")).join("")}`;
}

// Black or white text, whichever reads better on the given background.
export function inkOn(hex: string) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/iu.exec(hex);
  if (!m) return "#000000";
  const [r, g, b] = [m[1], m[2], m[3]].map((part) => parseInt(part, 16) / 255);
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const luminance = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  // WCAG contrast against each: black wins from about 18% luminance up. (A 36% cutoff put white
  // on mid tones such as #8c928b at 3.2:1, where black reads at 6.6:1.)
  const onBlack = (luminance + 0.05) / 0.05;
  const onWhite = 1.05 / (luminance + 0.05);
  return onBlack >= onWhite ? "#000000" : "#ffffff";
}

// The most common color along the image's edges (4-bit bins per channel),
// averaged within the winning bin. Transparent edges fall back to off-white.
export function edgeColor(source: CanvasImageSource, width: number, height: number) {
  const size = 64;
  const scale = size / Math.max(width, height);
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return DEFAULT_BG;
  ctx.drawImage(source, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);
  const bins = new Map<number, { count: number; r: number; g: number; b: number }>();
  const band = 2;
  let edgePixels = 0;
  let opaquePixels = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x >= band && x < w - band && y >= band && y < h - band) continue;
      const i = (y * w + x) * 4;
      edgePixels++;
      if (data[i + 3] < 200) continue;
      opaquePixels++;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
      const bin = bins.get(key) ?? { count: 0, r: 0, g: 0, b: 0 };
      bin.count++;
      bin.r += r;
      bin.g += g;
      bin.b += b;
      bins.set(key, bin);
    }
  }
  // A mostly transparent edge means the image has no background color.
  if (opaquePixels < edgePixels / 2) return DEFAULT_BG;
  let best: { count: number; r: number; g: number; b: number } | null = null;
  for (const bin of bins.values()) if (!best || bin.count > best.count) best = bin;
  if (!best) return DEFAULT_BG;
  return toHex(best.r / best.count, best.g / best.count, best.b / best.count);
}

// What to say when the browser can't open an image. Its own message ("The source image could not
// be decoded") means nothing to a member; an iPhone photo saved as HEIC is the usual cause.
export function unreadableImageMessage(file: Pick<File, "name" | "type">) {
  return /hei[cf]/iu.test(file.type) || /\.hei[cf]$/iu.test(file.name)
    ? "This browser can't open HEIC photos. Save it as a JPEG or PNG first."
    : "We couldn't open that image. Try a PNG, JPEG, or WebP.";
}

// Downsizes to at most 1024 px on the long side (the edit model's input
// limit), keeps PNG for images that may carry transparency, and samples the
// edge color from the original.
export async function prepareInspiration(file: File) {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error(unreadableImageMessage(file));
  }
  const color = edgeColor(bitmap, bitmap.width, bitmap.height);
  const scale = Math.min(1, 1024 / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not read that image.");
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const keepAlpha = file.type === "image/png" || file.type === "image/webp" || file.type === "image/gif";
  const contentType = keepAlpha ? "image/png" : "image/jpeg";
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (result) => (result ? resolve(result) : reject(new Error("Could not read that image."))),
      contentType,
      0.9,
    ),
  );
  return {
    bytes: await blob.arrayBuffer(),
    contentType,
    previewUrl: URL.createObjectURL(blob),
    color,
  };
}

export function errorMessage(error: unknown) {
  if (error && typeof error === "object" && "data" in error) {
    const data = (error as { data?: { message?: string } }).data;
    if (data?.message) return data.message;
  }
  if (error instanceof Error && error.message) return error.message.replace(/^\[CONVEX[^\]]*\]\s*/u, "");
  return "Something went wrong. Try again.";
}
