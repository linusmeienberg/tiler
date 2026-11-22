# mosaik

Ein Browser-Werkzeug für Symmetrien ebener Ornamente, mit zwei Arbeitsmodi:

- **Analyse:** das Foto eines periodischen Mosaiks laden und Symmetrieelemente
  einzeichnen. Das Werkzeug prüft, ob sie zusammenpassen, bestimmt die
  Symmetriegruppe in Conway-Notation und baut das Bild aus dem
  Fundamentalbereich wieder auf, um es mit dem Original zu vergleichen.
- **Generierung:** eine der 17 Ornamentgruppen wählen, ein Bild als Motiv in den
  Fundamentalbereich legen und die Ebene damit pflastern. Das Ergebnis lässt
  sich als SVG oder PNG exportieren.

![Analyse: drei Spiegelachsen erzeugen *442 (p4m)](docs/analyse.jpg)

![Generierung: Motiv unter der Gruppe 632 (p6)](docs/generierung.jpg)

Es läuft komplett im Browser: kein Server, keine Daten verlassen den Rechner.

## Schnellstart

Gebraucht wird [Node.js](https://nodejs.org) (Version in `.nvmrc`).

```bash
npm install
npm run dev       # http://localhost:5173
```

## Analyse

1. **Bild laden** (Knopf oder hineinziehen). »Beispiel« lädt ein \*442-Testmuster.
2. **Symmetrieelemente einzeichnen:**

   | Werkzeug | Taste |
   |---|---|
   | Gitter | T |
   | Drehzentrum (Ordnung mit 2/3/4/6) | D |
   | Spiegelachse | S |
   | Gleitachse (die Länge ist der Gleitvektor) | G |

   Punkte rasten an Gitterpunkte und vorhandene Elemente ein, Achsen an
   15°-Richtungen. Alt schaltet das Einrasten ab.
3. **Verträglichkeit:** Passen die Elemente nicht zusammen (z. B. ein
   quadratisches Gitter mit einem 3-zähligen Zentrum), erscheint sofort eine
   Warnung.
4. **Inventur:** Conway-Symbol und internationaler Name, dazu die Preisprobe
   (Summe der Kosten = 2) und eine unabhängige Flächenprobe. Auf Wunsch zeigt die
   Ansicht alle Spiegel, Gleitachsen und Drehzentren der Gruppe, die Zentren nach
   Bahnklasse eingefärbt.
5. **Startpunkt p** (Taste P):
   - zeigt den Fundamentalbereich D (Dirichlet-Bereich von p) und seine Kopien;
   - der Regler baut die Kopien schrittweise nach Wortlänge in den Erzeugern auf;
   - unter dem Zeiger steht das Gruppenelement, das D in diese Kopie abbildet.
6. **Prüfung am Bild:**
   - »Aus D« setzt das Bild nur aus dem Inhalt von D zusammen.
   - »Differenz« zeigt, wo das vom Original abweicht.
   - Als Vergleichsmaßstab dient das Bild, gegen sich selbst verschoben.
7. **In Generierung übernehmen:** Die erkannte Gruppe, p und das Bild wandern in
   den Generierungsmodus.

## Generierung

- **Gruppe wählen.** Je nach Gittertyp stellt man Zellgröße, Seitenverhältnis
  und Winkel ein.
- **Motiv:** »Bild laden« oder »Beispiel«.
  - Ziehen verschiebt das Motiv. Auch in gespiegelten oder gedrehten Kopien
    folgt es dem Zeiger.
  - Größe und Drehung stellt man mit Reglern ein.
- **Form von D:** Den Punkt p ziehen ändert sie.
- **Export des sichtbaren Ausschnitts:**
  - Ist das Motiv ein SVG, entsteht ein SVG. Das Motiv steht darin einmal in
    `<defs>`, jede Kopie ist ein `<use>` mit Transformation und Clip auf D.
  - Sonst entsteht ein PNG in doppelter Auflösung.

Verschieben: Leertaste oder rechte Maustaste und ziehen, oder scrollen.
Zoomen: ⌘/Strg und scrollen. »Einpassen«: Taste F.

## Wie es funktioniert

- **Isometrien** sind affine Abbildungen p ↦ M·p + t (`src/isometry.ts`).
- **Gruppe aus Erzeugern** (`src/group.ts`):
  - Breitensuche über Wörter in den Erzeugern und ihren Inversen, mit Wortlänge.
  - Doppelte Elemente werden über einen räumlichen Hash erkannt.
  - Die Suche endet, wenn ein Element das Zentrum weiter als einen Radius
    verschiebt.
- **Fundamentalbereich** (`src/construction.ts`):
  - Er ist die Voronoi-Zelle von p in seiner Bahn, berechnet durch
    Halbebenen-Schnitt.
  - Die Kopie unter einem Punkt ist die mit dem nächsten Bahnpunkt.
- **Inventur** (`src/inventory.ts`):
  - Drehzentren werden per Union-Find in Bahnklassen zusammengefasst. Gehen
    Spiegel durch ein Zentrum, ist es eine Spiegelecke, sonst eine Kegelspitze.
  - Spiegel ergeben einen Rand, wenn sie sich schneiden, sonst einen pro Klasse
    paralleler Spiegel.
  - Ein x gibt es, wenn eine Gleitspiegelung die spiegelfreie Kammer von p auf
    sich abbildet. Wie viele es sind, folgt aus der Preisprobe.
- **Die 17 Gruppen** (`src/groups.ts`):
  - Jede ist als Gittertyp plus Nebenklassenvertreter in Gitterkoordinaten
    abgelegt.
  - Für die Generierung werden die Kopien als Gittertranslation ∘ Nebenklasse
    aufgezählt (`src/tiling.ts`).
  - Aus einer Analyse gewinnt `realizationFromConstruction` Gitter und
    Nebenklassen zurück.

## Entwicklung

```bash
npm test          # Vitest
npm run typecheck
npm run build     # statische Dateien nach dist/ (relative Pfade, z. B. für GitHub Pages)
npm run preview   # den Build lokal ansehen
```

| Datei | Inhalt |
|---|---|
| `src/isometry.ts`, `src/group.ts` | Isometrien, Gruppenerzeugung |
| `src/construction.ts` | Bahn, Dirichlet-Bereich, Warnungen |
| `src/inventory.ts`, `src/orbifold.ts` | Conway-Notation, Preisprobe |
| `src/overlay.ts` | Prüfung am Bild |
| `src/groups.ts`, `src/tiling.ts` | die 17 Gruppen, Pflasterung für die Generierung |
| `src/scene.ts`, `src/view.ts` | eingezeichnete Elemente, Einrasten; Verschieben und Zoomen |
| `src/draw.ts`, `src/main.ts` | Zeichnen und Bedienung (Analyse) |
| `src/generate.ts` | Zustand, Zeichnen, Export (Generierung) |
| `tests/` | u. a. alle 17 Gruppen: Erkennung, lückenlose Pflasterung, Rückgewinnung aus der Analyse |

Die Tests von Gruppenkern, Inventur und Pflasterung laufen ohne Browser. Die
Bedienoberfläche ist von Hand und mit Playwright geprüft.

## Herkunft

Das Projekt begann als Python-Paket `tiler`, ein Jupyter-Widget zum Pflastern
mit einer vorgegebenen Gruppe. Diese Version ist abgelöst und nur noch in der
Git-Historie zu finden. Ihre Gruppentabelle lebt in `src/groups.ts` weiter, mit
einer Korrektur: dort waren p3m1 und p31m vertauscht.

## Lizenz

MIT, siehe [LICENSE](LICENSE).
