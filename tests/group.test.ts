import { describe, expect, it } from "vitest";
import { generateGroup, ElementSet, type Generator, type GroupElement } from "../src/group";
import {
  apply,
  compose,
  glide,
  isOrientationPreserving,
  kind,
  reflection,
  rotation,
  rotationOrder,
  translation,
  type Point,
} from "../src/isometry";

const SQUARE: [Point, Point] = [
  { x: 1, y: 0 },
  { x: 0, y: 1 },
];
const HEX: [Point, Point] = [
  { x: 1, y: 0 },
  { x: 0.5, y: Math.sqrt(3) / 2 },
];

/** A point not fixed by any nontrivial symmetry of the groups under test. */
const GENERIC: Point = { x: 0.1234, y: 0.0567 };

/** Window of k×k lattice cells, and the element set generated around it. */
function generate(generators: Generator[], basis: [Point, Point], k = 4): GroupElement[] {
  const [a1, a2] = basis;
  const center = { x: (k / 2) * (a1.x + a2.x), y: (k / 2) * (a1.y + a2.y) };
  return generateGroup(generators, { center, radius: 2 * k });
}

/** Number of orbit points of p whose lattice coordinates lie in [0, k)². */
function countInWindow(elements: GroupElement[], p: Point, basis: [Point, Point], k = 4): number {
  const [a1, a2] = basis;
  const det = a1.x * a2.y - a1.y * a2.x;
  let count = 0;
  for (const e of elements) {
    const q = apply(e.g, p);
    const u = (q.x * a2.y - q.y * a2.x) / det;
    const v = (a1.x * q.y - a1.y * q.x) / det;
    if (u >= 0 && u < k && v >= 0 && v < k) count++;
  }
  return count;
}

/** Elements fixing the point q (its stabilizer). */
function stabilizer(elements: GroupElement[], q: Point): GroupElement[] {
  return elements.filter((e) => {
    const r = apply(e.g, q);
    return Math.hypot(r.x - q.x, r.y - q.y) < 1e-7;
  });
}

function find(elements: GroupElement[], target: ReturnType<typeof translation>): GroupElement | undefined {
  const set = new ElementSet(GENERIC);
  set.add(target);
  return elements.find((e) => set.has(e.g));
}

// --- generator sets ------------------------------------------------------------

const P2: Generator[] = [
  { name: "a", g: rotation({ x: 0, y: 0 }, 2) },
  { name: "b", g: rotation({ x: 0.5, y: 0 }, 2) },
  { name: "c", g: rotation({ x: 0, y: 0.5 }, 2) },
];

const P4: Generator[] = [
  { name: "r", g: rotation({ x: 0, y: 0 }, 4) },
  { name: "s", g: rotation({ x: 0.5, y: 0 }, 2) },
];

// Reflections in the sides of the 45-45-90 triangle (0,0), (½,0), (½,½).
const P4M: Generator[] = [
  { name: "a", g: reflection({ x: 0, y: 0 }, { x: 1, y: 0 }) },
  { name: "b", g: reflection({ x: 0.5, y: 0 }, { x: 0.5, y: 1 }) },
  { name: "c", g: reflection({ x: 0, y: 0 }, { x: 1, y: 1 }) },
];

const PG: Generator[] = [
  { name: "g", g: glide({ x: 0, y: 0 }, { x: 0.5, y: 0 }) },
  { name: "h", g: glide({ x: 0, y: 0.5 }, { x: 0.5, y: 0.5 }) },
];

const P6: Generator[] = [
  { name: "r", g: rotation({ x: 0, y: 0 }, 6) },
  { name: "s", g: rotation({ x: 0.5, y: 0 }, 2) },
];

// --- tests ---------------------------------------------------------------------

describe("generateGroup", () => {
  it("2222: two orbit points per cell, only half-turns and translations", () => {
    const els = generate(P2, SQUARE);
    expect(countInWindow(els, GENERIC, SQUARE)).toBe(2 * 16);
    for (const e of els) expect(["identity", "translation", "rotation"]).toContain(kind(e.g));
    for (const e of els) if (kind(e.g) === "rotation") expect(rotationOrder(e.g)).toBe(2);
    expect(stabilizer(els, { x: 0.5, y: 0.5 })).toHaveLength(2);
  });

  it("442: four orbit points per cell; 4-fold centers at corners and cell centers, 2-fold at edge midpoints", () => {
    const els = generate(P4, SQUARE);
    expect(countInWindow(els, GENERIC, SQUARE)).toBe(4 * 16);
    expect(els.every((e) => isOrientationPreserving(e.g))).toBe(true);
    expect(stabilizer(els, { x: 1, y: 1 })).toHaveLength(4);
    expect(stabilizer(els, { x: 1.5, y: 1.5 })).toHaveLength(4);
    expect(stabilizer(els, { x: 1.5, y: 1 })).toHaveLength(2);
  });

  it("*442: eight orbit points per cell, dihedral stabilizers on the mirror corners", () => {
    const els = generate(P4M, SQUARE);
    expect(countInWindow(els, GENERIC, SQUARE)).toBe(8 * 16);
    expect(stabilizer(els, { x: 1, y: 1 })).toHaveLength(8); // corner *4
    expect(stabilizer(els, { x: 1.5, y: 1.5 })).toHaveLength(8); // corner *4
    expect(stabilizer(els, { x: 1.5, y: 1 })).toHaveLength(4); // corner *2
    expect(els.some((e) => kind(e.g) === "reflection")).toBe(true);
    expect(els.some((e) => kind(e.g) === "glide")).toBe(true);
  });

  it("*442 contains 442 as its orientation-preserving half (Sala de la Barca with weaving)", () => {
    const els = generate(P4M, SQUARE);
    const rotationsOnly = els.filter((e) => isOrientationPreserving(e.g));
    expect(countInWindow(rotationsOnly, GENERIC, SQUARE)).toBe(4 * 16);
  });

  it("xx: two orbit points per cell, glides but no mirrors or rotations", () => {
    const els = generate(PG, SQUARE);
    expect(countInWindow(els, GENERIC, SQUARE)).toBe(2 * 16);
    const kinds = new Set(els.map((e) => kind(e.g)));
    expect(kinds).toEqual(new Set(["identity", "translation", "glide"]));
  });

  it("632: six orbit points per hexagonal cell, 3-fold centers in the triangles", () => {
    const els = generate(P6, HEX);
    expect(countInWindow(els, GENERIC, HEX)).toBe(6 * 16);
    const threefold = { x: 2 + 0.5, y: 2 * Math.sqrt(3) + Math.sqrt(3) / 6 };
    expect(stabilizer(els, threefold)).toHaveLength(3);
    expect(stabilizer(els, { x: 2, y: 2 * Math.sqrt(3) })).toHaveLength(6);
  });

  it("records shortest word lengths in nondecreasing order", () => {
    const els = generate(P2, SQUARE);
    expect(els[0].length).toBe(0);
    expect(els[0].word).toEqual([]);
    for (let i = 1; i < els.length; i++) expect(els[i].length).toBeGreaterThanOrEqual(els[i - 1].length);
    for (const e of els) expect(e.word).toHaveLength(e.length);
    // Translation by (1,0) is a product of two half-turns: b∘a.
    expect(find(els, translation({ x: 1, y: 0 }))?.length).toBe(2);
    // Each word actually evaluates to its element.
    const byName = new Map(P2.map((gen) => [gen.name, gen.g]));
    for (const e of els.slice(0, 50)) {
      const g = e.word.reduce((acc, name) => compose(acc, byName.get(name)!), rotation({ x: 0, y: 0 }, 1));
      const p = apply(g, GENERIC);
      const q = apply(e.g, GENERIC);
      expect(Math.hypot(p.x - q.x, p.y - q.y)).toBeLessThan(1e-9);
    }
  });

  it("is closed under composition near the center", () => {
    const els = generate(P4M, SQUARE);
    const set = new ElementSet(GENERIC);
    for (const e of els) set.add(e.g);
    const near = els.filter((e) => e.length <= 3);
    for (const e of near) for (const f of near) expect(set.has(compose(e.g, f.g))).toBe(true);
  });
});
