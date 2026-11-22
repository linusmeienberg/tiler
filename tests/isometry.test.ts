import { describe, expect, it } from "vitest";
import {
  apply,
  compose,
  equals,
  glide,
  identity,
  inverse,
  kind,
  reflection,
  rotation,
  rotationCenter,
  rotationOrder,
  translation,
  type Isometry,
} from "../src/isometry";

function power(g: Isometry, n: number): Isometry {
  let result = identity;
  for (let i = 0; i < n; i++) result = compose(g, result);
  return result;
}

describe("isometry", () => {
  it("rotation of order n has order n and fixes its center", () => {
    for (const n of [2, 3, 4, 6]) {
      const c = { x: 0.3, y: -1.7 };
      const r = rotation(c, n);
      expect(equals(power(r, n), identity)).toBe(true);
      expect(equals(power(r, n - 1), identity)).toBe(false);
      const fixed = apply(r, c);
      expect(fixed.x).toBeCloseTo(c.x, 12);
      expect(fixed.y).toBeCloseTo(c.y, 12);
      expect(rotationOrder(r)).toBe(n);
      const center = rotationCenter(r);
      expect(center.x).toBeCloseTo(c.x, 12);
      expect(center.y).toBeCloseTo(c.y, 12);
    }
  });

  it("reflection is an involution fixing its line", () => {
    const p = { x: 1, y: 2 };
    const q = { x: 3, y: 5 };
    const m = reflection(p, q);
    expect(equals(compose(m, m), identity)).toBe(true);
    const r = apply(m, q);
    expect(r.x).toBeCloseTo(q.x, 12);
    expect(r.y).toBeCloseTo(q.y, 12);
    expect(kind(m)).toBe("reflection");
  });

  it("glide squared is the translation by twice the glide vector", () => {
    const p = { x: 0, y: 0.25 };
    const q = { x: 0.5, y: 0.25 };
    const g = glide(p, q);
    expect(equals(compose(g, g), translation({ x: 1, y: 0 }))).toBe(true);
    expect(kind(g)).toBe("glide");
  });

  it("inverse composes to the identity", () => {
    const g = compose(glide({ x: 0, y: 0 }, { x: 1, y: 2 }), rotation({ x: 4, y: 1 }, 3));
    expect(equals(compose(g, inverse(g)), identity)).toBe(true);
    expect(equals(compose(inverse(g), g), identity)).toBe(true);
  });

  it("classifies identity, translations and rotations", () => {
    expect(kind(identity)).toBe("identity");
    expect(kind(translation({ x: 1, y: 0 }))).toBe("translation");
    expect(kind(rotation({ x: 0, y: 0 }, 4))).toBe("rotation");
  });
});
