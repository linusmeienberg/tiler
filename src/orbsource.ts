/**
 * The orbifold mode's own state: a group (from the table or taken over from
 * analysis / generation), a start point p and a content (photo, motif, or none:
 * a white orbifold to paint on) – and how it becomes a PatternSource for the 3D
 * view.
 */
import type { GroupLines } from "./bodies";
import { canonicalDomain, type OrbifoldDomain } from "./canonical";
import { cellSize, renderCell, type Stroke } from "./cell";
import { construct } from "./construction";
import type { Realization } from "./groups";
import { inventory } from "./inventory";
import type { Isometry, Point } from "./isometry";
import type { PatternSource } from "./orbifold3d";

export interface OrbState {
  /** Increases with every new group or transfer: the painting is cleared then. */
  version: number;
  realization: Realization;
  label: string; // "*442 (p4m)"
  /** Where it came from (for the panel). */
  origin: "table" | "analyse" | "generate";
  /** For table groups: the table entry, so the generation can take it over with its lattice sliders. */
  table?: { group: string; params: { size: number; ratio: number; angleDeg: number } };
  base: Point;
  /** Decides the choices the group leaves open (see canonical.ts). */
  reference: Point;
  /** Draws the content in pattern coordinates; null: white. */
  paint: ((ctx: CanvasRenderingContext2D) => void) | null;
}

const WHITE = "#ffffff";

interface Built {
  version: number;
  source: PatternSource | null;
  elements: Isometry[];
  orbifold: OrbifoldDomain | null;
}
let built: Built | null = null;

/** The 3D view's source for the state (cached per version). */
export function sourceFor(s: OrbState): PatternSource | null {
  if (built?.version === s.version) return built.source;
  const { a1, a2 } = s.realization;
  const cell = Math.hypot(a1.x, a1.y) + Math.hypot(a2.x, a2.y);
  const c = construct(s.realization.generators, s.base, { radius: 6 * cell });
  const inv = inventory(c, s.base);
  if (!c.translations || !inv) {
    built = { version: s.version, source: null, elements: [], orbifold: null };
    return null;
  }
  const r = canonicalDomain(c, inv, s.base, s.reference);
  const orbifold = "error" in r ? null : r.domain;
  const elements = c.elements.map((e) => e.g);
  const { t1, t2 } = c.translations;
  const lines: GroupLines = { mirrors: inv.mirrors, glides: inv.glides, centers: inv.centers, t1, t2, reference: s.reference };
  const domain = orbifold?.polygon ?? c.domain;
  const source: PatternSource = {
    key: `orb-${s.version}`,
    label: s.label,
    symbol: inv.symbol,
    t1,
    t2,
    orbifold,
    lines,
    base: s.base,
    groupKey: `orb-${s.version}`,
    copies: () => elements,
    render: (a, b, { origin, marks, strokes }) =>
      renderCell({
        a,
        b,
        origin,
        ...cellSize(a, b),
        domain,
        copies: elements,
        paint: s.paint ?? (() => {}),
        background: WHITE,
        marks: marks && orbifold ? { domain: orbifold, copies: elements, ...marks } : undefined,
        strokes: strokes?.length ? { list: strokes, copies: elements } : undefined,
      }),
  };
  built = { version: s.version, source, elements, orbifold };
  return source;
}

/**
 * The orbifold's content including the painting, as a picture of the region
 * around D: for taking it over into the generation as a motif.
 */
export function snapshot(s: OrbState, strokes: Stroke[]): { canvas: HTMLCanvasElement; rect: { x: number; y: number; w: number; h: number } } | null {
  const source = sourceFor(s);
  if (!source || !built) return null;
  const D = built.orbifold?.polygon;
  if (!D) return null;
  // Cover D and a whole lattice cell around p: the generation may use another
  // fundamental domain (the Voronoi cell of p), which must find content too.
  const reach = Math.hypot(source.t1.x, source.t1.y) + Math.hypot(source.t2.x, source.t2.y);
  const pts = [...D, { x: s.base.x - reach, y: s.base.y - reach }, { x: s.base.x + reach, y: s.base.y + reach }];
  const xs = pts.map((v) => v.x);
  const ys = pts.map((v) => v.y);
  const rect = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  const canvas = source.render({ x: rect.w, y: 0 }, { x: 0, y: rect.h }, { origin: { x: rect.x, y: rect.y }, strokes });
  return { canvas, rect };
}
