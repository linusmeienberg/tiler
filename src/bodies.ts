/**
 * The orbifold as a body in space, built from the canonical domain D by rolling
 * or folding – without three.js, as plain triangle data:
 *
 * - Kaleidoscopes (*2222, *442, *333, *632): D itself, flat.
 * - ** : D rolled into a cylinder (the translation-glued edges meet).
 * - 4*2, 3*3, 2*22: D rolled around its cone point into a cone (party hat).
 * - 442, 632, 333, 22*: D folded along the line through the two vertices where
 *   an edge is glued to its neighbour (a "pillow": doubled polygon; for 22* a
 *   pocket, open along the mirror). Flat when exact; `inflate` puffs it up.
 * - 2222: a tetrahedron – the triangle of three equivalent 2-fold centers,
 *   folded along its medial triangle.
 *
 * All of these are isometric (the texture is not distorted), except for the
 * inflation of pillows. The non-orientable ones cannot be built undistorted (or
 * at all without self-intersection) and use standard immersions of a
 * parameter rectangle cut from the pattern so that its edges are glued as the
 * immersion requires:
 *
 * - *x : the strip between two neighbouring mirrors, half a period long – its
 *   cut edges are glued flipped by the glide on the midline: a Möbius band.
 * - xx : from one glide axis to the next but one, half a period long – long
 *   edges glued straight (translation), cut edges flipped: a Klein bottle
 *   (figure-8 immersion).
 * - 22x: the rectangle with four 2-fold centers as corners along the two glide
 *   directions – every boundary point is glued to the opposite one (point
 *   reflection in the center): a disk with antipodal boundary, i.e. the
 *   projective plane, shown as a cross-cap. Coordinates: "display" = (x, −y) of the image, so that
 * the pattern keeps its orientation when seen from outside.
 */
import type { OrbifoldDomain } from "./canonical";
import type { Line } from "./inventory";
import type { Point } from "./isometry";

export type BodyKind = "flat" | "cylinder" | "cone" | "pillow" | "tetrahedron" | "moebius" | "klein" | "crosscap";

/** A parallelogram of the pattern: origin + [0,1]·a + [0,1]·b (texture: a to the right, b up). */
export interface Region {
  origin: Point;
  a: Point;
  b: Point;
}
export type Vec3 = [number, number, number];

export interface BodyMesh {
  kind: BodyKind;
  positions: number[]; // xyz per vertex
  uvs: number[]; // uv per vertex in the texture of `region` (v up)
  indices: number[];
  /** Planar (world) coordinates per vertex – for tests and distortion checks. */
  planar: Point[];
  region: Region;
  /** The texture covers a whole period along a; a slider may shift it (offset.x, wrapping). */
  shiftable?: boolean;
  /** Typical stretch of the texture (5th and 95th percentile), for distorted bodies. */
  stretch?: [number, number];
  markers: { pos: Vec3; order: number; classIndex: number; corner: boolean }[];
  mirrors: Vec3[][]; // polylines along mirror edges
  /** Where a point of D (world coordinates) ends up on the body (not for the tetrahedron). */
  place?: (w: Point) => Vec3;
}

/** Symmetry elements and lattice, for the bodies cut from the pattern rather than from D. */
export interface GroupLines {
  mirrors: Line[];
  glides: Line[];
  centers: { point: Point; order: number; classIndex: number }[];
  t1: Point;
  t2: Point;
  reference: Point;
}

export interface BodyOptions {
  inflate?: number; // 0…1, pillows only
  detail?: number; // subdivisions per fan triangle
  /** Needed for 2222 (the tetrahedron is cut from the lattice, not from D). */
  lattice?: { t1: Point; t2: Point };
  /** Needed for *x, xx, 22x. */
  lines?: GroupLines;
}

/** Which body a symbol gets (null: not built yet). */
export function bodyKind(symbol: string): BodyKind | null {
  if (["*2222", "*442", "*333", "*632"].includes(symbol)) return "flat";
  if (symbol === "**") return "cylinder";
  if (["4*2", "3*3", "2*22"].includes(symbol)) return "cone";
  if (["442", "632", "333", "22*"].includes(symbol)) return "pillow";
  if (symbol === "2222") return "tetrahedron";
  if (symbol === "*x") return "moebius";
  if (symbol === "xx") return "klein";
  if (symbol === "22x") return "crosscap";
  return null;
}

export function buildBody(symbol: string, d: OrbifoldDomain, opts: BodyOptions = {}): BodyMesh | null {
  const kind = bodyKind(symbol);
  if (!kind) return null;
  const detail = opts.detail ?? 16;
  if (kind === "tetrahedron") return opts.lattice ? tetrahedron(d, opts.lattice) : null;
  if (kind === "moebius" || kind === "klein" || kind === "crosscap") return opts.lines ? immersion(kind, opts.lines) : null;

  // Work in display coordinates, counter-clockwise.
  let poly = d.polygon.map(disp);
  let edges = d.edges;
  if (signedArea(poly) < 0) {
    // Reverse vertex order; edge i (v_i → v_i+1) becomes edge n−2−i … keep a mapping.
    const n = poly.length;
    poly = [...poly].reverse();
    const old = edges;
    edges = poly.map((_, i) => old[(2 * n - 2 - i) % n]);
    // Partner indices refer to old numbering; remap them.
    edges = edges.map((e) => (e.partner === undefined ? e : { ...e, partner: (2 * n - 2 - e.partner) % n }));
  }
  const isMirror = (a: Point, b: Point) =>
    poly.some((v, i) => edges[i].kind === "mirror" && onSegment(a, v, poly[(i + 1) % poly.length]) && onSegment(b, v, poly[(i + 1) % poly.length]));

  let map: (q: Point) => Vec3;
  let pieces: Point[][] = [poly];

  if (kind === "flat") {
    map = (q) => [q.x, q.y, 0];
  } else if (kind === "cylinder") {
    const i = edges.findIndex((e) => e.kind === "mirror");
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const T = dist(a, b);
    const u = scale(sub(b, a), 1 / T);
    const nrm = { x: -u.y, y: u.x };
    const rho = T / (2 * Math.PI);
    map = (q) => {
      const s = dot(sub(q, a), u);
      const t = dot(sub(q, a), nrm);
      return [rho * Math.cos(s / rho), rho * Math.sin(s / rho), t];
    };
  } else if (kind === "cone") {
    const apex = d.singular.find((v) => !v.corner);
    if (!apex) return null;
    const c0 = disp(apex.point);
    const k = poly.findIndex((v) => dist(v, c0) < 1e-6 * size(poly));
    const next = poly[(k + 1) % poly.length];
    const n = apex.order;
    const phi0 = Math.atan2(next.y - c0.y, next.x - c0.x);
    const sin = 1 / n;
    const cos = Math.sqrt(1 - sin * sin);
    map = (q) => {
      const r = dist(q, c0);
      let phi = Math.atan2(q.y - c0.y, q.x - c0.x) - phi0;
      phi = ((phi % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      if (phi > (2 * Math.PI) / n + 1e-9) phi = 0; // numerical wrap at the first ray
      const psi = n * phi;
      return [r * sin * Math.cos(psi), r * sin * Math.sin(psi), -r * cos];
    };
  } else {
    // Pillow: fold along the line through the vertices where two glued edges meet.
    const n = poly.length;
    const fold = poly.filter((_, i) => edges[(i + n - 1) % n].partner === i);
    if (fold.length !== 2) return null;
    const [A, B] = fold;
    const side = (q: Point) => cross(sub(B, A), sub(q, A));
    const left = clip(poly, A, B, 1);
    const right = clip(poly, A, B, -1);
    pieces = [left, right];
    const reflect = (q: Point) => {
      const u = scale(sub(B, A), 1 / dist(A, B));
      const w = sub(q, A);
      const along = dot(w, u);
      return { x: A.x + 2 * along * u.x - w.x, y: A.y + 2 * along * u.y - w.y };
    };
    // Inflation: zero on the closed (glued or folded) outline of the folded shape,
    // positive inside and along an open (mirror) edge.
    const closed: [Point, Point][] = [];
    left.forEach((v, i) => {
      const w = left[(i + 1) % left.length];
      if (!isMirror(v, w)) closed.push([v, w]);
    });
    const area = Math.abs(signedArea(left));
    const s = 0.3 * Math.sqrt(area);
    const height = (opts.inflate ?? 0) * 0.35 * Math.sqrt(area);
    const bump = (q: Point) => closed.reduce((f, [a, b]) => f * Math.tanh(segmentDistance(q, a, b) / s), 1);
    map = (q) => {
      if (side(q) >= -1e-9 * area) return [q.x, q.y, height * bump(q)];
      const r = reflect(q);
      return [r.x, r.y, -height * bump(r)];
    };
  }

  // Mesh: each piece fanned from its centroid, then subdivided.
  const verts: Point[] = [];
  const index = new Map<string, number>();
  const indices: number[] = [];
  const tol = 1e-7 * size(poly);
  const vertex = (q: Point, piece: number) => {
    const key = `${piece}:${Math.round(q.x / tol)},${Math.round(q.y / tol)}`;
    let i = index.get(key);
    if (i === undefined) {
      i = verts.length;
      verts.push(q);
      index.set(key, i);
    }
    return i;
  };
  pieces.forEach((piece, pi) => {
    const c = centroid(piece);
    piece.forEach((a, k) => {
      const b = piece[(k + 1) % piece.length];
      const p = (i: number, j: number) =>
        vertex({ x: c.x + (i / detail) * (a.x - c.x) + (j / detail) * (b.x - a.x), y: c.y + (i / detail) * (a.y - c.y) + (j / detail) * (b.y - a.y) }, pi);
      for (let i = 0; i < detail; i++) {
        for (let j = 0; j <= i; j++) {
          indices.push(p(i, j), p(i + 1, j), p(i + 1, j + 1));
          if (j < i) indices.push(p(i, j), p(i + 1, j + 1), p(i, j + 1));
        }
      }
    });
  });

  const world = verts.map(undisp);
  const region = boxRegion(d.polygon);
  const mesh: BodyMesh = {
    kind,
    positions: verts.flatMap(map),
    uvs: world.flatMap((w) => uv(w, region)),
    indices,
    planar: world,
    region,
    markers: d.singular.map((v) => ({ pos: map(disp(v.point)), order: v.order, classIndex: v.classIndex, corner: v.corner })),
    place: (w) => map(disp(w)),
    mirrors: poly.flatMap((v, i) => {
      if (edges[i].kind !== "mirror") return [];
      const w = poly[(i + 1) % poly.length];
      return [Array.from({ length: 33 }, (_, k) => map({ x: v.x + ((w.x - v.x) * k) / 32, y: v.y + ((w.y - v.y) * k) / 32 }))];
    }),
  };
  return center(mesh);
}

// --- 2222: tetrahedron ------------------------------------------------------------------

function tetrahedron(d: OrbifoldDomain, lattice: { t1: Point; t2: Point }): BodyMesh | null {
  const P = d.singular[0];
  if (!P) return null;
  // A non-obtuse lattice triangle (always exists: reduce the basis, then pick b, b−a or b+a).
  let [a, b] = reduce(lattice.t1, lattice.t2);
  for (const c of [b, sub(b, a), add(b, a)]) {
    if (dot(a, c) >= -1e-9 && dot(scale(a, -1), sub(c, a)) >= -1e-9 && dot(scale(c, -1), sub(a, c)) >= -1e-9) {
      b = c;
      break;
    }
  }
  // Net in display coordinates, counter-clockwise.
  let N0 = disp(P.point);
  let N1 = disp(add(P.point, a));
  let N2 = disp(add(P.point, b));
  if (cross(sub(N1, N0), sub(N2, N0)) < 0) [N1, N2] = [N2, N1];
  const mid = (p: Point, q: Point) => ({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 });
  const M01 = mid(N0, N1);
  const M12 = mid(N1, N2);
  const M02 = mid(N0, N2);
  // Disphenoid with opposite edges L1 (W–M12, M01–M02), L2 (W–M02, M01–M12), L3 (W–M01, M02–M12).
  const A = (dist(N1, N2) / 2) ** 2 / 4;
  const B = (dist(N0, N2) / 2) ** 2 / 4;
  const C = (dist(N0, N1) / 2) ** 2 / 4;
  const x = Math.sqrt(Math.max(0, (B + C - A) / 2));
  const y = Math.sqrt(Math.max(0, (A + C - B) / 2));
  const z = Math.sqrt(Math.max(0, (A + B - C) / 2));
  const W: Vec3 = [x, y, z];
  const V12: Vec3 = [x, -y, -z];
  const V02: Vec3 = [-x, y, -z];
  const V01: Vec3 = [-x, -y, z];
  const faces: [Point, Vec3][][] = [
    [[M01, V01], [M12, V12], [M02, V02]],
    [[N0, W], [M01, V01], [M02, V02]],
    [[N1, W], [M12, V12], [M01, V01]],
    [[N2, W], [M02, V02], [M12, V12]],
  ];
  const netWorld = [N0, N1, N2].map(undisp);
  const region = boxRegion(netWorld);
  const planar = faces.flatMap((f) => f.map(([q]) => undisp(q)));
  // Classes of the four vertices: match against D's singular points modulo the lattice.
  const classOf = (q: Point) => {
    const w = undisp(q);
    const s = d.singular.find((v) => latticeEquivalent(v.point, w, lattice.t1, lattice.t2));
    return s ?? P;
  };
  const mesh: BodyMesh = {
    kind: "tetrahedron",
    positions: faces.flatMap((f) => f.flatMap(([, v]) => v)),
    uvs: planar.flatMap((w) => uv(w, region)),
    indices: planar.map((_, i) => i),
    planar,
    region,
    markers: ([
      [N0, W],
      [M01, V01],
      [M12, V12],
      [M02, V02],
    ] as [Point, Vec3][]).map(([q, v]) => {
      const s = classOf(q);
      return { pos: v, order: s.order, classIndex: s.classIndex, corner: s.corner };
    }),
    mirrors: [],
  };
  return center(mesh);
}

// --- helpers -----------------------------------------------------------------------------

/** Make faces point outwards (mirror if needed) and move the body's center to the origin. */
function center(m: BodyMesh): BodyMesh {
  const n = m.positions.length / 3;
  const g = [0, 1, 2].map((k) => {
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < n; i++) {
      lo = Math.min(lo, m.positions[3 * i + k]);
      hi = Math.max(hi, m.positions[3 * i + k]);
    }
    return (lo + hi) / 2;
  });
  const P = (i: number): Vec3 => [m.positions[3 * i] - g[0], m.positions[3 * i + 1] - g[1], m.positions[3 * i + 2] - g[2]];
  let outward = 0;
  for (let t = 0; t < m.indices.length; t += 3) {
    const [a, b, c] = [P(m.indices[t]), P(m.indices[t + 1]), P(m.indices[t + 2])];
    const nrm = cross3(sub3(b, a), sub3(c, a));
    outward += dot3(nrm, [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3]);
  }
  const flip = m.kind !== "flat" && outward < 0 ? -1 : 1;
  const tr = (v: Vec3): Vec3 => [flip * (v[0] - g[0]), v[1] - g[1], v[2] - g[2]];
  const positions: number[] = [];
  for (let i = 0; i < n; i++) positions.push(...tr([m.positions[3 * i], m.positions[3 * i + 1], m.positions[3 * i + 2]]));
  const indices = flip < 0 ? m.indices.map((_, t) => m.indices[t - (t % 3) + [0, 2, 1][t % 3]]) : m.indices;
  const place = m.place;
  return {
    ...m,
    positions,
    indices,
    markers: m.markers.map((k) => ({ ...k, pos: tr(k.pos) })),
    mirrors: m.mirrors.map((l) => l.map(tr)),
    place: place && ((w: Point) => tr(place(w))),
  };
}

function uv(w: Point, r: Region): [number, number] {
  const det = cross(r.a, r.b);
  const q = sub(w, r.origin);
  return [cross(q, r.b) / det, 1 - cross(r.a, q) / det];
}

function boxRegion(ps: Point[]): Region {
  const b = bbox(ps);
  return { origin: { x: b.x0, y: b.y0 }, a: { x: b.w, y: 0 }, b: { x: 0, y: b.h } };
}

function bbox(ps: Point[]): { x0: number; y0: number; w: number; h: number } {
  const xs = ps.map((p) => p.x);
  const ys = ps.map((p) => p.y);
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  return { x0, y0, w: Math.max(...xs) - x0, h: Math.max(...ys) - y0 };
}

/** The part of a convex polygon left (sign 1) or right (−1) of the line A→B, A and B on its boundary. */
function clip(poly: Point[], A: Point, B: Point, sign: number): Point[] {
  const tol = 1e-9 * size(poly) ** 2;
  const s = (q: Point) => sign * cross(sub(B, A), sub(q, A));
  const out: Point[] = [];
  poly.forEach((p, i) => {
    const q = poly[(i + 1) % poly.length];
    const sp = s(p);
    const sq = s(q);
    if (sp >= -tol) out.push(p);
    if ((sp > tol && sq < -tol) || (sp < -tol && sq > tol)) {
      const t = sp / (sp - sq);
      out.push({ x: p.x + t * (q.x - p.x), y: p.y + t * (q.y - p.y) });
    }
  });
  return out;
}

function reduce(a: Point, b: Point): [Point, Point] {
  // Lagrange–Gauss reduction: shortest basis of the lattice.
  for (let k = 0; k < 50; k++) {
    if (dot(b, b) < dot(a, a)) [a, b] = [b, a];
    const m = Math.round(dot(a, b) / dot(a, a));
    if (m === 0) break;
    b = sub(b, scale(a, m));
  }
  return [a, b];
}

function latticeEquivalent(z: Point, w: Point, t1: Point, t2: Point): boolean {
  const det = cross(t1, t2);
  const d = sub(w, z);
  const u = cross(d, t2) / det;
  const v = cross(t1, d) / det;
  return Math.abs(u - Math.round(u)) < 1e-6 && Math.abs(v - Math.round(v)) < 1e-6;
}

function onSegment(q: Point, a: Point, b: Point): boolean {
  return segmentDistance(q, a, b) < 1e-7 * (dist(a, b) + 1);
}

function segmentDistance(q: Point, a: Point, b: Point): number {
  const ab = sub(b, a);
  const t = Math.max(0, Math.min(1, dot(sub(q, a), ab) / dot(ab, ab)));
  return dist(q, { x: a.x + t * ab.x, y: a.y + t * ab.y });
}

function centroid(poly: Point[]): Point {
  return { x: poly.reduce((s, p) => s + p.x, 0) / poly.length, y: poly.reduce((s, p) => s + p.y, 0) / poly.length };
}

function signedArea(poly: Point[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) s += cross(poly[i], poly[(i + 1) % poly.length]);
  return s / 2;
}

function size(poly: Point[]): number {
  const b = bbox(poly);
  return Math.max(b.w, b.h);
}

const disp = (p: Point): Point => ({ x: p.x, y: -p.y });
const undisp = disp;
const sub = (a: Point, b: Point) => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a: Point, b: Point) => ({ x: a.x + b.x, y: a.y + b.y });
const scale = (a: Point, k: number) => ({ x: a.x * k, y: a.y * k });
const dot = (a: Point, b: Point) => a.x * b.x + a.y * b.y;
const cross = (a: Point, b: Point) => a.x * b.y - a.y * b.x;
const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const sub3 = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot3 = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross3 = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

// --- *x, xx, 22x: immersions of a parameter rectangle ------------------------------------------

function immersion(kind: "moebius" | "klein" | "crosscap", g: GroupLines): BodyMesh | null {
  let origin: Point;
  let A: Point; // along ξ
  let B: Point; // along η
  let map: (xi: number, eta: number) => Vec3;
  let fullPeriod = false;
  const markers: BodyMesh["markers"] = [];
  const mirrors: Vec3[][] = [];

  if (kind === "moebius" || kind === "klein") {
    const lines = kind === "moebius" ? g.mirrors : g.glides;
    if (lines.length === 0) return null;
    const u = unit(lines[0].u);
    const n = { x: -u.y, y: u.x };
    const T = norm(shortestAlong(u, g.t1, g.t2));
    const offsets = [...new Set(lines.filter((l) => Math.abs(cross(l.u, u)) < 1e-9).map((l) => Math.round(dot(l.a, n) * 1e6) / 1e6))].sort((x, y) => x - y);
    const r = dot(g.reference, n);
    const k = Math.max(0, offsets.findIndex((o, i) => o <= r + 1e-9 && (offsets[i + 1] ?? Infinity) > r + 1e-9));
    const lower = offsets[k];
    const step = kind === "moebius" ? 1 : 2; // Klein: to the next but one glide axis
    const upper = offsets[k + step];
    if (upper === undefined) return null;
    const W = upper - lower;
    const s0 = dot(g.reference, u);
    origin = add(scale(u, s0), scale(n, lower));
    A = scale(u, T / 2);
    B = scale(n, W);
    fullPeriod = true;
    if (kind === "moebius") {
      // Centre line true to scale; the band is made narrower if it would cut itself.
      const Rm = T / 2 / (2 * Math.PI);
      const half = Math.min(W / 2, 0.55 * Rm);
      map = (xi, eta) => {
        const th = 2 * Math.PI * xi;
        const t = (2 * eta - 1) * half;
        const rr = Rm + t * Math.cos(th / 2);
        return [rr * Math.cos(th), rr * Math.sin(th), t * Math.sin(th / 2)];
      };
      for (const eta of [0, 1]) mirrors.push(Array.from({ length: 129 }, (_, i) => map(i / 128, eta)));
    } else {
      // Figure-8 Klein bottle: (θ + 2π, −v) is the same point as (θ, v).
      const R0 = 2;
      map = (xi, eta) => {
        const th = 2 * Math.PI * xi;
        const v = 2 * Math.PI * eta;
        const c = Math.cos(th / 2);
        const sn = Math.sin(th / 2);
        const rr = R0 + c * Math.sin(v) - sn * Math.sin(2 * v);
        return [rr * Math.cos(th), rr * Math.sin(th), sn * Math.sin(v) + c * Math.sin(2 * v)];
      };
    }
  } else {
    // 22x: corners at 2-fold centers, sides along the two glide directions.
    if (g.glides.length === 0 || g.centers.length === 0) return null;
    const u1 = unit(g.glides[0].u);
    const u2 = { x: -u1.y, y: u1.x };
    A = scale(shortestAlong(u1, g.t1, g.t2), 0.5);
    B = scale(shortestAlong(u2, g.t1, g.t2), 0.5);
    const c = g.centers.filter((z) => z.order === 2).sort((p, q) => dist(p.point, g.reference) - dist(q.point, g.reference))[0];
    if (!c) return null;
    origin = c.point;
    map = (xi, eta) => {
      // Square → disk (odd, keeps antipodes), disk → hemisphere, hemisphere → cross-cap.
      const X0 = 2 * xi - 1;
      const Y0 = 2 * eta - 1;
      const X = X0 * Math.sqrt(Math.max(0, 1 - (Y0 * Y0) / 2));
      const Y = Y0 * Math.sqrt(Math.max(0, 1 - (X0 * X0) / 2));
      const rho = Math.min(1, Math.hypot(X, Y));
      const uu = Math.atan2(Y, X);
      const v = (rho * Math.PI) / 2;
      return [Math.cos(uu) * Math.sin(2 * v), Math.sin(uu) * Math.sin(2 * v), Math.cos(v) ** 2 - Math.cos(uu) ** 2 * Math.sin(v) ** 2];
    };
    for (const [xi, eta] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
      const w = add(add(origin, scale(A, xi)), scale(B, eta));
      const z = g.centers.find((q) => dist(q.point, w) < 1e-6 * (norm(A) + norm(B)));
      if (z) markers.push({ pos: map(xi, eta), order: z.order, classIndex: z.classIndex, corner: false });
    }
  }

  // Grid mesh.
  const N = kind === "moebius" ? 160 : 96;
  const M = kind === "moebius" ? 24 : 96;
  const positions: number[] = [];
  const uvs: number[] = [];
  const planar: Point[] = [];
  const indices: number[] = [];
  for (let j = 0; j <= M; j++) {
    for (let i = 0; i <= N; i++) {
      const xi = i / N;
      const eta = j / M;
      positions.push(...map(xi, eta));
      // With fullPeriod the texture spans a whole period T along A (= T/2): u ∈ [0, ½].
      uvs.push(fullPeriod ? xi / 2 : xi, eta);
      planar.push(add(add(origin, scale(A, xi)), scale(B, eta)));
    }
  }
  const at = (i: number, j: number) => j * (N + 1) + i;
  for (let j = 0; j < M; j++) {
    for (let i = 0; i < N; i++) indices.push(at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j), at(i + 1, j + 1), at(i, j + 1));
  }

  // Normalize so that the median stretch is 1, and report the typical range.
  const ratios: number[] = [];
  const h = 1e-3;
  for (let j = 1; j < 12; j++) {
    for (let i = 1; i < 12; i++) {
      const xi = i / 12;
      const eta = j / 12;
      const p = map(xi, eta);
      ratios.push(len3(p, map(xi + h, eta)) / (h * norm(A)), len3(p, map(xi, eta + h)) / (h * norm(B)));
    }
  }
  ratios.sort((x, y) => x - y);
  const median = ratios[Math.floor(ratios.length / 2)] || 1;
  const k = 1 / median;
  const sc = (v: Vec3): Vec3 => [v[0] * k, v[1] * k, v[2] * k];
  const pct = (q: number) => ratios[Math.floor(q * (ratios.length - 1))] / median;
  const mesh: BodyMesh = {
    kind,
    positions: positions.map((x) => x * k),
    uvs,
    indices,
    planar,
    region: { origin, a: fullPeriod ? scale(A, 2) : A, b: B },
    shiftable: fullPeriod,
    stretch: [pct(0.05), pct(0.95)],
    markers: markers.map((m) => ({ ...m, pos: sc(m.pos) })),
    mirrors: mirrors.map((l) => l.map(sc)),
    place: (w) => {
      const det = cross(A, B);
      const q = sub(w, origin);
      return sc(map(cross(q, B) / det, cross(A, q) / det));
    },
  };
  return center(mesh);
}

const unit = (a: Point) => scale(a, 1 / norm(a));
const norm = (a: Point) => Math.hypot(a.x, a.y);
const len3 = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

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
