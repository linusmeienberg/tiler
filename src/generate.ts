/**
 * Generation mode: choose a wallpaper group, load a motif, place it in the
 * fundamental domain D and see the plane tiled with its copies.
 *
 * State and drawing live here; main.ts routes input and owns the shared canvas,
 * view and image loading.
 */
import { renderCell, cellSize } from "./cell";
import { CLASS_COLORS, drawOrbifold, haloStroke, label } from "./draw";
import type { GroupLines } from "./bodies";
import type { OrbifoldDomain } from "./canonical";
import type { PatternSource } from "./orbifold3d";
import { DEFAULT_PARAMS, findGroup, GROUPS, realize, type LatticeParams, type Realization } from "./groups";
import { apply, inverse, type Isometry, type Point } from "./isometry";
import { buildTiling, copyAt, toFractional, visibleCopies, type DomainMode, type Tiling } from "./tiling";
import { toScreen, toWorld, type View } from "./view";

const STORAGE_KEY = "tiler.generate";
const MAX_MOTIF_SIDE = 2048;

interface Motif {
  x: number; // where the image center goes (world)
  y: number;
  scale: number;
  rotationDeg: number;
}

/** A group taken over from the analysis: fixed lattice and cosets. */
interface CustomGroup {
  realization: Realization;
  label: string; // e.g. "*442 (p4m)"
}

interface Settings {
  group: string;
  params: LatticeParams;
  custom: CustomGroup | null; // overrides group/params while set
  base: Point; // fractional coordinates of p
  motif: Motif | null; // null: fit into D when an image arrives
  showEdges: boolean;
  domainMode: DomainMode;
}

const DEFAULTS: Settings = {
  group: "*442",
  params: DEFAULT_PARAMS,
  custom: null,
  base: { x: 0.2137, y: 0.1312 },
  motif: null,
  showEdges: false,
  domainMode: "voronoi",
};

let settings: Settings = load();
let motifImage: HTMLCanvasElement | null = null; // pre-rasterized (SVGs are slow to redraw hundreds of times)
/** The motif's SVG source, if it is one: then the export is an SVG too. */
let motifSvg: { text: string; width: number; height: number } | null = null;
let cache: { key: string; tiling: Tiling | null } = { key: "", tiling: null };

type Drag = { type: "motif"; start: Point; startMotif: Motif; inv: { a: number; b: number; c: number; d: number } } | { type: "base" };
let drag: Drag | null = null;

function load(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    /* ignore */
  }
  return { ...DEFAULTS };
}

function save(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    /* ignore */
  }
}

function realization(): Realization {
  return settings.custom?.realization ?? realize(findGroup(settings.group), settings.params);
}

export function tiling(): Tiling | null {
  const key = JSON.stringify([settings.group, settings.params, settings.custom?.label ?? null, settings.base, settings.domainMode]);
  if (key !== cache.key) {
    const r = realization();
    let t = buildTiling(r, settings.base, settings.domainMode);
    // p on a symmetry element (e.g. after changing the group): fall back to the default.
    if (!t) t = buildTiling(r, DEFAULTS.base, settings.domainMode);
    cache = { key, tiling: t };
  }
  return cache.tiling;
}

// --- motif ---------------------------------------------------------------------------

export function setMotifImage(img: HTMLImageElement, svgText: string | null = null, fit = true): void {
  motifSvg = svgText ? { text: svgText, width: img.naturalWidth, height: img.naturalHeight } : null;
  const k = Math.min(1, MAX_MOTIF_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(img.naturalWidth * k));
  c.height = Math.max(1, Math.round(img.naturalHeight * k));
  c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
  motifImage = c;
  if (fit) fitMotif();
}

/**
 * Take over the analysis: its group (lattice + cosets), its p and its image,
 * placed exactly where it was – so the tiling starts out as the analysis'
 * reconstruction of the image from D.
 */
export function importFromAnalysis(r: Realization, label: string, base: Point, img: HTMLImageElement, svgText: string | null): void {
  settings.custom = { realization: r, label };
  settings.base = toFractional(r, base);
  setMotifImage(img, svgText, false);
  settings.motif = { x: img.naturalWidth / 2, y: img.naturalHeight / 2, scale: img.naturalWidth / motifImage!.width, rotationDeg: 0 };
  save();
}

export function hasMotif(): boolean {
  return motifImage !== null;
}

/**
 * Center the motif on D, large enough to cover D in any rotation (its shorter
 * side spans the circle around D) plus some margin, so dragging it a little does
 * not open gaps.
 */
export function fitMotif(): void {
  const t = tiling();
  if (!t || !motifImage) return;
  settings.motif = {
    x: t.centroid.x,
    y: t.centroid.y,
    scale: (2.4 * t.reach) / Math.min(motifImage.width, motifImage.height),
    rotationDeg: settings.motif?.rotationDeg ?? 0,
  };
  save();
}

// --- view --------------------------------------------------------------------------

/** About two lattice cells around D. */
export function fitView(width: number, height: number): View {
  const t = tiling();
  if (!t) return { scale: 1, ox: width / 2, oy: height / 2 };
  const { a1, a2 } = t.realization;
  const extent = 2.2 * (Math.hypot(a1.x, a1.y) + Math.hypot(a2.x, a2.y));
  const scale = Math.min(width, height) / extent;
  return { scale, ox: width / 2 - t.centroid.x * scale, oy: height / 2 - t.centroid.y * scale };
}

// --- input -------------------------------------------------------------------------

/** Returns false if the press should pan instead. */
export function pointerDown(view: View, s: Point): boolean {
  const t = tiling();
  if (!t) return false;
  const b = toScreen(view, t.base);
  if (Math.hypot(b.x - s.x, b.y - s.y) < 10) {
    drag = { type: "base" };
    return true;
  }
  if (!settings.motif || !motifImage) return false;
  // Drag in any copy g(D): the motif under the cursor follows it, so the
  // world motion is mapped back through g's linear part.
  const g = inverse(copyAt(t, toWorld(view, s)));
  drag = { type: "motif", start: toWorld(view, s), startMotif: { ...settings.motif }, inv: { a: g.a, b: g.b, c: g.c, d: g.d } };
  return true;
}

export function pointerMove(view: View, s: Point): void {
  const w = toWorld(view, s);
  if (drag?.type === "motif") {
    const dx = w.x - drag.start.x;
    const dy = w.y - drag.start.y;
    const { a, b, c, d } = drag.inv;
    settings.motif = { ...drag.startMotif, x: drag.startMotif.x + a * dx + b * dy, y: drag.startMotif.y + c * dx + d * dy };
  } else if (drag?.type === "base") {
    const t = tiling();
    if (!t) return;
    const frac = toFractional(t.realization, w);
    // Keep p only where it gives a proper domain (not on a mirror or center).
    if (buildTiling(realization(), frac)) settings.base = frac;
  }
}

export function pointerUp(): void {
  if (drag) save();
  drag = null;
}

export function isDragging(): boolean {
  return drag !== null;
}

// --- drawing -----------------------------------------------------------------------

/** `decorations`: D's outline, p, copy borders and drag preview (off for export). */
export function draw(ctx: CanvasRenderingContext2D, view: View, width: number, height: number, dpr: number, decorations = true): void {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (decorations) {
    ctx.fillStyle = "#e7e5e4";
    ctx.fillRect(0, 0, width, height);
  } else {
    ctx.clearRect(0, 0, width, height);
  }
  const t = tiling();
  if (!t) return;

  const tl = toWorld(view, { x: 0, y: 0 });
  const br = toWorld(view, { x: width, y: height });
  const copies = visibleCopies(t, { x0: tl.x, y0: tl.y, x1: br.x, y1: br.y });
  if (!copies) {
    ctx.fillStyle = "#78716c";
    ctx.font = "15px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Zu weit herausgezoomt – hineinzoomen oder »Einpassen«", width / 2, height / 2);
    ctx.textAlign = "start";
    return;
  }

  const world = () => ctx.setTransform(dpr * view.scale, 0, 0, dpr * view.scale, dpr * view.ox, dpr * view.oy);
  const domainPath = (grow = 0) => {
    ctx.beginPath();
    t.domain.forEach((v, k) => {
      const dx = v.x - t.centroid.x;
      const dy = v.y - t.centroid.y;
      const len = Math.hypot(dx, dy) || 1;
      const x = v.x + (dx / len) * grow;
      const y = v.y + (dy / len) * grow;
      if (k === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
  };
  const motifTransform = (m: Motif) => {
    ctx.translate(m.x, m.y);
    ctx.rotate((m.rotationDeg * Math.PI) / 180);
    ctx.scale(m.scale, m.scale);
  };
  const motif = motifImage && settings.motif;

  // Copies: D's content mapped by g, clipped to g(D) (grown by half a screen pixel against seams).
  const grow = 0.5 / view.scale;
  ctx.save();
  ctx.imageSmoothingQuality = "high";
  copies.forEach((g) => {
    ctx.save();
    world();
    ctx.transform(g.a, g.c, g.b, g.d, g.tx, g.ty);
    domainPath(grow);
    if (motif) {
      ctx.clip();
      motifTransform(motif);
      ctx.drawImage(motifImage!, -motifImage!.width / 2, -motifImage!.height / 2);
    } else {
      // No motif yet: color the copies by coset (orientation-reversing ones lighter).
      const k = t.realization.cosets.findIndex((c) => Math.abs(c.a - g.a) + Math.abs(c.b - g.b) + Math.abs(c.c - g.c) + Math.abs(c.d - g.d) < 1e-9);
      ctx.fillStyle = CLASS_COLORS[Math.max(0, k) % CLASS_COLORS.length];
      ctx.globalAlpha = g.a * g.d - g.b * g.c > 0 ? 0.45 : 0.22;
      ctx.fill();
    }
    ctx.restore();
  });
  ctx.restore();
  if (!decorations) return;

  // While dragging the motif: show all of it faintly, also outside D.
  if (motif && drag?.type === "motif") {
    ctx.save();
    world();
    motifTransform(motif);
    ctx.globalAlpha = 0.35;
    ctx.drawImage(motifImage!, -motifImage!.width / 2, -motifImage!.height / 2);
    ctx.restore();
  }

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const screenPolygon = (g: { a: number; b: number; c: number; d: number; tx: number; ty: number }) => {
    ctx.beginPath();
    t.domain.forEach((v, k) => {
      const s = toScreen(view, apply(g, v));
      if (k === 0) ctx.moveTo(s.x, s.y);
      else ctx.lineTo(s.x, s.y);
    });
    ctx.closePath();
  };
  if (settings.showEdges || !motif) {
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.8)";
    ctx.lineWidth = 1;
    for (const g of copies) {
      screenPolygon(g);
      ctx.stroke();
    }
    ctx.restore();
  }
  if (t.orbifold) drawOrbifold(ctx, (w) => toScreen(view, w), t.orbifold);
  else haloStroke(ctx, () => screenPolygon({ a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 }), "#111", 2.5);

  const b = toScreen(view, t.base);
  ctx.beginPath();
  ctx.arc(b.x, b.y, 5, 0, 2 * Math.PI);
  ctx.fillStyle = "#111";
  ctx.fill();
  ctx.strokeStyle = "white";
  ctx.lineWidth = 2;
  ctx.stroke();
  label(ctx, "p", b, "#111");
}

// --- side panel ------------------------------------------------------------------------

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

/** Wire the panel controls; `changed` re-renders. */
export function setupPanel(changed: () => void): void {
  const select = $<HTMLSelectElement>("#gen-group");
  const fromAnalysis = document.createElement("option");
  fromAnalysis.value = "";
  fromAnalysis.textContent = "aus der Analyse";
  fromAnalysis.disabled = true;
  select.replaceChildren(
    fromAnalysis,
    ...GROUPS.map((g) => {
      const o = document.createElement("option");
      o.value = g.conway;
      o.textContent = `${g.conway}  (${g.iuc})`;
      return o;
    }),
  );
  select.addEventListener("change", () => {
    settings.group = select.value;
    settings.custom = null;
    fitMotif(); // the new D is elsewhere and shaped differently
    save();
    changed();
  });

  const slider = (id: string, read: () => number, write: (x: number) => void) => {
    const el = $<HTMLInputElement>(id);
    el.addEventListener("input", () => {
      write(Number(el.value));
      changed();
    });
    el.addEventListener("change", save);
    return () => (el.value = String(read()));
  };
  const sync = [
    slider("#gen-size", () => settings.params.size, (x) => {
      // The lattice grows from the origin; the motif grows along with it.
      const k = x / settings.params.size;
      settings.params = { ...settings.params, size: x };
      if (settings.motif) settings.motif = { ...settings.motif, x: settings.motif.x * k, y: settings.motif.y * k, scale: settings.motif.scale * k };
    }),
    slider("#gen-ratio", () => settings.params.ratio, (x) => (settings.params = { ...settings.params, ratio: x })),
    slider("#gen-angle", () => settings.params.angleDeg, (x) => (settings.params = { ...settings.params, angleDeg: x })),
    slider(
      "#gen-scale",
      () => Math.log2(settings.motif?.scale ?? 1),
      (x) => settings.motif && (settings.motif = { ...settings.motif, scale: 2 ** x }),
    ),
    slider(
      "#gen-rotation",
      () => settings.motif?.rotationDeg ?? 0,
      (x) => settings.motif && (settings.motif = { ...settings.motif, rotationDeg: x }),
    ),
  ];
  syncSliders = () => sync.forEach((f) => f());

  for (const btn of document.querySelectorAll<HTMLButtonElement>("#gen-domain-mode button")) {
    btn.addEventListener("click", () => {
      settings.domainMode = btn.dataset.domain as DomainMode;
      save();
      changed();
    });
  }

  $("#gen-fit-motif").addEventListener("click", () => {
    fitMotif();
    changed();
  });
  const edges = $<HTMLInputElement>("#gen-edges");
  edges.checked = settings.showEdges;
  edges.addEventListener("change", () => {
    settings.showEdges = edges.checked;
    save();
    changed();
  });
}

let syncSliders = () => {};

export function renderPanel(): void {
  const t = tiling();
  const group = findGroup(settings.group);
  const custom = settings.custom;
  const select = $<HTMLSelectElement>("#gen-group");
  select.value = custom ? "" : group.conway;
  $("#gen-custom").hidden = !custom;
  $("#gen-custom").textContent = custom
    ? `Aus der Analyse übernommen: ${custom.label}, Gitter und Lage wie eingezeichnet. Eine Gruppe wählen, um frei weiterzumachen.`
    : "";
  $("#gen-row-size").hidden = !!custom;
  $("#gen-row-ratio").hidden = !!custom || !["oblique", "rect", "centered"].includes(group.lattice);
  $("#gen-row-angle").hidden = !!custom || group.lattice !== "oblique";
  $("#export").textContent = motifSvg ? "Ausschnitt als SVG speichern" : "Ausschnitt als PNG speichern";
  syncSliders();
  $("#gen-size-value").textContent = `${Math.round(settings.params.size)} px`;
  $("#gen-ratio-value").textContent = settings.params.ratio.toFixed(2);
  $("#gen-angle-value").textContent = `${Math.round(settings.params.angleDeg)}°`;
  $("#gen-scale-value").textContent = settings.motif ? `${(settings.motif.scale * 100).toFixed(0)} %` : "";
  $("#gen-rotation-value").textContent = settings.motif ? `${Math.round(settings.motif.rotationDeg)}°` : "";
  for (const btn of document.querySelectorAll<HTMLButtonElement>("#gen-domain-mode button")) {
    btn.classList.toggle("active", btn.dataset.domain === settings.domainMode);
  }
  $("#gen-domain-legend").hidden = settings.domainMode !== "orbifold";
  $("#gen-domain-error").textContent = t?.orbifoldError ? `${t.orbifoldError} Gezeigt wird der Voronoi-Bereich.` : "";
  $("#gen-motif").hidden = !motifImage;
  $("#export").hidden = !motifImage;
  $("#gen-no-motif").hidden = !!motifImage;
  if (t && custom) {
    $("#gen-info").textContent = `D hat ${t.domain.length} Ecken · ${t.realization.cosets.length} Kopien von D pro primitiver Zelle`;
  } else if (t) {
    const lattice = { oblique: "schiefwinklig", rect: "rechtwinklig", centered: "rechtwinklig zentriert", square: "quadratisch", hex: "hexagonal" }[group.lattice];
    const perCell = t.realization.cosets.length / (group.lattice === "centered" ? 2 : 1);
    $("#gen-info").textContent = `Gitter ${lattice} · D hat ${t.domain.length} Ecken · ${perCell} Kopien von D pro primitiver Zelle`;
  }
}

export const STATUS =
  "Ziehen verschiebt das Motiv (in jeder Kopie) · p ziehen ändert die Form von D · Leertaste/rechte Maustaste + Ziehen verschiebt die Ansicht · Scrollen verschiebt, ⌘+Scrollen zoomt";

// --- export --------------------------------------------------------------------------

export interface Export {
  blob: Blob;
  filename: string;
}

/** The visible part of the tiling: SVG if the motif is an SVG, else PNG (at twice the screen resolution). */
export async function exportView(view: View, width: number, height: number): Promise<Export | null> {
  const t = tiling();
  if (!t || !motifImage || !settings.motif) return null;
  // Crystallographic name (p4m), as the Conway symbol has * in it.
  const iuc = settings.custom ? (/\((\w+)\)/.exec(settings.custom.label)?.[1] ?? "gruppe") : findGroup(settings.group).iuc;
  const name = `tiler-${iuc}`;
  if (motifSvg) {
    const svg = tilingSvg(t, view, width, height);
    return svg ? { blob: new Blob([svg], { type: "image/svg+xml" }), filename: `${name}.svg` } : null;
  }
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * 2);
  canvas.height = Math.round(height * 2);
  draw(canvas.getContext("2d")!, view, width, height, 2, false);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  return blob ? { blob, filename: `${name}.png` } : null;
}

const num = (x: number) => String(Math.round(x * 1e4) / 1e4);

/**
 * Vector output: the motif's SVG once in <defs>, and per copy a <use> under the
 * copy's transform, clipped to D. Stays vector and small.
 */
export function tilingSvg(t: Tiling, view: View, width: number, height: number): string | null {
  const m = settings.motif;
  if (!m || !motifSvg || !motifImage) return null;
  const tl = toWorld(view, { x: 0, y: 0 });
  const br = toWorld(view, { x: width, y: height });
  const copies = visibleCopies(t, { x0: tl.x, y0: tl.y, x1: br.x, y1: br.y }, 20000);
  if (!copies) return null;

  const doc = new DOMParser().parseFromString(motifSvg.text, "image/svg+xml");
  const root = doc.documentElement;
  if (root.nodeName !== "svg") return null;
  root.setAttribute("width", String(motifSvg.width));
  root.setAttribute("height", String(motifSvg.height));
  root.removeAttribute("x");
  root.removeAttribute("y");
  const inner = new XMLSerializer().serializeToString(root);

  // World units per SVG unit: the canvas draws the rasterized motif (motifImage) at m.scale.
  const k = (m.scale * motifImage.width) / motifSvg.width;
  const motifTransform =
    `translate(${num(m.x)} ${num(m.y)}) rotate(${num(m.rotationDeg)}) ` +
    `scale(${num(k)}) translate(${num(-motifSvg.width / 2)} ${num(-motifSvg.height / 2)})`;
  // D grown by half an output pixel against hairline seams (neighbours agree there anyway).
  const grow = 0.5 / view.scale;
  const d =
    t.domain
      .map((v, i) => {
        const dx = v.x - t.centroid.x;
        const dy = v.y - t.centroid.y;
        const len = Math.hypot(dx, dy) || 1;
        return `${i === 0 ? "M" : "L"}${num(v.x + (dx / len) * grow)} ${num(v.y + (dy / len) * grow)}`;
      })
      .join(" ") + " Z";
  const matrix = (g: Isometry) => `matrix(${[g.a, g.c, g.b, g.d, g.tx, g.ty].map(num).join(" ")})`;
  const uses = copies.map((g) => `<use href="#tiler-motif" xlink:href="#tiler-motif" transform="${matrix(g)}" clip-path="url(#tiler-D)"/>`);
  // clip-path on a transformed <use>: the clip is in the use's own user space,
  // i.e. before its transform – so D is given in source coordinates.

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ` +
      `width="${Math.round(width)}" height="${Math.round(height)}" ` +
      `viewBox="${num(tl.x)} ${num(tl.y)} ${num(br.x - tl.x)} ${num(br.y - tl.y)}">`,
    `<defs>`,
    `<clipPath id="tiler-D" clipPathUnits="userSpaceOnUse"><path d="${d}"/></clipPath>`,
    `<g id="tiler-motif" transform="${motifTransform}">${inner}</g>`,
    `</defs>`,
    ...uses,
    `</svg>`,
  ].join("\n");
}

// --- for the orbifold view ------------------------------------------------------------

let canonicalCache: { key: string; domain: OrbifoldDomain | null; lines: GroupLines | null } = { key: "", domain: null, lines: null };

/** One lattice cell of the current tiling, for the 3D view (null without motif). */
export function patternSource(): PatternSource | null {
  const t = tiling();
  const m = settings.motif;
  const img = motifImage;
  if (!t || !m || !img) return null;
  const { t1, t2 } = t.translations;
  const label = settings.custom?.label ?? `${findGroup(settings.group).conway} (${findGroup(settings.group).iuc})`;
  const key = JSON.stringify([cache.key, m, img.width, img.height, settings.domainMode]);
  if (canonicalCache.key !== cache.key) {
    const ct = buildTiling(realization(), settings.base, "orbifold");
    const inv = ct?.inventory;
    canonicalCache = {
      key: cache.key,
      domain: ct?.orbifold ?? null,
      lines: inv ? { mirrors: inv.mirrors, glides: inv.glides, centers: inv.centers, t1, t2, reference: { x: 0, y: 0 } } : null,
    };
  }
  return {
    key,
    label,
    symbol: label.split(" ")[0],
    t1,
    t2,
    orbifold: canonicalCache.domain,
    lines: canonicalCache.lines,
    render(a, b, at, marks, inset) {
      const origin = at ?? { x: t.base.x - (a.x + b.x) / 2, y: t.base.y - (a.y + b.y) / 2 };
      const xs = [0, 1].flatMap((u) => [0, 1].map((v) => origin.x + u * a.x + v * b.x));
      const ys = [0, 1].flatMap((u) => [0, 1].map((v) => origin.y + u * a.y + v * b.y));
      const pad = Math.hypot(t1.x, t1.y) + Math.hypot(t2.x, t2.y); // the canonical D may reach further than the tiling's
      const copies = visibleCopies(t, { x0: Math.min(...xs) - pad, y0: Math.min(...ys) - pad, x1: Math.max(...xs) + pad, y1: Math.max(...ys) + pad }, 40000) ?? [];
      const orbifold = canonicalCache.domain;
      return renderCell({
        a,
        b,
        origin,
        ...cellSize(a, b),
        domain: t.domain,
        copies,
        paint: (ctx) => {
          ctx.translate(m.x, m.y);
          ctx.rotate((m.rotationDeg * Math.PI) / 180);
          ctx.scale(m.scale, m.scale);
          ctx.drawImage(img, -img.width / 2, -img.height / 2);
        },
        marks: marks && orbifold ? { domain: orbifold, copies, inset } : undefined,
      });
    },
  };
}
