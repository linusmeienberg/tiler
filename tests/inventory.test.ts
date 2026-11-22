import { describe, expect, it } from "vitest";
import { construct } from "../src/construction";
import { findGroup, GROUPS, realize, type LatticeParams } from "../src/groups";
import { reflection } from "../src/isometry";
import { inventory } from "../src/inventory";

const S = 100; // pixel-like scale
const params: LatticeParams = { size: S, ratio: 1.4, angleDeg: 72 };
const p = { x: 0.2137 * S, y: 0.1312 * S }; // generic for all 17 groups

describe("inventory", () => {
  it.each(GROUPS.map((g) => [g.conway, g] as const))("recognizes %s", (symbol, group) => {
    const c = construct(realize(group, params).generators, p, { radius: 8 * S });
    expect(c.warnings).toEqual([]);
    const inv = inventory(c, p)!;
    expect(inv.symbol).toBe(symbol);
    expect(inv.name).toBe(group.iuc);
    expect(inv.problems).toEqual([]);
    expect(inv.total).toBeCloseTo(2, 12);
  });

  it("itemizes *442 with one class per corner and colors them", () => {
    const c = construct(realize(findGroup("*442"), params).generators, p, { radius: 8 * S });
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

  it("finds *442 from the 442 generators plus one mirror through a 4-fold center", () => {
    const gens = realize(findGroup("442"), params).generators;
    gens.push({ name: "m", g: reflection({ x: 0, y: 0 }, { x: 1, y: 0 }) });
    const c = construct(gens, p, { radius: 8 * S });
    expect(inventory(c, p)!.symbol).toBe("*442");
  });
});
