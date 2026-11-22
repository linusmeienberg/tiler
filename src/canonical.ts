/**
 * Canonical fundamental domain: the orbifold drawn into the pattern. Mirrors are
 * its boundary, cone points and mirror corners are its vertices, and the other
 * edges are glued in pairs by rotations, translations or glide reflections.
 *
 * One construction for all 17 groups, from the inventory:
 *
 * 1. Mirrors in several directions: a chamber (region bounded by mirrors). If a
 *    cone point of order n lies inside, a 1/n wedge of the chamber from it (rays
 *    through chamber corners).
 * 2. Parallel mirrors: one period of the strip between neighbouring mirrors;
 *    with cone points, cut through two consecutive ones (perpendicular to the
 *    strip); with a glide axis inside the strip, the half on p's side.
 * 3. No mirrors, but rotations: the Voronoi cell of a highest-order center c
 *    among its own orbit, cut into n wedges from c, with rays through the
 *    lowest-order centers on its boundary (for 442 the kite 4-2-4-2).
 * 4. Only glides: one period of the strip between neighbouring glide axes.
 * 5. Only translations: the lattice parallelogram.
 *
 * The shape is fixed by the group and these rules alone. Where the group leaves a
 * choice – between classes of centers of equal order (333, 2222, 2*22 …), or the
 * position of cuts not through any center (**, *x, xx, o) – a fixed reference
 * point decides: the class with a member nearest to it (then by angle), and cuts
 * through it. p only selects which copy is shown: the one containing p.
 *
 * Then cone/corner points on the boundary become vertices, and every non-mirror
 * edge is matched with the edge it is glued to.
 */
import { clipByHalfPlane, dirichletDomain, type Construction } from "./construction";
import { apply, inverse, kind, type Point } from "./isometry";
import type { Inventory, Line } from "./inventory";

export type GlueKind = "rotation" | "translation" | "glide";

export interface OrbifoldEdge {
  /** Edge i runs from polygon[i] to polygon[i + 1]. */
  kind: "mirror" | "glued" | "open";
  /** For glued edges: the partner edge, the pair number and how they are glued. */
  partner?: number;
  pair?: number;
  via?: GlueKind;
  /** Arrow direction: true if drawn from polygon[i] to polygon[i+1]. */
  forward?: boolean;
}

export interface OrbifoldVertex {
  point: Point;
  order: number;
  corner: boolean;
  classIndex: number;
}

export interface OrbifoldDomain {
  polygon: Point[];
  edges: OrbifoldEdge[];
  singular: OrbifoldVertex[];
}

export type CanonicalResult = { domain: OrbifoldDomain } | { error: string };

/**
 * `reference`: decides the choices the group leaves open (see above); must not
 * depend on p, e.g. the first drawn element or the lattice origin.
 */
export function canonicalDomain(c: Construction, inv: Inventory, p: Point, reference: Point): CanonicalResult {
  if (!c.translations) return { error: "Die Gruppe hat keine zwei unabhängigen Translationen." };
  const { t1, t2 } = c.translations;
  const cell = norm(t1) + norm(t2);
  const tol = 1e-6 * cell;

  // Rank classes of centers by their member nearest to the reference point (ties: by angle).
  const rankKey = new Map<number, [number, number]>();
  for (const z of inv.centers) {
    const d = dist(z.point, reference);
    const a = (Math.atan2(z.point.y - reference.y, z.point.x - reference.x) + 2 * Math.PI) % (2 * Math.PI);
    const prev = rankKey.get(z.classIndex);
    if (!prev || d < prev[0] - 10 * tol || (Math.abs(d - prev[0]) <= 10 * tol && a < prev[1])) rankKey.set(z.classIndex, [d, a]);
  }
  const preferred = (classIndices: number[]): number =>
    [...new Set(classIndices)].sort((i, j) => {
      const [di, ai] = rankKey.get(i) ?? [Infinity, 0];
      const [dj, aj] = rankKey.get(j) ?? [Infinity, 0];
      return Math.abs(di - dj) > 10 * tol ? di - dj : ai - aj;
    })[0];
  // Everything is built at the reference point (nudged off any symmetry element
  // by a fixed tiny offset), never at p – so the shape cannot depend on p.
  const q = { x: reference.x + 0.0123 * cell, y: reference.y + 0.0071 * cell };
  // Cut positions along u not fixed by any center: through the reference point, one period T apart, around p.
  const periodAround = (u: Point, T: number): [number, number] => {
    const s0 = dot(reference, u);
    const lo = s0 + Math.floor((dot(q, u) - s0) / T) * T;
    return [lo, lo + T];
  };
  const box = square(q, 3 * cell);
  const mirrors = inv.mirrors.filter((l) => distToLine(q, l) <= 4 * cell);
  const cones = inv.centers.filter((z) => !inv.classes[z.classIndex].corner);

  let d0: Point[];
  if (mirrors.length > 0) {
    const parallel = mirrors.every((l) => Math.abs(cross(l.u, mirrors[0].u)) < 1e-9);
    const chamber = simplify(mirrors.reduce((poly, l) => keepSide(poly, l, q), box), tol);
    if (!parallel) {
      const inside = cones.filter((z) => strictlyInside(z.point, chamber, tol));
      if (inside.length === 0) d0 = chamber;
      else {
        // Rays from the cone point through chamber corners of the preferred class.
        const corners = inv.centers.filter((z) => chamber.some((v) => dist(v, z.point) < 10 * tol));
        const k = preferred(corners.map((z) => z.classIndex));
        const v = corners.find((z) => z.classIndex === k)?.point ?? chamber[0];
        d0 = wedge(chamber, inside[0].point, inside[0].order, v, tol);
      }
    } else {
      // A strip between two neighbouring mirrors.
      const u = mirrors[0].u;
      const T = norm(shortestAlong(u, t1, t2));
      const inStrip = cones.filter((z) => strictlyInside(z.point, chamber, tol) && Math.abs(dot(sub(z.point, q), u)) < 2 * T);
      let strip: Point[];
      if (inStrip.length > 0) {
        // Cut through a cone point and the next one along the strip.
        const sorted = inStrip.map((z) => z.point).sort((a, b) => dot(a, u) - dot(b, u));
        const k = sorted.findIndex((z) => dot(z, u) >= dot(q, u) - tol);
        const z0 = sorted[k === -1 ? sorted.length - 2 : Math.max(0, k - 1)];
        const z1 = sorted.find((z) => dot(z, u) > dot(z0, u) + tol);
        if (!z1) return { error: "Zu wenige Drehzentren im Streifen gefunden." };
        strip = slab(chamber, u, dot(z0, u), dot(z1, u));
      } else {
        strip = slab(chamber, u, ...periodAround(u, T));
        const axis = inv.glides.find((l) => Math.abs(cross(l.u, u)) < 1e-9 && strictlyInsideLine(l, chamber, tol));
        if (axis) {
          strip = keepSide(strip, axis, q);
        }
      }
      d0 = strip;
    }
  } else if (cones.length > 0) {
    const maxOrder = Math.max(...cones.map((z) => z.order));
    const top = cones.filter((z) => z.order === maxOrder);
    const k0 = preferred(top.map((z) => z.classIndex));
    const c0 = top.filter((z) => z.classIndex === k0).sort((a, b) => dist(a.point, q) - dist(b.point, q))[0];
    const orbitPoints = c.elements.map((e) => apply(e.g, c0.point)).filter((q) => dist(q, c0.point) <= 3 * cell);
    let cellPoly = simplify(dirichletDomain(c0.point, orbitPoints, 2 * cell), tol);
    const onBoundary = inv.centers.filter((z) => onPolygonBoundary(z.point, cellPoly, tol));
    cellPoly = insertPoints(cellPoly, onBoundary.map((z) => z.point), tol);
    const minOrder = Math.min(...onBoundary.map((z) => z.order));
    const lowest = onBoundary.filter((z) => z.order === minOrder);
    const k1 = preferred(lowest.map((z) => z.classIndex));
    const v = lowest.length > 0 ? lowest.find((z) => z.classIndex === k1)!.point : cellPoly[0];
    d0 = wedge(cellPoly, c0.point, c0.order, v, tol);
  } else if (inv.glides.length > 0) {
    const u = inv.glides[0].u;
    const parallelAxes = inv.glides.filter((l) => Math.abs(cross(l.u, u)) < 1e-9);
    const T = norm(shortestAlong(u, t1, t2));
    const strip = parallelAxes.filter((l) => distToLine(q, l) <= 2 * cell).reduce((poly, l) => keepSide(poly, l, q), box);
    d0 = slab(strip, u, ...periodAround(u, T));
  } else {
    // The lattice parallelogram with a corner at the reference point.
    const o = reference;
    d0 = [o, add(o, t1), add(add(o, t1), t2), add(o, t2)];
  }

  // The copy that contains p. On a boundary between copies (p on a mirror, a
  // center or a glued edge) the first in BFS order wins.
  d0 = simplify(d0, tol, inv.centers.map((z) => z.point));
  const hit = c.elements.find((e) => insideConvex(apply(inverse(e.g), p), d0, tol));
  if (!hit) return { error: "Kein Bereich enthält p." };
  let polygon = d0.map((v) => apply(hit.g, v));
  polygon = orientCCW(polygon);
  polygon = insertPoints(polygon, inv.centers.map((z) => z.point), tol);

  const glued = glue(polygon, c, inv.mirrors, tol);
  const singular: OrbifoldVertex[] = [];
  for (const v of glued.polygon) {
    const z = inv.centers.find((q) => dist(q.point, v) < 10 * tol);
    if (z) singular.push({ point: v, order: z.order, corner: inv.classes[z.classIndex].corner, classIndex: z.classIndex });
  }
  return { domain: { polygon: glued.polygon, edges: glued.edges, singular } };
}

/** Index of the copy g(D) containing q (point-in-polygon), or -1. */
export function copyContaining(c: Construction, polygon: Point[], q: Point): number {
  const tol = 1e-9;
  let best = -1;
  let bestDist = Infinity;
  c.elements.forEach((e, i) => {
    const local = apply(inverse(e.g), q);
    if (!insideConvex(local, polygon, tol)) return;
    // On a shared edge several copies qualify: take the one with the nearest centroid.
    const d = dist(apply(e.g, centroidOf(polygon)), q);
    if (d < bestDist) {
      best = i;
      bestDist = d;
    }
  });
  return best;
}

// --- gluing ------------------------------------------------------------------------

function glue(
  start: Point[],
  c: Construction,
  allMirrors: Line[],
  tol: number,
): { polygon: Point[]; edges: OrbifoldEdge[] } {
  let polygon = start;
  for (let attempt = 0; attempt < 2; attempt++) {
    const centroid = centroidOf(polygon);
    const diam = Math.max(...polygon.map((v) => dist(v, centroid)));
    const candidates = c.elements
      .map((e) => e.g)
      .filter((g) => kind(g) !== "identity" && dist(apply(g, centroid), centroid) <= 2 * diam + tol);
    const n = polygon.length;
    const edges: OrbifoldEdge[] = polygon.map(() => ({ kind: "open" }));
    const isMirror = (i: number) => {
      const a = polygon[i];
      const b = polygon[(i + 1) % n];
      return allMirrors.some((l) => distToLine(a, l) < 10 * tol && distToLine(b, l) < 10 * tol);
    };
    for (let i = 0; i < n; i++) if (isMirror(i)) edges[i] = { kind: "mirror" };

    let pair = 0;
    for (let i = 0; i < n; i++) {
      if (edges[i].kind !== "open") continue;
      const a = polygon[i];
      const b = polygon[(i + 1) % n];
      search: for (const g of candidates) {
        const ga = apply(g, a);
        const gb = apply(g, b);
        for (let j = 0; j < n; j++) {
          if (j === i || edges[j].kind !== "open") continue;
          const x = polygon[j];
          const y = polygon[(j + 1) % n];
          const same = dist(ga, x) < 10 * tol && dist(gb, y) < 10 * tol;
          const flipped = dist(ga, y) < 10 * tol && dist(gb, x) < 10 * tol;
          if (!same && !flipped) continue;
          // g(D) must lie across edge j, i.e. be the neighbour there.
          if (!separatesBy(x, y, centroid, apply(g, centroid), tol)) continue;
          const k = kind(g);
          const via: GlueKind = k === "rotation" ? "rotation" : k === "translation" ? "translation" : "glide";
          edges[i] = { kind: "glued", partner: j, pair, via, forward: true };
          edges[j] = { kind: "glued", partner: i, pair, via, forward: same };
          pair++;
          break search;
        }
      }
    }
    if (edges.every((e) => e.kind !== "open") || attempt === 1) return { polygon, edges };
    // Edges along a glide axis are glued half to half: split them at the midpoint.
    const split: Point[] = [];
    polygon.forEach((v, i) => {
      split.push(v);
      if (edges[i].kind === "open") {
        const w = polygon[(i + 1) % n];
        split.push({ x: (v.x + w.x) / 2, y: (v.y + w.y) / 2 });
      }
    });
    polygon = split;
  }
  return { polygon, edges: polygon.map(() => ({ kind: "open" })) };
}

// --- geometry ----------------------------------------------------------------------

/**
 * The part of a convex polygon between the rays from c through v and through
 * R(v), R the rotation by 2π/n about c in the polygon's direction of traversal.
 */
function wedge(polygon: Point[], c: Point, n: number, v: Point, tol: number): Point[] {
  const ccw = orientCCW(polygon);
  const sign = signedArea(ccw) > 0 ? 1 : -1;
  const angle = (sign * 2 * Math.PI) / n;
  const w = rotate(v, c, angle);
  const poly = insertPoints(ccw, [v, w], tol);
  const iv = poly.findIndex((q) => dist(q, v) < 10 * tol);
  const iw = poly.findIndex((q) => dist(q, w) < 10 * tol);
  const out: Point[] = [c];
  for (let k = iv; ; k = (k + 1) % poly.length) {
    out.push(poly[k]);
    if (k === iw) break;
  }
  return out;
}

function keepSide(polygon: Point[], l: Line, p: Point): Point[] {
  const n = { x: -l.u.y, y: l.u.x };
  const s = dot(sub(p, l.a), n);
  return clipByHalfPlane(polygon, l.a, s > 0 ? { x: -n.x, y: -n.y } : n);
}

/** Part of the polygon with lo ≤ x·u ≤ hi. */
function slab(polygon: Point[], u: Point, lo: number, hi: number): Point[] {
  const at = (s: number) => ({ x: u.x * s, y: u.y * s });
  return clipByHalfPlane(clipByHalfPlane(polygon, at(hi), u), at(lo), { x: -u.x, y: -u.y });
}

/** Shortest nonzero lattice vector parallel to u. */
function shortestAlong(u: Point, t1: Point, t2: Point): Point {
  let best: Point | null = null;
  for (let m = -8; m <= 8; m++) {
    for (let k = -8; k <= 8; k++) {
      if (m === 0 && k === 0) continue;
      const v = { x: m * t1.x + k * t2.x, y: m * t1.y + k * t2.y };
      if (Math.abs(cross(v, u)) > 1e-6 * norm(v)) continue;
      if (!best || norm(v) < norm(best)) best = v;
    }
  }
  return best ?? t1;
}

function square(c: Point, h: number): Point[] {
  return [
    { x: c.x - h, y: c.y - h },
    { x: c.x + h, y: c.y - h },
    { x: c.x + h, y: c.y + h },
    { x: c.x - h, y: c.y + h },
  ];
}

function insertPoints(polygon: Point[], points: Point[], tol: number): Point[] {
  const out: Point[] = [];
  polygon.forEach((a, i) => {
    out.push(a);
    const b = polygon[(i + 1) % polygon.length];
    const len = dist(a, b);
    const onEdge = points
      .map((q) => ({ q, t: dot(sub(q, a), sub(b, a)) / (len * len) }))
      .filter(({ q, t }) => t * len > 10 * tol && (1 - t) * len > 10 * tol && segmentDistance(q, a, b) < 10 * tol)
      .sort((x, y) => x.t - y.t);
    for (const { q } of onEdge) if (!out.some((o) => dist(o, q) < 10 * tol)) out.push(q);
  });
  return out;
}

function onPolygonBoundary(q: Point, polygon: Point[], tol: number): boolean {
  return polygon.some((a, i) => segmentDistance(q, a, polygon[(i + 1) % polygon.length]) < 10 * tol);
}

function strictlyInside(q: Point, polygon: Point[], tol: number): boolean {
  return insideConvex(q, polygon, -10 * tol);
}

function strictlyInsideLine(l: Line, polygon: Point[], tol: number): boolean {
  const n = { x: -l.u.y, y: l.u.x };
  const sides = polygon.map((v) => dot(sub(v, l.a), n));
  return Math.max(...sides) > 10 * tol && Math.min(...sides) < -10 * tol;
}

/** Inside or within `tol` of a convex polygon (either orientation); negative tol: strictly inside. */
export function insideConvex(q: Point, polygon: Point[], tol: number): boolean {
  const s = signedArea(polygon) > 0 ? 1 : -1;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    const len = dist(a, b);
    if (len < 1e-9) continue;
    if ((s * cross(sub(b, a), sub(q, a))) / len < -tol) return false;
  }
  return true;
}

function separatesBy(x: Point, y: Point, q1: Point, q2: Point, tol: number): boolean {
  const e = sub(y, x);
  const s1 = cross(e, sub(q1, x));
  const s2 = cross(e, sub(q2, x));
  return (s1 > tol && s2 < -tol) || (s1 < -tol && s2 > tol);
}

function segmentDistance(q: Point, a: Point, b: Point): number {
  const ab = sub(b, a);
  const t = Math.max(0, Math.min(1, dot(sub(q, a), ab) / dot(ab, ab)));
  return dist(q, { x: a.x + t * ab.x, y: a.y + t * ab.y });
}

function rotate(v: Point, c: Point, angle: number): Point {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const d = sub(v, c);
  return { x: c.x + cos * d.x - sin * d.y, y: c.y + sin * d.x + cos * d.y };
}

function signedArea(polygon: Point[]): number {
  let s = 0;
  for (let i = 0; i < polygon.length; i++) s += cross(polygon[i], polygon[(i + 1) % polygon.length]);
  return s / 2;
}

function orientCCW(polygon: Point[]): Point[] {
  return signedArea(polygon) >= 0 ? polygon : [...polygon].reverse();
}

/**
 * Merge near-duplicate vertices and drop vertices on a straight line (repeated
 * clipping leaves both), except those in `keep` (e.g. a cone point where an
 * edge is folded).
 */
function simplify(polygon: Point[], tol: number, keep: Point[] = []): Point[] {
  let out: Point[] = [];
  for (const v of polygon) if (!out.length || dist(v, out[out.length - 1]) > 10 * tol) out.push(v);
  while (out.length > 1 && dist(out[0], out[out.length - 1]) <= 10 * tol) out.pop();
  let changed = true;
  while (changed && out.length > 3) {
    changed = false;
    for (let i = 0; i < out.length; i++) {
      const a = out[(i + out.length - 1) % out.length];
      const v = out[i];
      const b = out[(i + 1) % out.length];
      const straight = Math.abs(cross(sub(v, a), sub(b, v))) / (dist(a, v) * dist(v, b)) < 1e-9 && dot(sub(v, a), sub(b, v)) > 0;
      if (straight && !keep.some((k) => dist(k, v) < 10 * tol)) {
        out = out.filter((_, j) => j !== i);
        changed = true;
        break;
      }
    }
  }
  return out;
}

export function centroidOf(polygon: Point[]): Point {
  const a = signedArea(polygon);
  if (Math.abs(a) < 1e-12) return polygon[0];
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < polygon.length; i++) {
    const p = polygon[i];
    const q = polygon[(i + 1) % polygon.length];
    const cr = cross(p, q);
    cx += (p.x + q.x) * cr;
    cy += (p.y + q.y) * cr;
  }
  return { x: cx / (6 * a), y: cy / (6 * a) };
}

const sub = (a: Point, b: Point) => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a: Point, b: Point) => ({ x: a.x + b.x, y: a.y + b.y });
const dot = (a: Point, b: Point) => a.x * b.x + a.y * b.y;
const cross = (a: Point, b: Point) => a.x * b.y - a.y * b.x;
const norm = (a: Point) => Math.hypot(a.x, a.y);
const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const distToLine = (q: Point, l: Line) => Math.abs(cross(l.u, sub(q, l.a)));
