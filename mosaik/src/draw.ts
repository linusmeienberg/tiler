/** Rendering of image, lattice, symmetry elements and the construction onto the canvas. */
import type { Construction } from "./construction";
import type { Point } from "./isometry";
import { labels, latticeBasis, type RotationOrder, type Scene, type SceneElement } from "./scene";
import { toScreen, toWorld, type View } from "./view";

export const COLORS = {
  lattice: "#7c3aed",
  rotation: "#dc2626",
  mirror: "#2563eb",
  glide: "#059669",
  selected: "#f59e0b",
  hover: "#db2777",
};

export interface Preview {
  kind: "lattice" | "mirror" | "glide";
  from: Point;
  to: Point;
}

/** What to show of the construction (orbit, Dirichlet domain and its copies). */
export interface CoverState {
  construction: Construction;
  base: Point;
  /** Show copies g(D) and orbit points g(p) with word length ≤ maxLength. */
  maxLength: number;
  showCopies: boolean;
  showOrbit: boolean;
  hovered: number | null; // element index
}

export interface DrawState {
  cover: CoverState | null;
  view: View;
  width: number; // CSS pixels
  height: number;
  dpr: number;
  image: HTMLImageElement | null;
  scene: Scene;
  selectedId: number | null;
  preview: Preview | null;
  ghost: { center: Point; order: RotationOrder } | null;
  snapIndicator: Point | null;
}

const KIND_ORDER = { lattice: 0, mirror: 1, glide: 2, rotation: 3 };

export function draw(ctx: CanvasRenderingContext2D, st: DrawState): void {
  const { view, width, height, dpr } = st;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = "#e7e5e4";
  ctx.fillRect(0, 0, width, height);

  if (st.image) {
    ctx.save();
    ctx.setTransform(dpr * view.scale, 0, 0, dpr * view.scale, dpr * view.ox, dpr * view.oy);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(st.image, 0, 0);
    ctx.restore();
  } else {
    ctx.fillStyle = "#78716c";
    ctx.font = "15px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Bild laden oder hierher ziehen – oder »Beispiel« wählen", width / 2, height / 2);
    ctx.textAlign = "start";
  }

  if (st.cover) drawCover(ctx, st, st.cover);

  const names = labels(st.scene);
  const sorted = [...st.scene.elements].sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);
  for (const el of sorted) {
    const selected = el.id === st.selectedId;
    drawElement(ctx, st, el, selected ? COLORS.selected : COLORS[el.kind], names.get(el.id) ?? "", selected);
  }

  ctx.globalAlpha = 0.6;
  if (st.preview) {
    const { kind, from, to } = st.preview;
    const points = kind === "lattice" ? latticePreviewPoints(st.scene, from, to) : [from, to];
    drawElement(ctx, st, { id: -1, kind, points }, COLORS[kind], "", false);
  }
  if (st.ghost) glyph(ctx, toScreen(view, st.ghost.center), st.ghost.order, COLORS.rotation);
  ctx.globalAlpha = 1;

  if (st.snapIndicator) {
    const s = toScreen(view, st.snapIndicator);
    ctx.beginPath();
    ctx.arc(s.x, s.y, 7, 0, 2 * Math.PI);
    ctx.strokeStyle = "#111";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  if (st.cover) {
    const b = toScreen(view, st.cover.base);
    ctx.beginPath();
    ctx.arc(b.x, b.y, 5, 0, 2 * Math.PI);
    ctx.fillStyle = "#111";
    ctx.fill();
    ctx.strokeStyle = "white";
    ctx.lineWidth = 2;
    ctx.stroke();
    label(ctx, "p", b, "#111");
  }
}

// Viridis-like sequential ramp: word length 0 (dark) → max (light).
const RAMP = ["#440154", "#3b528b", "#21918c", "#5ec962", "#fde725"];

export function lengthColor(length: number, maxLength: number): string {
  const t = maxLength > 0 ? Math.min(length / maxLength, 1) : 0;
  const x = t * (RAMP.length - 1);
  const i = Math.min(Math.floor(x), RAMP.length - 2);
  const mix = (a: string, b: string, f: number) => {
    const ca = [1, 3, 5].map((k) => parseInt(a.slice(k, k + 2), 16));
    const cb = [1, 3, 5].map((k) => parseInt(b.slice(k, k + 2), 16));
    return `rgb(${ca.map((v, j) => Math.round(v + (cb[j] - v) * f)).join(",")})`;
  };
  return mix(RAMP[i], RAMP[i + 1], x - i);
}

function drawCover(ctx: CanvasRenderingContext2D, st: DrawState, cover: CoverState): void {
  const { construction: c, maxLength } = cover;
  const { view, width, height } = st;
  const domainReach = Math.max(...c.domain.map((v) => Math.hypot(v.x - cover.base.x, v.y - cover.base.y))) * view.scale;
  const visible = (s: Point) =>
    s.x > -domainReach && s.x < width + domainReach && s.y > -domainReach && s.y < height + domainReach;
  const polygon = (i: number) => {
    const g = c.elements[i].g;
    ctx.beginPath();
    c.domain.forEach((v, k) => {
      const w = g.a * v.x + g.b * v.y + g.tx;
      const z = g.c * v.x + g.d * v.y + g.ty;
      const s = toScreen(view, { x: w, y: z });
      if (k === 0) ctx.moveTo(s.x, s.y);
      else ctx.lineTo(s.x, s.y);
    });
    ctx.closePath();
  };

  if (cover.showCopies) {
    ctx.save();
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(255,255,255,0.75)";
    c.elements.forEach((e, i) => {
      if (e.length > maxLength || !visible(toScreen(view, c.orbit[i]))) return;
      polygon(i);
      ctx.globalAlpha = 0.38;
      ctx.fillStyle = lengthColor(e.length, c.maxLength);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.stroke();
    });
    ctx.restore();
  }

  // The domain itself, and the copy under the cursor.
  haloStroke(ctx, () => polygon(0), "#111", 2.5);
  if (cover.hovered !== null && cover.hovered > 0 && c.elements[cover.hovered].length <= maxLength) {
    haloStroke(ctx, () => polygon(cover.hovered!), COLORS.hover, 2.5);
  }

  if (cover.showOrbit) {
    ctx.save();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "white";
    ctx.fillStyle = "#111";
    c.elements.forEach((e, i) => {
      if (i === 0 || e.length > maxLength) return;
      const s = toScreen(view, c.orbit[i]);
      if (!visible(s)) return;
      ctx.beginPath();
      ctx.arc(s.x, s.y, 3, 0, 2 * Math.PI);
      ctx.fill();
      ctx.stroke();
    });
    ctx.restore();
  }
}

/** While drawing a₂, show the whole lattice-to-be. */
function latticePreviewPoints(scene: Scene, from: Point, to: Point): Point[] {
  const lat = scene.elements.find((e) => e.kind === "lattice");
  if (lat && lat.points.length === 2) {
    const o = lat.points[0];
    return [o, lat.points[1], { x: o.x + to.x - from.x, y: o.y + to.y - from.y }];
  }
  return [from, to];
}

function drawElement(
  ctx: CanvasRenderingContext2D,
  st: DrawState,
  el: SceneElement,
  color: string,
  name: string,
  selected: boolean,
): void {
  const s = el.points.map((p) => toScreen(st.view, p));
  switch (el.kind) {
    case "lattice":
      drawLattice(ctx, st, el, color);
      if (s[1]) {
        arrow(ctx, s[0], s[1], color, 2.5);
        label(ctx, "t₁", s[1], color);
      }
      if (s[2]) {
        arrow(ctx, s[0], s[2], color, 2.5);
        label(ctx, "t₂", s[2], color);
      }
      break;
    case "mirror":
      haloStroke(ctx, () => infiniteLine(ctx, s[0], s[1], st), color, 2.5);
      label(ctx, name, s[1], color);
      break;
    case "glide":
      haloStroke(ctx, () => infiniteLine(ctx, s[0], s[1], st), color, 2, [10, 6]);
      arrow(ctx, s[0], s[1], color, 2.5);
      label(ctx, name, s[1], color);
      break;
    case "rotation":
      glyph(ctx, s[0], el.order ?? 2, color);
      label(ctx, name, s[0], color);
      break;
  }
  if (el.kind !== "rotation") for (const p of s) handle(ctx, p, color, selected);
}

function drawLattice(ctx: CanvasRenderingContext2D, st: DrawState, el: SceneElement, color: string): void {
  const basis = latticeBasis({ elements: [el], nextId: 0 });
  if (!basis) return;
  const { origin, a1, a2 } = basis;
  const det = a1.x * a2.y - a1.y * a2.x;
  const coords = (w: Point) => {
    const r = { x: w.x - origin.x, y: w.y - origin.y };
    return { u: (r.x * a2.y - r.y * a2.x) / det, v: (a1.x * r.y - a1.y * r.x) / det };
  };
  const corners = [
    { x: 0, y: 0 },
    { x: st.width, y: 0 },
    { x: 0, y: st.height },
    { x: st.width, y: st.height },
  ].map((c) => coords(toWorld(st.view, c)));
  const umin = Math.floor(Math.min(...corners.map((c) => c.u)));
  const umax = Math.ceil(Math.max(...corners.map((c) => c.u)));
  const vmin = Math.floor(Math.min(...corners.map((c) => c.v)));
  const vmax = Math.ceil(Math.max(...corners.map((c) => c.v)));
  if (umax - umin + vmax - vmin > 400) return; // too dense to be useful

  const at = (u: number, v: number) =>
    toScreen(st.view, { x: origin.x + u * a1.x + v * a2.x, y: origin.y + u * a1.y + v * a2.y });
  ctx.save();
  ctx.strokeStyle = color;
  ctx.globalAlpha *= 0.4;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let u = umin; u <= umax; u++) {
    const a = at(u, vmin);
    const b = at(u, vmax);
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
  }
  for (let v = vmin; v <= vmax; v++) {
    const a = at(umin, v);
    const b = at(umax, v);
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
  }
  ctx.stroke();
  ctx.restore();
}

// --- primitives (all in screen coordinates) -------------------------------------------

function haloStroke(
  ctx: CanvasRenderingContext2D,
  path: () => void,
  color: string,
  width: number,
  dash: number[] = [],
): void {
  ctx.save();
  ctx.setLineDash(dash);
  ctx.lineCap = "round";
  ctx.beginPath();
  path();
  ctx.strokeStyle = "rgba(255,255,255,0.85)";
  ctx.lineWidth = width + 3;
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
  ctx.restore();
}

function infiniteLine(ctx: CanvasRenderingContext2D, a: Point, b: Point, st: DrawState): void {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return;
  const reach = 2 * (st.width + st.height);
  ctx.moveTo(a.x - (dx / len) * reach, a.y - (dy / len) * reach);
  ctx.lineTo(a.x + (dx / len) * reach, a.y + (dy / len) * reach);
}

function arrow(ctx: CanvasRenderingContext2D, a: Point, b: Point, color: string, width: number): void {
  const angle = Math.atan2(b.y - a.y, b.x - a.x);
  const head = 11;
  const wing = (sign: number) => ({
    x: b.x - head * Math.cos(angle + sign * 0.45),
    y: b.y - head * Math.sin(angle + sign * 0.45),
  });
  haloStroke(
    ctx,
    () => {
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      const l = wing(1);
      const r = wing(-1);
      ctx.moveTo(l.x, l.y);
      ctx.lineTo(b.x, b.y);
      ctx.lineTo(r.x, r.y);
    },
    color,
    width,
  );
}

/** Standard crystallographic symbols: lens (2), triangle (3), square (4), hexagon (6). */
function glyph(ctx: CanvasRenderingContext2D, c: Point, order: RotationOrder, color: string): void {
  ctx.beginPath();
  if (order === 2) {
    ctx.ellipse(c.x, c.y, 5, 9, 0, 0, 2 * Math.PI);
  } else {
    const radius = { 3: 10, 4: 9, 6: 9 }[order];
    const offset = order === 4 ? Math.PI / 4 : -Math.PI / 2;
    for (let k = 0; k < order; k++) {
      const angle = offset + (2 * Math.PI * k) / order;
      const x = c.x + radius * Math.cos(angle);
      const y = c.y + radius * Math.sin(angle);
      if (k === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = "white";
  ctx.lineWidth = 2;
  ctx.stroke();
}

function handle(ctx: CanvasRenderingContext2D, p: Point, color: string, selected: boolean): void {
  ctx.beginPath();
  ctx.arc(p.x, p.y, selected ? 5.5 : 4, 0, 2 * Math.PI);
  ctx.fillStyle = "white";
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.stroke();
}

function label(ctx: CanvasRenderingContext2D, text: string, p: Point, color: string): void {
  if (!text) return;
  ctx.font = "600 13px system-ui, sans-serif";
  ctx.lineWidth = 3;
  ctx.strokeStyle = "white";
  ctx.strokeText(text, p.x + 10, p.y - 10);
  ctx.fillStyle = color;
  ctx.fillText(text, p.x + 10, p.y - 10);
}
