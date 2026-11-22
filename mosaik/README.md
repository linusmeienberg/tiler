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

Schritt 2 – Oberfläche (`npm run dev`, dann http://localhost:5173):

- Bild laden (Knopf oder hineinziehen), »Beispiel« lädt ein \*442-Testmuster.
- Werkzeuge: Auswahl (V), Gitter (T), Drehzentrum (D, Ordnung mit 2/3/4/6),
  Spiegelachse (S), Gleitachse (G; Länge = Gleitvektor).
- Einrasten an Gitterpunkte, Kantenmitten, Zellmitten und vorhandene Punkte;
  beim Zeichnen von a₂ zusätzlich an a₁ gedreht um ±60°/90°/120°. Alt schaltet
  das Einrasten aus.
- Griffe ziehen, Entf löscht, ⌘Z macht rückgängig. Die Elemente werden im
  Browser gespeichert (localStorage), das Bild nicht.
- `src/scene.ts` – Datenmodell der eingezeichneten Elemente, Einrasten,
  Trefferprüfung, Umwandlung in Erzeuger. `src/draw.ts` – Zeichnen.
  `src/main.ts` – Bedienung. `src/view.ts` – Verschieben/Zoomen.

Schritt 3 – Aufbau aus dem Fundamentalbereich:

- Werkzeug Startpunkt (P) setzt p (klicken oder ziehen, live).
- `src/construction.ts` – Gruppenelemente um p, Bahn, Dirichlet-Bereich
  (Halbebenen-Schnitt, nur nahe Bahnpunkte), primitive Translationen aus der
  Gruppe, »Bereiche pro Zelle« als Probe. Warnungen: Gruppe nicht diskret
  (Elemente passen nicht zusammen), zu wenige Translationen, p auf einem
  Symmetrieelement, Bereich lang und schmal.
- Schieberegler Wortlänge (bzw. [ ]) und ▶ zum schrittweisen Aufbau; Kopien
  nach Wortlänge eingefärbt. Unter dem Zeiger: die Kopie g(D) und das Wort für g
  (gefunden als nächster Bahnpunkt – das ist genau die Dirichlet-Eigenschaft).

## Entwicklung

```bash
npm install
npm run dev       # Entwicklungsserver
npm test          # vitest
npm run build     # statische Dateien nach dist/
npm run typecheck
```
