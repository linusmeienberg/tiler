/**
 * Generation mode: choose a wallpaper group, load a motif, place it in the
 * fundamental domain D and see the plane tiled with its copies.
 *
 * State and drawing live here; main.ts routes input and owns the shared canvas,
 * view and image loading.
 */
import { CLASS_COLORS, haloStroke, label } from "./draw";
import { DEFAULT_PARAMS, findGroup, GROUPS, type LatticeParams } from "./groups";
import { apply, inverse, type Point } from "./isometry";
import { buildTiling, copyAt, toFractional, visibleCopies, type Tiling } from "./tiling";
import { toScreen, toWorld, type View } from "./view";

const STORAGE_KEY = "mosaik.generate";
const MAX_MOTIF_SIDE = 2048;

interface Motif {
  x: number; // where the image center goes (world)
  y: number;
  scale: number;
  rotationDeg: number;
}

interface Settings {
  group: string;
  params: LatticeParams;
  base: Point; // fractional coordinates of p
  motif: Motif | null; // null: fit into D when an image arrives
  showEdges: boolean;
}

const DEFAULTS: Settings = {
  group: "*442",
  params: DEFAULT_PARAMS,
  base: { x: 0.2137, y: 0.1312 },
  motif: null,
  showEdges: false,
};

let settings: Settings = load();
let motifImage: HTMLCanvasElement | null = null; // pre-rasterized (SVGs are slow to redraw hundreds of times)
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

export function tiling(): Tiling | null {
  const key = JSON.stringify([settings.group, settings.params, settings.base]);
  if (key !== cache.key) {
    let t = buildTiling(settings.group, settings.params, settings.base);
    // p on a symmetry element (e.g. after changing the group): fall back to the default.
    if (!t) t = buildTiling(settings.group, settings.params, DEFAULTS.base);
    cache = { key, tiling: t };
  }
  return cache.tiling;
}

// --- motif ---------------------------------------------------------------------------

export function setMotifImage(img: HTMLImageElement): void {
  const k = Math.min(1, MAX_MOTIF_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(img.naturalWidth * k));
  c.height = Math.max(1, Math.round(img.naturalHeight * k));
  c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
  motifImage = c;
  fitMotif();
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
    if (buildTiling(settings.group, settings.params, frac)) settings.base = frac;
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

export function draw(ctx: CanvasRenderingContext2D, view: View, width: number, height: number, dpr: number): void {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = "#e7e5e4";
  ctx.fillRect(0, 0, width, height);
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
  haloStroke(ctx, () => screenPolygon({ a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 }), "#111", 2.5);

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
  select.replaceChildren(
    ...GROUPS.map((g) => {
      const o = document.createElement("option");
      o.value = g.conway;
      o.textContent = `${g.conway}  (${g.iuc})`;
      return o;
    }),
  );
  select.addEventListener("change", () => {
    settings.group = select.value;
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
  $<HTMLSelectElement>("#gen-group").value = group.conway;
  $("#gen-row-ratio").hidden = !["oblique", "rect", "centered"].includes(group.lattice);
  $("#gen-row-angle").hidden = group.lattice !== "oblique";
  syncSliders();
  $("#gen-size-value").textContent = `${Math.round(settings.params.size)} px`;
  $("#gen-ratio-value").textContent = settings.params.ratio.toFixed(2);
  $("#gen-angle-value").textContent = `${Math.round(settings.params.angleDeg)}°`;
  $("#gen-scale-value").textContent = settings.motif ? `${(settings.motif.scale * 100).toFixed(0)} %` : "";
  $("#gen-rotation-value").textContent = settings.motif ? `${Math.round(settings.motif.rotationDeg)}°` : "";
  $("#gen-motif").hidden = !motifImage;
  $("#gen-no-motif").hidden = !!motifImage;
  if (t) {
    const lattice = { oblique: "schiefwinklig", rect: "rechtwinklig", centered: "rechtwinklig zentriert", square: "quadratisch", hex: "hexagonal" }[group.lattice];
    const perCell = t.realization.cosets.length / (group.lattice === "centered" ? 2 : 1);
    $("#gen-info").textContent = `Gitter ${lattice} · D hat ${t.domain.length} Ecken · ${perCell} Kopien von D pro primitiver Zelle`;
  }
}

export const STATUS =
  "Ziehen verschiebt das Motiv (in jeder Kopie) · p ziehen ändert die Form von D · Leertaste/rechte Maustaste + Ziehen verschiebt die Ansicht · Scrollen verschiebt, ⌘+Scrollen zoomt";
