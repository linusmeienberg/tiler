import { describe, expect, it } from "vitest";
import { construct } from "../src/construction";
import { GROUPS, realize } from "../src/groups";
import { apply, compose, inverse, translation, type Point } from "../src/isometry";
import { COPIES_PER_CELL } from "../src/inventory";

const params = { size: 100, ratio: 1.4, angleDeg: 72 };
const p = { x: 21.37, y: 13.12 };

function inside(q: Point, polygon: Point[]): boolean {
  let sign = 0;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    const c = (b.x - a.x) * (q.y - a.y) - (b.y - a.y) * (q.x - a.x);
    if (Math.abs(c) < 1e-6) return false; // on the boundary: skip
    if (sign === 0) sign = Math.sign(c);
    else if (Math.sign(c) !== sign) return false;
  }
  return true;
}

describe("wallpaper group table", () => {
  it.each(GROUPS.map((g) => [g.conway, g] as const))("%s: lattice × cosets tile the plane once", (_, group) => {
    const r = realize(group, params);
    const primitive = group.lattice === "centered" ? 2 : 1;
    expect(r.cosets.length).toBe(COPIES_PER_CELL[group.conway] * primitive);

    const c = construct(r.generators, p, { radius: 800 });
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 300 - 150;
    for (let k = 0; k < 100; k++) {
      const q = { x: rand(), y: rand() };
      let hits = 0;
      for (let u = -5; u <= 5; u++)
        for (let v = -5; v <= 5; v++)
          for (const g of r.cosets) {
            const T = translation({ x: u * r.a1.x + v * r.a2.x, y: u * r.a1.y + v * r.a2.y });
            // q ∈ (T∘g)(D)  ⇔  (T∘g)⁻¹(q) ∈ D
            if (inside(apply(inverse(compose(T, g)), q), c.domain)) hits++;
          }
      expect(hits).toBe(1); // random points never land exactly on a boundary
    }
  });
});
