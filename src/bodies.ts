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
 * inflation of pillows. Coordinates: "display" = (x, −y) of the image, so that
 * the pattern keeps its orientation when seen from outside.
 */
import type { OrbifoldDomain } from "./canonical";
import type { Point } from "./isometry";

export type BodyKind = "flat" | "cylinder" | "cone" | "pillow" | "tetrahedron";
export type Vec3 = [number, number, number];

export interface BodyMesh {
  kind: BodyKind;
  positions: number[]; // xyz per vertex
  uvs: number[]; // uv per vertex (texture: the world rectangle `region`, v up)
  indices: number[];
  /** Planar (world) coordinates per vertex – for tests and distortion checks. */
  planar: Point[];
  region: { x0: number; y0: number; w: number; h: number };
  markers: { pos: Vec3; order: number; classIndex: number; corner: boolean }[];
  mirrors: Vec3[][]; // polylines along mirror edges
  /** Where a point of D (world coordinates) ends up on the body (not for the tetrahedron). */
  place?: (w: Point) => Vec3;
}

export interface BodyOptions {
  inflate?: number; // 0…1, pillows only
  detail?: number; // subdivisions per fan triangle
  /** Needed for 2222 (the tetrahedron is cut from the lattice, not from D). */
  lattice?: { t1: Point; t2: Point };
}

/** Which body a symbol gets (null: not built yet). */
export function bodyKind(symbol: string): BodyKind | null {
  if (["*2222", "*442", "*333", "*632"].includes(symbol)) return "flat";
  if (symbol === "**") return "cylinder";
  if (["4*2", "3*3", "2*22"].includes(symbol)) return "cone";
  if (["442", "632", "333", "22*"].includes(symbol)) return "pillow";
  if (symbol === "2222") return "tetrahedron";
  return null;
}

export function buildBody(symbol: string, d: OrbifoldDomain, opts: BodyOptions = {}): BodyMesh | null {
  const kind = bodyKind(symbol);
  if (!kind) return null;
  const detail = opts.detail ?? 16;
  if (kind === "tetrahedron") return opts.lattice ? tetrahedron(d, opts.lattice) : null;

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
  const region = bbox(d.polygon);
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
  const region = bbox(netWorld);
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

function uv(w: Point, r: { x0: number; y0: number; w: number; h: number }): [number, number] {
  return [(w.x - r.x0) / r.w, 1 - (w.y - r.y0) / r.h];
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
