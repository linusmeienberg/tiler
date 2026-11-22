/**
 * Plane isometries as affine maps p ↦ M·p + t, with M = [[a, b], [c, d]] orthogonal.
 */

export interface Point {
  x: number;
  y: number;
}

export interface Isometry {
  a: number;
  b: number;
  c: number;
  d: number;
  tx: number;
  ty: number;
}

export const TOLERANCE = 1e-9;

export const identity: Isometry = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };

export function apply(g: Isometry, p: Point): Point {
  return { x: g.a * p.x + g.b * p.y + g.tx, y: g.c * p.x + g.d * p.y + g.ty };
}

/** g ∘ h: first h, then g. */
export function compose(g: Isometry, h: Isometry): Isometry {
  return {
    a: g.a * h.a + g.b * h.c,
    b: g.a * h.b + g.b * h.d,
    c: g.c * h.a + g.d * h.c,
    d: g.c * h.b + g.d * h.d,
    tx: g.a * h.tx + g.b * h.ty + g.tx,
    ty: g.c * h.tx + g.d * h.ty + g.ty,
  };
}

/** Inverse of an isometry: M⁻¹ = Mᵀ, t' = −Mᵀ·t. */
export function inverse(g: Isometry): Isometry {
  return {
    a: g.a,
    b: g.c,
    c: g.b,
    d: g.d,
    tx: -(g.a * g.tx + g.c * g.ty),
    ty: -(g.b * g.tx + g.d * g.ty),
  };
}

export function equals(g: Isometry, h: Isometry, tol = TOLERANCE): boolean {
  return (
    Math.abs(g.a - h.a) < tol &&
    Math.abs(g.b - h.b) < tol &&
    Math.abs(g.c - h.c) < tol &&
    Math.abs(g.d - h.d) < tol &&
    Math.abs(g.tx - h.tx) < tol &&
    Math.abs(g.ty - h.ty) < tol
  );
}

export function isOrientationPreserving(g: Isometry): boolean {
  return g.a * g.d - g.b * g.c > 0;
}

// --- constructors ------------------------------------------------------------

export function translation(v: Point): Isometry {
  return { a: 1, b: 0, c: 0, d: 1, tx: v.x, ty: v.y };
}

/** Rotation by 2π/order about `center`. */
export function rotation(center: Point, order: number): Isometry {
  const angle = (2 * Math.PI) / order;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    a: cos,
    b: -sin,
    c: sin,
    d: cos,
    tx: center.x - (cos * center.x - sin * center.y),
    ty: center.y - (sin * center.x + cos * center.y),
  };
}

/** Reflection in the line through p and q. */
export function reflection(p: Point, q: Point): Isometry {
  const phi = Math.atan2(q.y - p.y, q.x - p.x);
  const cos2 = Math.cos(2 * phi);
  const sin2 = Math.sin(2 * phi);
  return {
    a: cos2,
    b: sin2,
    c: sin2,
    d: -cos2,
    tx: p.x - (cos2 * p.x + sin2 * p.y),
    ty: p.y - (sin2 * p.x - cos2 * p.y),
  };
}

/** Glide reflection: reflect in the line through p and q, then translate by q − p. */
export function glide(p: Point, q: Point): Isometry {
  return compose(translation({ x: q.x - p.x, y: q.y - p.y }), reflection(p, q));
}

// --- classification ----------------------------------------------------------

export type IsometryKind = "identity" | "translation" | "rotation" | "reflection" | "glide";

export function kind(g: Isometry, tol = TOLERANCE): IsometryKind {
  const linearIsIdentity =
    Math.abs(g.a - 1) < tol && Math.abs(g.b) < tol && Math.abs(g.c) < tol && Math.abs(g.d - 1) < tol;
  if (linearIsIdentity) {
    return Math.hypot(g.tx, g.ty) < tol ? "identity" : "translation";
  }
  if (isOrientationPreserving(g)) return "rotation";
  // Orientation-reversing: g² is a translation by twice the glide vector.
  const g2 = compose(g, g);
  return Math.hypot(g2.tx, g2.ty) < tol ? "reflection" : "glide";
}

/** Order n of a rotation (angle 2π/n up to sign); Infinity if not a finite-order rotation. */
export function rotationOrder(g: Isometry, maxOrder = 12): number {
  if (kind(g) !== "rotation") return Infinity;
  const angle = Math.abs(Math.atan2(g.c, g.a));
  for (let n = 2; n <= maxOrder; n++) {
    for (let k = 1; k < n; k++) {
      if (Math.abs(angle - (2 * Math.PI * k) / n) < 1e-7 && gcd(k, n) === 1) return n;
    }
  }
  return Infinity;
}

/** Fixed point of a rotation: solves (I − M)·p = t. */
export function rotationCenter(g: Isometry): Point {
  const m00 = 1 - g.a;
  const m01 = -g.b;
  const m10 = -g.c;
  const m11 = 1 - g.d;
  const det = m00 * m11 - m01 * m10;
  return { x: (m11 * g.tx - m01 * g.ty) / det, y: (m00 * g.ty - m10 * g.tx) / det };
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}
