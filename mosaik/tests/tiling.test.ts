import { describe, expect, it } from "vitest";
import { GROUPS } from "../src/groups";
import { apply, inverse, type Point } from "../src/isometry";
import { buildTiling, copyAt, polygonCentroid, visibleCopies } from "../src/tiling";

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
    const t = buildTiling(conway, params, base)!;
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
    expect(buildTiling("*442", params, { x: 0.3, y: 0 })).toBeNull(); // on a mirror
  });

  it("gives null when zoomed out too far", () => {
    const t = buildTiling("*632", params, base)!;
    expect(visibleCopies(t, { x0: 0, y0: 0, x1: 1e5, y1: 1e5 })).toBeNull();
  });

  it("computes the centroid of a polygon", () => {
    expect(polygonCentroid([{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 }])).toEqual({ x: 1, y: 1 });
  });
});
