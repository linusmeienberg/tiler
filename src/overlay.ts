/**
 * Overlay check: rebuild the image from the content of the fundamental domain D
 * alone, by drawing D's pixels into every copy g(D), and compare the result with
 * the original. Where the drawn symmetry is right, the two agree.
 *
 * For comparison, the same measure between the image and a copy of itself
 * shifted by a generic (non-symmetry) vector: what "no symmetry at all" scores.
 */
import type { Construction } from "./construction";
import type { Point } from "./isometry";

export interface OverlayResult {
  /** Working resolution: canvas pixel = world pixel · scale. */
  scale: number;
  reconstruction: HTMLCanvasElement;
  /** Red, opacity = local difference. */
  difference: HTMLCanvasElement;
  /** Mean color difference (0…1) over the pixels covered by both. */
  mean: number;
  /** Same measure for a generic shift of the image against itself. */
  baseline: number | null;
  /** Fraction of the image covered by the reconstruction. */
  coverage: number;
}

const MAX_SIDE = 1200; // working resolution, long side
const BLUR_PX = 1; // forgive sub-pixel misalignment of photos and drawn elements

export interface Comparison {
  mean: number;
  coverage: number;
}

/**
 * Per-pixel mean absolute RGB difference (0…1) of two RGBA buffers, over the
 * pixels opaque in both. If `out` is given, writes red with opacity ∝ difference.
 */
export function compareRGBA(a: Uint8ClampedArray, b: Uint8ClampedArray, out?: Uint8ClampedArray): Comparison {
  let sum = 0;
  let count = 0;
  const pixels = a.length / 4;
  for (let i = 0; i < a.length; i += 4) {
    if (a[i + 3] < 200 || b[i + 3] < 200) continue;
    const d = (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2])) / (3 * 255);
    sum += d;
    count++;
    if (out) {
      out[i] = 220;
      out[i + 1] = 38;
      out[i + 2] = 38;
      out[i + 3] = Math.min(255, Math.round(d * 3 * 255));
    }
  }
  return { mean: count ? sum / count : 0, coverage: pixels ? count / pixels : 0 };
}

/** `domain`: the fundamental domain to rebuild from (Voronoi cell of p by default); must contain p. */
export function overlayCheck(
  image: CanvasImageSource,
  width: number,
  height: number,
  c: Construction,
  domainPolygon: Point[] = c.domain,
): OverlayResult {
  const scale = Math.min(1, MAX_SIDE / Math.max(width, height));
  const W = Math.max(1, Math.round(width * scale));
  const H = Math.max(1, Math.round(height * scale));

  const original = canvas(W, H);
  original.ctx.drawImage(image, 0, 0, W, H);

  // Rebuild: D's content, mapped by each g into g(D). In working pixels the map
  // is S·g·S⁻¹ with S = scaling by `scale`; D is grown by one pixel so that
  // antialiased clip edges do not leave seams between neighbouring copies.
  const reconstruction = canvas(W, H);
  const r = reconstruction.ctx;
  const p = c.orbit[0];
  const domain = grow(domainPolygon, p, 1 / scale);
  const reach = Math.max(...domain.map((v) => Math.hypot(v.x - p.x, v.y - p.y)));
  const xs = domain.map((v) => v.x * scale);
  const ys = domain.map((v) => v.y * scale);
  const sx = Math.max(0, Math.floor(Math.min(...xs)));
  const sy = Math.max(0, Math.floor(Math.min(...ys)));
  const sw = Math.min(W, Math.ceil(Math.max(...xs))) - sx;
  const sh = Math.min(H, Math.ceil(Math.max(...ys))) - sy;
  if (sw > 0 && sh > 0) {
    c.elements.forEach((e, i) => {
      const o = c.orbit[i];
      if (o.x < -reach || o.y < -reach || o.x > width + reach || o.y > height + reach) return;
      const g = e.g;
      r.save();
      r.setTransform(g.a, g.c, g.b, g.d, g.tx * scale, g.ty * scale);
      r.beginPath();
      domain.forEach((v, k) => (k === 0 ? r.moveTo(v.x * scale, v.y * scale) : r.lineTo(v.x * scale, v.y * scale)));
      r.closePath();
      r.clip();
      r.drawImage(original.el, sx, sy, sw, sh, sx, sy, sw, sh);
      r.restore();
    });
  }

  const a = blurred(original.el).getImageData(0, 0, W, H).data;
  const b = blurred(reconstruction.el).getImageData(0, 0, W, H).data;
  const difference = canvas(W, H);
  const diffData = difference.ctx.createImageData(W, H);
  const { mean, coverage } = compareRGBA(a, b, diffData.data);
  difference.ctx.putImageData(diffData, 0, 0);

  let baseline: number | null = null;
  if (c.translations) {
    // A generic fraction of the lattice is never a symmetry translation.
    const { t1, t2 } = c.translations;
    const v = { x: (0.37 * t1.x + 0.29 * t2.x) * scale, y: (0.37 * t1.y + 0.29 * t2.y) * scale };
    const shifted = canvas(W, H);
    shifted.ctx.drawImage(original.el, v.x, v.y);
    const cmp = compareRGBA(a, blurred(shifted.el).getImageData(0, 0, W, H).data);
    if (cmp.coverage > 0.05) baseline = cmp.mean;
  }

  return { scale, reconstruction: reconstruction.el, difference: difference.el, mean, baseline, coverage };
}

function canvas(w: number, h: number): { el: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const el = document.createElement("canvas");
  el.width = w;
  el.height = h;
  return { el, ctx: el.getContext("2d", { willReadFrequently: true })! };
}

function blurred(src: HTMLCanvasElement): CanvasRenderingContext2D {
  const { ctx } = canvas(src.width, src.height);
  ctx.filter = `blur(${BLUR_PX}px)`;
  ctx.drawImage(src, 0, 0);
  return ctx;
}

/** Push each vertex of a convex polygon away from an interior point by `by`. */
function grow(polygon: Point[], center: Point, by: number): Point[] {
  return polygon.map((v) => {
    const dx = v.x - center.x;
    const dy = v.y - center.y;
    const len = Math.hypot(dx, dy) || 1;
    return { x: v.x + (dx / len) * by, y: v.y + (dy / len) * by };
  });
}
