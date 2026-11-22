import { describe, expect, it } from "vitest";
import { passesPriceCheck, price, priceBreakdown, WALLPAPER_GROUPS } from "../src/orbifold";

describe("price check", () => {
  it("all 17 wallpaper groups cost exactly 2", () => {
    expect(Object.keys(WALLPAPER_GROUPS)).toHaveLength(17);
    for (const symbol of Object.keys(WALLPAPER_GROUPS)) {
      expect(passesPriceCheck(symbol), symbol).toBe(true);
    }
  });

  it("itemizes *442 as 1 + 3/8 + 3/8 + 1/4", () => {
    expect(priceBreakdown("*442")).toEqual([
      { feature: "*", cost: 1 },
      { feature: "*4", cost: 3 / 8 },
      { feature: "*4", cost: 3 / 8 },
      { feature: "*2", cost: 1 / 4 },
    ]);
  });

  it("itemizes 442 as 3/4 + 3/4 + 1/2", () => {
    expect(price("442")).toBeCloseTo(2, 12);
    expect(priceBreakdown("442").map((i) => i.cost)).toEqual([3 / 4, 3 / 4, 1 / 2]);
  });

  it("rejects impossible signatures", () => {
    for (const symbol of ["*443", "44", "2223", "*", "x", "55*"]) {
      expect(passesPriceCheck(symbol), symbol).toBe(false);
    }
  });

  it("rejects unknown characters", () => {
    expect(() => price("*44q")).toThrow();
  });
});
