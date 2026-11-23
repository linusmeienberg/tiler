/**
 * Generation mode, without DOM: a chosen wallpaper group realized on a lattice,
 * its Dirichlet domain D around p, and the copies (u·a₁ + v·a₂) ∘ coset that
 * cover a given rectangle. Every group element is exactly one such product, so
 * the copies of D tile the plane.
 */
import { canonicalDomain, insideConvex, type OrbifoldDomain } from "./canonical";
import { construct, type Construction } from "./construction";
import type { Realization } from "./groups";
import { apply, compose, inverse, translation, type Isometry, type Point } from "./isometry";
import { inventory, type Inventory } from "./inventory";

export type DomainMode = "voronoi" | "orbifold";

export interface Tiling {
  realization: Realization;
  base: Point; // p, in world coordinates
  domain: Point[];
  /** Primitive translation basis (for centered lattices smaller than the conventional a₁, a₂). */
  translations: { t1: Point; t2: Point };
  /** Set when the canonical domain is used: edge roles and singular points for drawing. */
  orbifold: OrbifoldDomain | null;
  /** Why the orbifold was not available (the Voronoi cell is used instead). */
  orbifoldError: string | null;
  /** Inventory (only computed in orbifold mode). */
  inventory: Inventory | null;
  centroid: Point;
  /** Max distance of a domain vertex from the centroid. */
  reach: number;
}

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Fractional coordinates (u, v) of p in the lattice basis → tiling, or null if p lies on a symmetry element. */
export function buildTiling(realization: Realization, baseFrac: Point, mode: DomainMode = "voronoi"): Tiling | null {
  const { a1, a2 } = realization;
  const base = { x: baseFrac.x * a1.x + baseFrac.y * a2.x, y: baseFrac.x * a1.y + baseFrac.y * a2.y };
  const cell = Math.hypot(a1.x, a1.y) + Math.hypot(a2.x, a2.y);
  const c = construct(realization.generators, base, { radius: 3 * cell });
  if (c.onElement || c.copiesPerCell === null) return null;
  let domain = c.domain;
  let orbifold: OrbifoldDomain | null = null;
  let orbifoldError: string | null = null;
  let inv: Inventory | null = null;
  if (mode === "orbifold") {
    inv = inventory(c, base);
    // Reference for the choices the group leaves open: the origin of the group table.
    const r = inv ? canonicalDomain(c, inv, base, { x: 0, y: 0 }) : { error: "keine Inventur" };
    if ("error" in r) orbifoldError = r.error;
    else {
      domain = r.domain.polygon;
      orbifold = r.domain;
    }
  }
  const centroid = polygonCentroid(domain);
  const reach = Math.max(...domain.map((v) => Math.hypot(v.x - centroid.x, v.y - centroid.y)));
  return { realization, base, domain, translations: c.translations!, orbifold, orbifoldError, inventory: inv, centroid, reach };
}

/**
 * A group found in the analysis, as lattice + cosets: one element per coset of
 * the translation lattice, with its translation reduced into the unit cell.
 * Null unless the construction is a proper wallpaper group.
 */
export function realizationFromConstruction(c: Construction): Realization | null {
  if (!c.translations || c.copiesPerCell === null) return null;
  const { t1: a1, t2: a2 } = c.translations;
  const lattice = { a1, a2, cosets: [], generators: [] };
  const keys = new Set<string>();
  const cosets: Isometry[] = [];
  for (const { g } of c.elements) {
    const f = toFractional(lattice, { x: g.tx, y: g.ty });
    const u = f.x - Math.floor(f.x + 1e-7);
    const v = f.y - Math.floor(f.y + 1e-7);
    const key = [g.a, g.b, g.c, g.d, u, v].map((x) => Math.round(x * 1e5)).join(",");
    if (keys.has(key)) continue;
    keys.add(key);
    cosets.push({ ...g, tx: u * a1.x + v * a2.x, ty: u * a1.y + v * a2.y });
  }
  if (cosets.length !== Math.round(c.copiesPerCell)) return null;
  // Identity first (elements[0] is the identity, so its coset comes first).
  return {
    a1,
    a2,
    cosets,
    generators: [
      { name: "t₁", g: translation(a1) },
      { name: "t₂", g: translation(a2) },
      ...cosets.slice(1).map((g, i) => ({ name: `g${i + 1}`, g })),
    ],
  };
}

/** p in fractional coordinates of the tiling's lattice. */
export function toFractional(r: { a1: Point; a2: Point }, w: Point): Point {
  const { a1, a2 } = r;
  const det = a1.x * a2.y - a1.y * a2.x;
  return { x: (w.x * a2.y - w.y * a2.x) / det, y: (a1.x * w.y - a1.y * w.x) / det };
}

/**
 * The copies of D that meet `rect`, as isometries g with copy = g(D); null if
 * there would be more than `max` (zoomed out too far).
 */
export function visibleCopies(t: Tiling, rect: Rect, max = 6000): Isometry[] | null {
  const { a1, a2, cosets } = t.realization;
  const out: Isometry[] = [];
  const pad = t.reach;
  for (const g of cosets) {
    const c = apply(g, t.centroid);
    const corners = [
      { x: rect.x0 - pad - c.x, y: rect.y0 - pad - c.y },
      { x: rect.x1 + pad - c.x, y: rect.y0 - pad - c.y },
      { x: rect.x0 - pad - c.x, y: rect.y1 + pad - c.y },
      { x: rect.x1 + pad - c.x, y: rect.y1 + pad - c.y },
    ].map((q) => toFractional(t.realization, q));
    const u0 = Math.floor(Math.min(...corners.map((q) => q.x)));
    const u1 = Math.ceil(Math.max(...corners.map((q) => q.x)));
    const v0 = Math.floor(Math.min(...corners.map((q) => q.y)));
    const v1 = Math.ceil(Math.max(...corners.map((q) => q.y)));
    if ((u1 - u0 + 1) * (v1 - v0 + 1) * cosets.length > 4 * max) return null;
    for (let u = u0; u <= u1; u++) {
      for (let v = v0; v <= v1; v++) {
        const T = { x: u * a1.x + v * a2.x, y: u * a1.y + v * a2.y };
        const x = c.x + T.x;
        const y = c.y + T.y;
        if (x < rect.x0 - pad || x > rect.x1 + pad || y < rect.y0 - pad || y > rect.y1 + pad) continue;
        out.push(compose(translation(T), g));
        if (out.length > max) return null;
      }
    }
  }
  return out;
}

/** The copy containing q (point in polygon; for the Voronoi cell also the one with the nearest image of p). */
export function copyAt(t: Tiling, q: Point): Isometry {
  const near = visibleCopies(t, { x0: q.x, y0: q.y, x1: q.x, y1: q.y }) ?? [];
  const containing = near.find((g) => insideConvex(apply(inverse(g), q), t.domain, 1e-9));
  if (containing) return containing;
  let best = near[0];
  let bestDist = Infinity;
  for (const g of near) {
    const o = apply(g, t.base);
    const d = (o.x - q.x) ** 2 + (o.y - q.y) ** 2;
    if (d < bestDist) {
      best = g;
      bestDist = d;
    }
  }
  return best;
}

export function polygonCentroid(polygon: Point[]): Point {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < polygon.length; i++) {
    const p = polygon[i];
    const q = polygon[(i + 1) % polygon.length];
    const cr = p.x * q.y - q.x * p.y;
    a += cr;
    cx += (p.x + q.x) * cr;
    cy += (p.y + q.y) * cr;
  }
  return { x: cx / (3 * a), y: cy / (3 * a) };
}
