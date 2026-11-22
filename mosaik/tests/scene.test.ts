import { describe, expect, it } from "vitest";
import { generateGroup } from "../src/group";
import { apply } from "../src/isometry";
import {
  addElement,
  emptyScene,
  hitElement,
  hitHandle,
  labels,
  latticeBasis,
  snap,
  toGenerators,
  type Scene,
} from "../src/scene";

/** The example image: *442 with a 90 px square cell whose origin is at (37, 23). */
function sampleScene(): Scene {
  const scene = emptyScene();
  addElement(scene, { kind: "lattice", points: [{ x: 37, y: 23 }, { x: 127, y: 23 }, { x: 37, y: 113 }] });
  addElement(scene, { kind: "mirror", points: [{ x: 37, y: 23 }, { x: 82, y: 23 }] });
  addElement(scene, { kind: "mirror", points: [{ x: 82, y: 23 }, { x: 82, y: 68 }] });
  addElement(scene, { kind: "mirror", points: [{ x: 37, y: 23 }, { x: 82, y: 68 }] });
  return scene;
}

describe("scene", () => {
  it("names elements per kind", () => {
    const scene = sampleScene();
    addElement(scene, { kind: "rotation", points: [{ x: 82, y: 68 }], order: 4 });
    expect([...labels(scene).values()]).toEqual(["t₁, t₂", "m₁", "m₂", "m₃", "r₁"]);
  });

  it("turns drawn elements into generators of the right group (*442: 8 per cell)", () => {
    const scene = sampleScene();
    const gens = toGenerators(scene);
    expect(gens.map((g) => g.name)).toEqual(["t₁", "t₂", "m₁", "m₂", "m₃"]);

    const center = { x: 37 + 180, y: 23 + 180 };
    const els = generateGroup(gens, { center, radius: 600 });
    const p = { x: 37 + 11.1, y: 23 + 5.3 }; // generic point
    // Orbit points inside the 4×4 block of cells starting at the origin.
    const inside = els
      .map((e) => apply(e.g, p))
      .filter((q) => q.x >= 37 && q.x < 37 + 360 && q.y >= 23 && q.y < 23 + 360);
    expect(inside).toHaveLength(8 * 16);
  });

  it("needs a complete, non-degenerate lattice for a basis", () => {
    const scene = emptyScene();
    addElement(scene, { kind: "lattice", points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] });
    expect(latticeBasis(scene)).toBeNull();
    scene.elements[0].points.push({ x: 20, y: 0 }); // collinear
    expect(latticeBasis(scene)).toBeNull();
    scene.elements[0].points[2] = { x: 0, y: 10 };
    expect(latticeBasis(scene)).not.toBeNull();
  });

  it("snaps to lattice points, edge midpoints, cell centers and element points", () => {
    const scene = sampleScene();
    expect(snap(scene, { x: 127 + 3, y: 23 - 2 }, 6)).toEqual({ x: 127, y: 23 }); // lattice point
    expect(snap(scene, { x: 82 + 2, y: 113 + 1 }, 6)).toEqual({ x: 82, y: 113 }); // edge midpoint
    expect(snap(scene, { x: 172 - 4, y: 158 }, 6)).toEqual({ x: 172, y: 158 }); // cell center
    expect(snap(scene, { x: 60, y: 90 }, 6)).toBeNull();
    const free = emptyScene();
    addElement(free, { kind: "rotation", points: [{ x: 5, y: 5 }], order: 2 });
    expect(snap(free, { x: 6, y: 4 }, 3)).toEqual({ x: 5, y: 5 });
    expect(snap(free, { x: 6, y: 4 }, 3, { id: 1, index: 0 })).toBeNull();
  });

  it("while drawing a₂, snaps to a₁ turned by 90° (square) or 60° (hexagonal)", () => {
    const scene = emptyScene();
    addElement(scene, { kind: "lattice", points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] });
    const square = snap(scene, { x: 2, y: 97 }, 6)!;
    expect(square.x).toBeCloseTo(0, 9);
    expect(square.y).toBeCloseTo(100, 9);
    const hex = snap(scene, { x: 52, y: -84 }, 6)!;
    expect(hex.x).toBeCloseTo(50, 9);
    expect(hex.y).toBeCloseTo(-50 * Math.sqrt(3), 9);
  });

  it("hits handles first, then infinite axes", () => {
    const scene = sampleScene();
    expect(hitHandle(scene, { x: 128, y: 24 }, 3)).toEqual({ id: 1, index: 1 });
    // Far along m₂ (x = 82), away from all handles.
    expect(hitElement(scene, { x: 83, y: 400 }, 3)).toBe(3);
    expect(hitElement(scene, { x: 300, y: 400 }, 3)).toBeNull();
  });
});
