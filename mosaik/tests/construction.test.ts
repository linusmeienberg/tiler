import { describe, expect, it } from "vitest";
import { construct, nearestOrbitIndex, polygonArea } from "../src/construction";
import type { Generator } from "../src/group";
import { apply, glide, reflection, rotation, translation } from "../src/isometry";

// Unit square lattice, generators as in group.test.ts.
const P2: Generator[] = [
  { name: "a", g: rotation({ x: 0, y: 0 }, 2) },
  { name: "b", g: rotation({ x: 0.5, y: 0 }, 2) },
  { name: "c", g: rotation({ x: 0, y: 0.5 }, 2) },
];
const P4: Generator[] = [
  { name: "r", g: rotation({ x: 0, y: 0 }, 4) },
  { name: "s", g: rotation({ x: 0.5, y: 0 }, 2) },
];
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

const p = { x: 0.31, y: 0.12 };

describe("construct", () => {
  it.each([
    ["2222", P2, 1, 2],
    ["442", P4, 1, 4],
    ["*442", P4M, 1, 8],
    ["xx", PG, 1, 2],
    ["632", P6, Math.sqrt(3) / 2, 6],
  ] as const)("%s: domain area = cell area / %#", (_name, gens, cellArea, order) => {
    const c = construct([...gens], p, { radius: 6 });
    expect(c.warnings).toEqual([]);
    expect(polygonArea(c.domain)).toBeCloseTo(cellArea / order, 9);
    expect(c.copiesPerCell).toBeCloseTo(order, 9);
  });

  it("*442: the Dirichlet domain of a point inside the 45-45-90 triangle is that triangle", () => {
    const c = construct([...P4M], p, { radius: 6 });
    const corners = [
      { x: 0, y: 0 },
      { x: 0.5, y: 0 },
      { x: 0.5, y: 0.5 },
    ];
    expect(c.domain).toHaveLength(3);
    for (const corner of corners) {
      expect(c.domain.some((v) => Math.hypot(v.x - corner.x, v.y - corner.y) < 1e-9)).toBe(true);
    }
  });

  it("finds the primitive translation lattice even if no translation was drawn", () => {
    const c = construct([...P4M], p, { radius: 6 });
    const { t1, t2 } = c.translations!;
    expect(Math.hypot(t1.x, t1.y)).toBeCloseTo(1, 9);
    expect(Math.abs(t1.x * t2.y - t1.y * t2.x)).toBeCloseTo(1, 9);
  });

  it("copies tile the plane: each random point lies in exactly the copy of its nearest orbit point", () => {
    const c = construct([...P4], p, { radius: 6 });
    const inside = (poly: { x: number; y: number }[], q: { x: number; y: number }) => {
      let sign = 0;
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i];
        const b = poly[(i + 1) % poly.length];
        const s = Math.sign((b.x - a.x) * (q.y - a.y) - (b.y - a.y) * (q.x - a.x));
        if (s !== 0 && sign !== 0 && s !== sign) return false;
        if (s !== 0) sign = s;
      }
      return true;
    };
    let seed = 1;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
    for (let k = 0; k < 200; k++) {
      const q = { x: rand(), y: rand() };
      const containing = c.elements.filter((e) => inside(c.domain.map((v) => apply(e.g, v)), q));
      expect(containing).toHaveLength(1);
      expect(c.elements.indexOf(containing[0])).toBe(nearestOrbitIndex(c.orbit, q));
    }
  });

  it("warns when the start point lies on a mirror", () => {
    const c = construct([...P4M], { x: 0.3, y: 0 }, { radius: 6 });
    expect(c.pointWarnings.some((w) => w.includes("Symmetrieelement"))).toBe(true);
    expect(c.groupWarnings).toEqual([]); // the group itself is fine
    expect(c.onElement).toBe(true);
    expect(c.copiesPerCell).toBeNull();
  });

  it("does not warn when the start point is merely close to a mirror (domain stays the triangle)", () => {
    const c = construct([...P4M], { x: 0.3, y: 0.002 }, { radius: 6 });
    expect(c.warnings).toEqual([]);
    expect(c.domain).toHaveLength(3);
  });

  it("warns when the domain is a sliver", () => {
    const gens: Generator[] = [
      // In pixels: a 100 × 5 px cell (shortest translations below 0.5 px count as non-discrete).
      { name: "t₁", g: translation({ x: 100, y: 0 }) },
      { name: "t₂", g: translation({ x: 0, y: 5 }) },
    ];
    const c = construct(gens, { x: 31, y: 1.2 }, { radius: 300 });
    expect(c.warnings.some((w) => w.includes("lang und schmal"))).toBe(true);
    expect(c.copiesPerCell).toBeCloseTo(1, 9); // still a valid domain
  });

  it("warns when the elements are inconsistent (square lattice + 3-fold rotation)", () => {
    const gens: Generator[] = [
      { name: "t₁", g: translation({ x: 1, y: 0 }) },
      { name: "t₂", g: translation({ x: 0, y: 1 }) },
      { name: "r", g: rotation({ x: 0, y: 0 }, 3) },
    ];
    const c = construct(gens, p, { radius: 4, maxElements: 3000 });
    expect(c.groupWarnings.some((w) => w.includes("nicht diskret"))).toBe(true);
    expect(c.discrete).toBe(false);
  });

  it("warns when there are not enough translations (a single mirror)", () => {
    const c = construct([P4M[0]], p, { radius: 6 });
    expect(c.elements).toHaveLength(2);
    expect(c.groupWarnings.some((w) => w.includes("Translationen"))).toBe(true);
  });
});
