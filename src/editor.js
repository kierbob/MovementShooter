// Standalone map editor (editor.html). Builds maps out of the same pieces the game uses:
// boxes (x, z = center, w, d = size, y = bottom, h = height, kind = color), jump pads and spawns.
// Export downloads a .json the game can load with loadCustomMap (world.js); Test Play opens
// the game on the current map via index.html?testmap.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { COLORS, gridTexture, boxGeometry } from './render.js';
import { toonGradient } from './particles.js';
import { JUMP_PAD } from './config.js';

const SAVE_KEY = 'movement-shooter.editor.v1';
const TEST_KEY = 'movement-shooter.testmap';
const GRID = 0.5;
const KINDS = [
  ['block', 'Block'], ['wall', 'Wall'], ['plat', 'Platform'], ['pillar', 'Pillar'],
  ['stair', 'Stair'], ['low', 'Low / Cover'], ['floor', 'Floor'], ['test', 'Yellow'],
];

const $ = (s) => document.querySelector(s);
const round = (v) => Math.round(v * 1000) / 1000;
const snap = (v, g = GRID) => Math.round(v / g) * g;
// Snap a box center so its edges land on the grid (odd sizes stay aligned too).
const snapCenter = (c, size) => snap(c - size / 2) + size / 2;

// ---------- map data ----------
let nextId = 1;
const newId = () => nextId++;

function defaultMap() {
  const H = 45;
  return {
    name: 'New Map',
    boxes: [
      { x: 0, z: 0, w: H * 2, d: H * 2, h: 1, y: -1, kind: 'floor' },
      { x: 0, z: -H - 0.5, w: H * 2 + 2, d: 1, h: 10, y: 0, kind: 'wall' },
      { x: 0, z: H + 0.5, w: H * 2 + 2, d: 1, h: 10, y: 0, kind: 'wall' },
      { x: -H - 0.5, z: 0, w: 1, d: H * 2, h: 10, y: 0, kind: 'wall' },
      { x: H + 0.5, z: 0, w: 1, d: H * 2, h: 10, y: 0, kind: 'wall' },
    ],
    pads: [],
    spawns: [{ x: 0, y: 0, z: 38, yaw: 0 }],
  };
}

// Internal copy with ids so selection survives undo/redo.
function withIds(m) {
  return {
    name: String(m.name ?? 'Untitled').slice(0, 32),
    boxes: (m.boxes ?? []).map((b) => ({ id: newId(), x: +b.x, z: +b.z, w: +b.w, d: +b.d, h: +b.h, y: +(b.y ?? 0), kind: b.kind ?? 'block' })),
    pads: (m.pads ?? []).map((p) => ({
      id: newId(), x: +p.x, y: +(p.y ?? 0), z: +p.z, radius: +(p.radius ?? 1.2),
      ...(p.launch != null ? { launch: +p.launch } : {}),
      ...(p.dir ? { dir: { x: +p.dir.x, z: +p.dir.z }, forward: +(p.forward ?? 18) } : {}),
    })),
    spawns: (m.spawns ?? []).map((s) => ({ id: newId(), x: +s.x, y: +(s.y ?? 0), z: +s.z, yaw: +(s.yaw ?? 0) })),
  };
}

function exportMap() {
  const strip = ({ id, ...rest }) => {
    const o = {};
    for (const [k, v] of Object.entries(rest)) o[k] = typeof v === 'number' ? round(v) : v && typeof v === 'object' ? { x: round(v.x), z: round(v.z) } : v;
    return o;
  };
  return { name: map.name, version: 1, boxes: map.boxes.map(strip), pads: map.pads.map(strip), spawns: map.spawns.map(strip) };
}

let map;
try { map = withIds(JSON.parse(localStorage.getItem(SAVE_KEY)) ?? defaultMap()); } catch { map = withIds(defaultMap()); }

// ---------- undo ----------
const undoStack = [];
let redoStack = [];
const snapshot = () => JSON.stringify({ map, nextId });
function checkpoint() {
  undoStack.push(snapshot());
  if (undoStack.length > 200) undoStack.shift();
  redoStack = [];
}
function restore(json) {
  const s = JSON.parse(json);
  map = s.map;
  selection = selection.filter((sel) => findObj(sel));
  changed();
}
function undo() { if (!undoStack.length) return; redoStack.push(snapshot()); restore(undoStack.pop()); toast('Undo'); }
function redo() { if (!redoStack.length) return; undoStack.push(snapshot()); restore(redoStack.pop()); toast('Redo'); }

let saveTimer = 0;
function changed() {
  sync();
  refreshProps();
  refreshStats();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(exportMap())); } catch { /* storage full/blocked */ }
  }, 250);
}

// ---------- three.js scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.domElement.className = 'ed-canvas';
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xcfd8f6);
scene.add(new THREE.HemisphereLight(0xffffff, 0x8a7fb8, 2.0));
const sunLight = new THREE.DirectionalLight(0xffffff, 1.8);
sunLight.position.set(30, 60, 20);
scene.add(sunLight);

const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 2000);
camera.position.set(0, 70, 80);
const controls = new OrbitControls(camera, renderer.domElement);
controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE };
controls.screenSpacePanning = false;
controls.maxPolarAngle = Math.PI * 0.495;
controls.enableDamping = true;
controls.target.set(0, 0, 0);

const minorGrid = new THREE.GridHelper(400, 400, 0x000000, 0x000000);
minorGrid.material.transparent = true; minorGrid.material.opacity = 0.06;
const majorGrid = new THREE.GridHelper(400, 40, 0x000000, 0x000000);
majorGrid.material.transparent = true; majorGrid.material.opacity = 0.18;
minorGrid.position.y = majorGrid.position.y = 0.002;
scene.add(minorGrid, majorGrid);
const axisX = new THREE.Mesh(new THREE.BoxGeometry(400, 0.01, 0.08), new THREE.MeshBasicMaterial({ color: 0xff5a6a }));
const axisZ = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.01, 400), new THREE.MeshBasicMaterial({ color: 0x3c8cff }));
axisX.position.y = axisZ.position.y = 0.004;
scene.add(axisX, axisZ);
const groundPlane = new THREE.Mesh(new THREE.PlaneGeometry(2000, 2000), new THREE.MeshBasicMaterial({ visible: false }));
groundPlane.rotation.x = -Math.PI / 2;
scene.add(groundPlane);

const tex = gridTexture();
const matCache = {};
function boxMat(kind, selected) {
  const key = kind + (selected ? '!' : '');
  return (matCache[key] ??= new THREE.MeshToonMaterial({
    color: COLORS[kind] ?? 0x888888, map: tex, gradientMap: toonGradient(),
    emissive: selected ? 0x6a5200 : 0x000000,
  }));
}
const edgeMat = new THREE.LineBasicMaterial({ color: 0x10142e, transparent: true, opacity: 0.35 });
const edgeSelMat = new THREE.LineBasicMaterial({ color: 0xffe135 });
const padMat = new THREE.MeshToonMaterial({ color: 0xff5ab4, gradientMap: toonGradient(), emissive: 0x401030 });
const padSelMat = new THREE.MeshToonMaterial({ color: 0xffe135, gradientMap: toonGradient(), emissive: 0x403000 });
const spawnMat = new THREE.MeshToonMaterial({ color: 0x3cf0a0, gradientMap: toonGradient(), transparent: true, opacity: 0.85 });
const spawnSelMat = new THREE.MeshToonMaterial({ color: 0xffe135, gradientMap: toonGradient() });

// id -> { obj, key }
const views = new Map();
const pickables = [];

function makeBoxView(b) {
  const mesh = new THREE.Mesh(boxGeometry(b.w, b.h, b.d), boxMat(b.kind, false));
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry), edgeMat);
  mesh.add(edges);
  mesh.userData.edges = edges;
  return mesh;
}
function makePadView(p) {
  const g = new THREE.Group();
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(p.radius, p.radius, 0.14, 28), padMat);
  disc.position.y = 0.07;
  g.add(disc);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(p.radius * 0.7, 0.05, 6, 28), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  ring.rotation.x = Math.PI / 2; ring.position.y = 0.16;
  g.add(ring);
  if (p.dir) {
    const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.9, 12), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    arrow.rotation.x = Math.PI / 2; // tip along +Z, then the holder turns +Z onto dir
    arrow.position.set(0, 0.35, 0.2);
    const holder = new THREE.Group();
    holder.add(arrow);
    holder.rotation.y = Math.atan2(p.dir.x, p.dir.z);
    g.add(holder);
  }
  g.userData.disc = disc;
  return g;
}
function makeSpawnView() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.38, 1.04, 4, 12), spawnMat);
  body.position.y = 0.9;
  g.add(body);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.6, 10), new THREE.MeshBasicMaterial({ color: 0x10142e }));
  nose.rotation.x = -Math.PI / 2;
  nose.position.set(0, 1.4, -0.65);
  g.add(nose);
  g.userData.disc = body;
  return g;
}

function allObjects() {
  return [
    ...map.boxes.map((o) => ['box', o]), ...map.pads.map((o) => ['pad', o]), ...map.spawns.map((o) => ['spawn', o]),
  ];
}
function findObj(sel) {
  const list = sel.type === 'box' ? map.boxes : sel.type === 'pad' ? map.pads : map.spawns;
  return list.find((o) => o.id === sel.id);
}
const isSelected = (id) => selection.some((s) => s.id === id);

// Bring the three.js objects in line with the map data.
function sync() {
  const seen = new Set();
  for (const [type, o] of allObjects()) {
    seen.add(o.id);
    const key = type === 'box' ? `${o.w}|${o.h}|${o.d}` : type === 'pad' ? `${o.radius}|${o.dir ? `${o.dir.x},${o.dir.z}` : ''}` : 's';
    let v = views.get(o.id);
    if (v && v.key !== key) { scene.remove(v.obj); views.delete(o.id); v = null; }
    if (!v) {
      const obj = type === 'box' ? makeBoxView(o) : type === 'pad' ? makePadView(o) : makeSpawnView(o);
      obj.userData.ref = { type, id: o.id };
      obj.traverse((c) => { c.userData.ref = { type, id: o.id }; });
      scene.add(obj);
      v = { obj, key };
      views.set(o.id, v);
    }
    const sel = isSelected(o.id);
    if (type === 'box') {
      v.obj.position.set(o.x, o.y + o.h / 2, o.z);
      v.obj.material = boxMat(o.kind, sel);
      v.obj.userData.edges.material = sel ? edgeSelMat : edgeMat;
    } else {
      v.obj.position.set(o.x, o.y, o.z);
      if (type === 'spawn') v.obj.rotation.y = o.yaw;
      v.obj.userData.disc.material = type === 'pad' ? (sel ? padSelMat : padMat) : (sel ? spawnSelMat : spawnMat);
    }
  }
  for (const [id, v] of views) if (!seen.has(id)) { scene.remove(v.obj); views.delete(id); }
  pickables.length = 0;
  for (const v of views.values()) v.obj.traverse((c) => { if (c.isMesh) pickables.push(c); });
}

// ---------- tools / ghost ----------
let tool = 'select';
let newKind = 'block';
const newSize = { w: 4, d: 4, h: 2 };
let selection = []; // [{ type, id }]

const ghostMat = new THREE.MeshBasicMaterial({ color: 0xffe135, transparent: true, opacity: 0.4, depthWrite: false });
let ghost = null;
function setGhost(obj) {
  if (ghost) scene.remove(ghost);
  ghost = obj;
  if (ghost) {
    ghost.traverse((c) => { if (c.isMesh) { c.material = ghostMat; c.raycast = () => {}; } });
    ghost.visible = false;
    scene.add(ghost);
  }
}
function rebuildGhost() {
  if (tool === 'box') {
    const m = new THREE.Mesh(new THREE.BoxGeometry(newSize.w, newSize.h, newSize.d), ghostMat);
    m.add(new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry), edgeSelMat));
    ghostMat.color.set(COLORS[newKind] ?? 0xffe135);
    setGhost(m);
  } else if (tool === 'pad') {
    ghostMat.color.set(0xff5ab4);
    setGhost(makePadView({ radius: 1.2 }));
  } else if (tool === 'spawn') {
    ghostMat.color.set(0x3cf0a0);
    setGhost(makeSpawnView());
  } else {
    setGhost(null);
  }
}

function setTool(t) {
  tool = t;
  for (const b of document.querySelectorAll('[data-tool]')) b.classList.toggle('on', b.dataset.tool === t);
  rebuildGhost();
  renderer.domElement.style.cursor = t === 'select' ? 'default' : 'crosshair';
  status();
}

// ---------- picking ----------
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let lastPointer = null;

function pick(e, targets = pickables) {
  scene.updateMatrixWorld(); // positions may have changed since the last drawn frame
  camera.updateMatrixWorld();
  const r = renderer.domElement.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const hits = raycaster.intersectObjects([...targets, groundPlane], false);
  return hits[0] ?? null;
}

// Where a new piece would go for the current pointer position.
function placement(e) {
  const hit = pick(e);
  if (!hit) return null;
  const free = e.altKey;
  const sn = (v) => (free ? v : snap(v));
  const p = hit.point;
  const n = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : new THREE.Vector3(0, 1, 0);
  if (hit.object === groundPlane) n.set(0, 1, 0);
  const ref = hit.object.userData.ref;
  if (tool === 'box') {
    const { w, d, h } = newSize;
    let x = p.x, z = p.z, y;
    if (n.y > 0.5) y = p.y;
    else if (n.y < -0.5) y = p.y - h;
    else {
      x += n.x * w / 2; z += n.z * d / 2;
      const b = ref?.type === 'box' ? findObj(ref) : null;
      y = b ? b.y : snap(p.y);
    }
    if (!free) {
      if (Math.abs(n.x) > 0.5) x = p.x + n.x * w / 2; else x = snapCenter(x, w);
      if (Math.abs(n.z) > 0.5) z = p.z + n.z * d / 2; else z = snapCenter(z, d);
      x = Math.abs(n.x) > 0.5 ? round(x) : x;
      z = Math.abs(n.z) > 0.5 ? round(z) : z;
    }
    return { x, z, y: round(y) };
  }
  // pads / spawns sit on whatever surface you point at
  const top = n.y > 0.5 ? p.y : null;
  if (top == null) return null;
  return { x: sn(p.x), z: sn(p.z), y: round(top) };
}

// ---------- pointer ----------
let drag = null;
const dragPlane = new THREE.Plane();
const tmpV = new THREE.Vector3();

function planePoint(e) {
  camera.updateMatrixWorld();
  const r = renderer.domElement.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  return raycaster.ray.intersectPlane(dragPlane, tmpV) ? tmpV.clone() : null;
}

renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());
renderer.domElement.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  const hit = pick(e, pickables);
  if (tool === 'select') {
    const ref = hit?.object.userData.ref;
    if (!ref) { if (!e.shiftKey) select([]); return; }
    if (e.shiftKey) {
      select(isSelected(ref.id) ? selection.filter((s) => s.id !== ref.id) : [...selection, ref]);
      return;
    }
    if (!isSelected(ref.id)) select([ref]);
    dragPlane.set(new THREE.Vector3(0, 1, 0), -hit.point.y);
    drag = { start: hit.point.clone(), orig: selection.map((s) => ({ s, x: findObj(s).x, z: findObj(s).z })), moved: false };
    renderer.domElement.setPointerCapture(e.pointerId);
    return;
  }
  const at = placement(e);
  if (!at) return;
  checkpoint();
  let obj;
  if (tool === 'box') {
    obj = { id: newId(), x: at.x, z: at.z, y: at.y, w: newSize.w, d: newSize.d, h: newSize.h, kind: newKind };
    map.boxes.push(obj);
  } else if (tool === 'pad') {
    obj = { id: newId(), x: at.x, y: at.y, z: at.z, radius: 1.2 };
    map.pads.push(obj);
  } else {
    obj = { id: newId(), x: at.x, y: at.y, z: at.z, yaw: nearestYaw(at) };
    map.spawns.push(obj);
  }
  selection = [{ type: tool, id: obj.id }];
  changed();
});

// New spawns face the middle of the map by default.
function nearestYaw(p) {
  const yaw = Math.atan2(p.x, p.z); // facing -dir toward origin: forward = (-sin, -cos)
  return Math.round(yaw / (Math.PI / 4)) * (Math.PI / 4);
}

renderer.domElement.addEventListener('pointermove', (e) => {
  lastPointer = e;
  if (drag) {
    const p = planePoint(e);
    if (!p) return;
    let dx = p.x - drag.start.x, dz = p.z - drag.start.z;
    if (!e.altKey) { dx = snap(dx); dz = snap(dz); }
    if (!drag.moved && (dx || dz)) { checkpoint(); drag.moved = true; }
    for (const o of drag.orig) { const obj = findObj(o.s); obj.x = round(o.x + dx); obj.z = round(o.z + dz); }
    sync();
    refreshProps();
    return;
  }
  updateGhost(e);
  status(e);
});
renderer.domElement.addEventListener('pointerup', () => { if (drag?.moved) changed(); drag = null; });
renderer.domElement.addEventListener('pointerleave', () => { if (ghost) ghost.visible = false; });

function updateGhost(e) {
  if (!ghost) return;
  const at = placement(e);
  ghost.visible = !!at;
  if (!at) return;
  if (tool === 'box') ghost.position.set(at.x, at.y + newSize.h / 2, at.z);
  else ghost.position.set(at.x, at.y, at.z);
  if (tool === 'spawn') ghost.rotation.y = nearestYaw(at);
}

// ---------- selection + editing ----------
function select(list) {
  selection = list;
  sync();
  refreshProps();
}

function selectedObjs() { return selection.map((s) => ({ s, o: findObj(s) })).filter((x) => x.o); }

function moveSelection(dx, dy, dz) {
  if (!selection.length) return;
  checkpoint();
  for (const { o } of selectedObjs()) { o.x = round(o.x + dx); o.y = round(o.y + dy); o.z = round(o.z + dz); }
  changed();
}

function rotateSelection() {
  if (!selection.length) return;
  checkpoint();
  for (const { s, o } of selectedObjs()) {
    if (s.type === 'box') [o.w, o.d] = [o.d, o.w];
    else if (s.type === 'spawn') o.yaw = round(o.yaw - Math.PI / 4);
    else if (o.dir) o.dir = { x: round(-o.dir.z), z: round(o.dir.x) };
  }
  changed();
}

function deleteSelection() {
  if (!selection.length) return;
  checkpoint();
  const ids = new Set(selection.map((s) => s.id));
  map.boxes = map.boxes.filter((o) => !ids.has(o.id));
  map.pads = map.pads.filter((o) => !ids.has(o.id));
  map.spawns = map.spawns.filter((o) => !ids.has(o.id));
  selection = [];
  changed();
}

function duplicateSelection() {
  if (!selection.length) return;
  checkpoint();
  const copies = [];
  for (const { s, o } of selectedObjs()) {
    const c = JSON.parse(JSON.stringify(o));
    c.id = newId();
    c.x = round(c.x + (s.type === 'box' ? o.w : 2));
    (s.type === 'box' ? map.boxes : s.type === 'pad' ? map.pads : map.spawns).push(c);
    copies.push({ type: s.type, id: c.id });
  }
  selection = copies;
  changed();
  toast(`Duplicated ${copies.length}`);
}

function focusSelection() {
  const objs = selectedObjs();
  if (!objs.length) return;
  const c = new THREE.Vector3();
  for (const { o } of objs) c.add(new THREE.Vector3(o.x, o.y + (o.h ?? 1) / 2, o.z));
  c.divideScalar(objs.length);
  const off = camera.position.clone().sub(controls.target).setLength(28);
  controls.target.copy(c);
  camera.position.copy(c).add(off);
}

// ---------- properties panel ----------
const props = $('[data-props]');
let propsKey = '';

function field(label, f, value, step = 0.5, extra = '') {
  return `<label class="prop${extra}">${label}<input type="number" step="${step}" data-f="${f}" value="${value}"></label>`;
}

function refreshProps() {
  const objs = selectedObjs();
  const key = objs.map((x) => x.s.id).join(',') + '|' + objs.map((x) => (x.o.dir ? 'd' : '')).join('');
  if (key !== propsKey) {
    propsKey = key;
    props.innerHTML = buildProps(objs);
  }
  // Update values in place (keeps focus/typing intact).
  if (objs.length !== 1) return;
  const o = objs[0].o;
  for (const input of props.querySelectorAll('[data-f]')) {
    if (input === document.activeElement) continue;
    const f = input.dataset.f;
    const v = f === 'yawDeg' ? Math.round((-o.yaw * 180) / Math.PI) % 360
      : f === 'dirDeg' ? (o.dir ? Math.round((Math.atan2(o.dir.x, -o.dir.z) * 180) / Math.PI) : 0)
      : f === 'top' ? round(o.y + o.h)
      : f === 'launch' ? (o.launch ?? '')
      : o[f];
    if (input.tagName === 'SELECT') input.value = v; else input.value = v ?? '';
  }
}

function buildProps(objs) {
  if (!objs.length) return '';
  const btns = `<div class="prop-btns"><button type="button" data-act="dup">Duplicate</button><button type="button" data-act="del" class="danger">Delete</button></div>`;
  if (objs.length > 1) {
    const hasBox = objs.some((x) => x.s.type === 'box');
    return `<div class="prop-title">${objs.length} selected</div><div class="prop-sub">Multi-select</div>
      ${hasBox ? `<label class="prop">Set kind for all boxes<select data-multikind>${KINDS.map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></label>` : ''}
      ${btns}<div class="prop-note">Arrows / PgUp / PgDn move them all. Drag any of them to move the group.</div>`;
  }
  const { s } = objs[0];
  if (s.type === 'box') {
    return `<div class="prop-title">Box</div><div class="prop-sub">Position &amp; size (m)</div>
      <div class="prop-grid">${field('X', 'x', 0)}${field('Bottom Y', 'y', 0)}${field('Z', 'z', 0)}
      ${field('Width', 'w', 0)}${field('Height', 'h', 0)}${field('Depth', 'd', 0)}</div>
      <div class="prop-grid two" style="margin-top:8px">${field('Top Y', 'top', 0)}
      <label class="prop">Kind<select data-f="kind">${KINDS.map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></label></div>
      ${btns}<div class="prop-note">R swaps width and depth. Top Y is where you stand on it.</div>`;
  }
  if (s.type === 'pad') {
    const o = objs[0].o;
    return `<div class="prop-title">Jump Pad</div><div class="prop-sub">Launcher</div>
      <div class="prop-grid">${field('X', 'x', 0)}${field('Y', 'y', 0)}${field('Z', 'z', 0)}</div>
      <div class="prop-grid two" style="margin-top:8px">${field('Radius', 'radius', 0, 0.1)}
      <label class="prop">Launch up<input type="number" step="1" data-f="launch" placeholder="${JUMP_PAD.launch}"></label></div>
      <label class="prop-check"><input type="checkbox" data-dirtoggle ${o.dir ? 'checked' : ''}>Directional (flings you forward)</label>
      ${o.dir ? `<div class="prop-grid two">${field('Direction °', 'dirDeg', 0, 45)}${field('Forward speed', 'forward', 0, 1)}</div>` : ''}
      ${btns}<div class="prop-note">Launch ${JUMP_PAD.launch} ≈ 6.5 m high. Directional pads point along the arrow; R turns them 90°.</div>`;
  }
  return `<div class="prop-title">Spawn</div><div class="prop-sub">Player start</div>
    <div class="prop-grid">${field('X', 'x', 0)}${field('Y', 'y', 0)}${field('Z', 'z', 0)}</div>
    <div class="prop-grid two" style="margin-top:8px">${field('Facing °', 'yawDeg', 0, 45)}</div>
    ${btns}<div class="prop-note">The nose shows which way you face. R turns 45°. The first spawn is where Test Play starts you.</div>`;
}

props.addEventListener('change', (e) => {
  const objs = selectedObjs();
  if (!objs.length) return;
  const t = e.target;
  if (t.matches('[data-multikind]')) {
    checkpoint();
    for (const { s, o } of objs) if (s.type === 'box') o.kind = t.value;
    changed();
    return;
  }
  const o = objs[0].o;
  if (t.matches('[data-dirtoggle]')) {
    checkpoint();
    if (t.checked) { o.dir = { x: 0, z: -1 }; o.forward = 18; } else { delete o.dir; delete o.forward; }
    changed();
    return;
  }
  const f = t.dataset.f;
  if (!f) return;
  checkpoint();
  if (f === 'kind') o.kind = t.value;
  else {
    const v = parseFloat(t.value);
    if (f === 'launch') { if (Number.isFinite(v)) o.launch = v; else delete o.launch; }
    else if (!Number.isFinite(v)) { undoStack.pop(); refreshProps(); return; }
    else if (f === 'yawDeg') o.yaw = round((-v * Math.PI) / 180);
    else if (f === 'dirDeg') { const a = (v * Math.PI) / 180; o.dir = { x: round(Math.sin(a)), z: round(-Math.cos(a)) }; }
    else if (f === 'top') o.y = round(v - o.h);
    else if (['w', 'd', 'h', 'radius'].includes(f)) o[f] = Math.max(0.1, v);
    else o[f] = v;
  }
  changed();
});
props.addEventListener('click', (e) => {
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act === 'dup') duplicateSelection();
  if (act === 'del') deleteSelection();
});

// ---------- left panel ----------
$('[data-kinds]').innerHTML = KINDS.map(([k, l]) =>
  `<button type="button" class="kind" data-kind="${k}"><i style="background:#${(COLORS[k] ?? 0x888888).toString(16).padStart(6, '0')}"></i>${l}</button>`).join('');
function refreshKinds() {
  for (const b of document.querySelectorAll('[data-kind]')) b.classList.toggle('on', b.dataset.kind === newKind);
}
document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-tool]');
  if (t) setTool(t.dataset.tool);
  const k = e.target.closest('[data-kind]');
  if (k) {
    newKind = k.dataset.kind;
    refreshKinds();
    if (tool !== 'box') setTool('box'); else rebuildGhost();
  }
  const c = e.target.closest('[data-cmd]');
  if (c) commands[c.dataset.cmd]?.();
});
for (const input of document.querySelectorAll('[data-new]')) {
  input.value = newSize[input.dataset.new];
  input.addEventListener('change', () => {
    const v = parseFloat(input.value);
    if (Number.isFinite(v) && v > 0) newSize[input.dataset.new] = v;
    input.value = newSize[input.dataset.new];
    if (tool !== 'box') setTool('box'); else rebuildGhost();
  });
}

function refreshStats() {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const b of map.boxes) {
    minX = Math.min(minX, b.x - b.w / 2); maxX = Math.max(maxX, b.x + b.w / 2);
    minZ = Math.min(minZ, b.z - b.d / 2); maxZ = Math.max(maxZ, b.z + b.d / 2);
  }
  const size = map.boxes.length ? `${round(maxX - minX)} × ${round(maxZ - minZ)} m` : '—';
  const sp = map.spawns.length;
  $('[data-stats]').innerHTML = `<b>${map.boxes.length}</b> boxes · <b>${map.pads.length}</b> pads · <b>${sp}</b> spawns<br>Size ${size}` +
    (sp < 8 ? `<br><span class="warn">Free-for-all wants 8+ spawns spread around</span>` : '');
}

// ---------- commands ----------
const nameInput = $('[data-map-name]');
nameInput.addEventListener('input', () => { map.name = nameInput.value.slice(0, 32) || 'Untitled'; changed(); });

function download(name, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
const slug = () => (map.name || 'map').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'map';

const commands = {
  new() {
    if (!confirm('Start a new map? (Your current one is replaced; Ctrl+Z brings it back.)')) return;
    checkpoint();
    map = withIds(defaultMap());
    selection = [];
    nameInput.value = map.name;
    changed();
  },
  import() { $('[data-file]').click(); },
  export() {
    download(`${slug()}.json`, JSON.stringify(exportMap(), null, 1));
    toast('Exported. Send the .json file over!');
  },
  async copy() {
    try { await navigator.clipboard.writeText(JSON.stringify(exportMap())); toast('Map JSON copied'); }
    catch { toast('Copy blocked, use Export instead'); }
  },
  play() {
    try { localStorage.setItem(TEST_KEY, JSON.stringify(exportMap())); } catch { toast('Could not save the test map'); return; }
    window.open('index.html?testmap=1', 'movement-shooter-testplay');
    toast(map.spawns.length ? 'Opened Test Play in a new tab' : 'No spawn! You start at 0, 0');
  },
  help() { $('[data-help]').classList.toggle('hidden'); },
};

$('[data-file]').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    if (!Array.isArray(data.boxes)) throw new Error('no boxes');
    checkpoint();
    map = withIds(data);
    selection = [];
    nameInput.value = map.name;
    changed();
    toast(`Loaded ${map.name}`);
  } catch {
    toast("That file isn't a map");
  }
});

let toastTimer = 0;
function toast(text) {
  const el = $('[data-toast]');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
}

function status(e) {
  let pos = '';
  if (e) {
    const hit = pick(e);
    if (hit) pos = `<b>${round(hit.point.x).toFixed(1)}, ${round(hit.point.y).toFixed(1)}, ${round(hit.point.z).toFixed(1)}</b> · `;
  }
  const hints = {
    select: 'Click to select · drag to move · Shift+click adds',
    box: 'Click floor/top to place · click a side to stack against it · Alt = no snap',
    pad: 'Click a surface to place a jump pad',
    spawn: 'Click a surface to place a spawn (faces the middle)',
  };
  $('[data-status]').innerHTML = `${pos}${hints[tool]} · Right-drag orbit · Middle/WASD pan · <b>?</b> help`;
}

// ---------- keyboard ----------
const held = new Set();
window.addEventListener('keydown', (e) => {
  if (e.target instanceof Element && e.target.closest('input, select, textarea')) {
    if (e.key === 'Enter') e.target.blur();
    return;
  }
  const k = e.key.toLowerCase();
  const ctrl = e.ctrlKey || e.metaKey;
  if (ctrl && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (ctrl && k === 'y') { e.preventDefault(); redo(); return; }
  if (ctrl && k === 'd') { e.preventDefault(); duplicateSelection(); return; }
  if (ctrl && k === 's') { e.preventDefault(); commands.export(); return; }
  if (ctrl) return;
  if (['w', 'a', 's', 'd'].includes(k)) { held.add(k); return; }
  if (k === 'v') setTool('select');
  else if (k === 'b') setTool('box');
  else if (k === 'p') setTool('pad');
  else if (k === 'n') setTool('spawn');
  else if (k === 'r') rotateSelection();
  else if (k === 'f') focusSelection();
  else if (k === 'escape') { if (!$('[data-help]').classList.contains('hidden')) commands.help(); else select([]); }
  else if (k === 'delete' || k === 'backspace') { e.preventDefault(); deleteSelection(); }
  else if (k === 'pageup') { e.preventDefault(); moveSelection(0, GRID, 0); }
  else if (k === 'pagedown') { e.preventDefault(); moveSelection(0, -GRID, 0); }
  else if (k === '?' || k === 'h') commands.help();
  else if (k.startsWith('arrow')) {
    e.preventDefault();
    // Arrows move relative to the camera, snapped to the nearest world axis.
    const fwd = new THREE.Vector3();
    camera.getWorldDirection(fwd);
    let ax = Math.abs(fwd.x) > Math.abs(fwd.z) ? { x: Math.sign(fwd.x), z: 0 } : { x: 0, z: Math.sign(fwd.z) };
    const right = { x: -ax.z, z: ax.x };
    const step = e.shiftKey ? 2 : GRID;
    if (k === 'arrowdown') ax = { x: -ax.x, z: -ax.z };
    if (k === 'arrowleft') ax = { x: -right.x, z: -right.z };
    if (k === 'arrowright') ax = right;
    moveSelection(ax.x * step, 0, ax.z * step);
  }
});
window.addEventListener('keyup', (e) => held.delete(e.key.toLowerCase()));
window.addEventListener('blur', () => held.clear());

// ---------- loop ----------
function resize() {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

let last = performance.now();
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (held.size) {
    const fwd = new THREE.Vector3();
    camera.getWorldDirection(fwd);
    fwd.y = 0; fwd.normalize();
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const move = new THREE.Vector3();
    if (held.has('w')) move.add(fwd);
    if (held.has('s')) move.sub(fwd);
    if (held.has('d')) move.add(right);
    if (held.has('a')) move.sub(right);
    const speed = camera.position.distanceTo(controls.target) * 1.2;
    move.setLength(speed * dt);
    camera.position.add(move);
    controls.target.add(move);
  }
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}

nameInput.value = map.name;
refreshKinds();
setTool('select');
changed();
requestAnimationFrame(loop);
// editor.html?map=bean-street opens a built-in map from maps/ (Ctrl+Z goes back to yours).
const builtIn = new URLSearchParams(location.search).get('map');
if (builtIn && /^[a-z0-9-]+$/.test(builtIn)) {
  fetch(`maps/${builtIn}.json`, { cache: 'no-store' })
    .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then((data) => {
      checkpoint();
      map = withIds(data);
      selection = [];
      nameInput.value = map.name;
      changed();
      toast(`Opened ${map.name} · Ctrl+Z to get your old map back`);
      history.replaceState(null, '', location.pathname); // a refresh keeps your edits instead of reloading it
    })
    .catch(() => toast(`Couldn't find the map "${builtIn}"`));
}
if (!localStorage.getItem(SAVE_KEY + '.seenHelp')) {
  commands.help();
  try { localStorage.setItem(SAVE_KEY + '.seenHelp', '1'); } catch { /* ignore */ }
}
