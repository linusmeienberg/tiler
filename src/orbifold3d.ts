/**
 * Orbifold mode: the pattern's orbifold in 3D. First stage: the torus ℝ²/Λ of
 * the translation lattice, textured with one lattice cell.
 *
 * A flat torus has no undistorted embedding in space, so the donut stretches the
 * texture: the middle circle of the tube is true to scale (radii from the
 * lattice vectors: 2πR = |a|, 2πr = |b|), the outside is stretched by
 * (R + r)/R and the inside compressed by (R − r)/R. Which strip of the cell lies
 * outside is an arbitrary choice – a slider shifts it around the tube.
 *
 * Painting: Shift + drag on the body (or torus) paints; plain drag rotates. The hit's
 * texture coordinate leads back to a point of the pattern; strokes are kept in
 * pattern coordinates and drawn under every group element, so they continue
 * across mirrors and glued seams. They are cleared when the group changes.
 */
import * as THREE from "three";
import { ArcballControls } from "three/examples/jsm/controls/ArcballControls.js";
import { buildBody, bodyKind, type BodyKind, type BodyMesh, type GroupLines } from "./bodies";
import type { OrbifoldDomain } from "./canonical";
import { cellTransform, drawStrokes, type Stroke } from "./cell";
import { CLASS_COLORS, COLORS } from "./draw";
import type { Isometry, Point } from "./isometry";

/** A pattern with a lattice: renders the parallelogram origin + [0,1)·a + [0,1)·b (default: a cell around p). */
export interface PatternSource {
  key: string; // changes when the content changes
  label: string;
  symbol: string; // Conway symbol
  t1: Point;
  t2: Point;
  /** The canonical domain, for the orbifold body (null if not available). */
  orbifold: OrbifoldDomain | null;
  /** Mirrors, glide axes, centers and the reference point – for *x, xx, 22x. */
  lines: GroupLines | null;
  /** p: the torus cell is centered on it. */
  base: Point;
  /** Changes exactly when the symmetry group changes (then the painting is cleared). */
  groupKey: string;
  /** Group elements near the pattern region (for replicating strokes). */
  copies(): Isometry[];
  render(a: Point, b: Point, options: RenderOptions): HTMLCanvasElement;
}

export interface RenderOptions {
  origin: Point;
  /** Orbifold edge roles and gluing marks (and, if `centers`, the center symbols). */
  marks?: MarkOptions | null;
  strokes?: Stroke[];
}

export interface MarkOptions {
  /** Just inside the edges (bodies made from D itself). */
  inset: boolean;
  /** Symbols for cone points and mirror corners (on bodies the coloured balls show them instead). */
  centers: boolean;
}

export interface TorusSettings {
  view: "torus" | "orbifold";
  swap: boolean; // t₂ around the big circle, t₁ around the tube
  shift: number; // 0…1: texture shift around the tube
  inflate: number; // 0…1: pillows only
  slide: number; // 0…1: shift along mirrors / glide axes (Möbius band, Klein bottle)
  marks: boolean; // orbifold marks on the texture, balls at centers, mirror tubes
}

export type ViewInfo =
  | ({ view: "torus" } & TorusInfo)
  | { view: "orbifold"; kind: BodyKind | null; symbol: string; stretch?: [number, number]; shiftable?: boolean };

/** Distortion, relative to the middle ring of the tube (true to scale around the big circle). */
export interface TorusInfo {
  bigCircle: number; // length of the lattice vector around the big circle
  tube: number;
  stretch: number; // around the big circle, outside
  squeeze: number; // around the big circle, inside
  tubeFactor: number; // around the tube (1 unless the tube had to be made thinner)
  /** Angle between the lattice vectors in degrees: the cell becomes a rectangle on the torus, so ≠ 90° means shear. */
  angle: number;
}

/** Thickest tube allowed (r/R): a proper donut, not too distorted inside. */
const MAX_TUBE_RATIO = 0.5;

let renderer: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene;
let camera: THREE.PerspectiveCamera;
let controls: ArcballControls;
let mesh: THREE.Mesh | null = null;
let texture: THREE.CanvasTexture | null = null;
let shown = { key: "", swap: false, marks: false, strokes: -1 };
let body: THREE.Group | null = null;
let bodyKey = "";
let bodyTexture: { key: string; texture: THREE.CanvasTexture } | null = null;
let running = false;
let container: HTMLElement;

// --- painting state ---
let strokes: Stroke[] = [];
let strokesVersion = 0;
let groupKey = "";
let currentSource: PatternSource | null = null;
let brush = { color: "#b91c1c", width: 6 };
/** What a ray can hit, and how its texture maps back to the pattern. */
let paintTarget: { mesh: THREE.Mesh; texture: THREE.CanvasTexture; a: Point; b: Point; origin: Point } | null = null;
let onPainted: () => void = () => {};

export function init(host: HTMLElement, painted: () => void = () => {}): void {
  container = host;
  onPainted = painted;
}

export function setBrush(b: Partial<typeof brush>): void {
  brush = { ...brush, ...b };
}

export function strokeCount(): number {
  return strokes.length;
}

export function currentStrokes(): Stroke[] {
  return strokes;
}

export function undoStroke(): void {
  if (strokes.pop()) strokesVersion++;
}

export function clearStrokes(): void {
  if (strokes.length) strokesVersion++;
  strokes = [];
}

function ensureRenderer(): void {
  if (renderer) return;
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  renderer.domElement.className = "viewer3d";
  container.append(renderer.domElement);
  scene = new THREE.Scene();
  scene.background = new THREE.Color("#e7e5e4");
  camera = new THREE.PerspectiveCamera(35, 1, 0.01, 100);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8178, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 1.4);
  sun.position.set(2, 3, 4);
  scene.add(sun);
  // Free rotation like a trackball under the cursor (no locked up axis, so the
  // torus can be turned over): left drag rotates, right drag pans, wheel zooms.
  camera.position.set(0, -2.6, 2.4);
  camera.up.set(0, 0, 1);
  camera.lookAt(0, 0, 0);
  controls = new ArcballControls(camera, renderer.domElement, scene);
  controls.setGizmosVisible(false);
  controls.saveState();
  new ResizeObserver(resize).observe(container);
  // Capture phase: decide before the controls whether this drag paints or rotates.
  renderer.domElement.addEventListener("pointerdown", startPainting, { capture: true });
  // While Shift is held the cursor shows that dragging paints.
  const cursor = (e: KeyboardEvent) => {
    if (e.key === "Shift" && renderer) renderer.domElement.style.cursor = e.type === "keydown" ? "crosshair" : "";
  };
  window.addEventListener("keydown", cursor);
  window.addEventListener("keyup", cursor);
  window.addEventListener("blur", () => renderer && (renderer.domElement.style.cursor = ""));
}

// --- painting ------------------------------------------------------------------------------

const raycaster = new THREE.Raycaster();

/** The pattern point under a screen position, if the ray hits the painted surface. */
function patternPointAt(e: PointerEvent): Point | null {
  if (!paintTarget || !renderer) return null;
  const rect = renderer.domElement.getBoundingClientRect();
  const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const hit = raycaster.intersectObject(paintTarget.mesh, false)[0];
  if (!hit?.uv) return null;
  // Texture coordinate → image fraction (offset/repeat, wrapping and flipY applied) → pattern.
  const uv = hit.uv.clone();
  paintTarget.texture.transformUv(uv);
  const { a, b, origin } = paintTarget;
  return { x: origin.x + uv.x * a.x + uv.y * b.x, y: origin.y + uv.x * a.y + uv.y * b.y };
}

function startPainting(e: PointerEvent): void {
  if (!e.shiftKey || e.button !== 0 || !paintTarget || !currentSource) return;
  const p = patternPointAt(e);
  if (!p) return; // off the body: the controls rotate as usual
  e.stopImmediatePropagation();
  controls.enabled = false;
  let current: Stroke = { points: [p], color: brush.color, width: brush.width };
  strokes.push(current);
  paintIncrement(current, [p]);
  const move = (ev: PointerEvent) => {
    const q = patternPointAt(ev);
    if (!q) return;
    const last = current.points[current.points.length - 1];
    const step = Math.hypot(q.x - last.x, q.y - last.y);
    if (step < brush.width * 0.25) return;
    // Across a seam the pattern point jumps to another copy of the same place:
    // continue in a new piece rather than drawing a line across the pattern.
    if (step > brush.width * 12) {
      current = { points: [q], color: brush.color, width: brush.width };
      strokes.push(current);
      paintIncrement(current, [q]);
      return;
    }
    current.points.push(q);
    paintIncrement(current, [last, q]);
  };
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    controls.enabled = true;
    onPainted();
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

/** Draw a new piece of a stroke into the texture currently shown, without re-rendering it. */
function paintIncrement(stroke: Stroke, points: Point[]): void {
  if (!paintTarget || !currentSource) return;
  const canvas = paintTarget.texture.image as HTMLCanvasElement;
  const ctx = canvas.getContext("2d")!;
  const { a, b, origin } = paintTarget;
  drawStrokes(ctx, cellTransform(a, b, origin, canvas.width, canvas.height), [{ ...stroke, points }], currentSource.copies());
  paintTarget.texture.needsUpdate = true;
}

function resize(): void {
  if (!renderer) return;
  const { width, height } = container.getBoundingClientRect();
  if (width === 0 || height === 0) return;
  renderer.setSize(width, height);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

export function resetCamera(): void {
  if (!renderer) return;
  controls.reset();
}

export function setActive(on: boolean): void {
  if (on) ensureRenderer();
  if (renderer) renderer.domElement.hidden = !on;
  if (on && !running) {
    running = true;
    resize();
    const loop = () => {
      if (!running) return;
      // No controls.update() here: for ArcballControls it re-aims the camera with
      // the old up vector every frame and fights the trackball rotation (jitter).
      renderer!.render(scene, camera);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
  if (!on) running = false;
}

/** Show the torus or the orbifold body of `source` (null: nothing). */
export function update(source: PatternSource | null, settings: TorusSettings): ViewInfo | null {
  ensureRenderer();
  if (mesh) mesh.visible = false;
  if (body) body.visible = false;
  paintTarget = null;
  currentSource = source;
  if (!source) return null;
  // A different symmetry group: the painting no longer fits, start over.
  if (source.groupKey !== groupKey) {
    groupKey = source.groupKey;
    clearStrokes();
  }
  // The orbifold of o is the torus itself.
  if (settings.view === "orbifold" && source.symbol !== "o") {
    const m = showBody(source, settings);
    return { view: "orbifold", kind: m?.kind ?? null, symbol: source.symbol, stretch: m?.stretch, shiftable: m?.shiftable };
  }
  return { view: "torus", ...showTorus(source, settings) };
}

function showTorus(source: PatternSource, settings: TorusSettings): TorusInfo {
  const [a, b] = settings.swap ? [source.t2, source.t1] : [source.t1, source.t2];
  const la = Math.hypot(a.x, a.y);
  const lb = Math.hypot(b.x, b.y);
  let R = la / (2 * Math.PI);
  let r = lb / (2 * Math.PI);
  // With |b| close to |a| the true tube would be as thick as the ring (no hole):
  // make it thinner and say so (tubeFactor < 1).
  if (r > MAX_TUBE_RATIO * R) r = MAX_TUBE_RATIO * R;
  const tubeFactor = (2 * Math.PI * r) / lb;
  // Unit scale: outer radius 1.
  const scale = 1 / (R + r);
  R *= scale;
  r *= scale;

  const origin = { x: source.base.x - (a.x + b.x) / 2, y: source.base.y - (a.y + b.y) / 2 };
  if (
    shown.key !== source.key ||
    shown.swap !== settings.swap ||
    shown.marks !== settings.marks ||
    shown.strokes !== strokesVersion ||
    !mesh
  ) {
    texture?.dispose();
    texture = new THREE.CanvasTexture(
      source.render(a, b, { origin, marks: settings.marks ? { inset: false, centers: true } : null, strokes }),
    );
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = renderer!.capabilities.getMaxAnisotropy();
    // TorusGeometry: u runs around the big circle, v around the tube; with the
    // default flipY the canvas's (right, up) maps to (u, v), which keeps the
    // pattern's orientation as seen from outside (no mirror image).
    const geometry = new THREE.TorusGeometry(R, r, 96, 192);
    if (mesh) {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
      scene.remove(mesh);
    }
    mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ map: texture, roughness: 0.85, side: THREE.DoubleSide }));
    scene.add(mesh);
    shown = { key: source.key, swap: settings.swap, marks: settings.marks, strokes: strokesVersion };
  }
  mesh.visible = true;
  texture!.offset.set(0, settings.shift);
  paintTarget = { mesh, texture: texture!, a, b, origin };
  const angle = (Math.acos(Math.abs(a.x * b.x + a.y * b.y) / (la * lb)) * 180) / Math.PI;
  return { bigCircle: la, tube: lb, stretch: (R + r) / R, squeeze: (R - r) / R, tubeFactor, angle };
}

// --- orbifold bodies -----------------------------------------------------------------------

let bodyMesh: BodyMesh | null = null;

function showBody(source: PatternSource, settings: TorusSettings): BodyMesh | null {
  const kind = bodyKind(source.symbol);
  if (!kind || !source.orbifold) return null;
  const inflate = kind === "pillow" ? settings.inflate : 0;
  const key = JSON.stringify([source.key, source.symbol, inflate]);
  if (key !== bodyKey || !body) {
    const m = buildBody(source.symbol, source.orbifold, {
      inflate,
      lattice: { t1: source.t1, t2: source.t2 },
      lines: source.lines ?? undefined,
    });
    if (!m) return null;
    replaceBody(makeBody(m, textureFor(source, m, settings.marks)));
    bodyKey = key;
    bodyMesh = m;
  }
  // Marks toggled: new texture, show or hide balls and mirror tubes.
  const tex = textureFor(source, bodyMesh!, settings.marks);
  const surface = body!.children[0] as THREE.Mesh;
  const mat = surface.material as THREE.MeshStandardMaterial;
  if (mat.map !== tex) {
    mat.map = tex;
    mat.needsUpdate = true;
  }
  body!.children.slice(1).forEach((o) => (o.visible = settings.marks));
  // Sliding along mirrors / glide axes only moves the texture (it spans a whole period).
  if (bodyMesh?.shiftable && bodyTexture) bodyTexture.texture.offset.set(settings.slide, 0);
  body!.visible = true;
  const r = bodyMesh!.region;
  paintTarget = { mesh: surface, texture: tex, a: r.a, b: r.b, origin: r.origin };
  return bodyMesh;
}

/** The texture is the world rectangle `region` around D; reused while only the inflation changes. */
function textureFor(source: PatternSource, m: BodyMesh, marks: boolean): THREE.CanvasTexture {
  const r = m.region;
  const key = JSON.stringify([source.key, r, marks, strokesVersion]);
  if (bodyTexture?.key !== key) {
    bodyTexture?.texture.dispose();
    // Bodies made from D itself have D's edges as their edges: draw the marks just inside.
    const inset = ["flat", "cylinder", "cone", "pillow"].includes(m.kind);
    // On bodies the coloured balls mark cone points and corners; no symbols in the texture.
    const t = new THREE.CanvasTexture(
      source.render(r.a, r.b, { origin: r.origin, marks: marks ? { inset, centers: false } : null, strokes }),
    );
    t.colorSpace = THREE.SRGBColorSpace;
    if (m.shiftable) t.wrapS = THREE.RepeatWrapping;
    t.anisotropy = renderer!.capabilities.getMaxAnisotropy();
    bodyTexture = { key, texture: t };
  }
  return bodyTexture.texture;
}

function makeBody(m: BodyMesh, map: THREE.Texture): THREE.Group {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(m.positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(m.uvs, 2));
  geometry.setIndex(m.indices);
  geometry.computeVertexNormals();
  // Closed bodies (pillows, tetrahedron) only from outside – the two layers of a
  // flat pillow lie in the same plane; open sheets from both sides.
  const closed = m.kind === "pillow" || m.kind === "tetrahedron";
  const material = new THREE.MeshStandardMaterial({
    map,
    roughness: 0.85,
    side: closed ? THREE.FrontSide : THREE.DoubleSide,
    flatShading: m.kind === "tetrahedron",
  });
  const group = new THREE.Group();
  group.add(new THREE.Mesh(geometry, material));

  geometry.computeBoundingSphere();
  const radius = geometry.boundingSphere!.radius || 1;
  // Mirror boundary as thin tubes (WebGL lines are always 1 px wide).
  const mirrorMaterial = new THREE.MeshStandardMaterial({ color: COLORS.mirror, roughness: 0.4 });
  for (const line of m.mirrors) {
    const curve = new THREE.CatmullRomCurve3(line.map(([x, y, z]) => new THREE.Vector3(x, y, z)));
    group.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 64, radius * 0.008, 8), mirrorMaterial));
  }
  for (const k of m.markers) {
    const ball = new THREE.Mesh(
      new THREE.SphereGeometry(radius * 0.035, 16, 12),
      new THREE.MeshStandardMaterial({ color: CLASS_COLORS[k.classIndex % CLASS_COLORS.length], roughness: 0.5 }),
    );
    ball.position.set(...k.pos);
    group.add(ball);
  }
  group.scale.setScalar(1 / radius);
  return group;
}

function replaceBody(group: THREE.Group): void {
  if (body) {
    scene.remove(body);
    body.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.Line) {
        o.geometry.dispose();
        const mat = o.material as THREE.Material & { map?: THREE.Texture };
        mat.dispose(); // the texture is kept in bodyTexture
      }
    });
  }
  body = group;
  scene.add(body);
}
