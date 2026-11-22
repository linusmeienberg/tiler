/** UI wiring: tools, pointer/keyboard input, image loading, element list. */
import "./style.css";
import { construct, nearestOrbitIndex, type Construction } from "./construction";
import { CLASS_COLORS, COLORS, draw, type CoverState, type ImageMode, type Preview } from "./draw";
import { inventory, type Inventory } from "./inventory";
import type { Point } from "./isometry";
import { overlayCheck, type OverlayResult } from "./overlay";
import { realizationFromConstruction } from "./tiling";
import {
  addElement,
  describe,
  dist,
  emptyScene,
  findLattice,
  hitElement,
  hitHandle,
  labels,
  latticeBasis,
  removeElement,
  ROTATION_ORDERS,
  snap,
  toGenerators,
  type HandleRef,
  type RotationOrder,
  type Scene,
} from "./scene";
import { fitRect, toWorld, zoomAt, type View } from "./view";
import * as gen from "./generate";

type Mode = "analyse" | "generate";
const MODE_KEY = "mosaik.mode";

type Tool = "select" | "lattice" | "rotation" | "mirror" | "glide" | "base";

const TOOLS: { tool: Tool; key: string; label: string }[] = [
  { tool: "select", key: "V", label: "Auswahl" },
  { tool: "lattice", key: "T", label: "Gitter" },
  { tool: "rotation", key: "D", label: "Drehzentrum" },
  { tool: "mirror", key: "S", label: "Spiegelachse" },
  { tool: "glide", key: "G", label: "Gleitachse" },
  { tool: "base", key: "P", label: "Startpunkt" },
];

const SNAP_PX = 12;
const HIT_PX = 8;
const STORAGE_KEY = "mosaik.scene";

// --- DOM ------------------------------------------------------------------------

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const stage = $<HTMLDivElement>("#stage");
const canvas = $<HTMLCanvasElement>("#canvas");
const ctx = canvas.getContext("2d")!;
const status = $<HTMLElement>("#status");
const list = $<HTMLUListElement>("#elements");

// --- state ----------------------------------------------------------------------

let scene: Scene = loadScene();
const history: string[] = [];
let tool: Tool = "select";
let order: RotationOrder = 4;
let selectedId: number | null = null;
let image: HTMLImageElement | null = null;
let imageSvg: string | null = null; // SVG source of the analysis image, if it is one
let mode: Mode = loadMode();
let view: View = { scale: 1, ox: 0, oy: 0 };
const views: Record<Mode, View | null> = { analyse: null, generate: null };
let size = { width: 0, height: 0, dpr: 1 };
let pointer: Point | null = null; // screen coordinates
let spaceDown = false;
let altDown = false;

// Construction display: copies/orbit up to word length `lengthLimit`.
let lengthLimit = 0;
let followMax = true; // keep lengthLimit at the maximum when the construction changes
let showCopies = true;
let showOrbit = true;
let showDerived = true;
let playTimer: number | null = null;
let imageMode: ImageMode = "original";

type Drag =
  | { type: "pan"; start: Point; startView: View }
  | { type: "handle"; ref: HandleRef; last: Point }
  | { type: "create"; kind: Preview["kind"]; from: Point; to: Point }
  | { type: "base" };
let drag: Drag | null = null;

// --- persistence & undo -----------------------------------------------------------

function loadScene(): Scene {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as Scene;
  } catch {
    /* storage unavailable or corrupt: start empty */
  }
  return emptyScene();
}

function saveScene(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(scene));
  } catch {
    /* ignore */
  }
}

/** Call before every change to the scene. */
function checkpoint(): void {
  history.push(JSON.stringify(scene));
  if (history.length > 200) history.shift();
}

function undo(): void {
  const prev = history.pop();
  if (!prev) return;
  scene = JSON.parse(prev);
  if (selectedId !== null && !scene.elements.some((e) => e.id === selectedId)) selectedId = null;
  changed();
}

function changed(): void {
  saveScene();
  renderList();
  requestRender();
}

// --- coordinates & snapping ---------------------------------------------------------

function screenPos(e: MouseEvent): Point {
  const rect = canvas.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

/** World point under screen point s, snapped unless Alt is held. */
function snapped(s: Point, exclude?: HandleRef): { point: Point; snappedTo: Point | null } {
  const w = toWorld(view, s);
  if (altDown) return { point: w, snappedTo: null };
  const target = snap(scene, w, SNAP_PX / view.scale, exclude);
  return { point: target ?? w, snappedTo: target };
}

// --- construction (orbit, Dirichlet domain, copies) ---------------------------------

interface Analysis {
  key: string;
  construction: Construction | null;
  inventory: Inventory | null;
  /** True if p is not set and the construction uses a helper point instead. */
  auxiliary: boolean;
}
let cached: Analysis = { key: "", construction: null, inventory: null, auxiliary: false };

/**
 * Helper points (fractions of the image size) for checking the group before p is
 * set: generic, so they rarely lie on a symmetry element; the next one is tried if so.
 */
const HELPER_POINTS = [
  [0.5137, 0.4871],
  [0.4613, 0.5329],
  [0.5421, 0.5582],
];

/**
 * The group generated by the drawn elements, built around p – or, without p,
 * around a helper point, so that the compatibility checks and the inventory are
 * available as soon as elements are drawn. Recomputed only when elements, start
 * point or image change.
 */
function analysis(): Analysis {
  const generators = toGenerators(scene);
  // Keep elements whose copies can reach the image (or a default area without one).
  const w = image?.naturalWidth ?? 1000;
  const h = image?.naturalHeight ?? 1000;
  const key = JSON.stringify([scene.elements, scene.base ?? null, w, h]);
  if (key === cached.key) return cached;
  if (generators.length === 0) return (cached = { key, construction: null, inventory: null, auxiliary: false });

  const candidates = scene.base ? [scene.base] : HELPER_POINTS.map(([fx, fy]) => ({ x: fx * w, y: fy * h }));
  let construction: Construction | null = null;
  let base = candidates[0];
  for (base of candidates) {
    const reach = Math.max(...[[0, 0], [w, 0], [0, h], [w, h]].map(([x, y]) => Math.hypot(x - base.x, y - base.y)));
    construction = construct(generators, base, { radius: 1.2 * reach + 100 });
    if (!construction.onElement) break;
  }
  const auxiliary = !scene.base;
  if (!auxiliary && (followMax || lengthLimit > construction!.maxLength)) lengthLimit = construction!.maxLength;
  cached = { key, construction, inventory: inventory(construction!, base), auxiliary };
  return cached;
}

/** The construction around the user's p (null while p is not set). */
function currentConstruction(): Construction | null {
  const a = analysis();
  return a.auxiliary ? null : a.construction;
}

// --- overlay check -------------------------------------------------------------------

let overlayCache: { key: string; result: OverlayResult } | null = null;

/** Computed on demand (when a check view is chosen), not while dragging. */
function currentOverlay(): OverlayResult | null {
  if (imageMode === "original" && overlayCache === null) return null;
  const a = analysis();
  const c = a.auxiliary ? null : a.construction;
  if (!image || !c || c.copiesPerCell === null) return null;
  const key = a.key + image.src;
  if (overlayCache?.key === key) return overlayCache.result;
  const editing = drag?.type === "handle" || drag?.type === "base";
  if (editing || imageMode === "original") return null;
  overlayCache = { key, result: overlayCheck(image, image.naturalWidth, image.naturalHeight, c) };
  return overlayCache.result;
}

function setImageMode(mode: ImageMode): void {
  imageMode = mode;
  for (const btn of document.querySelectorAll<HTMLButtonElement>("#image-mode button")) {
    btn.classList.toggle("active", btn.dataset.mode === mode);
  }
  requestRender();
}

function renderCheckPanel(available: boolean, result: OverlayResult | null): void {
  $("#check").hidden = !available;
  $("#check-empty").hidden = available;
  if (!available) return;
  let text = "";
  if (!result) {
    text =
      imageMode === "original"
        ? "»Aus D« baut das Bild nur aus dem Inhalt des Fundamentalbereichs auf (D in jede Kopie g(D) gelegt); »Differenz« zeigt, wo es vom Original abweicht."
        : "wird berechnet, sobald nichts mehr gezogen wird …";
  } else {
    const pct = (x: number) => `${(100 * x).toFixed(1).replace(".", ",")} %`;
    text = `Mittlere Abweichung ${pct(result.mean)}`;
    if (result.baseline !== null && result.baseline > 0) {
      const ratio = result.mean / result.baseline;
      text += ` · zum Vergleich ohne Symmetrie (Bild gegen sich selbst verschoben): ${pct(result.baseline)}. `;
      text +=
        ratio < 0.3
          ? "Die Symmetrie passt gut zum Bild."
          : ratio < 0.6
            ? "Die Symmetrie passt nur teilweise – rote Stellen in der Differenz ansehen."
            : "Die Symmetrie passt nicht zum Bild.";
    }
    if (result.coverage < 0.95) text += ` Verglichen wurden ${pct(result.coverage)} des Bilds (der Rest liegt außerhalb der Kopien von D oder D ragt aus dem Bild).`;
  }
  $("#check-info").textContent = text;
}

function setLengthLimit(n: number, c: Construction): void {
  lengthLimit = Math.max(0, Math.min(n, c.maxLength));
  followMax = lengthLimit === c.maxLength;
  requestRender();
}

function togglePlay(): void {
  if (playTimer !== null) {
    stopPlay();
    return;
  }
  const c = currentConstruction();
  if (!c) return;
  setLengthLimit(0, c);
  playTimer = window.setInterval(() => {
    const now = currentConstruction();
    if (!now || lengthLimit >= now.maxLength) return stopPlay();
    setLengthLimit(lengthLimit + 1, now);
  }, 450);
  $("#play").textContent = "■";
}

function stopPlay(): void {
  if (playTimer !== null) window.clearInterval(playTimer);
  playTimer = null;
  $("#play").textContent = "▶";
}

function renderCoverPanel(c: Construction | null, hovered: number | null): void {
  $("#cover").hidden = !c;
  $("#cover-empty").hidden = !!c;
  if (!c) return;

  const slider = $<HTMLInputElement>("#length");
  slider.max = String(c.maxLength);
  slider.value = String(lengthLimit);
  $("#length-value").textContent = `${lengthLimit} / ${c.maxLength}`;

  const info = [`${c.elements.length} Gruppenelemente`, `Fundamentalbereich mit ${c.domain.length} Ecken`];
  if (c.copiesPerCell !== null) {
    info.push(`${formatNumber(c.copiesPerCell)} Bereiche pro primitiver Gitterzelle`);
    const drawn = latticeBasis(scene);
    if (drawn && c.translations) {
      const ratio =
        Math.abs(drawn.a1.x * drawn.a2.y - drawn.a1.y * drawn.a2.x) /
        Math.abs(c.translations.t1.x * c.translations.t2.y - c.translations.t1.y * c.translations.t2.x);
      if (Math.abs(ratio - 1) > 1e-3) info.push(`die gezeichnete Zelle umfasst ${formatNumber(ratio)} primitive Zellen`);
    }
  }
  $("#cover-info").textContent = info.join(" · ");

  let hoverText = "";
  if (hovered !== null && c.elements[hovered].length <= lengthLimit) {
    const e = c.elements[hovered];
    hoverText =
      hovered === 0
        ? "Unter dem Zeiger: der Fundamentalbereich D selbst (Wortlänge 0)"
        : `Unter dem Zeiger: g(D) mit g = ${e.word.join(" · ")} (Wortlänge ${e.length})`;
  }
  $("#cover-hover").textContent = hoverText;

  renderWarnings("#cover-warnings", c.pointWarnings);
}

function renderGroupWarnings(warnings: string[]): void {
  renderWarnings("#group-warnings", warnings);
}

const shownWarnings = new Map<string, string>();
function renderWarnings(sel: string, warnings: string[]): void {
  const joined = warnings.join("\n");
  if (shownWarnings.get(sel) === joined) return;
  shownWarnings.set(sel, joined);
  $(sel).replaceChildren(
    ...warnings.map((w) => {
      const li = document.createElement("li");
      li.textContent = w;
      return li;
    }),
  );
}

let shownInventory: Inventory | null | undefined;
function renderInventoryPanel(inv: Inventory | null): void {
  if (inv === shownInventory) return;
  shownInventory = inv;
  $("#inv").hidden = !inv;
  $("#inv-empty").hidden = !!inv;
  if (!inv) return;

  $("#inv-conway").textContent = inv.symbol;
  $("#inv-name").textContent = inv.name ? `(${inv.name})` : "";
  const row = (cells: (string | Node)[], className = "") => {
    const tr = document.createElement("tr");
    tr.className = className;
    for (const cell of cells) {
      const td = document.createElement("td");
      td.append(cell);
      tr.append(td);
    }
    return tr;
  };
  $("#inv-table").replaceChildren(
    ...inv.items.map((item) => {
      const feature = document.createElement("span");
      if (item.classIndex !== undefined) {
        const swatch = document.createElement("span");
        swatch.className = "swatch";
        swatch.style.background = CLASS_COLORS[item.classIndex % CLASS_COLORS.length];
        feature.append(swatch);
      }
      feature.append(item.feature);
      return row([feature, item.label, fraction(item.cost)]);
    }),
    row(["", "Summe", `${fraction(inv.total)} ${Math.abs(inv.total - 2) < 1e-9 ? "✓" : "✗"}`], "sum"),
  );
  $("#inv-check").textContent =
    inv.expectedCopies !== null && inv.problems.length === 0
      ? `Flächenprobe: ${inv.expectedCopies} Bereiche pro primitiver Zelle – passt zu ${inv.symbol} ✓`
      : "";
  $("#inv-problems").replaceChildren(
    ...inv.problems.map((text) => {
      const li = document.createElement("li");
      li.textContent = text;
      return li;
    }),
  );
}

/** 3/8 instead of 0.375 (denominators up to 24). */
function fraction(x: number): string {
  for (let den = 1; den <= 24; den++) {
    const num = Math.round(x * den);
    if (Math.abs(num / den - x) < 1e-9) return den === 1 ? String(num) : `${num}/${den}`;
  }
  return x.toFixed(3);
}

function formatNumber(x: number): string {
  return Math.abs(x - Math.round(x)) < 1e-6 ? String(Math.round(x)) : x.toFixed(2);
}

// --- rendering ------------------------------------------------------------------

let renderQueued = false;
function requestRender(): void {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    render();
  });
}

function render(): void {
  if (mode === "generate") {
    gen.draw(ctx, view, size.width, size.height, size.dpr);
    gen.renderPanel();
    status.textContent = gen.STATUS;
    return;
  }
  let snapIndicator: Point | null = null;
  let ghost: { center: Point; order: RotationOrder } | null = null;
  let preview: Preview | null = null;

  if (drag?.type === "create") {
    preview = { kind: drag.kind, from: drag.from, to: drag.to };
    snapIndicator = altDown ? null : snap(scene, drag.to, 1e-9);
  } else if (drag?.type === "handle") {
    snapIndicator = altDown ? null : snap(scene, drag.last, 1e-9, drag.ref);
  } else if (pointer && !drag && tool !== "select" && tool !== "base" && !spaceDown) {
    const s = snapped(pointer);
    snapIndicator = s.snappedTo;
    if (tool === "rotation") ghost = { center: s.point, order };
  }

  const a = analysis();
  const construction = a.auxiliary ? null : a.construction;
  let cover: CoverState | null = null;
  let hovered: number | null = null;
  if (construction && scene.base) {
    hovered = pointer ? nearestOrbitIndex(construction.orbit, toWorld(view, pointer)) : null;
    cover = {
      construction,
      base: scene.base,
      maxLength: lengthLimit,
      showCopies,
      showOrbit,
      hovered,
    };
  }

  const overlay = currentOverlay();
  draw(ctx, {
    view,
    ...size,
    image,
    scene,
    selectedId,
    preview,
    ghost,
    snapIndicator,
    cover,
    derived: showDerived ? a.inventory : null,
    overlay: overlay ? { mode: imageMode, result: overlay } : null,
  });
  renderGroupWarnings(a.construction?.groupWarnings ?? []);
  renderCoverPanel(construction, hovered);
  renderInventoryPanel(a.inventory);
  renderCheckPanel(!!(image && construction && construction.copiesPerCell !== null), overlay);
  renderStatus();
}

function renderStatus(): void {
  const hints: Record<Tool, string> = {
    select: "Element anklicken zum Auswählen · Griffe ziehen · Leerfläche ziehen verschiebt die Ansicht · Entf löscht",
    lattice: latticeHint(),
    rotation: `Klicken setzt ein Drehzentrum der Ordnung ${order} (Tasten 2/3/4/6 wechseln)`,
    mirror: "Entlang der Spiegelachse ziehen",
    glide: "Entlang der Gleitachse ziehen – die Länge ist der Gleitvektor (meist ½ Gittertranslation)",
    base: "Klicken oder ziehen setzt den Startpunkt p – abseits von Spiegeln und Drehzentren · [ ] ändern die Wortlänge",
  };
  let coords = "";
  if (pointer) {
    const w = toWorld(view, pointer);
    coords = ` · x ${w.x.toFixed(1)}, y ${w.y.toFixed(1)}`;
  }
  status.textContent =
    hints[tool] + " · Alt: ohne Einrasten · Scrollen verschiebt, Pinch/⌘+Scrollen zoomt · ⌘Z rückgängig" + coords;
}

function latticeHint(): string {
  const lat = findLattice(scene);
  if (!lat || lat.points.length >= 3) return "Vom Gitterursprung aus den ersten Gittervektor a₁ ziehen" + (lat ? " (ersetzt das Gitter)" : "");
  return "Jetzt den zweiten Gittervektor a₂ ziehen (vom Ursprung aus)";
}

function renderList(): void {
  const names = labels(scene);
  list.replaceChildren(
    ...scene.elements.map((el) => {
      const li = document.createElement("li");
      li.classList.toggle("selected", el.id === selectedId);
      li.style.borderLeft = `4px solid ${COLORS[el.kind]}`;
      const name = document.createElement("span");
      name.className = "name";
      name.textContent = names.get(el.id) ?? "";
      const desc = document.createElement("span");
      desc.className = "desc";
      desc.textContent = describe(el);
      const del = document.createElement("button");
      del.textContent = "×";
      del.title = "Löschen";
      del.addEventListener("click", (e) => {
        e.stopPropagation();
        deleteElement(el.id);
      });
      li.append(name, desc, del);
      li.addEventListener("click", () => {
        selectedId = el.id;
        renderList();
        requestRender();
      });
      return li;
    }),
  );
  $("#no-elements").hidden = scene.elements.length > 0;
}

function renderToolbar(): void {
  for (const btn of document.querySelectorAll<HTMLButtonElement>("#tools button")) {
    btn.classList.toggle("active", btn.dataset.tool === tool);
  }
  for (const btn of document.querySelectorAll<HTMLButtonElement>("#orders button")) {
    btn.classList.toggle("active", Number(btn.dataset.order) === order);
  }
  canvas.style.cursor = mode === "generate" ? "move" : tool === "select" ? "default" : "crosshair";
}

// --- actions --------------------------------------------------------------------

function setTool(t: Tool): void {
  tool = t;
  drag = null;
  renderToolbar();
  requestRender();
}

function setOrder(n: RotationOrder): void {
  order = n;
  // In the select tool, the order keys edit the selected rotation center;
  // in the rotation tool they only choose the order of the next one.
  const el = tool === "select" ? scene.elements.find((e) => e.id === selectedId) : undefined;
  if (el?.kind === "rotation" && el.order !== n) {
    checkpoint();
    el.order = n;
    changed();
  }
  renderToolbar();
  requestRender();
}

function deleteElement(id: number): void {
  checkpoint();
  removeElement(scene, id);
  if (selectedId === id) selectedId = null;
  changed();
}

function finishCreate(d: Extract<Drag, { type: "create" }>): void {
  if (dist(d.from, d.to) * view.scale < 4) return; // just a click
  checkpoint();
  if (d.kind === "lattice") {
    const lat = findLattice(scene);
    if (lat && lat.points.length === 2) {
      const o = lat.points[0];
      lat.points.push({ x: o.x + d.to.x - d.from.x, y: o.y + d.to.y - d.from.y });
      selectedId = lat.id;
    } else {
      if (lat) removeElement(scene, lat.id);
      selectedId = addElement(scene, { kind: "lattice", points: [d.from, d.to] }).id;
    }
  } else {
    selectedId = addElement(scene, { kind: d.kind, points: [d.from, d.to] }).id;
  }
  changed();
}

/**
 * Mirror and glide axes: turn the direction from → to onto a multiple of 15°
 * relative to a reference (a₁, else the first other axis, else the image x axis),
 * keeping the length along the axis. Hand-drawn axes are never exactly at 45° or
 * 60° to each other, and slightly-off mirrors generate a non-discrete group.
 */
function constrainAxis(from: Point, to: Point, excludeId?: number): Point {
  if (altDown) return to;
  const lat = findLattice(scene);
  const axis = scene.elements.find((e) => (e.kind === "mirror" || e.kind === "glide") && e.id !== excludeId);
  const refEl = lat ?? axis;
  const ref = refEl ? Math.atan2(refEl.points[1].y - refEl.points[0].y, refEl.points[1].x - refEl.points[0].x) : 0;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const step = Math.PI / 12;
  const angle = ref + Math.round((Math.atan2(dy, dx) - ref) / step) * step;
  const u = { x: Math.cos(angle), y: Math.sin(angle) };
  const along = dx * u.x + dy * u.y;
  return { x: from.x + along * u.x, y: from.y + along * u.y };
}

function moveHandle(ref: HandleRef, to: Point): void {
  const el = scene.elements.find((e) => e.id === ref.id);
  if (!el) return;
  if (el.kind === "lattice" && ref.index === 0) {
    // Moving the origin moves the whole lattice.
    const dx = to.x - el.points[0].x;
    const dy = to.y - el.points[0].y;
    el.points = el.points.map((p) => ({ x: p.x + dx, y: p.y + dy }));
  } else {
    el.points[ref.index] = to;
  }
}

function fitView(): void {
  if (mode === "generate") view = gen.fitView(size.width, size.height);
  else if (image) view = fitRect(image.naturalWidth, image.naturalHeight, size.width, size.height);
  requestRender();
}

/** `svg`: the file is an SVG – its source is kept, so the generation export can stay vector. */
function loadImage(url: string, svg: boolean): void {
  const img = new Image();
  const text = svg ? fetch(url).then((r) => r.text()).catch(() => null) : Promise.resolve(null);
  img.onload = async () => {
    const svgText = await text;
    if (mode === "generate") {
      gen.setMotifImage(img, svgText);
      requestRender();
      return;
    }
    image = img;
    imageSvg = svgText;
    fitView();
  };
  img.onerror = () => {
    status.textContent = "Das Bild konnte nicht geladen werden.";
  };
  img.src = url;
}

// --- input ------------------------------------------------------------------------

canvas.addEventListener("pointerdown", (e) => {
  const s = screenPos(e);
  pointer = s;
  canvas.setPointerCapture(e.pointerId);

  if (e.button === 1 || e.button === 2 || spaceDown) {
    drag = { type: "pan", start: s, startView: view };
    return;
  }
  if (e.button !== 0) return;
  if (mode === "generate") {
    if (!gen.pointerDown(view, s)) drag = { type: "pan", start: s, startView: view };
    requestRender();
    return;
  }

  const w = toWorld(view, s);
  switch (tool) {
    case "select": {
      const ref = hitHandle(scene, w, HIT_PX / view.scale);
      const hitId = ref?.id ?? hitElement(scene, w, HIT_PX / view.scale);
      selectedId = hitId;
      if (ref) {
        checkpoint();
        drag = { type: "handle", ref, last: w };
      } else if (hitId === null) {
        drag = { type: "pan", start: s, startView: view };
      }
      renderList();
      break;
    }
    case "base": {
      checkpoint();
      scene.base = w;
      drag = { type: "base" };
      changed();
      break;
    }
    case "rotation": {
      checkpoint();
      selectedId = addElement(scene, { kind: "rotation", points: [snapped(s).point], order }).id;
      changed();
      break;
    }
    default: {
      const p = snapped(s).point;
      drag = { type: "create", kind: tool, from: p, to: p };
    }
  }
  requestRender();
});

canvas.addEventListener("pointermove", (e) => {
  const s = screenPos(e);
  pointer = s;
  if (drag?.type === "pan") {
    view = { ...drag.startView, ox: drag.startView.ox + s.x - drag.start.x, oy: drag.startView.oy + s.y - drag.start.y };
  } else if (mode === "generate") {
    if (!gen.isDragging()) return;
    gen.pointerMove(view, s);
  } else if (drag?.type === "handle") {
    drag.last = snapped(s, drag.ref).point;
    const ref = drag.ref;
    const el = scene.elements.find((e) => e.id === ref.id);
    if (el && (el.kind === "mirror" || el.kind === "glide")) {
      drag.last = constrainAxis(el.points[1 - ref.index], drag.last, el.id);
    }
    moveHandle(drag.ref, drag.last);
  } else if (drag?.type === "create") {
    drag.to = drag.kind === "lattice" ? snapped(s).point : constrainAxis(drag.from, snapped(s).point);
  } else if (drag?.type === "base") {
    scene.base = toWorld(view, s);
  }
  requestRender();
});

canvas.addEventListener("pointerup", () => {
  gen.pointerUp();
  if (drag?.type === "create") finishCreate(drag);
  if (drag?.type === "handle" || drag?.type === "base") changed();
  drag = null;
  requestRender();
});

canvas.addEventListener("pointerleave", () => {
  if (!drag) {
    pointer = null;
    requestRender();
  }
});

canvas.addEventListener("contextmenu", (e) => e.preventDefault());

canvas.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 16 : 1;
    if (e.ctrlKey || e.metaKey) {
      view = zoomAt(view, screenPos(e), Math.exp(-e.deltaY * unit * 0.01));
    } else {
      view = { ...view, ox: view.ox - e.deltaX * unit, oy: view.oy - e.deltaY * unit };
    }
    requestRender();
  },
  { passive: false },
);

window.addEventListener("keydown", (e) => {
  // Shortcuts work everywhere except in text fields (checkboxes and sliders keep focus after a click).
  if (e.target instanceof HTMLInputElement && !["checkbox", "range"].includes(e.target.type)) return;
  if (e.key === "Alt") altDown = true;
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
    e.preventDefault();
    undo();
    return;
  }
  if (e.metaKey || e.ctrlKey) return;

  if (mode === "generate") {
    if (e.key === "f" || e.key === "F") fitView();
    else if (e.key === "+" || e.key === "=") view = zoomAt(view, { x: size.width / 2, y: size.height / 2 }, 1.25);
    else if (e.key === "-") view = zoomAt(view, { x: size.width / 2, y: size.height / 2 }, 0.8);
    else if (e.key === " ") {
      e.preventDefault();
      spaceDown = true;
    }
    requestRender();
    return;
  }

  const t = TOOLS.find((x) => x.key.toLowerCase() === e.key.toLowerCase());
  if (t) setTool(t.tool);
  else if (ROTATION_ORDERS.includes(Number(e.key) as RotationOrder)) setOrder(Number(e.key) as RotationOrder);
  else if ((e.key === "Delete" || e.key === "Backspace") && selectedId !== null) deleteElement(selectedId);
  else if (e.key === "Escape") {
    drag = null;
    selectedId = null;
    renderList();
  } else if (e.key === "f" || e.key === "F") fitView();
  else if (e.key === "[" || e.key === "]") {
    const c = currentConstruction();
    if (c) setLengthLimit(lengthLimit + (e.key === "]" ? 1 : -1), c);
  }
  else if (e.key === "+" || e.key === "=") view = zoomAt(view, { x: size.width / 2, y: size.height / 2 }, 1.25);
  else if (e.key === "-") view = zoomAt(view, { x: size.width / 2, y: size.height / 2 }, 0.8);
  else if (e.key === " ") {
    e.preventDefault();
    spaceDown = true;
    canvas.style.cursor = "grab";
  }
  requestRender();
});

window.addEventListener("keyup", (e) => {
  if (e.key === "Alt") altDown = false;
  if (e.key === " ") {
    spaceDown = false;
    renderToolbar();
  }
  requestRender();
});

window.addEventListener("blur", () => {
  altDown = false;
  spaceDown = false;
});

// Image: file picker, drag & drop, example.
$<HTMLInputElement>("#file").addEventListener("change", (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (file) loadImage(URL.createObjectURL(file), isSvg(file));
});
stage.addEventListener("dragover", (e) => {
  e.preventDefault();
  stage.classList.add("dragover");
});
stage.addEventListener("dragleave", () => stage.classList.remove("dragover"));
stage.addEventListener("drop", (e) => {
  e.preventDefault();
  stage.classList.remove("dragover");
  const file = e.dataTransfer?.files[0];
  if (file?.type.startsWith("image/")) loadImage(URL.createObjectURL(file), isSvg(file));
});
function isSvg(file: File): boolean {
  return file.type === "image/svg+xml" || file.name.toLowerCase().endsWith(".svg");
}
$("#example").addEventListener("click", () =>
  loadImage(import.meta.env.BASE_URL + (mode === "generate" ? "motiv.svg" : "beispiel.svg"), true),
);
$("#to-generate").addEventListener("click", () => {
  const c = currentConstruction();
  const inv = cached.inventory;
  const r = c && realizationFromConstruction(c);
  if (!r || !image || !scene.base) return;
  const label = inv ? `${inv.symbol}${inv.name ? ` (${inv.name})` : ""}` : "eingezeichnete Gruppe";
  gen.importFromAnalysis(r, label, scene.base, image, imageSvg);
  setMode("generate");
  fitView();
});
$("#export").addEventListener("click", async () => {
  const out = await gen.exportView(view, size.width, size.height);
  if (!out) {
    status.textContent = "Export nicht möglich (zu weit herausgezoomt?)";
    return;
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(out.blob);
  a.download = out.filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
});
$("#fit").addEventListener("click", fitView);
$<HTMLInputElement>("#length").addEventListener("input", (e) => {
  stopPlay();
  const c = currentConstruction();
  if (c) setLengthLimit(Number((e.target as HTMLInputElement).value), c);
});
$("#play").addEventListener("click", (e) => {
  e.preventDefault(); // the button sits inside a <label>
  togglePlay();
});
$<HTMLInputElement>("#show-copies").addEventListener("change", (e) => {
  showCopies = (e.target as HTMLInputElement).checked;
  requestRender();
});
$<HTMLInputElement>("#show-derived").addEventListener("change", (e) => {
  showDerived = (e.target as HTMLInputElement).checked;
  requestRender();
});
$<HTMLInputElement>("#show-orbit").addEventListener("change", (e) => {
  showOrbit = (e.target as HTMLInputElement).checked;
  requestRender();
});
for (const btn of document.querySelectorAll<HTMLButtonElement>("#image-mode button")) {
  btn.addEventListener("click", () => setImageMode(btn.dataset.mode as ImageMode));
}
$("#clear").addEventListener("click", () => {
  if (scene.elements.length === 0) return;
  checkpoint();
  scene = emptyScene();
  selectedId = null;
  changed();
});

// Toolbar buttons.
$("#tools").append(
  ...TOOLS.map(({ tool: t, key, label }) => {
    const btn = document.createElement("button");
    btn.dataset.tool = t;
    btn.innerHTML = `${label}<kbd>${key}</kbd>`;
    btn.addEventListener("click", () => setTool(t));
    return btn;
  }),
);
$("#orders").append(
  ...ROTATION_ORDERS.map((n) => {
    const btn = document.createElement("button");
    btn.dataset.order = String(n);
    btn.textContent = String(n);
    btn.title = `${n}-zähliges Drehzentrum`;
    btn.addEventListener("click", () => setOrder(n));
    return btn;
  }),
);

// Canvas size follows its container, at device resolution.
new ResizeObserver(() => {
  const rect = stage.getBoundingClientRect();
  const firstLayout = size.width === 0;
  size = { width: rect.width, height: rect.height, dpr: window.devicePixelRatio || 1 };
  canvas.width = Math.round(rect.width * size.dpr);
  canvas.height = Math.round(rect.height * size.dpr);
  if (firstLayout) fitView();
  render();
}).observe(stage);

// Modes.
function loadMode(): Mode {
  try {
    return localStorage.getItem(MODE_KEY) === "generate" ? "generate" : "analyse";
  } catch {
    return "analyse";
  }
}

function setMode(m: Mode): void {
  if (size.width > 0) views[mode] = view;
  mode = m;
  try {
    localStorage.setItem(MODE_KEY, m);
  } catch {
    /* ignore */
  }
  drag = null;
  stopPlay();
  for (const btn of document.querySelectorAll<HTMLButtonElement>("#mode button")) {
    btn.classList.toggle("active", btn.dataset.mode === m);
  }
  $("#toolbar-analyse").hidden = m !== "analyse";
  $("#side-analyse").hidden = m !== "analyse";
  $("#side-generate").hidden = m !== "generate";
  canvas.style.cursor = m === "generate" ? "move" : tool === "select" ? "default" : "crosshair";
  const saved = views[m];
  if (saved) view = saved;
  else if (size.width > 0) fitView();
  requestRender();
}
for (const btn of document.querySelectorAll<HTMLButtonElement>("#mode button")) {
  btn.addEventListener("click", () => setMode(btn.dataset.mode as Mode));
}
gen.setupPanel(requestRender);

renderToolbar();
renderList();
setImageMode("original");
setMode(mode);
