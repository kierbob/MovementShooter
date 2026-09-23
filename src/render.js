import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { toonGradient } from './particles.js';

// Graphics quality: render resolution (pixel ratio) and shadow detail — the two big GPU costs.
export const QUALITY = {
  high: { label: 'High', pixelRatio: 2, shadowSize: 2048, softShadows: true },
  balanced: { label: 'Balanced', pixelRatio: 1.5, shadowSize: 2048, softShadows: false },
  performance: { label: 'Performance', pixelRatio: 1, shadowSize: 1024, softShadows: false },
};

// Bold cartoon palette.
const COLORS = {
  floor: 0x56648a,
  wall: 0x8fa3cc,
  block: 0xa77be0,
  stair: 0xf0b650,
  pillar: 0x4fcf92,
  low: 0xf0766a,
  test: 0xffd35a,
  plat: 0x52aef5,
  trialfloor: 0x6f7fb0,
  arenafloor: 0x5d6f96,
  gate: 0xff5ab4,
};

// A 4x4 grid texture; one cell = 1 m so distances and heights are readable.
function gridTexture() {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, size, size);
  g.strokeStyle = 'rgba(0,0,0,0.12)';
  g.lineWidth = 2;
  for (let i = 0; i <= 4; i++) {
    const p = (i * size) / 4;
    g.beginPath(); g.moveTo(p, 0); g.lineTo(p, size); g.stroke();
    g.beginPath(); g.moveTo(0, p); g.lineTo(size, p); g.stroke();
  }
  g.strokeStyle = 'rgba(0,0,0,0.35)';
  g.lineWidth = 6;
  g.strokeRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

// BoxGeometry with UVs scaled to world size so the grid is 1 m everywhere.
function boxGeometry(w, h, d) {
  const geo = new THREE.BoxGeometry(w, h, d);
  const uv = geo.attributes.uv;
  const faceSize = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]]; // +x -x +y -y +z -z
  for (let f = 0; f < 6; f++) {
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v;
      uv.setXY(i, (uv.getX(i) * faceSize[f][0]) / 4, (uv.getY(i) * faceSize[f][1]) / 4);
    }
  }
  return geo;
}

// Lighting presets. sky = [top, bottom] gradient; sunDir = where the sun sits relative to you
// (low y = long shadows); hemi = ambient sky/ground light; exposure = overall brightness.
// cloud = cartoon cloud tint; sunDisc = color of the sun glow in the sky.
// Fog is a very distant haze in the sky's horizon color: nothing in a normal fight is touched,
// but far walls and the map edge melt softly into the sky.
export const LIGHTING = {
  sunny: {
    label: 'Sunny Toon', sky: ['#3aa6ff', '#bfeaff'], fog: 0xbfeaff, fogNear: 55, fogFar: 300,
    hemiSky: 0xeef8ff, hemiGround: 0x6e5c86, hemi: 1.55, sun: 0xfff1d6, sunI: 2.6, sunDir: [35, 60, 25], exposure: 1,
    cloud: 0xffffff, sunDisc: 0xfff6cf,
  },
  pastel: {
    label: 'Candy Pastel', sky: ['#ff9fd8', '#a9e6ff'], fog: 0xb9dcff, fogNear: 55, fogFar: 300,
    hemiSky: 0xfff2ff, hemiGround: 0x9a80c8, hemi: 1.8, sun: 0xfff6fb, sunI: 2.1, sunDir: [25, 65, 30], exposure: 1.05,
    cloud: 0xfff0fb, sunDisc: 0xffffff,
  },
  arcade: {
    label: 'Arcade Punch', sky: ['#1452ff', '#6fd2ff'], fog: 0x6fd2ff, fogNear: 60, fogFar: 320,
    hemiSky: 0xffffff, hemiGround: 0x3b2470, hemi: 1.05, sun: 0xffffff, sunI: 3.8, sunDir: [40, 55, -30], exposure: 1.02,
    cloud: 0xffffff, sunDisc: 0xfffbe6,
  },
};

// Chunky low-poly cartoon clouds on a ring high above; the ring follows the camera like a skybox.
function makeClouds() {
  const group = new THREE.Group();
  const mat = new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: toonGradient(), fog: false });
  const geo = new THREE.IcosahedronGeometry(1, 1);
  const rnd = (a, b) => a + Math.random() * (b - a);
  for (let i = 0; i < 16; i++) {
    const cloud = new THREE.Group();
    const puffs = 4 + Math.floor(Math.random() * 4);
    for (let j = 0; j < puffs; j++) {
      const m = new THREE.Mesh(geo, mat);
      const s = rnd(6, 11) * (j === 0 ? 1.3 : 1);
      m.scale.set(s, s * 0.75, s);
      m.position.set((j - puffs / 2) * rnd(6, 9), rnd(-1, 3), rnd(-4, 4));
      cloud.add(m);
    }
    const a = (i / 16) * Math.PI * 2 + rnd(-0.15, 0.15);
    const r = rnd(230, 320);
    cloud.position.set(Math.cos(a) * r, rnd(55, 95), Math.sin(a) * r);
    cloud.rotation.y = -a + Math.PI / 2;
    group.add(cloud);
  }
  return { group, mat };
}

// Cartoon birds: little dark "V" silhouettes in loose flocks, flapping and circling high up.
function makeBirds() {
  const group = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: 0x3a2f5a, side: THREE.DoubleSide, fog: false });
  // One wing: a thin swept triangle hinged at the body (x = 0).
  const wing = new THREE.BufferGeometry();
  wing.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, -0.35, 0, 0, 0.35, 1.6, 0.15, 0.25], 3));
  wing.computeVertexNormals();
  const body = new THREE.SphereGeometry(0.28, 8, 6);
  const flocks = [];
  const rnd = (a, b) => a + Math.random() * (b - a);
  for (let f = 0; f < 4; f++) {
    const flock = new THREE.Group();
    const birds = [];
    const n = 3 + Math.floor(Math.random() * 4);
    for (let i = 0; i < n; i++) {
      const bird = new THREE.Group();
      const b = new THREE.Mesh(body, mat);
      b.scale.set(1, 0.8, 1.8);
      const left = new THREE.Mesh(wing, mat);
      const right = new THREE.Mesh(wing, mat);
      right.scale.x = -1;
      bird.add(b, left, right);
      // V-formation-ish offsets
      const row = Math.ceil(i / 2), side = i % 2 ? 1 : -1;
      bird.position.set(side * row * rnd(3, 4), rnd(-1, 1), row * rnd(3, 4));
      bird.scale.setScalar(rnd(1.3, 1.7));
      flock.add(bird);
      birds.push({ left, right, phase: Math.random() * Math.PI * 2, speed: rnd(7, 9) });
    }
    group.add(flock);
    flocks.push({
      flock, birds, radius: rnd(90, 170), height: rnd(40, 70), angle: Math.random() * Math.PI * 2,
      turn: rnd(0.025, 0.05) * (Math.random() < 0.5 ? -1 : 1), bob: Math.random() * 10,
    });
  }
  function update(dt, t) {
    for (const f of flocks) {
      f.angle += f.turn * dt;
      f.flock.position.set(Math.cos(f.angle) * f.radius, f.height + Math.sin(t * 0.4 + f.bob) * 2, Math.sin(f.angle) * f.radius);
      // face along the circle (direction of travel)
      f.flock.rotation.y = -f.angle + (f.turn > 0 ? Math.PI : 0);
      for (const b of f.birds) {
        const flap = Math.sin(t * b.speed + b.phase) * 0.6;
        b.left.rotation.z = flap;
        b.right.rotation.z = -flap;
      }
    }
  }
  return { group, update };
}

// Soft round sun glow placed far away in the sun's direction.
function makeSunDisc() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.28, 'rgba(255,255,255,1)');
  grad.addColorStop(0.34, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, fog: false, depthWrite: false, transparent: true }));
  s.scale.setScalar(90);
  s.renderOrder = -2;
  return s;
}

function skyTexture(top, bottom) {
  const c = document.createElement('canvas');
  c.width = 2; c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, top);
  grad.addColorStop(1, bottom);
  g.fillStyle = grad;
  g.fillRect(0, 0, 2, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createRenderer(boxes) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  // Linear at exposure 1 looks the same as no tone mapping; presets nudge the exposure.
  renderer.toneMapping = THREE.LinearToneMapping;
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x8ed2ff, 70, 170);

  const camera = new THREE.PerspectiveCamera(80, window.innerWidth / window.innerHeight, 0.05, 500);
  camera.rotation.order = 'YXZ';

  const hemi = new THREE.HemisphereLight(0xeaf6ff, 0x6a5a7a, 1.6);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff4e0, 2.4);
  sun.position.set(30, 60, 20);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -50, right: 50, top: 50, bottom: -50, near: 1, far: 150 });
  sun.shadow.bias = -0.0005;
  scene.add(sun);

  // The map never moves, so every box of the same kind is merged into ONE mesh:
  // ~12 draw calls (and ~12 shadow draws) instead of one per box.
  const tex = gridTexture();
  const byKind = {};
  for (const b of boxes) {
    const w = b.max.x - b.min.x, h = b.max.y - b.min.y, d = b.max.z - b.min.z;
    const geo = boxGeometry(w, h, d);
    geo.translate((b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2, (b.min.z + b.max.z) / 2);
    (byKind[b.kind] ??= []).push(geo);
  }
  for (const [kind, geos] of Object.entries(byKind)) {
    const mat = new THREE.MeshToonMaterial({ color: COLORS[kind] ?? 0x888888, map: tex, gradientMap: toonGradient() });
    const mesh = new THREE.Mesh(mergeGeometries(geos), mat);
    geos.forEach((g) => g.dispose());
    mesh.castShadow = kind !== 'floor' && kind !== 'trialfloor' && kind !== 'arenafloor';
    mesh.receiveShadow = true;
    scene.add(mesh);
  }

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  scene.add(sun.target);

  const clouds = makeClouds();
  scene.add(clouds.group);
  const birds = makeBirds();
  scene.add(birds.group);
  const sunDisc = makeSunDisc();
  scene.add(sunDisc);
  let skyTime = 0;

  // Sky decorations follow the camera so they always look infinitely far away.
  // Clouds slowly drift around the sky and bob; birds circle and flap.
  function updateSky(cam, dt = 0) {
    skyTime += dt;
    clouds.group.position.set(cam.position.x, Math.sin(skyTime * 0.15) * 1.5, cam.position.z);
    clouds.group.rotation.y += dt * 0.006;
    birds.group.position.set(cam.position.x, 0, cam.position.z);
    birds.update(dt, skyTime);
    const d = lighting.preset.sunDir;
    const l = Math.hypot(d[0], d[1], d[2]);
    sunDisc.position.set(cam.position.x + (d[0] / l) * 400, cam.position.y + (d[1] / l) * 400, cam.position.z + (d[2] / l) * 400);
  }

  // Swap the whole look. Returns the preset so the viewmodel can match it.
  const skies = {};
  const lighting = { preset: LIGHTING.sunny };
  function applyLighting(id) {
    const L = LIGHTING[id] ?? LIGHTING.sunny;
    lighting.preset = L;
    clouds.mat.color.setHex(L.cloud);
    sunDisc.material.color.setHex(L.sunDisc);
    scene.background = (skies[id] ??= skyTexture(L.sky[0], L.sky[1]));
    scene.fog.color.setHex(L.fog);
    scene.fog.near = L.fogNear;
    scene.fog.far = L.fogFar;
    hemi.color.setHex(L.hemiSky);
    hemi.groundColor.setHex(L.hemiGround);
    hemi.intensity = L.hemi;
    sun.color.setHex(L.sun);
    sun.intensity = L.sunI;
    renderer.toneMappingExposure = L.exposure;
    return L;
  }
  applyLighting('sunny');

  function applyQuality(id) {
    const Q = QUALITY[id] ?? QUALITY.balanced;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, Q.pixelRatio));
    renderer.setSize(window.innerWidth, window.innerHeight);
    const type = Q.softShadows ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    if (renderer.shadowMap.type !== type || sun.shadow.mapSize.x !== Q.shadowSize) {
      renderer.shadowMap.type = type;
      sun.shadow.mapSize.set(Q.shadowSize, Q.shadowSize);
      sun.shadow.map?.dispose();
      sun.shadow.map = null; // rebuilt at the new size on the next frame
      scene.traverse((o) => { if (o.material) [].concat(o.material).forEach((m) => { m.needsUpdate = true; }); });
    }
  }

  return { renderer, scene, camera, sun, applyLighting, lighting, updateSky, applyQuality };
}
