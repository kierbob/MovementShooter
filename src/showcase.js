// Loadout "locker" showcase: a small separate 3D view that shows the selected gun/ability on a
// stage (slowly swaying, drag to spin), plus one-off picture thumbnails for the item tiles.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { toonify, VIEWMODELS } from './models.js';
import { toonGradient } from './particles.js';

const ABILITY_MODELS = { frag: 'grenade.glb', impulse: 'impulse.glb' }; // knife is built below
const FIT = 1.7; // longest side of every model on the stage, in world units

const loader = new GLTFLoader();

function knifeModel() {
  const g = new THREE.Group();
  const mat = (c) => new THREE.MeshToonMaterial({ color: c, gradientMap: toonGradient() });
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.02, 0.4), mat(0xd8dee9));
  blade.position.z = -0.12;
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.043, 0.12, 4), mat(0xd8dee9));
  tip.rotation.x = -Math.PI / 2; tip.rotation.y = Math.PI / 4; tip.scale.set(1, 1, 0.33);
  tip.position.z = -0.38;
  const guard = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.05, 0.04), mat(0x333844));
  guard.position.z = 0.1;
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.06, 0.22), mat(0x6b3f22));
  handle.position.z = 0.23;
  g.add(blade, tip, guard, handle);
  toonify(g, 0.012);
  return g;
}

async function loadItemModel(id) {
  const file = VIEWMODELS[id]?.file ?? ABILITY_MODELS[id];
  let model;
  if (file) {
    model = (await loader.loadAsync(`assets/models/weapons/${file}`)).scene;
  } else if (id === 'knife') {
    model = knifeModel();
  } else {
    return null;
  }
  // Side-on with the barrel pointing right (Kenney barrels point -Z).
  model.rotation.y = -Math.PI / 2;
  const holder = new THREE.Group();
  holder.add(model);
  holder.updateMatrixWorld(true);
  let box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const s = FIT / Math.max(size.x, size.y, size.z, 1e-3);
  model.scale.multiplyScalar(s);
  holder.updateMatrixWorld(true);
  box = new THREE.Box3().setFromObject(model);
  model.position.sub(box.getCenter(new THREE.Vector3()));
  if (file) toonify(model, 0.028 / s);
  return holder;
}

export class Showcase {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(28, 1, 0.1, 50);
    this.camera.position.set(0, 0.35, 4.4);
    this.camera.lookAt(0, 0, 0);
    this.scene.add(new THREE.HemisphereLight(0xfff4e0, 0x5a4a9a, 2.2));
    const key = new THREE.DirectionalLight(0xffffff, 2.4);
    key.position.set(2, 3, 4);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0xffe135, 1.2);
    rim.position.set(-3, 1, -2);
    this.scene.add(rim);

    this.pivot = new THREE.Group();
    this.scene.add(this.pivot);
    this.models = {};      // id -> Promise<Group|null>
    this.current = null;
    this.wantId = null;
    this.pop = 1;
    this.spin = 0;         // extra yaw from dragging
    this.spinVel = 0;
    this.active = false;
    this.t = 0;

    let drag = null;
    canvas.addEventListener('pointerdown', (e) => { drag = e.clientX; canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener('pointermove', (e) => {
      if (drag == null) return;
      this.spinVel = (e.clientX - drag) * 0.012;
      this.spin += this.spinVel;
      drag = e.clientX;
    });
    const end = () => { drag = null; };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    this.dragging = () => drag != null;

    new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
    this.loop = this.loop.bind(this);
  }

  model(id) {
    if (!this.models[id]) this.models[id] = loadItemModel(id).catch(() => null);
    return this.models[id];
  }

  async show(id) {
    if (id === this.wantId) return;
    this.wantId = id;
    const m = await this.model(id);
    if (this.wantId !== id) return; // something else was picked while this loaded
    if (this.current) this.pivot.remove(this.current);
    this.current = m;
    if (m) { this.pivot.add(m); this.pop = 0; }
  }

  resize() {
    const el = this.canvas.parentElement;
    const w = el.clientWidth, h = el.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // Keep the whole gun in view on narrow screens; on wide ones slide it right, clear of the stats.
    const wide = w / h >= 1.3;
    this.camera.position.z = wide ? 4.4 : 4.4 * (1.3 / (w / h));
    const shift = wide ? -Math.min(1.1, (w / h - 1.3) * 0.9) : 0;
    this.camera.position.x = shift;
    this.camera.lookAt(shift, 0, 0);
    this.camera.updateProjectionMatrix();
  }

  start() {
    if (this.active) return;
    this.active = true;
    this.last = performance.now();
    this.resize();
    requestAnimationFrame(this.loop);
  }

  stop() { this.active = false; }

  loop(now) {
    if (!this.active) return;
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.t += dt;
    if (!this.dragging()) {
      this.spinVel *= Math.exp(-dt * 3);
      this.spin += this.spinVel;
    }
    this.pop = Math.min(1, this.pop + dt * 5);
    const s = 0.8 + 0.2 * (1 - Math.pow(1 - this.pop, 3)) + Math.sin(this.pop * Math.PI) * 0.06;
    this.pivot.scale.setScalar(s);
    this.pivot.rotation.set(0.12 + Math.sin(this.t * 0.9) * 0.05, Math.sin(this.t * 0.5) * 0.45 + this.spin, 0);
    this.pivot.position.y = Math.sin(this.t * 1.4) * 0.04;
    this.renderer.render(this.scene, this.camera);
    requestAnimationFrame(this.loop);
  }

  // Render a picture of each item (3/4 view) for the tiles. Calls onEach(id, dataURL) as they finish.
  async thumbnails(ids, onEach) {
    const r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    r.setPixelRatio(1);
    r.setSize(320, 180);
    r.outputColorSpace = THREE.SRGBColorSpace;
    const cam = new THREE.PerspectiveCamera(28, 320 / 180, 0.1, 50);
    cam.position.set(0, 0.4, 4.2);
    cam.lookAt(0, 0, 0);
    const scene = new THREE.Scene();
    for (const l of this.scene.children) if (l.isLight) scene.add(l.clone());
    const pivot = new THREE.Group();
    pivot.rotation.set(0.15, 0.35, 0);
    scene.add(pivot);
    for (const id of ids) {
      const m = await this.model(id);
      if (!m) continue;
      const c = m.clone();
      pivot.add(c);
      r.render(scene, cam);
      onEach(id, r.domElement.toDataURL('image/png'));
      pivot.remove(c);
    }
    r.dispose();
    r.forceContextLoss();
  }
}
