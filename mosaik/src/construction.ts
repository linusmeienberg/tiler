/**
 * From generators and a start point p: the group elements near p, the orbit of p,
 * its Dirichlet domain (a fundamental domain), and sanity checks.
 *
 * Dirichlet domain D(p) = points closer to p than to any other orbit point g(p).
 * Its copy g(D) is the set of points whose nearest orbit point is g(p), so the
 * copy under the cursor is simply the one with the nearest orbit point.
 */
import { generateGroup, type Generator, type GroupElement } from "./group";
import { apply, kind, type Point } from "./isometry";

export interface Construction {
  /** In BFS order, i.e. sorted by word length; elements[0] is the identity. */
  elements: GroupElement[];
  /** orbit[i] = elements[i](p). */
  orbit: Point[];
  /** Dirichlet domain of p, as a convex polygon. */
  domain: Point[];
  maxLength: number;
  /** Primitive translation basis of the generated group, if it has two independent translations. */
  translations: { t1: Point; t2: Point } | null;
  /** Primitive cell area / domain area: the number of fundamental domains per cell. */
  copiesPerCell: number | null;
  /** The group generates a lattice of translations (and nothing arbitrarily small). */
  discrete: boolean;
  /** p lies on a mirror or rotation center (then D is too large). */
  onElement: boolean;
  /** About the generators alone: not discrete, too few translations. */
  groupWarnings: string[];
  /** About the choice of p: on an element, sliver domain. */
  pointWarnings: string[];
  /** groupWarnings followed by pointWarnings. */
  warnings: string[];
}

export interface ConstructOptions {
  /** Keep elements that move p at most this far. */
  radius: number;
  maxElements?: number;
}

export function construct(generators: Generator[], p: Point, options: ConstructOptions): Construction {
  const { radius, maxElements = 20_000 } = options;
  const elements = generateGroup(generators, { center: p, radius, maxElements });
  const orbit = elements.map((e) => apply(e.g, p));
  const domain = dirichletDomain(p, orbit, radius);
  const translations = translationBasis(elements);
  const groupWarnings: string[] = [];
  const pointWarnings: string[] = [];

  const capped = elements.length >= maxElements;
  const shortest = translations ? norm(translations.t1) : Infinity;
  if (capped || shortest < 0.5) {
    groupWarnings.push(
      "Die Elemente passen nicht zusammen: Die erzeugte Gruppe ist nicht diskret " +
        "(beliebig kleine Verschiebungen). Prüfe Ordnungen, Lage und Gitter.",
    );
  } else if (!translations) {
    groupWarnings.push(
      "Keine zwei unabhängigen Translationen – das ist (noch) keine Ornamentgruppe, " +
        "der Fundamentalbereich ist unbeschränkt. Gitter einzeichnen oder Elemente ergänzen.",
    );
  }

  const discrete = !capped && shortest >= 0.5;
  const nearest = Math.min(...orbit.slice(1).map((q) => dist(q, p)));
  const onElement = nearest < 1e-6;
  if (onElement) {
    pointWarnings.push(
      "Der Startpunkt liegt auf einem Symmetrieelement (Spiegelachse oder Drehzentrum); " +
        "der Bereich ist darum zu groß. Startpunkt etwas verschieben.",
    );
  } else if (discrete && translations && elongation(domain) > 8) {
    pointWarnings.push(
      "Der Fundamentalbereich ist lang und schmal. Ein anderer Startpunkt macht ihn vielleicht kompakter.",
    );
  }

  let copiesPerCell: number | null = null;
  if (translations && discrete && !onElement) {
    copiesPerCell = Math.abs(cross(translations.t1, translations.t2)) / polygonArea(domain);
  }

  return {
    elements,
    orbit,
    domain,
    maxLength: elements.reduce((m, e) => Math.max(m, e.length), 0),
    translations,
    copiesPerCell,
    discrete,
    onElement,
    groupWarnings,
    pointWarnings,
    warnings: [...groupWarnings, ...pointWarnings],
  };
}

/** Index of the orbit point nearest to q (= the copy containing q). */
export function nearestOrbitIndex(orbit: Point[], q: Point): number {
  let best = -1;
  let bestDist = Infinity;
  orbit.forEach((o, i) => {
    const d = (o.x - q.x) ** 2 + (o.y - q.y) ** 2;
    if (d < bestDist) {
      best = i;
      bestDist = d;
    }
  });
  return best;
}

/**
 * Voronoi cell of p among `orbit`, starting from a square of half-size `bound`
 * (so it stays finite when the group has too few translations).
 */
export function dirichletDomain(p: Point, orbit: Point[], bound: number): Point[] {
  let polygon: Point[] = [
    { x: p.x - bound, y: p.y - bound },
    { x: p.x + bound, y: p.y - bound },
    { x: p.x + bound, y: p.y + bound },
    { x: p.x - bound, y: p.y + bound },
  ];
  const others = orbit
    .map((q) => ({ q, d: dist(q, p) }))
    .filter(({ d }) => d > 1e-6)
    .sort((a, b) => a.d - b.d);

  let reach = bound * Math.SQRT2; // farthest polygon vertex from p
  for (const { q, d } of others) {
    if (d > 2 * reach) break; // its bisector cannot cut the polygon any more
    const mid = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
    polygon = clipByHalfPlane(polygon, mid, { x: q.x - p.x, y: q.y - p.y });
    reach = Math.max(...polygon.map((v) => dist(v, p)));
  }
  return dedupe(polygon, 1e-6 * bound);
}

/**
 * Shortest translation, then shortest one independent of it: in two dimensions
 * these always form a basis of the translation lattice.
 */
export function translationBasis(elements: GroupElement[]): { t1: Point; t2: Point } | null {
  const vectors = elements
    .filter((e) => kind(e.g) === "translation")
    .map((e) => ({ x: e.g.tx, y: e.g.ty }))
    .sort((a, b) => norm(a) - norm(b));
  if (vectors.length === 0) return null;
  const t1 = vectors[0];
  const t2 = vectors.find((v) => Math.abs(cross(t1, v)) > 1e-6 * norm(t1) * norm(v));
  return t2 ? { t1, t2 } : null;
}

/** Diameter² / area: 2 for a square, 4 for the 45-45-90 triangle, large for slivers. */
export function elongation(polygon: Point[]): number {
  let diameter2 = 0;
  for (const a of polygon) for (const b of polygon) diameter2 = Math.max(diameter2, (a.x - b.x) ** 2 + (a.y - b.y) ** 2);
  return diameter2 / polygonArea(polygon);
}

export function polygonArea(polygon: Point[]): number {
  let sum = 0;
  for (let i = 0; i < polygon.length; i++) sum += cross(polygon[i], polygon[(i + 1) % polygon.length]);
  return Math.abs(sum) / 2;
}

/** Keep the part of a convex polygon on the side of the line (through mid, ⟂ normal) opposite to normal. */
function clipByHalfPlane(polygon: Point[], mid: Point, normal: Point): Point[] {
  const side = (v: Point) => (v.x - mid.x) * normal.x + (v.y - mid.y) * normal.y;
  const out: Point[] = [];
  for (let i = 0; i < polygon.length; i++) {
    const cur = polygon[i];
    const next = polygon[(i + 1) % polygon.length];
    const sc = side(cur);
    const sn = side(next);
    if (sc <= 0) out.push(cur);
    if (sc <= 0 !== sn <= 0) {
      const t = sc / (sc - sn);
      out.push({ x: cur.x + t * (next.x - cur.x), y: cur.y + t * (next.y - cur.y) });
    }
  }
  return out;
}

function dedupe(polygon: Point[], tol: number): Point[] {
  const out: Point[] = [];
  for (const v of polygon) if (out.length === 0 || dist(v, out[out.length - 1]) > tol) out.push(v);
  while (out.length > 1 && dist(out[0], out[out.length - 1]) <= tol) out.pop();
  return out;
}

const cross = (a: Point, b: Point) => a.x * b.y - a.y * b.x;
const norm = (a: Point) => Math.hypot(a.x, a.y);
const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
