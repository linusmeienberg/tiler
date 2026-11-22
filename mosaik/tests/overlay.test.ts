import { describe, expect, it } from "vitest";
import { compareRGBA } from "../src/overlay";

const rgba = (...pixels: number[][]) => new Uint8ClampedArray(pixels.flat());

describe("compareRGBA", () => {
  it("is zero for identical images", () => {
    const a = rgba([10, 20, 30, 255], [200, 100, 0, 255]);
    expect(compareRGBA(a, a)).toEqual({ mean: 0, coverage: 1 });
  });

  it("averages the absolute RGB difference over pixels opaque in both", () => {
    const a = rgba([0, 0, 0, 255], [0, 0, 0, 255], [0, 0, 0, 255]);
    const b = rgba([255, 255, 255, 255], [0, 0, 0, 255], [255, 255, 255, 0]);
    const out = new Uint8ClampedArray(a.length);
    const { mean, coverage } = compareRGBA(a, b, out);
    expect(mean).toBeCloseTo(0.5, 12); // black vs white, black vs black; third pixel ignored
    expect(coverage).toBeCloseTo(2 / 3, 12);
    expect(out[3]).toBe(255); // fully different: opaque red
    expect(out[7]).toBe(0); // equal: transparent
    expect(out[11]).toBe(0); // not compared
  });
});
