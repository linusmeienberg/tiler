/** Pan/zoom: screen = world · scale + offset. */
import type { Point } from "./isometry";

export interface View {
  scale: number;
  ox: number;
  oy: number;
}

export const toScreen = (v: View, p: Point): Point => ({ x: p.x * v.scale + v.ox, y: p.y * v.scale + v.oy });
export const toWorld = (v: View, s: Point): Point => ({ x: (s.x - v.ox) / v.scale, y: (s.y - v.oy) / v.scale });

/** Zoom by `factor`, keeping the world point under screen point `s` fixed. */
export function zoomAt(v: View, s: Point, factor: number): View {
  const w = toWorld(v, s);
  const scale = Math.min(Math.max(v.scale * factor, 0.02), 50);
  return { scale, ox: s.x - w.x * scale, oy: s.y - w.y * scale };
}

/** View that fits a w×h world rectangle (at the origin) into a cw×ch screen area. */
export function fitRect(w: number, h: number, cw: number, ch: number, margin = 24): View {
  const scale = Math.min((cw - 2 * margin) / w, (ch - 2 * margin) / h);
  return { scale, ox: (cw - w * scale) / 2, oy: (ch - h * scale) / 2 };
}
