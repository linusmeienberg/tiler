import { describe, expect, it } from "vitest";
import { buildBody, bodyKind } from "../src/bodies";
import { canonicalDomain } from "../src/canonical";
import { construct } from "../src/construction";
import { findGroup, GROUPS, realize } from "../src/groups";
import { apply, inverse } from "../src/isometry";
import { inventory } from "../src/inventory";

const params = { size: 100, ratio: 1.3, angleDeg: 74 };
const p = { x: 21.37, y: 13.12 };

function setup(conway: string) {
  const c = construct(realize(findGroup(conway), params).generators, p, { radius: 800 });
  const inv = inventory(c, p)!;
  const r = canonicalDomain(c, inv, p, { x: 0, y: 0 });
  if ("error" in r) throw new Error(r.error);
  const { t1, t2 } = c.translations!;
  const lines = { mirrors: inv.mirrors, glides: inv.glides, centers: inv.centers, t1, t2, reference: { x: 0, y: 0 } };
  return { c, d: r.domain, lines };
}

const len3 = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

const ALL = GROUPS.map((g) => g.conway).filter((s) => bodyKind(s) !== null);
const IMMERSED = ["*x", "xx", "22x"];
const BUILT = ALL.filter((s) => !IMMERSED.includes(s)); // the exact (isometric) bodies

describe("orbifold bodies", () => {
  it("covers every group but o (whose orbifold is the torus)", () => {
    expect(ALL.length).toBe(16);
    expect(BUILT.sort()).toEqual(["*2222", "*333", "*442", "*632", "**", "2*22", "2222", "22*", "3*3", "333", "4*2", "442", "632"].sort());
  });

  it.each(IMMERSED.map((s) => [s] as const))("%s: the parameter rectangle is a fundamental domain, glued as the immersion requires", (symbol) => {
    const { c, d, lines } = setup(symbol);
    const body = buildBody(symbol, d, { lines })!;
    expect(body).not.toBeNull();
    // The rectangle: origin + ξ·A + η·B with A = a / 2 for the shiftable ones (texture spans a whole period).
    const { origin } = body.region;
    const A = body.shiftable ? { x: body.region.a.x / 2, y: body.region.a.y / 2 } : body.region.a;
    const B = body.region.b;
    const det = A.x * B.y - A.y * B.x;
    const { t1, t2 } = c.translations!;
    expect(Math.abs(det)).toBeCloseTo(Math.abs(t1.x * t2.y - t1.y * t2.x) / c.copiesPerCell!, 6);
    const local = (w: { x: number; y: number }) => {
      const q = { x: w.x - origin.x, y: w.y - origin.y };
      return { xi: (q.x * B.y - q.y * B.x) / det, eta: (A.x * q.y - A.y * q.x) / det };
    };
    const at = (xi: number, eta: number) => ({ x: origin.x + xi * A.x + eta * B.x, y: origin.y + xi * A.y + eta * B.y });
    // Tiles: random points lie in exactly one copy g(R).
    let seed = 9;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let k = 0; k < 40; k++) {
      const q = at(rand() * 3 - 1, rand() * 3 - 1);
      const hits = c.elements.filter((e) => {
        const l = local(apply(inverse(e.g), q));
        return l.xi > 1e-9 && l.xi < 1 - 1e-9 && l.eta > 1e-9 && l.eta < 1 - 1e-9;
      });
      expect(hits).toHaveLength(1);
    }
    // Boundary points identified by the group land on the same point of the body.
    const onBoundary = (l: { xi: number; eta: number }) =>
      l.xi > -1e-9 && l.xi < 1 + 1e-9 && l.eta > -1e-9 && l.eta < 1 + 1e-9 &&
      (Math.abs(l.xi) < 1e-9 || Math.abs(l.xi - 1) < 1e-9 || Math.abs(l.eta) < 1e-9 || Math.abs(l.eta - 1) < 1e-9);
    let identified = 0;
    for (const t of [0.1, 0.37, 0.5, 0.81]) {
      for (const q of [at(t, 0), at(t, 1), at(0, t), at(1, t)]) {
        for (const e of c.elements) {
          const w = apply(e.g, q);
          if (Math.hypot(w.x - q.x, w.y - q.y) < 1e-6 || !onBoundary(local(w))) continue;
          expect(len3(body.place!(q), body.place!(w))).toBeLessThan(1e-6);
          identified++;
        }
      }
    }
    expect(identified).toBeGreaterThanOrEqual(8); // Möbius band: only the cut edges (mirror points map to themselves)
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
