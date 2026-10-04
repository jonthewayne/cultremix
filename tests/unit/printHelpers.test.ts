import { describe, expect, it } from "vitest";
import { COMFORT_COLORS_1717, shirtColor } from "../../shared/config/print-products";
import { dilate, measureAlpha, roundSolid } from "../../src/lib/print/alpha";
import type { AlphaMetrics } from "../../src/lib/print/alpha";
import { printCheck, readyLine } from "../../src/lib/print/check";
import { offeredPrintColors } from "../../src/lib/print/colors";
import { dpiGrade, sourceDpi } from "../../src/lib/print/dpi";
import { applyKnockout, borderColor, parseHex, toHex } from "../../src/lib/print/knockout";
import {
  atTop,
  canvasPx,
  centered,
  clampPlacement,
  defaultPlacement,
  insideSafeArea,
  pixelRect,
} from "../../src/lib/print/placement";
import { padBox, trimsAnything, visibleBox } from "../../src/lib/print/trim";
import {
  CODE_PATTERN,
  encodeCode,
  isPrintFileKey,
  printFileKey,
  printPreviewKey,
  printVersionKey,
  randomCode,
} from "../../convex/lib/printKeys";

const product = COMFORT_COLORS_1717;

// A metrics record for an image with the given share of solid pixels and haze.
function metrics(width: number, height: number, solidShare = 0.4, hazeShare = 0): AlphaMetrics {
  const visible = Math.round(width * height * 0.5);
  return {
    width,
    height,
    hasAlpha: true,
    solid: Math.round(width * height * solidShare),
    visible,
    haze: Math.round(visible * hazeShare),
  };
}

describe("source DPI", () => {
  it("is pixels per printed inch, the smaller direction counting", () => {
    expect(sourceDpi(3000, 3000, 10, 10)).toBe(300);
    expect(sourceDpi(3000, 1500, 10, 10)).toBe(150);
    expect(sourceDpi(1000, 1000, 0, 5)).toBe(0);
  });

  it("refuses 149, calls 150 good and 200 great", () => {
    expect(dpiGrade(149)).toBe("refused");
    expect(dpiGrade(149.99)).toBe("refused");
    expect(dpiGrade(150)).toBe("good");
    expect(dpiGrade(199.9)).toBe("good");
    expect(dpiGrade(200)).toBe("great");
  });

  it("halves when the image is cropped to half its width at the same placed shape", () => {
    // 2000 px across 10 in is 200 DPI; the left half (1000 px) printed at the same 10 in width is 100.
    const full = sourceDpi(2000, 2000, 10, 10);
    const half = sourceDpi(1000, 2000, 10, 20);
    expect(half).toBe(full / 2);
  });

  it("matches the check's DPI for a placed design", () => {
    const at10 = printCheck(metrics(1500, 1500), { xIn: 0, yIn: 0, widthIn: 10 }, product);
    expect(at10.dpi).toBe(150);
    expect(at10.grade).toBe("good");
    const at1006 = printCheck(metrics(1500, 1500), { xIn: 0, yIn: 0, widthIn: 10.07 }, product);
    expect(at1006.grade).toBe("refused");
    expect(at1006.ready).toBe(false);
  });
});

describe("alpha, haze and coverage", () => {
  // An image: a solid square in the middle, with soft edges, on a clear background.
  function square(size: number, inset: number) {
    const alpha = new Uint8Array(size * size);
    for (let y = inset; y < size - inset; y++) for (let x = inset; x < size - inset; x++) alpha[y * size + x] = 255;
    return alpha;
  }

  it("sees transparency only when some pixel isn't solid", () => {
    expect(measureAlpha(new Uint8Array(16).fill(255), 4, 4).hasAlpha).toBe(false);
    expect(measureAlpha(square(10, 2), 10, 10).hasAlpha).toBe(true);
  });

  it("counts the model's 240-254 'solid' as solid, and rounds it up", () => {
    const alpha = new Uint8Array([240, 254, 239, 0]);
    const m = measureAlpha(alpha, 2, 2);
    expect(m.solid).toBe(2);
    expect(m.visible).toBe(3);
    expect(Array.from(roundSolid(alpha))).toEqual([255, 255, 239, 0]);
  });

  it("dilates a mark by exactly the radius", () => {
    const mask = new Uint8Array(49);
    mask[3 * 7 + 3] = 1;
    const out = dilate(mask, 7, 7, 2);
    expect(out.reduce((a, b) => a + b, 0)).toBe(25);
    expect(out[1 * 7 + 1]).toBe(1);
    expect(out[0]).toBe(0);
  });

  it("doesn't count soft edges within 2 px of solid pixels as haze", () => {
    const alpha = square(20, 5);
    // A 2 px soft ring around the square.
    for (let y = 3; y < 17; y++) for (let x = 3; x < 17; x++) if (alpha[y * 20 + x] === 0) alpha[y * 20 + x] = 120;
    const m = measureAlpha(alpha, 20, 20);
    expect(m.haze).toBe(0);
  });

  it("counts faint pixels far from any solid pixel as haze", () => {
    const alpha = square(20, 5);
    alpha[0] = 30;
    alpha[19] = 30;
    const m = measureAlpha(alpha, 20, 20);
    expect(m.haze).toBe(2);
  });

  it("warns at 6% haze and refuses at 11%", () => {
    const placement = { xIn: 3, yIn: 1, widthIn: 9 };
    const six = printCheck(metrics(2000, 2000, 0.4, 0.06), placement, product);
    expect(six.items.find((i) => i.key === "haze")?.status).toBe("warn");
    expect(six.ready).toBe(true);
    const eleven = printCheck(metrics(2000, 2000, 0.4, 0.11), placement, product);
    expect(eleven.items.find((i) => i.key === "haze")?.status).toBe("refuse");
    expect(eleven.ready).toBe(false);
    const four = printCheck(metrics(2000, 2000, 0.4, 0.04), placement, product);
    expect(four.items.find((i) => i.key === "haze")?.status).toBe("ok");
  });

  it("refuses a design without transparency", () => {
    const opaque = { ...metrics(2000, 2000, 1), hasAlpha: false };
    const check = printCheck(opaque, { xIn: 3, yIn: 1, widthIn: 9 }, product);
    expect(check.items.find((i) => i.key === "alpha")?.status).toBe("refuse");
    expect(check.ready).toBe(false);
  });

  it("measures coverage against the whole print area, refusing under 2% and over 98%", () => {
    // 40% solid over a 9 x 9 in placement in a 15 x 17 area.
    const check = printCheck(metrics(2000, 2000, 0.4), { xIn: 3, yIn: 1, widthIn: 9 }, product);
    expect(check.coverage).toBeCloseTo((0.4 * 81) / 255, 6);
    const tiny = printCheck(metrics(2000, 2000, 0.05), { xIn: 3, yIn: 1, widthIn: 4 }, product);
    expect(tiny.coverage).toBeLessThan(0.02);
    expect(tiny.items.find((i) => i.key === "coverage")?.status).toBe("refuse");
    const full = printCheck(metrics(4500, 5100, 1), { xIn: 0, yIn: 0, widthIn: 15 }, product);
    expect(full.coverage).toBeCloseTo(1, 6);
    expect(full.items.find((i) => i.key === "coverage")?.status).toBe("refuse");
  });

  it("warns past the safe line without refusing", () => {
    const check = printCheck(metrics(4000, 4000), { xIn: 0, yIn: 0, widthIn: 12 }, product);
    expect(check.items.find((i) => i.key === "safe")?.status).toBe("warn");
    expect(check.ready).toBe(true);
  });

  it("writes the work page's status line", () => {
    expect(readyLine(212.7, 11.24)).toBe("Print file ready, 212 DPI at 11.2 in");
    expect(readyLine(300, 12)).toBe("Print file ready, 300 DPI at 12.0 in");
  });
});

describe("knockout", () => {
  function image(colors: Array<[number, number, number]>) {
    const rgba = new Uint8Array(colors.length * 4);
    colors.forEach(([r, g, b], i) => rgba.set([r, g, b, 255], i * 4));
    return rgba;
  }
  const W: [number, number, number] = [255, 255, 255];
  const K: [number, number, number] = [0, 0, 0];

  it("clears the color within tolerance and keeps the rest", () => {
    const rgba = image([W, [250, 250, 250], [200, 200, 200], K]);
    const cleared = applyKnockout(rgba, 4, 1, { color: { r: 255, g: 255, b: 255 }, tolerance: 5, fromEdges: false });
    expect(cleared).toBe(2);
    expect([rgba[3], rgba[7], rgba[11], rgba[15]]).toEqual([0, 0, 255, 255]);
  });

  it("takes only the exact color at tolerance 0", () => {
    const rgba = image([W, [254, 255, 255]]);
    applyKnockout(rgba, 2, 1, { color: { r: 255, g: 255, b: 255 }, tolerance: 0, fromEdges: false });
    expect([rgba[3], rgba[7]]).toEqual([0, 255]);
  });

  it("from the edges, keeps the same color enclosed by the design", () => {
    // 5x5: white border ring, black ring, white center.
    const colors: Array<[number, number, number]> = [];
    for (let y = 0; y < 5; y++) {
      for (let x = 0; x < 5; x++) {
        const ring = Math.min(x, y, 4 - x, 4 - y);
        colors.push(ring === 1 ? K : W);
      }
    }
    const edges = image(colors);
    applyKnockout(edges, 5, 5, { color: { r: 255, g: 255, b: 255 }, tolerance: 10, fromEdges: true });
    expect(edges[12 * 4 + 3]).toBe(255);
    expect(edges[0 * 4 + 3]).toBe(0);
    const everywhere = image(colors);
    applyKnockout(everywhere, 5, 5, { color: { r: 255, g: 255, b: 255 }, tolerance: 10, fromEdges: false });
    expect(everywhere[12 * 4 + 3]).toBe(0);
  });

  it("never changes the size or moves pixels", () => {
    const rgba = image([W, K, W, K]);
    const before = rgba.length;
    applyKnockout(rgba, 2, 2, { color: { r: 255, g: 255, b: 255 }, tolerance: 50, fromEdges: true });
    expect(rgba.length).toBe(before);
    expect(Array.from(rgba.slice(4, 7))).toEqual([0, 0, 0]);
  });

  it("guesses the background from the border", () => {
    const colors: Array<[number, number, number]> = [];
    for (let i = 0; i < 9; i++) colors.push(i === 4 ? K : [250, 240, 230]);
    expect(borderColor(image(colors), 3, 3)).toEqual({ r: 250, g: 240, b: 230 });
  });

  it("reads and writes hex colors", () => {
    expect(parseHex("#ff8000")).toEqual({ r: 255, g: 128, b: 0 });
    expect(parseHex("nope")).toBeNull();
    expect(toHex({ r: 1, g: 2, b: 255 })).toBe("#0102ff");
  });
});

describe("trim", () => {
  it("finds the box around everything that shows", () => {
    const alpha = new Uint8Array(100);
    alpha[2 * 10 + 3] = 5;
    alpha[7 * 10 + 6] = 255;
    expect(visibleBox(alpha, 10, 10)).toEqual({ left: 3, top: 2, width: 4, height: 6 });
    expect(visibleBox(new Uint8Array(4), 2, 2)).toBeNull();
  });

  it("never grows past the image", () => {
    const box = padBox({ left: 1, top: 1, width: 8, height: 8 }, 4, 10, 10);
    expect(box).toEqual({ left: 0, top: 0, width: 10, height: 10 });
    expect(trimsAnything(box, 10, 10)).toBe(false);
    expect(trimsAnything({ left: 0, top: 0, width: 9, height: 10 }, 10, 10)).toBe(true);
  });
});

describe("placement", () => {
  it("defaults to 12 in wide, centered at the safe line", () => {
    const p = defaultPlacement(1, product);
    expect(p).toEqual({ xIn: 1.5, yIn: 0.5, widthIn: 12 });
    expect(insideSafeArea(p, 1, product)).toBe(true);
  });

  it("shrinks a tall design's default to fit the safe height", () => {
    const p = defaultPlacement(2, product);
    expect(p.widthIn).toBe(8);
    expect(p.yIn + p.widthIn * 2).toBeLessThanOrEqual(16.5);
  });

  it("keeps the design inside the print area", () => {
    expect(clampPlacement({ xIn: 10, yIn: -3, widthIn: 40 }, 1, product)).toEqual({ xIn: 0, yIn: 0, widthIn: 15 });
    expect(clampPlacement({ xIn: 14, yIn: 16, widthIn: 4 }, 1, product)).toEqual({ xIn: 11, yIn: 13, widthIn: 4 });
    expect(clampPlacement({ xIn: Number.NaN, yIn: 0, widthIn: 0.1 }, 1, product).widthIn).toBe(2);
  });

  it("centers and tops", () => {
    expect(centered({ xIn: 0, yIn: 4, widthIn: 10 }, product).xIn).toBe(2.5);
    expect(atTop({ xIn: 0, yIn: 4, widthIn: 10 }, product).yIn).toBe(0.5);
  });

  it("maps to whole pixels on the 4500 x 5100 canvas", () => {
    expect(canvasPx(product)).toEqual({ width: 4500, height: 5100 });
    expect(pixelRect({ xIn: 1.5, yIn: 0.5, widthIn: 12 }, 1, product)).toEqual({ left: 450, top: 150, width: 3600, height: 3600 });
    const edge = pixelRect({ xIn: 14.999, yIn: 0, widthIn: 15 }, 17 / 15, product);
    expect(edge.left + edge.width).toBeLessThanOrEqual(4500);
    expect(edge.top + edge.height).toBeLessThanOrEqual(5100);
  });
});

describe("print keys", () => {
  it("makes 26 lowercase base32 characters from 128 random bits", () => {
    const codes = new Set(Array.from({ length: 200 }, () => randomCode()));
    expect(codes.size).toBe(200);
    for (const code of codes) expect(code).toMatch(CODE_PATTERN);
  });

  it("encodes bytes as RFC 4648 base32", () => {
    expect(encodeCode(new Uint8Array(16))).toBe("a".repeat(26));
    expect(encodeCode(new Uint8Array(16).fill(255))).toBe("7".repeat(25) + "4");
    expect(() => encodeCode(new Uint8Array(8))).toThrow();
  });

  it("puts the print file under the work's three-digit expression folder", () => {
    const code = "abcdefghijklmnopqrstuvwxyz";
    expect(printFileKey(101, 1, code)).toBe(`works/101/001/print-${code}/print.png`);
    expect(printVersionKey(101, 12, code, 3)).toBe(`works/101/012/print-${code}/version-3.png`);
    expect(printPreviewKey(printFileKey(101, 1, code))).toBe(`works/101/001/print-${code}/print-preview.webp`);
    expect(isPrintFileKey(printFileKey(101, 1, code))).toBe(true);
    expect(isPrintFileKey(`works/101/001/print-short/print.png`)).toBe(false);
  });

  it("refuses guessable or malformed parts", () => {
    expect(() => printFileKey(101, 1, "ABCDEFGHIJKLMNOPQRSTUVWXYZ")).toThrow();
    expect(() => printFileKey(101, 1, "abc")).toThrow();
    expect(() => printFileKey(0, 1, "abcdefghijklmnopqrstuvwxyz")).toThrow();
    expect(() => printVersionKey(101, 1, "abcdefghijklmnopqrstuvwxyz", 0)).toThrow();
  });
});

describe("product", () => {
  it("names its sources and marks the print area unverified", () => {
    expect(product.verified).toBe(false);
    expect(product.sources.length).toBeGreaterThan(0);
    expect(product.printArea).toEqual({ widthIn: 15, heightIn: 17 });
  });

  it("falls back to the first color", () => {
    expect(shirtColor("Butter").hex).toBe("#ffe09e");
    expect(shirtColor("nope").name).toBe("Black");
  });
});

describe("offered colors", () => {
  it("maps a work's garment colors to the print product's, lead first", () => {
    expect(offeredPrintColors(["true-navy", "ivory", "black"])).toEqual(["True Navy", "Ivory", "Black"]);
  });

  it("falls back to the nearest shade and drops repeats", () => {
    expect(offeredPrintColors(["moss", "chalky-mint", "crimson", "watermelon"])).toEqual(["Sage", "Seafoam", "Brick"]);
  });

  it("is empty for a work with no offered colors or unknown keys", () => {
    expect(offeredPrintColors(undefined)).toEqual([]);
    expect(offeredPrintColors(["plaid"])).toEqual([]);
  });
});
