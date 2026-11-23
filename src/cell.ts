/**
 * The content of one lattice cell as a texture: the parallelogram
 * origin + u·a + v·b (0 ≤ u, v < 1) mapped onto a width × height canvas,
 * u to the right and v downwards. Built from copies g(D) of the fundamental
 * domain, so the texture is exactly periodic (seamless when wrapped), even if
 * the photo itself is not.
 */
import type { OrbifoldDomain } from "./canonical";
import { drawOrbifold } from "./draw";
import { apply, type Isometry, type Point } from "./isometry";

export interface CellOptions {
  a: Point;
  b: Point;
  origin: Point;
  width: number;
  height: number;
  domain: Point[];
  /** Isometries whose copies g(D) cover the cell (extra ones are skipped). */
  copies: Isometry[];
  /** Draws the source content (image or motif) in world coordinates. */
  paint: (ctx: CanvasRenderingContext2D) => void;
  background?: string;
  /** Draw the orbifold marks (edge roles, gluing ticks and arrows, centers) of every copy g(D) over the content. */
  marks?: { domain: OrbifoldDomain; copies: Isometry[]; inset?: boolean; centers?: boolean };
}

export function renderCell(o: CellOptions): HTMLCanvasElement {
  const { a, b, origin, width: W, height: H } = o;
  const det = a.x * b.y - a.y * b.x;
  // World → canvas: diag(W, H) · [a b]⁻¹ · (w − origin).
  const m00 = (W * b.y) / det;
  const m01 = (-W * b.x) / det;
  const m10 = (-H * a.y) / det;
  const m11 = (H * a.x) / det;
  const e = -(m00 * origin.x + m01 * origin.y);
  const f = -(m10 * origin.x + m11 * origin.y);

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = o.background ?? "#e7e5e4";
  ctx.fillRect(0, 0, W, H);

  const centroid = average(o.domain);
  const reach = Math.max(...o.domain.map((v) => dist(v, centroid)));
  const cellCenter = { x: origin.x + (a.x + b.x) / 2, y: origin.y + (a.y + b.y) / 2 };
  const cellReach = (Math.hypot(a.x + b.x, a.y + b.y) + Math.hypot(a.x - b.x, a.y - b.y)) / 2;
  // Grow D by about one texel against seams between neighbouring copies.
  const grow = (1.5 * Math.hypot(a.x, a.y)) / W;
  const grown = o.domain.map((v) => {
    const d = dist(v, centroid) || 1;
    return { x: v.x + ((v.x - centroid.x) / d) * grow, y: v.y + ((v.y - centroid.y) / d) * grow };
  });

  ctx.imageSmoothingQuality = "high";
  for (const g of o.copies) {
    if (dist(apply(g, centroid), cellCenter) > reach + cellReach + grow) continue;
    ctx.save();
    ctx.setTransform(m00, m10, m01, m11, e, f);
    ctx.transform(g.a, g.c, g.b, g.d, g.tx, g.ty);
    ctx.beginPath();
    grown.forEach((v, k) => (k === 0 ? ctx.moveTo(v.x, v.y) : ctx.lineTo(v.x, v.y)));
    ctx.closePath();
    ctx.clip();
    o.paint(ctx);
    ctx.restore();
  }

  if (o.marks) {
    const D = o.marks.domain.polygon;
    const c = average(D);
    const r = Math.max(...D.map((v) => dist(v, c)));
    const toCanvas = (w: Point) => ({ x: m00 * w.x + m01 * w.y + e, y: m10 * w.x + m11 * w.y + f });
    // Marks sized relative to D (as on screen for a domain of ~160 px across).
    const perUnit = Math.hypot(m00, m10);
    const scale = Math.max(0.5, (perUnit * r) / 130);
    for (const g of o.marks.copies) {
      if (dist(apply(g, c), cellCenter) > r + cellReach) continue;
      drawOrbifold(ctx, (w) => toCanvas(apply(g, w)), o.marks.domain, scale, o.marks.inset, o.marks.centers ?? true);
    }
  }
  return canvas;
}

/** Texture size for a cell with sides a (horizontal) and b (vertical): long side `max` pixels. */
export function cellSize(a: Point, b: Point, max = 1024): { width: number; height: number } {
  const la = Math.hypot(a.x, a.y);
  const lb = Math.hypot(b.x, b.y);
  const k = max / Math.max(la, lb);
  return { width: Math.max(16, Math.round(la * k)), height: Math.max(16, Math.round(lb * k)) };
}

function average(ps: Point[]): Point {
  return { x: ps.reduce((s, p) => s + p.x, 0) / ps.length, y: ps.reduce((s, p) => s + p.y, 0) / ps.length };
}

const dist = (p: Point, q: Point) => Math.hypot(p.x - q.x, p.y - q.y);
