# mosaik

Browser-Tool (TypeScript + Canvas): Foto eines periodischen Mosaiks laden,
Symmetrieelemente einzeichnen und sehen, wie die Ebene aus einem
Fundamentalbereich durch die Symmetriegruppe aufgebaut wird.

## Stand

Schritt 1 – Gruppenkern:

- `src/isometry.ts` – Isometrien als affine Abbildungen (Komposition, Inverse,
  Gleichheit mit Toleranz); Konstruktoren für Translation, Drehung, Spiegelung,
  Gleitspiegelung; Klassifikation, Drehordnung, Drehzentrum.
- `src/group.ts` – Erzeugung der Gruppe per Breitensuche über Wörter in den
  Erzeugern (inkl. Inversen), mit kürzestem Wort und Wortlänge pro Element.
  Abbruch, sobald ein Element den Mittelpunkt weiter als `radius` verschiebt.
- `src/orbifold.ts` – Preisprobe für Conway-Symbole; die 17 Ornamentgruppen.

## Entwicklung

```bash
npm install
npm test          # vitest
npm run typecheck
```
