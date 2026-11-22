import { describe, expect, it } from "vitest";
import { canonicalDomain, copyContaining, insideConvex } from "../src/canonical";
import { construct, polygonArea } from "../src/construction";
import { findGroup, GROUPS, realize } from "../src/groups";
import { apply, inverse } from "../src/isometry";
import { inventory } from "../src/inventory";

const S = 100;
const params = { size: S, ratio: 1.4, angleDeg: 72 };

function setup(conway: string, p = { x: 21.37, y: 13.12 }) {
  const c = construct(realize(findGroup(conway), params).generators, p, { radius: 8 * S });
  const inv = inventory(c, p)!;
  const result = canonicalDomain(c, inv, p);
  if ("error" in result) throw new Error(result.error);
  return { c, inv, p, d: result.domain };
}

const cross = (ax: number, ay: number, bx: number, by: number) => ax * by - ay * bx;

describe("canonical (orbifold) domain", () => {
  const POINTS = [
    { x: 21.37, y: 13.12 },
    { x: 63.1, y: 47.9 },
    { x: -37.7, y: 81.3 },
  ];
  it.each(GROUPS.flatMap((g) => POINTS.map((pt, k) => [g.conway, k, pt] as const)))("%s, p #%i", (conway, _k, pt) => {
    const { c, inv, p, d } = setup(conway, pt);
    const { t1, t2 } = c.translations!;
    const cellArea = Math.abs(cross(t1.x, t1.y, t2.x, t2.y));

    // Area: one domain per point-group element.
    expect(polygonArea(d.polygon)).toBeCloseTo(cellArea / c.copiesPerCell!, 6);
    // Contains p.
    expect(insideConvex(p, d.polygon, 1e-9)).toBe(true);

    // Tiles: random points lie in exactly one copy.
    let seed = 3;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 2 * S;
    for (let k = 0; k < 80; k++) {
      const q = { x: p.x + rand(), y: p.y + rand() };
      const hits = c.elements.filter((e) => insideConvex(apply(inverse(e.g), q), d.polygon, -1e-7));
      expect(hits).toHaveLength(1);
      expect(copyContaining(c, d.polygon, q)).toBe(c.elements.indexOf(hits[0]));
    }

    // Every edge is a mirror or glued to a partner (which points back).
    d.edges.forEach((e, i) => {
      expect(e.kind).not.toBe("open");
      if (e.kind === "glued") expect(d.edges[e.partner!].partner).toBe(i);
    });

    // No mirror crosses the interior.
    for (const l of inv.mirrors) {
      const sides = d.polygon.map((v) => cross(l.u.x, l.u.y, v.x - l.a.x, v.y - l.a.y));
      expect(Math.max(...sides) < 1e-6 || Math.min(...sides) > -1e-6).toBe(true);
    }

    // Every class of cone points and mirror corners is a vertex.
    expect(new Set(d.singular.map((v) => v.classIndex))).toEqual(new Set(inv.classes.map((_, i) => i)));

    // Mirror edges exactly when the symbol has a *; glide gluing exactly when it has an x.
    expect(d.edges.some((e) => e.kind === "mirror")).toBe(conway.includes("*"));
    expect(d.edges.some((e) => e.via === "glide")).toBe(conway.includes("x"));
  });

  it("is the mirror chamber for kaleidoscopes (*442: triangle, all edges mirrors)", () => {
    const { d } = setup("*442");
    expect(d.polygon).toHaveLength(3);
    expect(d.edges.every((e) => e.kind === "mirror")).toBe(true);
  });

  it("is the kite 4-2-4-2 for 442", () => {
    const { d } = setup("442");
    expect(d.polygon).toHaveLength(4);
    expect(d.singular.map((v) => v.order).sort()).toEqual([2, 2, 4, 4]);
    expect(d.edges.every((e) => e.via === "rotation")).toBe(true);
  });

  it("refuses p on a mirror", () => {
    const { c, inv } = setup("*442");
    expect("error" in canonicalDomain(c, inv, { x: 30, y: 0 })).toBe(true);
  });
});
