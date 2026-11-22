import { describe, expect, it } from "vitest";
import { construct } from "../src/construction";
import type { Generator } from "../src/group";
import { translation, type Isometry, type Point } from "../src/isometry";
import { inventory } from "../src/inventory";

/*
 * Reference: the 17 groups as coset representatives (linear part M and translation
 * t in fractional coordinates of the conventional basis), taken from
 * tiler/src/tiler/groups.py, where they are verified for closure and order
 * (but p3m1 and p31m are swapped there, see below).
 */
type M = [[number, number], [number, number]];
const I: M = [[1, 0], [0, 1]];
const R180: M = [[-1, 0], [0, -1]];
const MX: M = [[1, 0], [0, -1]];
const MY: M = [[-1, 0], [0, 1]];
const ROT90: M = [[0, -1], [1, 0]];
const R3: M = [[-1, -1], [1, 0]];
const R6: M = [[0, -1], [1, 1]];
const MHEX_A: M = [[1, 1], [0, -1]];
const MHEX_B: M = [[0, 1], [1, 0]];

const mul = (a: M, b: M): M => [
  [a[0][0] * b[0][0] + a[0][1] * b[1][0], a[0][0] * b[0][1] + a[0][1] * b[1][1]],
  [a[1][0] * b[0][0] + a[1][1] * b[1][0], a[1][0] * b[0][1] + a[1][1] * b[1][1]],
];
const pow = (a: M, k: number): M => (k === 0 ? I : mul(a, pow(a, k - 1)));
const H = 0.5;

type Lattice = "oblique" | "rect" | "centered" | "square" | "hex";
const S = 100; // pixel-like scale
const BASIS: Record<Lattice, [Point, Point]> = {
  oblique: [{ x: S, y: 0 }, { x: 0.3 * S, y: 1.1 * S }],
  rect: [{ x: S, y: 0 }, { x: 0, y: 1.4 * S }],
  centered: [{ x: S, y: 0 }, { x: 0, y: 1.4 * S }],
  square: [{ x: S, y: 0 }, { x: 0, y: S }],
  hex: [{ x: S, y: 0 }, { x: 0.5 * S, y: (Math.sqrt(3) / 2) * S }],
};

const GROUPS: [string, Lattice, [M, [number, number]][]][] = [
  ["o", "oblique", [[I, [0, 0]]]],
  ["2222", "oblique", [[R180, [0, 0]]]],
  ["**", "rect", [[MX, [0, 0]]]],
  ["xx", "rect", [[MX, [H, 0]]]],
  ["*x", "centered", [[MX, [0, 0]]]],
  ["*2222", "rect", [[MX, [0, 0]], [MY, [0, 0]], [R180, [0, 0]]]],
  ["22*", "rect", [[R180, [0, 0]], [MY, [H, 0]], [MX, [H, 0]]]],
  ["22x", "rect", [[R180, [0, 0]], [MX, [H, H]], [MY, [H, H]]]],
  ["2*22", "centered", [[MX, [0, 0]], [MY, [0, 0]], [R180, [0, 0]]]],
  ["442", "square", [1, 2, 3].map((k) => [pow(ROT90, k), [0, 0]])],
  ["*442", "square", [...[1, 2, 3].map((k) => [pow(ROT90, k), [0, 0]] as [M, [number, number]]), ...[0, 1, 2, 3].map((k) => [mul(MX, pow(ROT90, k)), [0, 0]] as [M, [number, number]])]],
  ["4*2", "square", [...[1, 2, 3].map((k) => [pow(ROT90, k), [0, 0]] as [M, [number, number]]), ...[0, 1, 2, 3].map((k) => [mul(MX, pow(ROT90, k)), [H, H]] as [M, [number, number]])]],
  ["333", "hex", [1, 2].map((k) => [pow(R3, k), [0, 0]])],
  // Note: tiler labels these two the other way round, which is wrong. MHEX_A mirrors
  // run along the lattice vectors (edges of the triangle grid), so the triangle centers
  // are 3-fold cones off the mirrors: 3*3 (p31m). MHEX_B mirrors are perpendicular to
  // lattice vectors and pass through every 3-fold center: *333 (p3m1).
  ["3*3", "hex", [...[1, 2].map((k) => [pow(R3, k), [0, 0]] as [M, [number, number]]), ...[0, 1, 2].map((k) => [mul(MHEX_A, pow(R3, k)), [0, 0]] as [M, [number, number]])]],
  ["*333", "hex", [...[1, 2].map((k) => [pow(R3, k), [0, 0]] as [M, [number, number]]), ...[0, 1, 2].map((k) => [mul(MHEX_B, pow(R3, k)), [0, 0]] as [M, [number, number]])]],
  ["632", "hex", [1, 2, 3, 4, 5].map((k) => [pow(R6, k), [0, 0]])],
  ["*632", "hex", [...[1, 2, 3, 4, 5].map((k) => [pow(R6, k), [0, 0]] as [M, [number, number]]), ...[0, 1, 2, 3, 4, 5].map((k) => [mul(MHEX_A, pow(R6, k)), [0, 0]] as [M, [number, number]])]],
];

/** Cartesian isometry B·M·B⁻¹, B·t from fractional coordinates. */
function toCartesian([a1, a2]: [Point, Point], m: M, t: [number, number]): Isometry {
  const det = a1.x * a2.y - a1.y * a2.x;
  const Binv: M = [
    [a2.y / det, -a2.x / det],
    [-a1.y / det, a1.x / det],
  ];
  const B: M = [
    [a1.x, a2.x],
    [a1.y, a2.y],
  ];
  const L = mul(mul(B, m), Binv);
  return {
    a: L[0][0],
    b: L[0][1],
    c: L[1][0],
    d: L[1][1],
    tx: a1.x * t[0] + a2.x * t[1],
    ty: a1.y * t[0] + a2.y * t[1],
  };
}

function generators(lattice: Lattice, ops: [M, [number, number]][]): Generator[] {
  const [a1, a2] = BASIS[lattice];
  const gens: Generator[] = [
    { name: "t₁", g: translation(a1) },
    { name: "t₂", g: translation(a2) },
  ];
  if (lattice === "centered") gens.push({ name: "c", g: translation({ x: (a1.x + a2.x) / 2, y: (a1.y + a2.y) / 2 }) });
  ops.forEach(([m, t], i) => gens.push({ name: `g${i}`, g: toCartesian(BASIS[lattice], m, t) }));
  return gens;
}

const p = { x: 0.2137 * S, y: 0.1312 * S }; // generic for all 17 groups

describe("inventory", () => {
  it.each(GROUPS)("recognizes %s", (symbol, lattice, ops) => {
    const c = construct(generators(lattice, ops), p, { radius: 8 * S });
    expect(c.warnings).toEqual([]);
    const inv = inventory(c, p)!;
    expect(inv.symbol).toBe(symbol);
    expect(inv.problems).toEqual([]);
    expect(inv.total).toBeCloseTo(2, 12);
  });

  it("itemizes *442 with one class per corner and colors them", () => {
    const ops = GROUPS.find(([s]) => s === "*442")![2];
    const c = construct(generators("square", ops), p, { radius: 8 * S });
    const inv = inventory(c, p)!;
    expect(inv.items.map((i) => i.feature)).toEqual(["*", "*4", "*4", "*2"]);
    expect(inv.classes).toEqual([
      { order: 4, corner: true },
      { order: 4, corner: true },
      { order: 2, corner: true },
    ]);
    // Every rotation center in the region is assigned a class.
    expect(inv.centers.length).toBeGreaterThan(50);
    expect(new Set(inv.centers.map((z) => z.classIndex))).toEqual(new Set([0, 1, 2]));
  });

  it("reports a missing element: *442 drawn as 442 plus one mirror is still found complete", () => {
    // 442 generators plus one mirror through a 4-fold center generate all of *442.
    const ops442 = GROUPS.find(([s]) => s === "442")![2];
    const gens = generators("square", ops442);
    gens.push({ name: "m", g: toCartesian(BASIS.square, MX, [0, 0]) });
    const c = construct(gens, p, { radius: 8 * S });
    expect(inventory(c, p)!.symbol).toBe("*442");
  });
});
