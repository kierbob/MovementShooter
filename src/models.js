// Loads .glb models and gives them the game's cartoon look (toon shading + black outlines).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { toonGradient } from './particles.js';
import { objectOutline, smoothShell } from './outline.js';

// First-person gun models (assets/models/weapons). The model is auto-fitted:
//   length   how long the gun should be in viewmodel space (bigger = chunkier on screen)
//   flip     true if the model's barrel points toward +Z (we want it toward -Z)
//   offset   [x, y, z] nudge after fitting
export const VIEWMODELS = {
  shotgun: { file: 'boomstick.glb', length: 0.55, flip: false, offset: [0, 0, 0] },
  rifle: { file: 'puslerifle.glb', length: 0.64, flip: false, offset: [0, 0, 0] },
  rocket: { file: 'rocketlauncher.glb', length: 0.72, flip: false, offset: [0.03, 0, 0] },
  pistol: { file: 'sidearm.glb', length: 0.34, flip: false, offset: [0, 0, 0] },
  smg: { file: 'buzzsmg.glb', length: 0.5, flip: false, offset: [0, 0, 0] },
  kickpistol: { file: 'kickpistol.glb', length: 0.4, flip: false, offset: [0, 0, 0] },
  sniper: { file: 'sniper.glb', length: 0.8, flip: false, offset: [0, 0, 0] },
  deagle: { file: 'deagle.glb', length: 0.36, flip: false, offset: [0, 0, 0] },
};

const loader = new GLTFLoader();

// Swap PBR materials for toon ones (keeps the colormap texture) and add outlines.
export function toonify(root, outlineThickness) {
  const meshes = [];
  root.traverse((o) => { if (o.isMesh) meshes.push(o); });
  const outline = outlineThickness > 0 ? objectOutline(outlineThickness) : null;
  for (const mesh of meshes) {
    const old = mesh.material;
    if (old.map) {
      old.map.magFilter = THREE.NearestFilter; // palette textures stay crisp
      old.map.minFilter = THREE.NearestFilter;
      old.map.generateMipmaps = false;
    }
    mesh.material = new THREE.MeshToonMaterial({
      map: old.map ?? null, color: old.color ?? 0xffffff, gradientMap: toonGradient(),
    });
    if (outline) {
      const o = new THREE.Mesh(smoothShell(mesh.geometry), outline);
      o.renderOrder = -1;
      mesh.add(o);
    }
  }
  return root;
}

// Third-person gun (held by bots): centered, `length` long, barrel along +Z (the way beans face).
// Returns a group you can clone for each bot.
export async function loadHeldGun(file, length) {
  const gltf = await loader.loadAsync(`assets/models/weapons/${file}`);
  const model = gltf.scene;
  const holder = new THREE.Group();
  holder.add(model);
  model.rotation.y = Math.PI; // Kenney barrels point -Z
  holder.updateMatrixWorld(true);
  let box = new THREE.Box3().setFromObject(model);
  const s = length / Math.max(box.getSize(new THREE.Vector3()).z, 1e-3);
  model.scale.multiplyScalar(s);
  holder.updateMatrixWorld(true);
  box = new THREE.Box3().setFromObject(model);
  model.position.sub(box.getCenter(new THREE.Vector3()));
  toonify(model, 0.012 / s);
  model.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return holder;
}

// Load a viewmodel and fit it: barrel along -Z, back end near the camera-side origin,
// sized to cfg.length. Returns { object, muzzle } (muzzle in the fitted object's space).
export async function loadViewmodel(cfg) {
  const gltf = await loader.loadAsync(`assets/models/weapons/${cfg.file}`);
  const model = gltf.scene;
  if (cfg.flip) model.rotation.y = Math.PI;

  const holder = new THREE.Group();
  holder.add(model);
  holder.updateMatrixWorld(true);
  let box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const s = cfg.length / Math.max(size.z, 1e-3);
  model.scale.multiplyScalar(s);
  holder.updateMatrixWorld(true);
  box = new THREE.Box3().setFromObject(model);

  // Center on X, top of the gun a bit above the holder, back of the gun at z = +0.12.
  // (The holder itself sits low-right of the camera, so this lands the gun in the corner.)
  const c = box.getCenter(new THREE.Vector3());
  model.position.x -= c.x;
  model.position.y -= box.max.y - 0.11;
  model.position.z -= box.max.z - 0.12;
  model.position.x += cfg.offset[0];
  model.position.y += cfg.offset[1];
  model.position.z += cfg.offset[2];
  holder.updateMatrixWorld(true);
  box = new THREE.Box3().setFromObject(model);

  toonify(model, 0.0035 / s);
  const muzzle = new THREE.Vector3(0, box.max.y - (box.max.y - box.min.y) * 0.3, box.min.z);
  // Angle the barrel slightly in toward the crosshair so you see the gun's side.
  const cant = 0.08;
  holder.rotation.y = cant;
  muzzle.applyAxisAngle(new THREE.Vector3(0, 1, 0), cant);
  return { object: holder, muzzle };
}
