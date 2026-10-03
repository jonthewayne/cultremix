// Every stored image keeps its original (for download, publishing, and the print upscale) plus
// two smaller WebP copies made when it's stored: a thumbnail for cards, chips, and pickers, and
// a medium for design tiles, the feed, and the shop page. Both are named by the original's
// SHA-256, so copies of the same file share them. The print upscale is a fourth version kept out
// of the public bucket; see docs/image-generation/README.md.

// The longest side of each copy, in pixels. Smaller images are never enlarged.
export const SIZES = { thumb: 400, medium: 1200 } as const;
export type SizeName = keyof typeof SIZES;

export function sizeKey(sha256: string, size: SizeName) {
  return "sizes/" + sha256 + "/" + size + ".webp";
}
