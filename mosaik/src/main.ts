/** UI wiring: tools, pointer/keyboard input, image loading, element list. */
import "./style.css";
import { COLORS, draw, type Preview } from "./draw";
import type { Point } from "./isometry";
import {
  addElement,
  describe,
  dist,
  emptyScene,
  findLattice,
  hitElement,
  hitHandle,
  labels,
  removeElement,
  ROTATION_ORDERS,
  snap,
  type HandleRef,
  type RotationOrder,
  type Scene,
} from "./scene";
import { fitRect, toWorld, zoomAt, type View } from "./view";

type Tool = "select" | "lattice" | "rotation" | "mirror" | "glide";

const TOOLS: { tool: Tool; key: string; label: string }[] = [
  { tool: "select", key: "V", label: "Auswahl" },
  { tool: "lattice", key: "T", label: "Gitter" },
  { tool: "rotation", key: "D", label: "Drehzentrum" },
  { tool: "mirror", key: "S", label: "Spiegelachse" },
  { tool: "glide", key: "G", label: "Gleitachse" },
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
let view: View = { scale: 1, ox: 0, oy: 0 };
let size = { width: 0, height: 0, dpr: 1 };
let pointer: Point | null = null; // screen coordinates
let spaceDown = false;
let altDown = false;

type Drag =
  | { type: "pan"; start: Point; startView: View }
  | { type: "handle"; ref: HandleRef; last: Point }
  | { type: "create"; kind: Preview["kind"]; from: Point; to: Point };
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
  let snapIndicator: Point | null = null;
  let ghost: { center: Point; order: RotationOrder } | null = null;
  let preview: Preview | null = null;

  if (drag?.type === "create") {
    preview = { kind: drag.kind, from: drag.from, to: drag.to };
    snapIndicator = altDown ? null : snap(scene, drag.to, 1e-9);
  } else if (drag?.type === "handle") {
    snapIndicator = altDown ? null : snap(scene, drag.last, 1e-9, drag.ref);
  } else if (pointer && !drag && tool !== "select" && !spaceDown) {
    const s = snapped(pointer);
    snapIndicator = s.snappedTo;
    if (tool === "rotation") ghost = { center: s.point, order };
  }

  draw(ctx, { view, ...size, image, scene, selectedId, preview, ghost, snapIndicator });
  renderStatus();
}

function renderStatus(): void {
  const hints: Record<Tool, string> = {
    select: "Element anklicken zum Auswählen · Griffe ziehen · Leerfläche ziehen verschiebt die Ansicht · Entf löscht",
    lattice: latticeHint(),
    rotation: `Klicken setzt ein Drehzentrum der Ordnung ${order} (Tasten 2/3/4/6 wechseln)`,
    mirror: "Entlang der Spiegelachse ziehen",
    glide: "Entlang der Gleitachse ziehen – die Länge ist der Gleitvektor (meist ½ Gittertranslation)",
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
  canvas.style.cursor = tool === "select" ? "default" : "crosshair";
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
  if (image) view = fitRect(image.naturalWidth, image.naturalHeight, size.width, size.height);
  requestRender();
}

function loadImage(url: string): void {
  const img = new Image();
  img.onload = () => {
    image = img;
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
  } else if (drag?.type === "handle") {
    drag.last = snapped(s, drag.ref).point;
    moveHandle(drag.ref, drag.last);
  } else if (drag?.type === "create") {
    drag.to = snapped(s).point;
  }
  requestRender();
});

canvas.addEventListener("pointerup", () => {
  if (drag?.type === "create") finishCreate(drag);
  if (drag?.type === "handle") changed();
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
  if (e.target instanceof HTMLInputElement) return;
  if (e.key === "Alt") altDown = true;
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
    e.preventDefault();
    undo();
    return;
  }
  if (e.metaKey || e.ctrlKey) return;

  const t = TOOLS.find((x) => x.key.toLowerCase() === e.key.toLowerCase());
  if (t) setTool(t.tool);
  else if (ROTATION_ORDERS.includes(Number(e.key) as RotationOrder)) setOrder(Number(e.key) as RotationOrder);
  else if ((e.key === "Delete" || e.key === "Backspace") && selectedId !== null) deleteElement(selectedId);
  else if (e.key === "Escape") {
    drag = null;
    selectedId = null;
    renderList();
  } else if (e.key === "f" || e.key === "F") fitView();
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
  if (file) loadImage(URL.createObjectURL(file));
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
  if (file?.type.startsWith("image/")) loadImage(URL.createObjectURL(file));
});
$("#example").addEventListener("click", () => loadImage(import.meta.env.BASE_URL + "beispiel.svg"));
$("#fit").addEventListener("click", fitView);
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
    btn.textContent = `${n}-zählig`;
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

renderToolbar();
renderList();
