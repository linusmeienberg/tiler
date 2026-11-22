/**
 * Generate the elements of a wallpaper group near a region of interest, by
 * breadth-first search over words in the generators (and their inverses).
 *
 * Each element remembers its word length (length of a shortest word), which
 * drives the step-by-step visualization.
 */
import { apply, compose, equals, identity, inverse, type Isometry, type Point } from "./isometry";

export interface Generator {
  name: string;
  g: Isometry;
}

export interface GroupElement {
  g: Isometry;
  /** A shortest word in the generators, e.g. ["a", "b⁻¹"]; [] for the identity. */
  word: string[];
  length: number;
}

export interface GenerateOptions {
  /** Center of the region of interest. */
  center: Point;
  /**
   * Elements that move `center` farther than this are discarded (and not expanded).
   * Choose it a bit larger than the visible region so that elements near the
   * border are still reached by shortest words.
   */
  radius: number;
  /** Safety cap on the number of elements. */
  maxElements?: number;
}

/** Generators plus their inverses (involutions are not duplicated). */
export function withInverses(generators: Generator[]): Generator[] {
  const out: Generator[] = [];
  for (const gen of generators) {
    out.push(gen);
    const inv = inverse(gen.g);
    if (!equals(inv, gen.g)) out.push({ name: `${gen.name}⁻¹`, g: inv });
  }
  return out;
}

export function generateGroup(generators: Generator[], options: GenerateOptions): GroupElement[] {
  const { center, radius, maxElements = 50_000 } = options;
  const letters = withInverses(generators);
  const seen = new ElementSet(center);
  const start: GroupElement = { g: identity, word: [], length: 0 };
  seen.add(start.g);
  const elements: GroupElement[] = [start];

  let frontier = [start];
  while (frontier.length > 0 && elements.length < maxElements) {
    const next: GroupElement[] = [];
    for (const element of frontier) {
      for (const letter of letters) {
        const g = compose(element.g, letter.g);
        const image = apply(g, center);
        if (Math.hypot(image.x - center.x, image.y - center.y) > radius) continue;
        if (seen.has(g)) continue;
        seen.add(g);
        const child = { g, word: [...element.word, letter.name], length: element.length + 1 };
        next.push(child);
        elements.push(child);
        if (elements.length >= maxElements) break;
      }
      if (elements.length >= maxElements) break;
    }
    frontier = next;
  }
  return elements;
}

/** The orbit of p under the given elements (one image per element). */
export function orbit(elements: GroupElement[], p: Point): Point[] {
  return elements.map((e) => apply(e.g, p));
}

/**
 * Set of isometries with tolerant lookup: bucketed by the image of a probe point
 * on a spatial grid, then compared exactly (within tolerance) inside neighboring cells.
 */
export class ElementSet {
  private buckets = new Map<string, Isometry[]>();
  private readonly cell = 1e-6;

  constructor(private readonly probe: Point) {}

  add(g: Isometry): void {
    const [i, j] = this.cellOf(g);
    const key = `${i},${j}`;
    const bucket = this.buckets.get(key);
    if (bucket) bucket.push(g);
    else this.buckets.set(key, [g]);
  }

  has(g: Isometry): boolean {
    const [i, j] = this.cellOf(g);
    for (let di = -1; di <= 1; di++) {
      for (let dj = -1; dj <= 1; dj++) {
        const bucket = this.buckets.get(`${i + di},${j + dj}`);
        if (bucket?.some((h) => equals(g, h))) return true;
      }
    }
    return false;
  }

  private cellOf(g: Isometry): [number, number] {
    const p = apply(g, this.probe);
    return [Math.round(p.x / this.cell), Math.round(p.y / this.cell)];
  }
}
