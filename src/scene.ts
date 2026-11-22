/**
 * The symmetry elements the user has drawn onto the image, in image pixel
 * coordinates (x right, y down). Pure data + geometry helpers; no DOM.
 */
import type { Generator } from "./group";
import { glide, reflection, rotation, translation, type Point } from "./isometry";

export type ElementKind = "lattice" | "rotation" | "mirror" | "glide";
export type RotationOrder = 2 | 3 | 4 | 6;
export const ROTATION_ORDERS: RotationOrder[] = [2, 3, 4, 6];

export interface SceneElement {
  id: number;
  kind: ElementKind;
  /**
   * lattice:  [origin, origin + a₁, origin + a₂]  (a₂ missing while drawing)
   * rotation: [center]
   * mirror:   [p, q]  – any two points on the axis
   * glide:    [p, q]  – on the axis; q − p is the glide vector
   */
  points: Point[];
  order?: RotationOrder; // rotation only
}

export interface Scene {
  elements: SceneElement[];
  nextId: number;
  /** Start point p for orbit and Dirichlet domain. */
  base?: Point | null;
}

export interface HandleRef {
  id: number;
  index: number;
}

export function emptyScene(): Scene {
  return { elements: [], nextId: 1 };
}

export function addElement(scene: Scene, element: Omit<SceneElement, "id">): SceneElement {
  const el = { ...element, id: scene.nextId++ };
  scene.elements.push(el);
  return el;
}

export function removeElement(scene: Scene, id: number): void {
  scene.elements = scene.elements.filter((e) => e.id !== id);
}

export function findLattice(scene: Scene): SceneElement | undefined {
  return scene.elements.find((e) => e.kind === "lattice");
}

/** Origin and basis vectors, if the lattice is complete and non-degenerate. */
export function latticeBasis(scene: Scene): { origin: Point; a1: Point; a2: Point } | null {
  const lat = findLattice(scene);
  if (!lat || lat.points.length < 3) return null;
  const [o, p1, p2] = lat.points;
  const a1 = sub(p1, o);
  const a2 = sub(p2, o);
  if (Math.abs(cross(a1, a2)) < 1e-6 * (norm(a1) * norm(a2) + 1e-12)) return null;
  return { origin: o, a1, a2 };
}

// --- names and generators -------------------------------------------------------

const SUBSCRIPTS = "₀₁₂₃₄₅₆₇₈₉";
const subscript = (n: number) => String(n).replace(/\d/g, (d) => SUBSCRIPTS[Number(d)]);
const PREFIX: Record<Exclude<ElementKind, "lattice">, string> = { rotation: "r", mirror: "m", glide: "g" };

/** Display names: r₁, r₂, …, m₁, …, g₁, …; the lattice is "t₁, t₂". */
export function labels(scene: Scene): Map<number, string> {
  const counters: Record<string, number> = {};
  const out = new Map<number, string>();
  for (const el of scene.elements) {
    if (el.kind === "lattice") {
      out.set(el.id, el.points.length >= 3 ? "t₁, t₂" : "t₁");
    } else {
      counters[el.kind] = (counters[el.kind] ?? 0) + 1;
      out.set(el.id, PREFIX[el.kind] + subscript(counters[el.kind]));
    }
  }
  return out;
}

export function describe(el: SceneElement): string {
  switch (el.kind) {
    case "lattice":
      return el.points.length >= 3 ? "Gitter" : "Gitter (a₂ fehlt)";
    case "rotation":
      return `Drehzentrum, Ordnung ${el.order}`;
    case "mirror":
      return "Spiegelachse";
    case "glide":
      return "Gleitachse";
  }
}

/** The isometries the drawn elements stand for, named as in `labels`. */
export function toGenerators(scene: Scene): Generator[] {
  const names = labels(scene);
  const gens: Generator[] = [];
  for (const el of scene.elements) {
    const [p, q, r] = el.points;
    switch (el.kind) {
      case "lattice":
        if (q && norm(sub(q, p)) > 1e-9) gens.push({ name: "t₁", g: translation(sub(q, p)) });
        if (r && norm(sub(r, p)) > 1e-9) gens.push({ name: "t₂", g: translation(sub(r, p)) });
        break;
      case "rotation":
        gens.push({ name: names.get(el.id)!, g: rotation(p, el.order ?? 2) });
        break;
      case "mirror":
        if (norm(sub(q, p)) > 1e-9) gens.push({ name: names.get(el.id)!, g: reflection(p, q) });
        break;
      case "glide":
        if (norm(sub(q, p)) > 1e-9) gens.push({ name: names.get(el.id)!, g: glide(p, q) });
        break;
    }
  }
  return gens;
}

// --- snapping and hit testing ---------------------------------------------------

/**
 * Nearest snap target within `radius`: lattice points, edge midpoints and cell
 * centers (the half-lattice), plus every point of every element except `exclude`.
 */
export function snap(scene: Scene, p: Point, radius: number, exclude?: HandleRef): Point | null {
  let best: Point | null = null;
  let bestDist = radius;
  const consider = (c: Point) => {
    const d = dist(c, p);
    if (d <= bestDist) {
      best = c;
      bestDist = d;
    }
  };

  const lattice = findLattice(scene);
  if (lattice?.points.length === 2) {
    // Drawing a₂: offer a₁ turned by ±60°, ±90°, ±120° (square and hexagonal lattices).
    const [o, p1] = lattice.points;
    const a1 = sub(p1, o);
    for (const deg of [60, 90, 120, -60, -90, -120]) {
      const t = (deg * Math.PI) / 180;
      consider({ x: o.x + Math.cos(t) * a1.x - Math.sin(t) * a1.y, y: o.y + Math.sin(t) * a1.x + Math.cos(t) * a1.y });
    }
  }

  const basis = latticeBasis(scene);
  if (basis) {
    const { origin, a1, a2 } = basis;
    const det = cross(a1, a2);
    const rel = sub(p, origin);
    const u2 = Math.round((2 * cross(rel, a2)) / det);
    const v2 = Math.round((2 * cross(a1, rel)) / det);
    for (let du = -1; du <= 1; du++) {
      for (let dv = -1; dv <= 1; dv++) {
        const u = (u2 + du) / 2;
        const v = (v2 + dv) / 2;
        consider({ x: origin.x + u * a1.x + v * a2.x, y: origin.y + u * a1.y + v * a2.y });
      }
    }
  }

  for (const el of scene.elements) {
    el.points.forEach((pt, index) => {
      if (exclude && exclude.id === el.id && exclude.index === index) return;
      consider(pt);
    });
  }
  return best;
}

/** Nearest element point (handle) within `radius`. */
export function hitHandle(scene: Scene, p: Point, radius: number): HandleRef | null {
  let best: HandleRef | null = null;
  let bestDist = radius;
  for (const el of scene.elements) {
    el.points.forEach((pt, index) => {
      const d = dist(pt, p);
      if (d <= bestDist) {
        best = { id: el.id, index };
        bestDist = d;
      }
    });
  }
  return best;
}

/** Element under p: a handle, or else a mirror/glide axis passing within `radius`. */
export function hitElement(scene: Scene, p: Point, radius: number): number | null {
  const handle = hitHandle(scene, p, radius);
  if (handle) return handle.id;
  let best: number | null = null;
  let bestDist = radius;
  for (const el of scene.elements) {
    if (el.kind !== "mirror" && el.kind !== "glide") continue;
    const d = distanceToLine(p, el.points[0], el.points[1]);
    if (d <= bestDist) {
      best = el.id;
      bestDist = d;
    }
  }
  return best;
}

// --- small vector helpers -----------------------------------------------------------

export const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
export const add = (a: Point, b: Point): Point => ({ x: a.x + b.x, y: a.y + b.y });
export const cross = (a: Point, b: Point) => a.x * b.y - a.y * b.x;
export const norm = (a: Point) => Math.hypot(a.x, a.y);
export const dist = (a: Point, b: Point) => norm(sub(a, b));

function distanceToLine(p: Point, a: Point, b: Point): number {
  const d = sub(b, a);
  const len = norm(d);
  if (len < 1e-12) return dist(p, a);
  return Math.abs(cross(d, sub(p, a))) / len;
}
