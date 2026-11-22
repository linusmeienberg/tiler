/**
 * The 17 wallpaper groups as data: a lattice type and coset representatives of
 * the translation subgroup (linear part M and translation t, both in fractional
 * coordinates of the conventional basis a₁, a₂). The identity coset is implicit.
 *
 * Adapted from the earlier Python version of this project, with p3m1 and p31m
 * the right way round (they were swapped there): MHEX_A mirrors run along the
 * lattice vectors, so the triangle centers are 3-fold cones off the mirrors –
 * 3*3 (p31m).
 */
import type { Generator } from "./group";
import { compose, identity, translation, type Isometry, type Point } from "./isometry";

export type LatticeKind = "oblique" | "rect" | "centered" | "square" | "hex";

type M = [[number, number], [number, number]];
type Op = [M, [number, number]];

const I: M = [[1, 0], [0, 1]];
const R180: M = [[-1, 0], [0, -1]];
const MX: M = [[1, 0], [0, -1]];
const MY: M = [[-1, 0], [0, 1]];
const ROT90: M = [[0, -1], [1, 0]];
const R3: M = [[-1, -1], [1, 0]];
const R6: M = [[0, -1], [1, 1]];
const MHEX_A: M = [[1, 1], [0, -1]];
const MHEX_B: M = [[0, 1], [1, 0]];
const H = 0.5;

const mul = (a: M, b: M): M => [
  [a[0][0] * b[0][0] + a[0][1] * b[1][0], a[0][0] * b[0][1] + a[0][1] * b[1][1]],
  [a[1][0] * b[0][0] + a[1][1] * b[1][0], a[1][0] * b[0][1] + a[1][1] * b[1][1]],
];
const pow = (a: M, k: number): M => (k === 0 ? I : mul(a, pow(a, k - 1)));
const rots = (r: M, n: number, t: [number, number] = [0, 0]): Op[] =>
  Array.from({ length: n - 1 }, (_, k) => [pow(r, k + 1), t] as Op);
const mirrors = (m: M, r: M, n: number, t: [number, number] = [0, 0]): Op[] =>
  Array.from({ length: n }, (_, k) => [mul(m, pow(r, k)), t] as Op);

export interface WallpaperGroup {
  conway: string;
  iuc: string;
  lattice: LatticeKind;
  ops: Op[];
}

export const GROUPS: WallpaperGroup[] = [
  { conway: "o", iuc: "p1", lattice: "oblique", ops: [] },
  { conway: "2222", iuc: "p2", lattice: "oblique", ops: [[R180, [0, 0]]] },
  { conway: "**", iuc: "pm", lattice: "rect", ops: [[MX, [0, 0]]] },
  { conway: "xx", iuc: "pg", lattice: "rect", ops: [[MX, [H, 0]]] },
  { conway: "*x", iuc: "cm", lattice: "centered", ops: [[MX, [0, 0]]] },
  { conway: "*2222", iuc: "pmm", lattice: "rect", ops: [[MX, [0, 0]], [MY, [0, 0]], [R180, [0, 0]]] },
  { conway: "22*", iuc: "pmg", lattice: "rect", ops: [[R180, [0, 0]], [MY, [H, 0]], [MX, [H, 0]]] },
  { conway: "22x", iuc: "pgg", lattice: "rect", ops: [[R180, [0, 0]], [MX, [H, H]], [MY, [H, H]]] },
  { conway: "2*22", iuc: "cmm", lattice: "centered", ops: [[MX, [0, 0]], [MY, [0, 0]], [R180, [0, 0]]] },
  { conway: "442", iuc: "p4", lattice: "square", ops: rots(ROT90, 4) },
  { conway: "*442", iuc: "p4m", lattice: "square", ops: [...rots(ROT90, 4), ...mirrors(MX, ROT90, 4)] },
  { conway: "4*2", iuc: "p4g", lattice: "square", ops: [...rots(ROT90, 4), ...mirrors(MX, ROT90, 4, [H, H])] },
  { conway: "333", iuc: "p3", lattice: "hex", ops: rots(R3, 3) },
  { conway: "*333", iuc: "p3m1", lattice: "hex", ops: [...rots(R3, 3), ...mirrors(MHEX_B, R3, 3)] },
  { conway: "3*3", iuc: "p31m", lattice: "hex", ops: [...rots(R3, 3), ...mirrors(MHEX_A, R3, 3)] },
  { conway: "632", iuc: "p6", lattice: "hex", ops: rots(R6, 6) },
  { conway: "*632", iuc: "p6m", lattice: "hex", ops: [...rots(R6, 6), ...mirrors(MHEX_A, R6, 6)] },
];

export function findGroup(conway: string): WallpaperGroup {
  return GROUPS.find((g) => g.conway === conway) ?? GROUPS[0];
}

/** Free lattice parameters: |a₁|, |a₂|/|a₁| (oblique, rect, centered), angle (oblique only). */
export interface LatticeParams {
  size: number;
  ratio: number;
  angleDeg: number;
}

export const DEFAULT_PARAMS: LatticeParams = { size: 160, ratio: 1.4, angleDeg: 75 };

/** Conventional basis (screen coordinates, y down; a₂ points down for positive angles). */
export function basis(kind: LatticeKind, { size, ratio, angleDeg }: LatticeParams): [Point, Point] {
  switch (kind) {
    case "oblique": {
      const a = (angleDeg * Math.PI) / 180;
      return [{ x: size, y: 0 }, { x: size * ratio * Math.cos(a), y: size * ratio * Math.sin(a) }];
    }
    case "rect":
    case "centered":
      return [{ x: size, y: 0 }, { x: 0, y: size * ratio }];
    case "square":
      return [{ x: size, y: 0 }, { x: 0, y: size }];
    case "hex":
      return [{ x: size, y: 0 }, { x: size / 2, y: (size * Math.sqrt(3)) / 2 }];
  }
}

/** Cartesian isometry B·M·B⁻¹, B·t from fractional coordinates. */
function toCartesian([a1, a2]: [Point, Point], [m, t]: Op): Isometry {
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
  return { a: L[0][0], b: L[0][1], c: L[1][0], d: L[1][1], tx: a1.x * t[0] + a2.x * t[1], ty: a1.y * t[0] + a2.y * t[1] };
}

export interface Realization {
  a1: Point;
  a2: Point;
  /** One element per coset of the lattice {u·a₁ + v·a₂}: every group element is (u a₁ + v a₂) ∘ coset. */
  cosets: Isometry[];
  generators: Generator[];
}

/** The group in Cartesian coordinates for the given lattice parameters. */
export function realize(group: WallpaperGroup, params: LatticeParams): Realization {
  const [a1, a2] = basis(group.lattice, params);
  const ops = group.ops.map((op) => toCartesian([a1, a2], op));
  const generators: Generator[] = [
    { name: "t₁", g: translation(a1) },
    { name: "t₂", g: translation(a2) },
  ];
  let cosets = [identity, ...ops];
  if (group.lattice === "centered") {
    const c = translation({ x: (a1.x + a2.x) / 2, y: (a1.y + a2.y) / 2 });
    generators.push({ name: "c", g: c });
    cosets = [...cosets, ...cosets.map((g) => compose(c, g))];
  }
  ops.forEach((g, i) => generators.push({ name: `g${i + 1}`, g }));
  return { a1, a2, cosets, generators };
}
