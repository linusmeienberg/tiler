/**
 * Conway inventory of a wallpaper group, read off from its elements near p:
 *
 * - rotation centers, grouped into orbit classes; a class is a mirror corner if
 *   mirrors pass through it, otherwise a cone point; its order is the order of
 *   the rotation subgroup fixing it;
 * - mirror lines: one boundary (*) if they run in several directions (they all
 *   meet), otherwise one per orbit class of parallel lines;
 * - a cross-cap (x) exists if some glide maps p's mirror-free chamber to itself
 *   (an orientation-reversing loop that avoids the mirrors). How many follows from
 *   the price: the remaining cost must be a whole number of x's.
 *
 * Independent check: the number of fundamental domains per primitive cell (from
 * areas) must equal the point group order belonging to the symbol.
 */
import type { Construction } from "./construction";
import { apply, isOrientationPreserving, kind, rotationCenter, type Isometry, type Point } from "./isometry";
import { price, WALLPAPER_GROUPS } from "./orbifold";

export interface Line {
  a: Point; // a point on the line
  u: Point; // unit direction
}

export interface InventoryItem {
  feature: string; // "4", "*4", "*", "x", "o"
  label: string;
  cost: number;
  classIndex?: number; // rotation-center class, for colors
}

export interface CenterClass {
  order: number;
  corner: boolean;
}

export interface Inventory {
  symbol: string;
  name: string | null; // crystallographic name, if one of the 17
  classes: CenterClass[]; // cones (by decreasing order), then corners (by decreasing order)
  items: InventoryItem[];
  total: number;
  expectedCopies: number | null;
  problems: string[];
  /** All symmetry elements in the generated region, for display. */
  centers: { point: Point; order: number; classIndex: number }[];
  mirrors: Line[];
  glides: Line[];
}

/** Point group order per primitive cell for each of the 17 groups. */
export const COPIES_PER_CELL: Record<string, number> = {
  o: 1,
  "2222": 2,
  "**": 2,
  xx: 2,
  "*x": 2,
  "*2222": 4,
  "22*": 4,
  "22x": 4,
  "2*22": 4,
  "442": 4,
  "*442": 8,
  "4*2": 8,
  "333": 3,
  "*333": 6,
  "3*3": 6,
  "632": 6,
  "*632": 12,
};

export function inventory(c: Construction, p: Point): Inventory | null {
  if (!c.translations || c.copiesPerCell === null) return null;
  const { t1, t2 } = c.translations;
  const cell = norm(t1) + norm(t2); // every point is this close to a translate of any other
  const tol = 1e-6 * cell;
  const els = c.elements.map((e) => e.g);
  const near = els.filter((_, i) => dist(c.orbit[i], p) <= 3 * cell);

  // --- rotation centers near p, and their orbit classes ---
  const centers: Point[] = [];
  for (const g of els) {
    if (kind(g) !== "rotation") continue;
    const z = rotationCenter(g);
    if (dist(z, p) <= cell && !centers.some((q) => dist(q, z) < tol)) centers.push(z);
  }
  const info = centers.map((z) => {
    let rotations = 0;
    let mirrors = 0;
    for (const g of els) {
      if (dist(apply(g, z), z) >= tol) continue;
      if (isOrientationPreserving(g)) rotations++;
      else mirrors++;
    }
    return { order: rotations, corner: mirrors > 0 };
  });
  const centerClass = unionFind(centers.length);
  centers.forEach((z, i) => {
    for (const g of near) {
      const w = apply(g, z);
      const j = centers.findIndex((q) => dist(q, w) < tol);
      if (j >= 0) centerClass.union(i, j);
    }
  });
  const rawClasses = groupsOf(centerClass, centers.length).map((members) => ({ members, ...info[members[0]] }));
  rawClasses.sort((a, b) => Number(a.corner) - Number(b.corner) || b.order - a.order);
  const classes: CenterClass[] = rawClasses.map(({ order, corner }) => ({ order, corner }));

  // --- mirrors ---
  const allMirrors = dedupeLines(els.filter((g) => kind(g) === "reflection").map((g) => axisOf(g)));
  const nearMirrors = allMirrors.filter((l) => distToLine(p, l) <= cell);
  let stars = 0;
  if (nearMirrors.length > 0) {
    const parallel = nearMirrors.every((l) => Math.abs(cross(l.u, nearMirrors[0].u)) < 1e-9);
    if (!parallel) {
      stars = 1;
    } else {
      const lineClass = unionFind(nearMirrors.length);
      nearMirrors.forEach((l, i) => {
        for (const g of near) {
          const image = { a: apply(g, l.a), u: linear(g, l.u) };
          const j = nearMirrors.findIndex((m) => sameLine(m, image, tol));
          if (j >= 0) lineClass.union(i, j);
        }
      });
      stars = groupsOf(lineClass, nearMirrors.length).length;
    }
  }

  // --- cross-caps: a glide that keeps p's chamber (no mirror between p and its image) ---
  const hasReversing = els.some((g) => !isOrientationPreserving(g));
  const chamberMirrors = allMirrors.filter((l) => distToLine(p, l) <= 4 * cell);
  const miracle = near.some(
    (g) => kind(g) === "glide" && !chamberMirrors.some((l) => separates(l, p, apply(g, p), tol)),
  );

  // --- symbol and price ---
  const cones = classes.filter((k) => !k.corner).map((k) => k.order);
  const corners = classes.filter((k) => k.corner).map((k) => k.order);
  const partial =
    cones.reduce((s, n) => s + (n - 1) / n, 0) + corners.reduce((s, n) => s + (n - 1) / (2 * n), 0) + stars;
  const rest = 2 - partial;
  const crosses = miracle ? Math.max(1, Math.round(rest)) : 0;
  const torus = !hasReversing && cones.length === 0;
  const symbol =
    cones.join("") +
    (stars > 0 ? "*" + corners.join("") + "*".repeat(stars - 1) : "") +
    "x".repeat(crosses) +
    (torus ? "o" : "");

  const items: InventoryItem[] = [];
  classes.forEach((k, i) => {
    if (!k.corner) items.push({ feature: `${k.order}`, label: `${k.order}-zähliges Drehzentrum`, cost: (k.order - 1) / k.order, classIndex: i });
  });
  for (let s = 0; s < stars; s++) items.push({ feature: "*", label: "Spiegelrand", cost: 1 });
  classes.forEach((k, i) => {
    if (k.corner) items.push({ feature: `*${k.order}`, label: `Spiegelecke (${k.order} Spiegel)`, cost: (k.order - 1) / (2 * k.order), classIndex: i });
  });
  for (let s = 0; s < crosses; s++) items.push({ feature: "x", label: "Gleitspiegelung abseits der Spiegel", cost: 1 });
  if (torus) items.push({ feature: "o", label: "nur Translationen (Torus)", cost: 2 });

  const total = price(symbol);
  const name = WALLPAPER_GROUPS[symbol] ?? null;
  const expectedCopies = COPIES_PER_CELL[symbol] ?? null;
  const problems: string[] = [];
  if (Math.abs(total - 2) > 1e-9) {
    problems.push(`Preisprobe nicht erfüllt: Summe ${total.toFixed(3)} statt 2.`);
  }
  if (!name) problems.push(`»${symbol}« ist keine der 17 Ornamentgruppen.`);
  if (expectedCopies !== null && Math.abs(expectedCopies - c.copiesPerCell) > 1e-3) {
    problems.push(
      `Flächenprobe: ${symbol} hat ${expectedCopies} Bereiche pro Zelle, gemessen wurden ${c.copiesPerCell.toFixed(2)}.`,
    );
  }

  // --- everything in the region, for display ---
  const regionCenters = new Map<string, { point: Point; order: number; classIndex: number }>();
  for (const g of els) {
    if (kind(g) !== "rotation") continue;
    const z = rotationCenter(g);
    const key = `${Math.round(z.x * 1e3)},${Math.round(z.y * 1e3)}`;
    if (regionCenters.has(key)) continue;
    const classIndex = rawClasses.findIndex((k) => k.members.some((m) => latticeEquivalent(centers[m], z, t1, t2)));
    if (classIndex >= 0) regionCenters.set(key, { point: z, order: classes[classIndex].order, classIndex });
  }
  const glides = dedupeLines(els.filter((g) => kind(g) === "glide").map((g) => axisOf(g))).filter(
    (l) => !allMirrors.some((m) => sameLine(m, l, tol * 100)),
  );

  return {
    symbol,
    name,
    classes,
    items,
    total,
    expectedCopies,
    problems,
    centers: [...regionCenters.values()],
    mirrors: allMirrors,
    glides,
  };
}

// --- geometry helpers ---------------------------------------------------------------

/** Axis of a reflection or glide: the fixed line of its reflection part. */
function axisOf(g: Isometry): Line {
  const phi = Math.atan2(g.c, g.a) / 2; // M = [[cos 2φ, sin 2φ], [sin 2φ, −cos 2φ]]
  const u = { x: Math.cos(phi), y: Math.sin(phi) };
  const along = g.tx * u.x + g.ty * u.y;
  const w = { x: g.tx - along * u.x, y: g.ty - along * u.y }; // translation part ⟂ axis
  return { a: { x: w.x / 2, y: w.y / 2 }, u };
}

function linear(g: Isometry, v: Point): Point {
  return { x: g.a * v.x + g.b * v.y, y: g.c * v.x + g.d * v.y };
}

function sameLine(l: Line, m: Line, tol: number): boolean {
  return Math.abs(cross(l.u, m.u)) < 1e-9 && distToLine(m.a, l) < tol;
}

function dedupeLines(lines: Line[]): Line[] {
  const byKey = new Map<string, Line>();
  for (const l of lines) {
    // Normalize the direction to a half-turn range, then key by angle and offset.
    const u = l.u.x < -1e-12 || (Math.abs(l.u.x) <= 1e-12 && l.u.y < 0) ? { x: -l.u.x, y: -l.u.y } : l.u;
    const offset = cross(u, l.a);
    const key = `${Math.round(Math.atan2(u.y, u.x) * 1e6)},${Math.round(offset * 1e3)}`;
    if (!byKey.has(key)) byKey.set(key, { a: l.a, u });
  }
  return [...byKey.values()];
}

function distToLine(q: Point, l: Line): number {
  return Math.abs(cross(l.u, { x: q.x - l.a.x, y: q.y - l.a.y }));
}

/** Strictly on opposite sides of the line. */
function separates(l: Line, q1: Point, q2: Point, tol: number): boolean {
  const s1 = cross(l.u, { x: q1.x - l.a.x, y: q1.y - l.a.y });
  const s2 = cross(l.u, { x: q2.x - l.a.x, y: q2.y - l.a.y });
  return (s1 > tol && s2 < -tol) || (s1 < -tol && s2 > tol);
}

function latticeEquivalent(z: Point, w: Point, t1: Point, t2: Point): boolean {
  const det = cross(t1, t2);
  const d = { x: w.x - z.x, y: w.y - z.y };
  const u = cross(d, t2) / det;
  const v = cross(t1, d) / det;
  return Math.abs(u - Math.round(u)) < 1e-6 && Math.abs(v - Math.round(v)) < 1e-6;
}

function unionFind(n: number) {
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  return {
    find,
    union: (i: number, j: number) => {
      parent[find(i)] = find(j);
    },
  };
}

function groupsOf(uf: ReturnType<typeof unionFind>, n: number): number[][] {
  const groups = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const root = uf.find(i);
    groups.set(root, [...(groups.get(root) ?? []), i]);
  }
  return [...groups.values()];
}

const cross = (a: Point, b: Point) => a.x * b.y - a.y * b.x;
const norm = (a: Point) => Math.hypot(a.x, a.y);
const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
