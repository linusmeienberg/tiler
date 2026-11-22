/**
 * Orbifold mode: the pattern's orbifold in 3D. First stage: the torus ℝ²/Λ of
 * the translation lattice, textured with one lattice cell.
 *
 * A flat torus has no undistorted embedding in space, so the donut stretches the
 * texture: the middle circle of the tube is true to scale (radii from the
 * lattice vectors: 2πR = |a|, 2πr = |b|), the outside is stretched by
 * (R + r)/R and the inside compressed by (R − r)/R. Which strip of the cell lies
 * outside is an arbitrary choice – a slider shifts it around the tube.
 */
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { Point } from "./isometry";

/** A pattern with a lattice: renders one cell for the basis (a, b). */
export interface PatternSource {
  key: string; // changes when the content changes
  label: string;
  t1: Point;
  t2: Point;
  render(a: Point, b: Point): HTMLCanvasElement;
}

export interface TorusSettings {
  swap: boolean; // t₂ around the big circle, t₁ around the tube
  shift: number; // 0…1: texture shift around the tube
}

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
let controls: OrbitControls;
let mesh: THREE.Mesh | null = null;
let texture: THREE.CanvasTexture | null = null;
let shown = { key: "", swap: false };
let running = false;
let container: HTMLElement;

export function init(host: HTMLElement): void {
  container = host;
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
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  resetCamera();
  new ResizeObserver(resize).observe(container);
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
  camera.position.set(0, -2.6, 2.4);
  camera.up.set(0, 0, 1);
  controls.target.set(0, 0, 0);
  controls.update();
}

export function setActive(on: boolean): void {
  if (on) ensureRenderer();
  if (renderer) renderer.domElement.hidden = !on;
  if (on && !running) {
    running = true;
    resize();
    const loop = () => {
      if (!running) return;
      controls.update();
      renderer!.render(scene, camera);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
  if (!on) running = false;
}

/** Show the torus of `source` (null: nothing). Returns the distortion info. */
export function update(source: PatternSource | null, settings: TorusSettings): TorusInfo | null {
  ensureRenderer();
  if (!source) {
    if (mesh) mesh.visible = false;
    shown = { key: "", swap: false };
    return null;
  }
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

  if (shown.key !== source.key || shown.swap !== settings.swap || !mesh) {
    texture?.dispose();
    texture = new THREE.CanvasTexture(source.render(a, b));
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
    shown = { key: source.key, swap: settings.swap };
  }
  mesh.visible = true;
  texture!.offset.set(0, settings.shift);
  const angle = (Math.acos(Math.abs(a.x * b.x + a.y * b.y) / (la * lb)) * 180) / Math.PI;
  return { bigCircle: la, tube: lb, stretch: (R + r) / R, squeeze: (R - r) / R, tubeFactor, angle };
}
