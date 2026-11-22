/**
 * Conway orbifold notation and the "price check" (Gauss–Bonnet / Conway's
 * Magic Theorem): a valid wallpaper signature costs exactly 2.
 *
 *   o                 2
 *   rotation n        (n−1)/n       (digits before the first *)
 *   *                 1
 *   mirror corner n   (n−1)/(2n)    (digits after a *)
 *   x                 1
 */

export interface PriceItem {
  feature: string;
  cost: number;
}

export function priceBreakdown(symbol: string): PriceItem[] {
  const items: PriceItem[] = [];
  let afterStar = false;
  for (const ch of symbol.replace(/\s+/g, "")) {
    if (ch === "o") {
      items.push({ feature: "o", cost: 2 });
    } else if (ch === "*") {
      afterStar = true;
      items.push({ feature: "*", cost: 1 });
    } else if (ch === "x" || ch === "×") {
      items.push({ feature: "x", cost: 1 });
    } else if (/[1-9]/.test(ch)) {
      const n = Number(ch);
      items.push(
        afterStar
          ? { feature: `*${n}`, cost: (n - 1) / (2 * n) }
          : { feature: `${n}`, cost: (n - 1) / n },
      );
    } else {
      throw new Error(`Unexpected character ${JSON.stringify(ch)} in orbifold symbol ${JSON.stringify(symbol)}`);
    }
  }
  return items;
}

export function price(symbol: string): number {
  return priceBreakdown(symbol).reduce((sum, item) => sum + item.cost, 0);
}

export function passesPriceCheck(symbol: string): boolean {
  return Math.abs(price(symbol) - 2) < 1e-9;
}

/** The 17 wallpaper groups: Conway symbol → crystallographic (IUC) name. */
export const WALLPAPER_GROUPS: Record<string, string> = {
  o: "p1",
  "2222": "p2",
  "**": "pm",
  xx: "pg",
  "*x": "cm",
  "*2222": "pmm",
  "22*": "pmg",
  "22x": "pgg",
  "2*22": "cmm",
  "442": "p4",
  "*442": "p4m",
  "4*2": "p4g",
  "333": "p3",
  "*333": "p3m1",
  "3*3": "p31m",
  "632": "p6",
  "*632": "p6m",
};
