import { describe, expect, it } from "vitest";
import { construct } from "../src/construction";
import { findGroup, GROUPS, realize } from "../src/groups";
import { apply, inverse, type Point } from "../src/isometry";
import { buildTiling, copyAt, polygonCentroid, realizationFromConstruction, visibleCopies } from "../src/tiling";

const tilingOf = (conway: string, frac = base) => buildTiling(realize(findGroup(conway), params), frac);

const params = { size: 80, ratio: 1.3, angleDeg: 70 };
const base = { x: 0.2137, y: 0.1312 };

function inside(q: Point, polygon: Point[]): boolean {
  let sign = 0;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    const c = (b.x - a.x) * (q.y - a.y) - (b.y - a.y) * (q.x - a.x);
    if (sign === 0) sign = Math.sign(c);
    else if (Math.sign(c) !== sign) return false;
  }
  return true;
}

describe("tiling", () => {
  it.each(GROUPS.map((g) => [g.conway] as const))("%s: visible copies cover the view rectangle exactly once", (conway) => {
    const t = tilingOf(conway)!;
    expect(t).not.toBeNull();
    const rect = { x0: -317, y0: 211, x1: 123, y1: 530 };
    const copies = visibleCopies(t, rect)!;
    let seed = 11;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let k = 0; k < 60; k++) {
      const q = { x: rect.x0 + rand() * (rect.x1 - rect.x0), y: rect.y0 + rand() * (rect.y1 - rect.y0) };
      const containing = copies.filter((g) => inside(apply(inverse(g), q), t.domain));
      expect(containing).toHaveLength(1);
      expect(copyAt(t, q)).toEqual(containing[0]);
    }
  });

  it("refuses a start point on a symmetry element", () => {
    expect(tilingOf("*442", { x: 0.3, y: 0 })).toBeNull(); // on a mirror
  });

  it("gives null when zoomed out too far", () => {
    const t = tilingOf("*632")!;
    expect(visibleCopies(t, { x0: 0, y0: 0, x1: 1e5, y1: 1e5 })).toBeNull();
  });

  it.each(GROUPS.map((g) => [g.conway] as const))("%s: lattice and cosets recovered from an analysis construction", (conway) => {
    const r = realize(findGroup(conway), params);
    const p = { x: 17.3, y: 9.1 };
    const c = construct(r.generators, p, { radius: 600 });
    const back = realizationFromConstruction(c)!;
    expect(back).not.toBeNull();
    const primitive = findGroup(conway).lattice === "centered" ? 2 : 1;
    expect(back.cosets).toHaveLength(r.cosets.length / primitive);
    // Tiling from the recovered realization reproduces the same domain.
    const frac = { x: 0, y: 0 };
    const det = back.a1.x * back.a2.y - back.a1.y * back.a2.x;
    frac.x = (p.x * back.a2.y - p.y * back.a2.x) / det;
    frac.y = (back.a1.x * p.y - back.a1.y * p.x) / det;
    const t = buildTiling(back, frac)!;
    expect(t.domain.length).toBe(c.domain.length);
    const rect = { x0: -150, y0: -120, x1: 170, y1: 140 };
    const copies = visibleCopies(t, rect)!;
    let seed = 5;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let k = 0; k < 30; k++) {
      const q = { x: rect.x0 + rand() * 320, y: rect.y0 + rand() * 260 };
      expect(copies.filter((g) => inside(apply(inverse(g), q), t.domain))).toHaveLength(1);
    }
  });

  it("computes the centroid of a polygon", () => {
    expect(polygonCentroid([{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 }])).toEqual({ x: 1, y: 1 });
  });
});
