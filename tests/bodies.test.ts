import { describe, expect, it } from "vitest";
import { buildBody, bodyKind } from "../src/bodies";
import { canonicalDomain } from "../src/canonical";
import { construct } from "../src/construction";
import { findGroup, GROUPS, realize } from "../src/groups";
import { inventory } from "../src/inventory";

const params = { size: 100, ratio: 1.3, angleDeg: 74 };
const p = { x: 21.37, y: 13.12 };

function setup(conway: string) {
  const c = construct(realize(findGroup(conway), params).generators, p, { radius: 800 });
  const inv = inventory(c, p)!;
  const r = canonicalDomain(c, inv, p, { x: 0, y: 0 });
  if ("error" in r) throw new Error(r.error);
  return { c, d: r.domain };
}

const len3 = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

const BUILT = GROUPS.map((g) => g.conway).filter((s) => bodyKind(s) !== null);

describe("orbifold bodies", () => {
  it("covers the exact cases", () => {
    expect(BUILT.sort()).toEqual(["*2222", "*333", "*442", "*632", "**", "2*22", "2222", "22*", "3*3", "333", "4*2", "442", "632"].sort());
  });

  // Rolled bodies are curved: mesh edges are chords there, so check the map locally instead.
  it.each(BUILT.filter((s) => ["cylinder", "cone"].includes(bodyKind(s)!)).map((s) => [s] as const))(
    "%s is isometric: small steps keep their length",
    (symbol) => {
      const { c, d } = setup(symbol);
      const body = buildBody(symbol, d, { lattice: c.translations! })!;
      const n = d.polygon.length;
      const g = { x: d.polygon.reduce((s, v) => s + v.x, 0) / n, y: d.polygon.reduce((s, v) => s + v.y, 0) / n };
      for (const [fx, fy] of [[0.3, 0.2], [0.6, 0.5], [0.1, 0.8]]) {
        const q = { x: g.x + (d.polygon[0].x - g.x) * fx, y: g.y + (d.polygon[1].y - g.y) * fy };
        for (const angle of [0, 1, 2.5]) {
          const h = 1e-3;
          const r = { x: q.x + h * Math.cos(angle), y: q.y + h * Math.sin(angle) };
          expect(len3(body.place!(q), body.place!(r)) / h).toBeCloseTo(1, 4);
        }
      }
    },
  );

  it.each(BUILT.filter((s) => !["cylinder", "cone"].includes(bodyKind(s)!)).map((s) => [s] as const))("%s is isometric: every mesh edge keeps its length", (symbol) => {
    const { c, d } = setup(symbol);
    const body = buildBody(symbol, d, { inflate: 0, lattice: c.translations! })!;
    expect(body).not.toBeNull();
    const P = (i: number) => body.positions.slice(3 * i, 3 * i + 3);
    for (let t = 0; t < body.indices.length; t += 3) {
      const tri = [body.indices[t], body.indices[t + 1], body.indices[t + 2]];
      for (let k = 0; k < 3; k++) {
        const i = tri[k];
        const j = tri[(k + 1) % 3];
        const planar = Math.hypot(body.planar[i].x - body.planar[j].x, body.planar[i].y - body.planar[j].y);
        expect(len3(P(i), P(j))).toBeCloseTo(planar, 6);
      }
    }
  });

  it.each(BUILT.filter((s) => s !== "2222").map((s) => [s] as const))("%s: glued edges meet in space", (symbol) => {
    const { c, d } = setup(symbol);
    const body = buildBody(symbol, d, { inflate: 0, lattice: c.translations! })!;
    const n = d.polygon.length;
    d.edges.forEach((e, i) => {
      if (e.kind !== "glued") return;
      const j = e.partner!;
      const a = d.polygon[i];
      const b = d.polygon[(i + 1) % n];
      const x = d.polygon[j];
      const y = d.polygon[(j + 1) % n];
      for (const t of [0, 0.25, 0.5, 0.8, 1]) {
        const q = { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
        // Same direction iff both edges carry the same flag (flags are relative to the pair).
        const s = e.forward === d.edges[j].forward ? t : 1 - t;
        const r = { x: x.x + s * (y.x - x.x), y: x.y + s * (y.y - x.y) };
        expect(len3(body.place!(q), body.place!(r))).toBeLessThan(1e-6);
      }
    });
  });

  it("2222: the tetrahedron has its four 2-fold centers as vertices, one of each class", () => {
    const { c, d } = setup("2222");
    const body = buildBody("2222", d, { lattice: c.translations! })!;
    expect(body.markers).toHaveLength(4);
    expect(new Set(body.markers.map((m) => m.classIndex)).size).toBe(4);
  });

  it("inflating a pillow moves the two layers apart", () => {
    const { c, d } = setup("442");
    const flat = buildBody("442", d, { inflate: 0, lattice: c.translations! })!;
    const puffed = buildBody("442", d, { inflate: 1, lattice: c.translations! })!;
    const zRange = (b: typeof flat) => {
      const zs = b.positions.filter((_, k) => k % 3 === 2);
      return Math.max(...zs) - Math.min(...zs);
    };
    expect(zRange(flat)).toBeLessThan(1e-9);
    expect(zRange(puffed)).toBeGreaterThan(5);
  });
});
