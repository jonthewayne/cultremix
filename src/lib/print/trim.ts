// The smallest rectangle holding every pixel that shows. Trimming crops to it; it never adds
// pixels, so a trimmed design is never bigger than its source.
export type Box = { left: number; top: number; width: number; height: number };

export function visibleBox(alpha: Uint8Array, width: number, height: number): Box | null {
  let left = width;
  let right = -1;
  let top = height;
  let bottom = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      if (alpha[row + x] === 0) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      bottom = y;
    }
  }
  if (right < 0) return null;
  return { left, top, width: right - left + 1, height: bottom - top + 1 };
}

// A box grown by `pad` pixels on each side, kept inside the image.
export function padBox(box: Box, pad: number, width: number, height: number): Box {
  const left = Math.max(0, box.left - pad);
  const top = Math.max(0, box.top - pad);
  const right = Math.min(width, box.left + box.width + pad);
  const bottom = Math.min(height, box.top + box.height + pad);
  return { left, top, width: right - left, height: bottom - top };
}

// Whether trimming would change anything.
export function trimsAnything(box: Box | null, width: number, height: number) {
  return box !== null && (box.width < width || box.height < height);
}
