// Cuts a 2x2 grid of designs (one image call, see gridPrompt) into four tiles. Each tile holds
// only its own quarter's artwork, cropped to that artwork with a small clear margin on every side,
// so a design that reaches its quarter's edge never picks up a sliver of a neighbor.
//
// How: find the artwork (alpha, or distance from the edge color on an opaque image), label its
// connected shapes, and find the emptiest column and row near the middle. Each shape goes whole to
// the quarter holding most of it. Two designs that touch are cut apart at their narrow joint; one
// shape sprawled across the middle can't be cut cleanly, so the quarters it covers come back empty.
import { convertIndexedToRgb, decode, encode } from "fast-png";

export type Rgba = { width: number; height: number; data: Uint8Array };
export type GridCell = {
  index: number; // 0 top left, 1 top right, 2 bottom left, 3 bottom right
  tile: Rgba | null;
  reason?: "empty" | "merged";
  box?: { x: number; y: number; width: number; height: number }; // the artwork in the grid image
};

export type CutOptions = {
  margin?: number; // clear pixels around each tile's artwork
  alphaThreshold?: number; // alpha at or above this counts as artwork
};

const SOFT_EDGE = 2; // anti-aliased pixels kept next to a tile's own artwork
const SIDE_SHARE = 0.15; // a shape with this much of itself on both sides of a line straddles it
const NECK = 0.35; // a straddling shape this thin at the line is two touching designs

export function decodeRgba(bytes: Uint8Array): Rgba {
  const png = decode(bytes);
  const { width, height } = png;
  const count = width * height;
  let source: ArrayLike<number> = png.data;
  let channels = png.channels;
  if (png.palette) {
    source = convertIndexedToRgb(png);
    channels = source.length / count;
  } else if (png.depth < 8) {
    throw new Error("Unsupported PNG bit depth.");
  }
  const shift = png.depth === 16 ? 8 : 0;
  const data = new Uint8Array(count * 4);
  for (let i = 0; i < count; i++) {
    const s = i * channels;
    const d = i * 4;
    if (channels >= 3) {
      data[d] = source[s] >> shift;
      data[d + 1] = source[s + 1] >> shift;
      data[d + 2] = source[s + 2] >> shift;
      data[d + 3] = channels === 4 ? source[s + 3] >> shift : 255;
    } else {
      const gray = source[s] >> shift;
      data[d] = gray;
      data[d + 1] = gray;
      data[d + 2] = gray;
      data[d + 3] = channels === 2 ? source[s + 1] >> shift : 255;
    }
  }
  return { width, height, data };
}

export function encodeRgba(image: Rgba): Uint8Array {
  return encode({ width: image.width, height: image.height, data: image.data, channels: 4, depth: 8 });
}

// Artwork mask. Uses alpha when the image has real transparency; otherwise keys out the most
// common edge color (an opaque grid), and reports that so tiles skip the soft edge.
function artworkMask(image: Rgba, alphaThreshold: number) {
  const { width, height, data } = image;
  const count = width * height;
  const mask = new Uint8Array(count);
  let clear = 0;
  for (let i = 0; i < count; i++) if (data[i * 4 + 3] < 8) clear++;
  if (clear > count * 0.05) {
    for (let i = 0; i < count; i++) mask[i] = data[i * 4 + 3] >= alphaThreshold ? 1 : 0;
    return { mask, keyed: false };
  }
  const tally = new Map<number, number>();
  const sample = (x: number, y: number) => {
    const d = (y * width + x) * 4;
    const k = ((data[d] >> 3) << 10) | ((data[d + 1] >> 3) << 5) | (data[d + 2] >> 3);
    tally.set(k, (tally.get(k) ?? 0) + 1);
  };
  for (let x = 0; x < width; x += 2) {
    sample(x, 0);
    sample(x, height - 1);
  }
  for (let y = 0; y < height; y += 2) {
    sample(0, y);
    sample(width - 1, y);
  }
  let key = 0;
  let best = -1;
  for (const [k, n] of tally) if (n > best) [key, best] = [k, n];
  const bg = [((key >> 10) & 31) * 8 + 4, ((key >> 5) & 31) * 8 + 4, (key & 31) * 8 + 4];
  for (let i = 0; i < count; i++) {
    const d = i * 4;
    const diff = Math.max(Math.abs(data[d] - bg[0]), Math.abs(data[d + 1] - bg[1]), Math.abs(data[d + 2] - bg[2]));
    mask[i] = diff > 40 ? 1 : 0;
  }
  return { mask, keyed: true };
}

// 8-connected shapes: labels[i] is 1..count, or 0 for background.
function labelShapes(mask: Uint8Array, width: number, height: number) {
  const labels = new Int32Array(width * height);
  const parent: Array<number> = [0];
  const find = (a: number) => {
    while (parent[a] !== a) {
      parent[a] = parent[parent[a]];
      a = parent[a];
    }
    return a;
  };
  const join = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra < rb) parent[rb] = ra;
    else if (rb < ra) parent[ra] = rb;
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!mask[i]) continue;
      let label = 0;
      const take = (other: number) => {
        if (!other) return;
        if (!label) label = other;
        else if (other !== label) join(label, other);
      };
      if (x > 0) take(labels[i - 1]);
      if (y > 0) {
        if (x > 0) take(labels[i - width - 1]);
        take(labels[i - width]);
        if (x < width - 1) take(labels[i - width + 1]);
      }
      if (!label) {
        label = parent.length;
        parent.push(label);
      }
      labels[i] = label;
    }
  }
  const remap = new Int32Array(parent.length);
  let count = 0;
  for (let l = 1; l < parent.length; l++) {
    const root = find(l);
    if (!remap[root]) remap[root] = ++count;
    remap[l] = remap[root];
  }
  for (let i = 0; i < labels.length; i++) if (labels[i]) labels[i] = remap[labels[i]];
  return { labels, count };
}

// The emptiest line in the middle 30% (0.35-0.65), nearest the center on ties.
function emptiestLine(occupancy: Int32Array) {
  const length = occupancy.length;
  const middle = length / 2;
  let best = Math.round(middle);
  let bestCount = Number.POSITIVE_INFINITY;
  for (let p = Math.floor(length * 0.35); p <= Math.ceil(length * 0.65) && p < length; p++) {
    const n = occupancy[p];
    if (n < bestCount || (n === bestCount && Math.abs(p - middle) < Math.abs(best - middle))) {
      best = p;
      bestCount = n;
    }
  }
  return best;
}

export function cutGrid(image: Rgba, options: CutOptions = {}): Array<GridCell> {
  const margin = options.margin ?? 4;
  const { width, height, data } = image;
  const { mask, keyed } = artworkMask(image, options.alphaThreshold ?? 24);
  const { labels, count } = labelShapes(mask, width, height);

  const columns = new Int32Array(width);
  const rows = new Int32Array(height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (mask[y * width + x]) {
        columns[x]++;
        rows[y]++;
      }
    }
  }
  const splitX = emptiestLine(columns);
  const splitY = emptiestLine(rows);
  const quarterOf = (x: number, y: number) => (y >= splitY ? 2 : 0) + (x >= splitX ? 1 : 0);

  // Per shape: area in each quarter, and pixels on the split lines (for the neck test).
  const quarterArea = new Int32Array((count + 1) * 4);
  const onSplitX = new Int32Array(count + 1);
  const onSplitY = new Int32Array(count + 1);
  const bounds = new Int32Array((count + 1) * 4).fill(-1); // minX, minY, maxX, maxY
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const l = labels[y * width + x];
      if (!l) continue;
      quarterArea[l * 4 + quarterOf(x, y)]++;
      if (x === splitX) onSplitX[l]++;
      if (y === splitY) onSplitY[l]++;
      const b = l * 4;
      if (bounds[b] === -1) {
        bounds[b] = x;
        bounds[b + 1] = y;
        bounds[b + 2] = x;
        bounds[b + 3] = y;
      } else {
        if (x < bounds[b]) bounds[b] = x;
        if (x > bounds[b + 2]) bounds[b + 2] = x;
        if (y > bounds[b + 3]) bounds[b + 3] = y;
      }
    }
  }

  // Decide each shape: whole to one quarter (>= 0), split along the lines (-1), or sprawled (-2).
  const fate = new Int32Array(count + 1);
  const mergedCells = new Set<number>();
  for (let l = 1; l <= count; l++) {
    const q = [0, 1, 2, 3].map((k) => quarterArea[l * 4 + k]);
    const area = q[0] + q[1] + q[2] + q[3];
    const straddlesX = Math.min(q[0] + q[2], q[1] + q[3]) >= area * SIDE_SHARE;
    const straddlesY = Math.min(q[0] + q[1], q[2] + q[3]) >= area * SIDE_SHARE;
    if (!straddlesX && !straddlesY) {
      fate[l] = q.indexOf(Math.max(...q));
      continue;
    }
    // Thickness at the line compared with the shape's thickest column or row.
    const b = l * 4;
    const thin = (onLine: number, span: number, alongX: boolean) => {
      let thickest = 0;
      if (alongX) {
        for (let x = bounds[b]; x <= bounds[b + 2]; x++) {
          let n = 0;
          for (let y = bounds[b + 1]; y <= bounds[b + 3]; y++) if (labels[y * width + x] === l) n++;
          if (n > thickest) thickest = n;
        }
      } else {
        for (let y = bounds[b + 1]; y <= bounds[b + 3]; y++) {
          let n = 0;
          for (let x = bounds[b]; x <= bounds[b + 2]; x++) if (labels[y * width + x] === l) n++;
          if (n > thickest) thickest = n;
        }
      }
      return span > 0 && onLine <= thickest * NECK;
    };
    const cutX = !straddlesX || thin(onSplitX[l], bounds[b + 2] - bounds[b], true);
    const cutY = !straddlesY || thin(onSplitY[l], bounds[b + 3] - bounds[b + 1], false);
    if (cutX && cutY) {
      fate[l] = -1;
    } else {
      fate[l] = -2;
      for (let k = 0; k < 4; k++) if (q[k] >= area * SIDE_SHARE) mergedCells.add(k);
    }
  }

  const cellOf = (i: number, x: number, y: number) => {
    const l = labels[i];
    if (!l) return -1;
    const f = fate[l];
    return f >= 0 ? f : f === -1 ? quarterOf(x, y) : -2;
  };

  // One pass: each artwork pixel's cell, and each cell's bounds and area. (Four passes, one per
  // cell, took most of the cutting time on Convex's small servers.)
  const cellMap = new Int8Array(width * height).fill(-1);
  const boundsOf = [0, 1, 2, 3].map(() => ({ minX: width, minY: height, maxX: -1, maxY: -1, area: 0 }));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!mask[i]) continue;
      const c = cellOf(i, x, y);
      cellMap[i] = c;
      if (c < 0) continue;
      const b = boundsOf[c];
      b.area++;
      if (x < b.minX) b.minX = x;
      if (x > b.maxX) b.maxX = x;
      if (y < b.minY) b.minY = y;
      if (y > b.maxY) b.maxY = y;
    }
  }

  const minArea = Math.round((width * height) / 4 * 0.002);
  const cells: Array<GridCell> = [];
  for (let cell = 0; cell < 4; cell++) {
    if (mergedCells.has(cell)) {
      cells.push({ index: cell, tile: null, reason: "merged" });
      continue;
    }
    const { minX, minY, maxX, maxY, area } = boundsOf[cell];
    if (area < minArea) {
      cells.push({ index: cell, tile: null, reason: "empty" });
      continue;
    }

    // Copy region: the artwork plus its soft edge, never pixels that belong to another cell.
    const edge = keyed ? 0 : Math.min(SOFT_EDGE, margin);
    const rx0 = Math.max(0, minX - edge);
    const ry0 = Math.max(0, minY - edge);
    const rx1 = Math.min(width - 1, maxX + edge);
    const ry1 = Math.min(height - 1, maxY + edge);
    const rw = rx1 - rx0 + 1;
    const rh = ry1 - ry0 + 1;
    const ours = new Uint8Array(rw * rh);
    for (let y = ry0; y <= ry1; y++) {
      for (let x = rx0; x <= rx1; x++) {
        const i = y * width + x;
        if (cellMap[i] === cell) ours[(y - ry0) * rw + (x - rx0)] = 1;
      }
    }
    let near = ours;
    if (edge > 0) {
      const across = new Uint8Array(rw * rh);
      for (let y = 0; y < rh; y++) {
        for (let x = 0; x < rw; x++) {
          for (let dx = -edge; dx <= edge; dx++) {
            const xx = x + dx;
            if (xx >= 0 && xx < rw && ours[y * rw + xx]) {
              across[y * rw + x] = 1;
              break;
            }
          }
        }
      }
      near = new Uint8Array(rw * rh);
      for (let y = 0; y < rh; y++) {
        for (let x = 0; x < rw; x++) {
          for (let dy = -edge; dy <= edge; dy++) {
            const yy = y + dy;
            if (yy >= 0 && yy < rh && across[yy * rw + x]) {
              near[y * rw + x] = 1;
              break;
            }
          }
        }
      }
    }

    const tw = maxX - minX + 1 + margin * 2;
    const th = maxY - minY + 1 + margin * 2;
    const tile = new Uint8Array(tw * th * 4);
    for (let y = ry0; y <= ry1; y++) {
      for (let x = rx0; x <= rx1; x++) {
        const r = (y - ry0) * rw + (x - rx0);
        if (!near[r]) continue;
        const i = y * width + x;
        const owner = mask[i] ? cellMap[i] : cell;
        if (owner !== cell) continue;
        const s = i * 4;
        const d = ((y - minY + margin) * tw + (x - minX + margin)) * 4;
        tile[d] = data[s];
        tile[d + 1] = data[s + 1];
        tile[d + 2] = data[s + 2];
        tile[d + 3] = keyed ? 255 : data[s + 3];
      }
    }
    cells.push({
      index: cell,
      tile: { width: tw, height: th, data: tile },
      box: { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
    });
  }
  return cells;
}
