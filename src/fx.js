// Everything visual for combat: bean dummies, jump pads, projectiles, tracers, explosions,
// and the first-person viewmodel. Reads combat/player state; never changes it.
import * as THREE from 'three';
import { DUMMY_PARTS } from './combat.js';
import { PADS } from './world.js';
import { WEAPONS } from './items.js';
import { horizontalSpeed } from './player.js';
import { Particles, toonGradient } from './particles.js';
import { VIEWMODELS, loadViewmodel, loadHeldGun } from './models.js';

const BOT_GUN_FILE = 'buzzsmg.glb'; // what the bean bots carry (any file in assets/models/weapons)
import { addOutline } from './outline.js';

const rand = (a, b) => a + Math.random() * (b - a);
function randUnit() {
  const u = Math.random() * 2 - 1, t = Math.random() * Math.PI * 2, s = Math.sqrt(1 - u * u);
  return { x: s * Math.cos(t), y: u, z: s * Math.sin(t) };
}

// Jagged polygon helper for the cartoon textures.
function jagged(g, points, rOuter, rInner) {
  g.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 ? rInner * rand(0.85, 1.1) : rOuter * rand(0.9, 1.1);
    const a = (i / (points * 2)) * Math.PI * 2;
    g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  g.closePath();
}

// Cartoon bullet hole: dark splotch, pale rim, a few cracks.
function bulletHoleTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.translate(64, 64);
  g.strokeStyle = '#1b1d28'; g.lineWidth = 5; g.lineCap = 'round';
  for (let i = 0; i < 5; i++) {
    const a = rand(0, Math.PI * 2);
    g.beginPath(); g.moveTo(Math.cos(a) * 26, Math.sin(a) * 26);
    g.lineTo(Math.cos(a + rand(-0.2, 0.2)) * rand(44, 58), Math.sin(a + rand(-0.2, 0.2)) * rand(44, 58)); g.stroke();
  }
  g.fillStyle = 'rgba(255,255,255,0.45)'; jagged(g, 9, 40, 30); g.fill();
  g.fillStyle = '#1b1d28'; jagged(g, 8, 30, 22); g.fill();
  g.fillStyle = '#05060a'; g.beginPath(); g.arc(0, 0, 11, 0, Math.PI * 2); g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Comic "action lines" radiating out from the muzzle on heavy shots.
function actionLinesTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.translate(128, 128);
  g.lineJoin = 'round';
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2 + rand(-0.1, 0.1);
    const r0 = rand(46, 64), r1 = rand(100, 124), w = rand(0.035, 0.06);
    g.beginPath();
    g.moveTo(Math.cos(a - w) * r0, Math.sin(a - w) * r0);
    g.lineTo(Math.cos(a) * r1, Math.sin(a) * r1);
    g.lineTo(Math.cos(a + w) * r0, Math.sin(a + w) * r0);
    g.closePath();
    g.fillStyle = '#fff6c0'; g.strokeStyle = '#15151f'; g.lineWidth = 5;
    g.stroke(); g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Comic-book "POW" star used for impacts and hits.
function starTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.translate(64, 64);
  g.lineJoin = 'round';
  g.fillStyle = '#ffffff'; g.strokeStyle = '#15151f'; g.lineWidth = 7;
  jagged(g, 8, 56, 26); g.fill(); g.stroke();
  g.fillStyle = '#ffffff'; jagged(g, 8, 30, 16); g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const SWITCH_TIME = 0.3;
const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.2, ...extra });

// ---------- viewmodels: simple guns built from boxes/cylinders, pointing down -Z ----------
function makeGun(id) {
  const g = new THREE.Group();
  const box = (w, h, d, x, y, z, c, extra) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), std(c, extra));
    m.position.set(x, y, z); g.add(m); return m;
  };
  const cyl = (r, l, x, y, z, c, extra) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, l, 14), std(c, extra));
    m.rotation.x = Math.PI / 2; m.position.set(x, y, z); g.add(m); return m;
  };
  const glow = (c) => ({ emissive: c, emissiveIntensity: 1.2 });
  switch (id) {
    case 'shotgun':
      box(0.1, 0.09, 0.36, 0, 0, -0.08, 0x4a3b2a);
      cyl(0.022, 0.42, -0.024, 0.02, -0.4, 0x2c2c2c);
      cyl(0.022, 0.42, 0.024, 0.02, -0.4, 0x2c2c2c);
      box(0.08, 0.05, 0.13, 0, -0.035, -0.32, 0x222222);
      box(0.07, 0.1, 0.2, 0, -0.03, 0.18, 0x6b4a2a);
      g.userData.muzzle = new THREE.Vector3(0, 0.02, -0.62);
      break;
    case 'rifle':
      box(0.07, 0.1, 0.44, 0, 0, -0.1, 0x3b4a66);
      cyl(0.018, 0.25, 0, 0.015, -0.44, 0x222222);
      box(0.05, 0.15, 0.07, 0, -0.11, -0.06, 0x222222);
      box(0.06, 0.08, 0.16, 0, -0.01, 0.2, 0x2b3448);
      box(0.03, 0.03, 0.09, 0, 0.065, -0.06, 0x6fa8ff, glow(0x3070ff));
      g.userData.muzzle = new THREE.Vector3(0, 0.015, -0.57);
      break;
    case 'rocket':
      cyl(0.075, 0.8, 0, 0.03, -0.14, 0x4d5b3a);
      cyl(0.09, 0.06, 0, 0.03, -0.54, 0x222222);
      cyl(0.085, 0.05, 0, 0.03, 0.25, 0x222222);
      box(0.04, 0.13, 0.05, 0, -0.1, 0.0, 0x222222);
      box(0.03, 0.05, 0.05, -0.08, 0.1, -0.12, 0xff6a3d, glow(0xff4a1d));
      g.userData.muzzle = new THREE.Vector3(0, 0.03, -0.58);
      g.userData.offset = [0.05, -0.02, 0];
      break;
    case 'pistol':
      box(0.05, 0.06, 0.2, 0, 0, -0.06, 0x2e3440);
      box(0.045, 0.13, 0.06, 0, -0.08, 0.02, 0x1e222a).rotation.x = -0.2;
      g.userData.muzzle = new THREE.Vector3(0, 0.01, -0.17);
      break;
    case 'smg':
      box(0.06, 0.08, 0.3, 0, 0, -0.06, 0x3a3f5a);
      cyl(0.015, 0.12, 0, 0.01, -0.26, 0x222222);
      box(0.04, 0.2, 0.05, 0, -0.13, -0.1, 0x222222);
      box(0.045, 0.11, 0.05, 0, -0.08, 0.05, 0x1e222a).rotation.x = -0.2;
      g.userData.muzzle = new THREE.Vector3(0, 0.01, -0.33);
      break;
    case 'kickpistol':
      box(0.07, 0.085, 0.25, 0, 0, -0.07, 0x5a3a2a);
      cyl(0.04, 0.06, 0, 0.005, -0.21, 0xff8a3d, glow(0xff5a1d));
      box(0.055, 0.14, 0.07, 0, -0.09, 0.03, 0x241a14).rotation.x = -0.2;
      g.userData.muzzle = new THREE.Vector3(0, 0.005, -0.25);
      break;
  }
  return g;
}

function makeProjectile(kind) {
  const g = new THREE.Group();
  if (kind === 'rocket') {
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.45, 10), std(0x55603f));
    body.rotation.x = Math.PI / 2; g.add(body);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.14, 10), std(0x333333));
    tip.rotation.x = Math.PI / 2; tip.position.z = 0.29; g.add(tip);
    const flame = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8),
      new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0.9 }));
    flame.position.z = -0.28; flame.scale.z = 2; g.add(flame);
  } else if (kind === 'frag') {
    g.add(new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 10), std(0x3b5d2a)));
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.02, 6, 16), std(0x222222));
    band.rotation.x = Math.PI / 2; g.add(band);
  } else if (kind === 'knife') {
    const spin = new THREE.Group();
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.008, 0.2), std(0xd8dee9, { metalness: 0.9, roughness: 0.2 }));
    blade.position.z = 0.06; spin.add(blade);
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.03, 0.1), std(0x2a1d14));
    handle.position.z = -0.09; spin.add(handle);
    g.add(spin); g.userData.spin = spin;
  } else if (kind === 'botshot') {
    // Big, bright and slow on purpose — you're meant to see it coming and dodge.
    g.add(new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), new THREE.MeshBasicMaterial({ color: 0xffd6f6 })));
    g.add(new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 10),
      new THREE.MeshBasicMaterial({ color: 0xff4fd8, transparent: true, opacity: 0.45, depthWrite: false })));
  } else if (kind === 'impulse') {
    g.add(new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 10), new THREE.MeshBasicMaterial({ color: 0x7ff6ff })));
    g.add(new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 10),
      new THREE.MeshBasicMaterial({ color: 0x38c8ff, transparent: true, opacity: 0.35, depthWrite: false })));
  }
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

const EXPLOSION_COLOR = { rocket: 0xff8a30, frag: 0xff7a20, impulse: 0x40d8ff };

export class FX {
  constructor(renderer, scene, camera, combat) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.combat = combat;
    this.time = 0;
    this.shake = 0;

    // Pooled lights — adding lights at runtime forces shader recompiles (stutter).
    this.flashLights = [0, 1].map(() => {
      const l = new THREE.PointLight(0xffa040, 0, 14, 2);
      scene.add(l);
      return { light: l, life: 0 };
    });
    this.nextLight = 0;
    this.muzzleLight = new THREE.PointLight(0xffd27a, 0, 8, 2);
    scene.add(this.muzzleLight);

    this.buildTargets();
    this.buildPads();
    this.projMeshes = new Map();
    this.tracers = [];
    this.bursts = []; // expanding shockwave rings: { mesh, life, max, from, to, opacity }
    this.particles = new Particles(scene);
    this.buildImpactPools();
    this.buildViewmodel();
    window.addEventListener('resize', () => {
      this.vmCamera.aspect = window.innerWidth / window.innerHeight;
      this.vmCamera.updateProjectionMatrix();
    });
  }

  // ---------- bean dummies & bots ----------
  // Views are made on demand (bots come and go) and keyed by target id.
  buildTargets() {
    this.partGeo = DUMMY_PARTS.map((part) => {
      const len = Math.hypot(part.b[0] - part.a[0], part.b[1] - part.a[1], part.b[2] - part.a[2]);
      return new THREE.CapsuleGeometry(part.r, len, 6, 14);
    });
    // Inverted-hull outlines: a slightly fatter capsule drawn back-faces-only in black.
    this.outlineGeo = DUMMY_PARTS.map((part) => {
      const len = Math.hypot(part.b[0] - part.a[0], part.b[1] - part.a[1], part.b[2] - part.a[2]);
      return new THREE.CapsuleGeometry(part.r + 0.022, len, 6, 14);
    });
    this.outlineMat = new THREE.MeshBasicMaterial({ color: 0x15151f, side: THREE.BackSide });
    this.eyeGeo = new THREE.SphereGeometry(0.032, 8, 6);
    this.eyeMat = new THREE.MeshBasicMaterial({ color: 0x151515 });
    this.targetViews = new Map();
    this.loadBotGun();
  }

  makeTargetView(t) {
    const remote = t.kind === 'remote';            // another player online
    const bot = t.kind === 'bot' || remote;         // anything that carries a gun
    const g = new THREE.Group();
    const body = remote ? new THREE.Color(t.color ?? 0x4fc3ff) : new THREE.Color(bot ? 0x9a6bff : 0xff8a3d);
    const head = remote ? body.clone().lerp(new THREE.Color(0xffffff), 0.3) : new THREE.Color(bot ? 0xc6a8ff : 0xffb35c);
    const bodyMat = new THREE.MeshToonMaterial({ color: body, gradientMap: toonGradient() });
    const headMat = new THREE.MeshToonMaterial({ color: head, gradientMap: toonGradient() });
    DUMMY_PARTS.forEach((part, i) => {
      const pos = [(part.a[0] + part.b[0]) / 2, (part.a[1] + part.b[1]) / 2, (part.a[2] + part.b[2]) / 2];
      const m = new THREE.Mesh(this.partGeo[i], part.zone === 'head' ? headMat : bodyMat);
      m.position.set(...pos);
      m.castShadow = true;
      const o = new THREE.Mesh(this.outlineGeo[i], this.outlineMat);
      o.position.set(...pos);
      g.add(m, o);
    });
    for (const x of [-0.065, 0.065]) {
      const e = new THREE.Mesh(this.eyeGeo, this.eyeMat);
      e.position.set(x * 1.15, 1.77, 0.185);
      g.add(e);
    }
    let botGun = null;
    if (bot) {
      // Angry brows (bots only) + a chunky toy blaster floating at the side.
      for (const s of remote ? [] : [-1, 1]) {
        const brow = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.022, 0.02), this.eyeMat);
        brow.position.set(s * 0.075, 1.84, 0.19);
        brow.rotation.z = s * -0.45;
        g.add(brow);
      }
      // Held gun: a simple placeholder until the real Kenney model has loaded (see update()).
      const gun = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.14, 0.42), new THREE.MeshToonMaterial({ color: 0x3a3f5a, gradientMap: toonGradient() }));
      addOutline(body);
      gun.add(body);
      gun.position.set(-0.52, 0.95, 0.3); // floats at the bean's side, Rayman-style
      g.add(gun);
      botGun = gun;
    }
    const bar = new THREE.Group();
    bar.position.y = 2.2;
    const bg = new THREE.Mesh(new THREE.PlaneGeometry(0.84, 0.1), new THREE.MeshBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.7 }));
    const fill = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.07), new THREE.MeshBasicMaterial({ color: 0x5ee06a }));
    fill.position.z = 0.001;
    bar.add(bg, fill);
    g.add(bar);
    // Online players get a floating name tag instead of a health bar (for now).
    let tag = null;
    if (remote) {
      bar.visible = false;
      tag = this.nameTag(t.name ?? 'Bean', t.color ?? 0x4fc3ff);
      tag.position.y = 2.3;
      g.add(tag);
    }
    this.scene.add(g);
    return { g, bodyMat, headMat, fill, bar, tag, flash: 0, gun: bot ? botGun : null, realGun: false };
  }

  nameTag(name, color) {
    const c = document.createElement('canvas');
    c.width = 512; c.height = 128;
    const draw = () => {
      const g = c.getContext('2d');
      g.clearRect(0, 0, 512, 128);
      g.font = "64px Bangers, 'Bebas Neue', sans-serif";
      g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
      g.lineWidth = 12; g.strokeStyle = '#15151f'; g.strokeText(name, 256, 64);
      g.fillStyle = '#' + new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.45).getHexString();
      g.fillText(name, 256, 64);
      tex.needsUpdate = true;
    };
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    draw();
    document.fonts?.ready.then(draw);
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    s.scale.set(2.4, 0.6, 1);
    return s;
  }

  // The gun bots carry. Loaded once, cloned into each bot's hand.
  loadBotGun() {
    loadHeldGun(BOT_GUN_FILE, 0.62)
      .then((m) => { this.botGunTemplate = m; })
      .catch((err) => console.warn('Bot gun model failed to load, keeping placeholder.', err));
    // World-size copies of every weapon, for the ones you chuck away when reloading.
    this.heldGuns = {};
    for (const [id, cfg] of Object.entries(VIEWMODELS)) {
      loadHeldGun(cfg.file, cfg.length * 1.1).then((m) => { this.heldGuns[id] = m; }).catch(() => {});
    }
    this.tossed = [];
  }

  // Reloading: the empty gun gets flung out to the right, spins, bounces and poofs away.
  tossGun(id, player) {
    const tpl = this.heldGuns?.[id];
    this.onSound?.('throw');
    if (Math.random() < 0.3) this.onWord?.(['YEET!', 'BYE!', 'TOSS!'][Math.floor(Math.random() * 3)], { screen: { x: 0.68, y: 0.62 } }, 'small');
    if (!tpl) return;
    const obj = tpl.clone();
    const cam = this.camera;
    const pos = cam.localToWorld(new THREE.Vector3(0.35, -0.2, -0.6));
    const q = cam.quaternion;
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
    obj.position.copy(pos);
    obj.quaternion.copy(q);
    const vel = fwd.multiplyScalar(3).add(right.multiplyScalar(rand(4, 6))).add(new THREE.Vector3(0, rand(4, 6), 0));
    vel.x += player.vel.x; vel.y += Math.max(0, player.vel.y); vel.z += player.vel.z;
    this.scene.add(obj);
    this.tossed.push({ obj, vel, spin: new THREE.Vector3(rand(-14, 14), rand(-8, 8), rand(-14, 14)), age: 0 });
    if (this.tossed.length > 6) this.removeTossed(this.tossed.shift());
  }

  removeTossed(t) {
    this.scene.remove(t.obj);
    this.particles.spawn({ pos: t.obj.position, life: 0.3, size: [0.2, 0.7], color: 0xffffff, opacity: [0.9, 0] });
    this.addStar(t.obj.position, 0.5, 0.12, 0xffffff);
  }

  updateTossed(dt) {
    this.tossed = (this.tossed ?? []).filter((t) => {
      t.age += dt;
      t.vel.y -= 20 * dt;
      const sp = t.vel.length();
      if (sp > 0.01) {
        const dir = { x: t.vel.x / sp, y: t.vel.y / sp, z: t.vel.z / sp };
        const hit = this.combat.raycast(t.obj.position, dir, sp * dt + 0.1, 0, false);
        if (hit) {
          // bounce off whatever it hit, losing energy
          const n = new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z);
          t.vel.reflect(n).multiplyScalar(0.45);
          t.spin.multiplyScalar(0.6);
          t.obj.position.set(hit.point.x + n.x * 0.1, hit.point.y + n.y * 0.1, hit.point.z + n.z * 0.1);
        } else {
          t.obj.position.addScaledVector(t.vel, dt);
        }
      }
      t.obj.rotation.x += t.spin.x * dt;
      t.obj.rotation.y += t.spin.y * dt;
      t.obj.rotation.z += t.spin.z * dt;
      if (t.age > 1.6) { this.removeTossed(t); return false; }
      return true;
    });
  }

  // ---------- jump pads ----------
  buildPads() {
    this.padViews = PADS.map((pad) => {
      const color = pad.dir ? 0xffa640 : 0x38e1ff;
      const g = new THREE.Group();
      g.position.set(pad.x, pad.y, pad.z);
      const base = new THREE.Mesh(new THREE.CylinderGeometry(pad.radius, pad.radius * 1.08, 0.08, 32), std(0x1b2233));
      base.position.y = 0.04;
      base.receiveShadow = true;
      const glowMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.75 });
      const glow = new THREE.Mesh(new THREE.CircleGeometry(pad.radius * 0.8, 32), glowMat);
      glow.rotation.x = -Math.PI / 2;
      glow.position.y = 0.085;
      const pulseMat = new THREE.MeshBasicMaterial({ color, transparent: true, side: THREE.DoubleSide, depthWrite: false });
      const pulse = new THREE.Mesh(new THREE.RingGeometry(pad.radius * 0.82, pad.radius * 0.95, 32), pulseMat);
      pulse.rotation.x = -Math.PI / 2;
      g.add(base, glow, pulse);
      if (pad.dir) {
        const s = new THREE.Shape();
        s.moveTo(0, 0.55); s.lineTo(0.4, -0.2); s.lineTo(0, -0.02); s.lineTo(-0.4, -0.2); s.lineTo(0, 0.55);
        const arrow = new THREE.Mesh(new THREE.ShapeGeometry(s), new THREE.MeshBasicMaterial({ color: 0x1b2233 }));
        const holder = new THREE.Group();
        holder.rotation.y = Math.atan2(-pad.dir.x, -pad.dir.z);
        arrow.rotation.x = -Math.PI / 2;
        arrow.position.y = 0.09;
        holder.add(arrow);
        g.add(holder);
      }
      this.scene.add(g);
      return { g, glowMat, pulse, pulseMat, burst: 0 };
    });
    this.padLaunchesSeen = 0;
  }

  // ---------- viewmodel (own scene + camera, drawn on top so guns never clip into walls) ----------
  buildViewmodel() {
    this.vmScene = new THREE.Scene();
    this.vmCamera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.01, 10);
    this.vmHemi = new THREE.HemisphereLight(0xdfefff, 0x4a4035, 1.8);
    this.vmScene.add(this.vmHemi);
    const sun = new THREE.DirectionalLight(0xffffff, 1.8);
    sun.position.set(1, 2, 1);
    this.vmScene.add(sun);
    this.vmSun = sun;
    this.vmMuzzleLight = new THREE.PointLight(0xffc060, 0, 2, 2);
    this.vmScene.add(this.vmMuzzleLight);
    this.guns = {};
    for (const id of Object.keys(WEAPONS)) {
      this.guns[id] = makeGun(id);
      this.guns[id].visible = false;
      this.vmScene.add(this.guns[id]);
    }
    this.loadGunModels();
    const flashMat = new THREE.MeshBasicMaterial({
      color: 0xffd27a, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    this.flash = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.07), flashMat);
      p.rotation.z = (i * Math.PI) / 3;
      this.flash.add(p);
    }
    this.flash.visible = false;
    this.vmScene.add(this.flash);

    // Cartoon muzzle extras: POW star, action lines, smoke puffs and shell casings.
    this.vmParticles = new Particles(this.vmScene, 60);
    const vmSprite = (map) => {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map, transparent: true, depthWrite: false, depthTest: false }));
      s.renderOrder = 10;
      s.visible = false;
      this.vmScene.add(s);
      return s;
    };
    this.vmStar = vmSprite(this.starTex);
    this.vmLines = vmSprite(actionLinesTexture());
    this.vmStarT = 0;
    this.vmLinesT = 0;
    this.vmStarSize = 0;
    this.vmLinesSize = 0;
    this.flashT = 0;
    this.kick = 0;
    this.throwT = 0;
    this.bobPhase = 0;
    this.sway = 0;
    this.lastYaw = 0;
    this.current = null;
  }

  // Swap the code-built placeholder guns for the .glb models as they finish loading.
  // If a file is missing or broken, that weapon just keeps its placeholder.
  loadGunModels() {
    this.modelStatus = {};
    for (const [id, cfg] of Object.entries(VIEWMODELS)) {
      if (!this.guns[id]) continue;
      this.modelStatus[id] = 'loading';
      loadViewmodel(cfg).then(({ object, muzzle }) => {
        const g = this.guns[id];
        g.clear();
        g.add(object);
        g.userData.muzzle = muzzle;
        g.userData.offset = [0, 0, 0];
        this.modelStatus[id] = 'loaded';
      }).catch((err) => {
        this.modelStatus[id] = 'failed';
        console.warn(`Viewmodel for ${id} (${cfg.file}) failed to load, using placeholder.`, err);
      });
    }
  }

  // Match the first-person gun's lights to the world's lighting preset (a bit brighter, so the
  // gun always reads clearly even at night).
  setLighting(L) {
    this.vmHemi.color.setHex(L.hemiSky);
    this.vmHemi.groundColor.setHex(L.hemiGround);
    this.vmHemi.intensity = Math.max(1.4, L.hemi * 1.1);
    this.vmSun.color.setHex(L.sun);
    this.vmSun.intensity = 0.6 + Math.min(L.sunI, 3) * 0.5;
  }

  showGun(id) {
    if (this.current) this.guns[this.current].visible = false;
    this.current = id;
    this.guns[id].visible = true;
  }

  muzzleWorld() {
    return this.camera.localToWorld(new THREE.Vector3(0.18, -0.16, -0.7));
  }

  // ---------- event handling ----------
  handle(events, player) {
    for (const e of events) {
      if (e.type === 'shot') {
        const w = WEAPONS[e.weapon];
        this.kick = Math.min(1.2, this.kick + w.kick);
        this.flashT = 0.05;
        this.flash.rotation.z = Math.random() * Math.PI;
        const m = this.muzzleWorld();
        this.muzzleLight.position.copy(m);
        this.muzzleLight.intensity = 6;
        for (const end of e.ends) this.addTracer(m, end);
        if (w.knockback) this.shake = Math.max(this.shake, w.knockback * 0.006);
        this.muzzleFx(w);
      } else if (e.type === 'hit') {
        const tv = this.targetViews.get(e.target);
        if (tv) tv.flash = 0.08;
        this.hitSplat(e);
        if (e.kill) this.onWord?.('SPLAT!', { world: e.pos }, 'kill');
        else if (e.zone === 'head' && Math.random() < 0.5) this.onWord?.('BONK!', { world: e.pos }, 'head');
      } else if (e.type === 'impact') {
        this.impact(e.pos, e.normal);
      } else if (e.type === 'explosion') {
        const color = EXPLOSION_COLOR[e.kind] ?? 0xff8a30;
        this.explosion(e.pos, e.radius, e.kind);
        this.onWord?.(e.kind === 'impulse' ? 'BWOMP!' : 'KABOOM!', { world: e.pos }, e.kind === 'impulse' ? 'blue' : 'big');
        const slot = this.flashLights[this.nextLight++ % this.flashLights.length];
        slot.light.color.setHex(color);
        slot.light.position.set(e.pos.x, e.pos.y + 0.3, e.pos.z);
        slot.light.intensity = 60;
        slot.life = 0.25;
        const d = Math.hypot(e.pos.x - player.pos.x, e.pos.y - player.pos.y, e.pos.z - player.pos.z);
        this.shake = Math.max(this.shake, Math.max(0, 0.06 * (1 - d / 15)));
      } else if (e.type === 'throw') {
        this.throwT = 1;
      } else if (e.type === 'botShotHit') {
        // Pink splat where a bot shot lands (on you or on a wall)
        for (let i = 0; i < 6; i++) {
          const r = randUnit();
          this.particles.spawn({
            pos: e.pos, vel: { x: r.x * 3, y: Math.abs(r.y) * 3, z: r.z * 3 }, gravity: 8,
            life: rand(0.25, 0.4), size: [0.1, 0.02], color: 0xff4fd8, opacity: [1, 0.6],
          });
        }
        if (!e.player) this.addStar(e.pos, 0.35, 0.1, 0xff9ce8);
      } else if (e.type === 'hurt') {
        this.shake = Math.max(this.shake, 0.03 + e.dmg * 0.002);
      }
    }
  }

  // Tracers come from a fixed pool (no new objects while firing = no garbage-collection hitches).
  addTracer(from, to) {
    if (!this.tracerPool) {
      this.tracerPool = [];
      this.nextTracer = 0;
      for (let i = 0; i < 48; i++) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
        const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xfff2a0, transparent: true, opacity: 0.9 }));
        line.frustumCulled = false;
        line.visible = false;
        this.scene.add(line);
        this.tracerPool.push({ line, life: 0 });
      }
    }
    const t = this.tracerPool[this.nextTracer++ % this.tracerPool.length];
    const p = t.line.geometry.attributes.position;
    p.setXYZ(0, from.x, from.y, from.z);
    p.setXYZ(1, to.x, to.y, to.z);
    p.needsUpdate = true;
    t.line.visible = true;
    t.life = 0.07;
  }

  // Flat shockwave ring lying on the ground plane.
  addRing(pos, color, startScale, endScale, life, opacity) {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(this.ringGeo ??= new THREE.RingGeometry(0.82, 1, 40), mat);
    mesh.position.set(pos.x, pos.y + 0.05, pos.z);
    mesh.rotation.x = -Math.PI / 2;
    mesh.scale.setScalar(startScale);
    this.scene.add(mesh);
    this.bursts.push({ mesh, life, max: life, from: startScale, to: endScale, opacity });
  }

  // ---------- impacts, hits, explosions (cartoon style) ----------
  buildImpactPools() {
    this.holeTex = [bulletHoleTexture(), bulletHoleTexture(), bulletHoleTexture()];
    this.decals = [];
    this.decalGeo = new THREE.PlaneGeometry(1, 1);
    this.nextDecal = 0;
    for (let i = 0; i < 80; i++) {
      const mat = new THREE.MeshBasicMaterial({
        map: this.holeTex[i % 3], transparent: true, depthWrite: false,
        polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
      });
      const mesh = new THREE.Mesh(this.decalGeo, mat);
      mesh.visible = false;
      this.scene.add(mesh);
      this.decals.push({ mesh, age: 0 });
    }
    const starTex = starTexture();
    this.starTex = starTex;
    this.stars = [];
    this.nextStar = 0;
    for (let i = 0; i < 24; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: starTex, transparent: true, depthWrite: false }));
      s.visible = false;
      this.scene.add(s);
      this.stars.push({ s, age: 0, life: 0, size: 0 });
    }
  }

  addDecal(pos, n) {
    const d = this.decals[this.nextDecal++ % this.decals.length];
    d.mesh.position.set(pos.x + n.x * 0.01, pos.y + n.y * 0.01, pos.z + n.z * 0.01);
    d.mesh.lookAt(pos.x + n.x, pos.y + n.y, pos.z + n.z);
    d.mesh.rotateZ(Math.random() * Math.PI * 2);
    d.mesh.scale.setScalar(rand(0.16, 0.22));
    d.mesh.material.opacity = 1;
    d.mesh.visible = true;
    d.age = 0;
  }

  addStar(pos, size, life, color = 0xffffff) {
    const st = this.stars[this.nextStar++ % this.stars.length];
    st.s.position.set(pos.x, pos.y, pos.z);
    st.s.material.color.setHex(color);
    st.s.material.rotation = Math.random() * Math.PI;
    st.s.visible = true;
    st.age = 0; st.life = life; st.size = size;
  }

  impact(pos, n) {
    this.addDecal(pos, n);
    this.addStar({ x: pos.x + n.x * 0.08, y: pos.y + n.y * 0.08, z: pos.z + n.z * 0.08 }, 0.35, 0.1, 0xfff3b0);
    for (let i = 0; i < 4; i++) {
      const r = randUnit();
      this.particles.spawn({
        geo: 'cube', lit: true, pos, life: rand(0.35, 0.55), gravity: 18, spin: 14,
        vel: { x: n.x * rand(2, 4) + r.x * 2, y: n.y * rand(2, 4) + r.y * 2 + 2, z: n.z * rand(2, 4) + r.z * 2 },
        size: [0.07, 0.04], color: 0x9aa3b5, opacity: [1, 1],
      });
    }
    this.particles.spawn({ pos, life: 0.22, size: [0.08, 0.3], color: 0xffffff, opacity: [0.8, 0] });
  }

  // Bean juice! Orange blobs + a comic star, yellow on headshots, red on kills.
  hitSplat(e) {
    const head = e.zone === 'head';
    const color = head ? 0xffc766 : 0xff8a3d;
    const count = e.kill ? 14 : head ? 9 : 6;
    for (let i = 0; i < count; i++) {
      const r = randUnit();
      this.particles.spawn({
        lit: true, pos: e.pos, life: rand(0.4, 0.7), gravity: 14, drag: 0.5,
        vel: { x: r.x * rand(2, 4), y: Math.abs(r.y) * 3 + 1.5, z: r.z * rand(2, 4) },
        size: [rand(0.07, 0.11), 0.03], color, opacity: [1, 1],
      });
    }
    this.addStar(e.pos, e.kill ? 0.9 : head ? 0.6 : 0.4, e.kill ? 0.18 : 0.12,
      e.kill ? 0xff5a5a : head ? 0xffe066 : 0xffffff);
  }

  explosion(pos, radius, kind) {
    const k = radius / 4.5;
    const impulse = kind === 'impulse';
    const pal = impulse ? [0xeaffff, 0x3fd8ff, 0x1f5cff] : [0xffe14d, 0xff7a1a, 0xd8321a];
    // White flash core
    this.particles.spawn({ pos, life: 0.12, size: [0.4, 2.2 * k], color: 0xffffff, color2: pal[0], opacity: [1, 0] });
    // Fireball: chunky puffs thrown outward that burn from yellow to red
    for (let i = 0; i < 12; i++) {
      const d = randUnit();
      d.y = Math.abs(d.y) * 0.8 + 0.15;
      const s = rand(4, 8) * k;
      this.particles.spawn({
        pos: { x: pos.x + d.x * 0.3, y: pos.y + d.y * 0.3, z: pos.z + d.z * 0.3 },
        vel: { x: d.x * s, y: d.y * s, z: d.z * s }, drag: 5,
        life: rand(0.35, 0.55), size: [0.4 * k, rand(0.9, 1.5) * k],
        color: pal[0], color2: pal[2], opacity: [1, 0], fadeStart: 0.6,
      });
    }
    if (!impulse) {
      // Cartoon smoke: fat grey toon puffs that billow up and linger
      for (let i = 0; i < 10; i++) {
        this.particles.spawn({
          lit: true, delay: rand(0.06, 0.2),
          pos: { x: pos.x + rand(-0.8, 0.8) * k, y: pos.y + rand(0, 0.8) * k, z: pos.z + rand(-0.8, 0.8) * k },
          vel: { x: rand(-1, 1), y: rand(1, 2.2), z: rand(-1, 1) }, drag: 1.2,
          life: rand(1.4, 2.2), size: [0.5 * k, rand(1.1, 1.7) * k],
          color: 0xc4c9d2, color2: 0x70757f, opacity: [0.95, 0], fadeStart: 0.5,
        });
      }
      // Chunks of debris
      for (let i = 0; i < 6; i++) {
        const d = randUnit();
        this.particles.spawn({
          geo: 'cube', lit: true, pos, gravity: 20, spin: 12, life: rand(0.7, 1),
          vel: { x: d.x * 4, y: rand(5, 9), z: d.z * 4 }, size: [0.13, 0.07], color: 0x3a3f4b, opacity: [1, 1],
        });
      }
    } else {
      // Impulse: electric sparkles instead of smoke
      for (let i = 0; i < 16; i++) {
        const d = randUnit();
        const s = rand(6, 10);
        this.particles.spawn({
          geo: 'cube', pos, gravity: 6, drag: 2, spin: 20, life: rand(0.35, 0.6),
          vel: { x: d.x * s, y: d.y * s, z: d.z * s }, size: [0.09, 0.02], color: 0xbff8ff, opacity: [1, 1],
        });
      }
    }
    this.addRing(pos, pal[1], 0.3, radius * 1.15, 0.3, 0.8);
  }

  // Everything that pops out of the gun when it fires (drawn in the viewmodel scene).
  muzzleFx(w) {
    const f = w.fx ?? {};
    const gun = this.guns[w.id];
    gun.updateMatrixWorld(true);
    const m = gun.localToWorld(gun.userData.muzzle.clone());
    this.vmMuzzle = m;

    this.vmStarT = 0.08;
    this.vmStarSize = f.star ?? 0.15;
    this.vmStar.material.rotation = Math.random() * Math.PI;
    this.vmStar.material.color.setHex(0xfff3a0);
    if (f.lines) {
      this.vmLinesT = 0.1;
      this.vmLinesSize = (f.star ?? 0.3) * 1.4;
      this.vmLines.material.rotation = Math.random() * Math.PI;
    }
    // Smoke puffs curling off the barrel
    const puffs = f.lines ? 4 : 2;
    for (let i = 0; i < puffs; i++) {
      this.vmParticles.spawn({
        lit: true, pos: m, life: rand(0.35, 0.55), drag: 3,
        vel: { x: rand(-0.15, 0.15), y: rand(0.15, 0.4), z: rand(-0.6, -0.2) },
        size: [0.015, rand(0.05, 0.08) * (f.lines ? 1.4 : 1)],
        color: 0xf2f2f2, color2: 0xb8bcc6, opacity: [0.9, 0], fadeStart: 0.3,
      });
    }
    // Shell casing flicked out to the right
    if (f.shell != null) {
      const ej = gun.localToWorld(new THREE.Vector3(0.03, 0.03, -0.1));
      this.vmParticles.spawn({
        geo: 'cube', lit: true, pos: ej, gravity: 5, spin: 25, life: 0.6,
        vel: { x: rand(0.6, 1), y: rand(0.8, 1.2), z: rand(0, 0.3) },
        size: w.id === 'shotgun' ? [0.035, 0.03] : [0.022, 0.02], color: f.shell, opacity: [1, 1],
      });
    }
    // Comic word next to the gun
    if (f.words && Math.random() < (f.wordChance ?? 0)) {
      const word = f.words[Math.floor(Math.random() * f.words.length)];
      const p = m.clone().project(this.vmCamera);
      this.onWord?.(word, { screen: { x: (p.x + 1) / 2, y: (1 - p.y) / 2 } }, f.lines ? 'big' : 'small');
    }
  }

  // Smoke trails behind flying projectiles.
  trail(pr, mesh) {
    const every = pr.kind === 'rocket' ? 0.018 : 0.035;
    mesh.userData.trailT = (mesh.userData.trailT ?? 0) - this.frameDt;
    if (mesh.userData.trailT > 0 || pr.stuck || pr.resting) return;
    mesh.userData.trailT = every;
    const sp = Math.hypot(pr.vel.x, pr.vel.y, pr.vel.z) || 1;
    const back = { x: pr.pos.x - (pr.vel.x / sp) * 0.3, y: pr.pos.y - (pr.vel.y / sp) * 0.3, z: pr.pos.z - (pr.vel.z / sp) * 0.3 };
    const jitter = () => ({ x: rand(-0.4, 0.4), y: rand(0, 0.6), z: rand(-0.4, 0.4) });
    if (pr.kind === 'rocket') {
      this.particles.spawn({ lit: true, pos: back, vel: jitter(), drag: 2, life: 0.6, size: [0.12, 0.42], color: 0xe4e7ec, color2: 0x9aa0a8, opacity: [0.9, 0], fadeStart: 0.3 });
      this.particles.spawn({ pos: back, life: 0.08, size: [0.14, 0.04], color: 0xffc040, opacity: [1, 0.6] });
    } else if (pr.kind === 'frag') {
      this.particles.spawn({ pos: back, vel: jitter(), life: 0.3, size: [0.06, 0.16], color: 0xffffff, opacity: [0.6, 0] });
    } else if (pr.kind === 'impulse') {
      this.particles.spawn({ geo: 'cube', pos: back, vel: jitter(), spin: 15, life: 0.3, size: [0.06, 0.01], color: 0x7ff6ff, opacity: [1, 0.5] });
    } else if (pr.kind === 'botshot') {
      this.particles.spawn({ pos: back, vel: jitter(), life: 0.35, size: [0.14, 0.04], color: 0xff4fd8, opacity: [0.8, 0] });
    }
  }

  // ---------- per-frame update ----------
  update(dt, combat, player, input, playing) {
    this.time += dt;
    this.frameDt = dt;

    // Dummies & bots (views created/removed as targets come and go)
    const liveIds = new Set();
    for (const t of combat.targets) {
      liveIds.add(t.id);
      let view = this.targetViews.get(t.id);
      if (!view) { view = this.makeTargetView(t); this.targetViews.set(t.id, view); }
      if (view.gun && !view.realGun && this.botGunTemplate) {
        view.gun.clear();
        view.gun.add(this.botGunTemplate.clone());
        view.realGun = true;
      }
      view.g.visible = !t.dead;
      // Bots' health bars face the camera; dummies already face you.
      if (t.kind === 'bot') view.bar.rotation.y = Math.atan2(this.camera.position.x - t.pos.x, this.camera.position.z - t.pos.z) - t.yaw;
      view.g.position.set(t.pos.x, t.pos.y, t.pos.z);
      view.g.rotation.y = t.yaw; // faces you; the hitboxes turn the same way
      // Online players squash down when crouching/sliding (no limbs, so this is the "animation").
      if (t.kind === 'remote') {
        const sy = t.low ? 0.62 : 1;
        view.g.scale.y += (sy - view.g.scale.y) * Math.min(1, dt * 14);
      }
      const frac = t.hp / t.maxHp;
      view.fill.scale.x = Math.max(0.001, frac);
      view.fill.position.x = -0.4 * (1 - frac);
      view.fill.material.color.setHex(frac > 0.5 ? 0x5ee06a : frac > 0.25 ? 0xf2c14e : 0xe5534b);
      view.flash = Math.max(0, view.flash - dt);
      const e = view.flash > 0 ? 0xffffff : 0x000000;
      view.bodyMat.emissive.setHex(e);
      view.headMat.emissive.setHex(e);
    }
    for (const [id, view] of this.targetViews) {
      if (!liveIds.has(id)) { this.scene.remove(view.g); this.targetViews.delete(id); }
    }

    // Jump pads: idle pulse + burst when you get launched
    if (player.padLaunches !== this.padLaunchesSeen) {
      this.padLaunchesSeen = player.padLaunches;
      const pv = this.padViews[player.lastPad];
      if (pv) {
        pv.burst = 1;
        this.onWord?.('BOING!', { world: { x: pv.g.position.x, y: pv.g.position.y + 1.2, z: pv.g.position.z } }, 'blue');
      }
    }
    for (const v of this.padViews) {
      const t = (this.time * 0.8) % 1;
      v.pulse.position.y = 0.1 + t * 1.2;
      v.pulse.scale.setScalar(1 - t * 0.25);
      v.pulseMat.opacity = (1 - t) * 0.6;
      v.burst = Math.max(0, v.burst - dt * 3);
      v.glowMat.opacity = 0.7 + v.burst * 0.3;
      v.g.children[1].scale.setScalar(1 + v.burst * 0.3);
    }

    // Projectiles
    const alive = new Set();
    for (const pr of combat.projectiles) {
      alive.add(pr);
      let mesh = this.projMeshes.get(pr);
      if (!mesh) {
        mesh = makeProjectile(pr.kind);
        this.scene.add(mesh);
        this.projMeshes.set(pr, mesh);
      }
      const moved = mesh.position.x !== pr.pos.x || mesh.position.y !== pr.pos.y || mesh.position.z !== pr.pos.z;
      mesh.position.set(pr.pos.x, pr.pos.y, pr.pos.z);
      const spd = Math.hypot(pr.vel.x, pr.vel.y, pr.vel.z);
      if (!pr.stuck && spd > 0.1) mesh.lookAt(pr.pos.x + pr.vel.x, pr.pos.y + pr.vel.y, pr.pos.z + pr.vel.z);
      if (mesh.userData.spin) mesh.userData.spin.rotation.x = pr.stuck ? 0 : -this.time * 25;
      if (moved) this.trail(pr, mesh); // no trail puffs piling up while paused
    }
    for (const [pr, mesh] of this.projMeshes) {
      if (!alive.has(pr)) { this.scene.remove(mesh); this.projMeshes.delete(pr); }
    }

    // Tracers / bursts / lights
    for (const t of this.tracerPool ?? []) {
      if (!t.line.visible) continue;
      t.life -= dt;
      t.line.material.opacity = Math.max(0, t.life / 0.07) * 0.9;
      if (t.life <= 0) t.line.visible = false;
    }
    this.bursts = this.bursts.filter((b) => {
      b.life -= dt;
      const k = 1 - Math.max(0, b.life) / b.max;
      b.mesh.scale.setScalar(b.from + (b.to - b.from) * Math.sqrt(k));
      b.mesh.material.opacity = b.opacity * (1 - k);
      if (b.life > 0) return true;
      this.scene.remove(b.mesh); b.mesh.material.dispose();
      return false;
    });
    this.particles.update(dt);
    this.updateTossed(dt);
    // Bullet holes stay 10 s, then fade out over the last second.
    for (const d of this.decals) {
      if (!d.mesh.visible) continue;
      d.age += dt;
      if (d.age > 10) d.mesh.visible = false;
      else if (d.age > 9) d.mesh.material.opacity = 10 - d.age;
    }
    // Comic stars pop big then shrink away.
    for (const st of this.stars) {
      if (!st.s.visible) continue;
      st.age += dt;
      const t = st.age / st.life;
      if (t >= 1) { st.s.visible = false; continue; }
      st.s.scale.setScalar(st.size * (t < 0.3 ? 0.6 + t / 0.3 * 0.4 : 1 - (t - 0.3) * 0.6));
      st.s.material.opacity = t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4;
    }
    for (const s of this.flashLights) {
      s.life = Math.max(0, s.life - dt);
      s.light.intensity = s.life > 0 ? 60 * (s.life / 0.25) : 0;
    }
    this.muzzleLight.intensity = Math.max(0, this.muzzleLight.intensity - dt * 120);
    this.shake = Math.max(0, this.shake - dt * 0.25);

    if (playing) this.updateViewmodel(dt, combat, player, input);
  }

  updateViewmodel(dt, combat, player, input) {
    const w = combat.weapon;
    if (this.current !== w.id) this.showGun(w.id);
    const gun = this.guns[w.id];
    const st = combat.weaponState;
    const drawP = combat.drawT / SWITCH_TIME;

    // Reload = chuck the empty gun away and a fresh one pops up:
    //   0–12%   wind-up flick     12–50%  hands empty (the old gun is flying off in the world)
    //   50–100% new gun springs up from below with a little overshoot
    const reloadP = st.reloadT > 0 ? 1 - st.reloadT / w.reload : 0;
    let rY = 0, rRot = 0, rX = 0, empty = false;
    if (st.reloadT > 0) {
      if (reloadP < 0.12) {
        const k = reloadP / 0.12;
        rY = k * 0.12; rRot = k * 0.9; rX = k * 0.08;
      } else if (reloadP < 0.5) {
        empty = true;
        if (!this.tossedThisReload) {
          this.tossedThisReload = true;
          this.tossGun(w.id, player);
        }
      } else {
        const k = (reloadP - 0.5) / 0.5;
        const c = 1.7, e = 1 + (c + 1) * Math.pow(k - 1, 3) + c * Math.pow(k - 1, 2); // ease-out-back
        rY = -0.45 * (1 - e); rRot = -0.5 * (1 - e);
        if (!this.caughtThisReload) { this.caughtThisReload = true; this.onSound?.('switch'); }
      }
    } else {
      this.tossedThisReload = false;
      this.caughtThisReload = false;
    }
    gun.visible = !empty;

    this.kick = Math.max(0, this.kick - dt * 7);
    this.throwT = Math.max(0, this.throwT - dt * 4);
    const speed = horizontalSpeed(player);
    if (player.grounded && !player.sliding) this.bobPhase += dt * (4 + speed * 0.9);
    const bobAmt = player.grounded && !player.sliding ? Math.min(1, speed / 9) : 0;
    const dyaw = input.yaw - this.lastYaw;
    this.lastYaw = input.yaw;
    this.sway += (Math.max(-0.04, Math.min(0.04, dyaw * 0.8)) - this.sway) * Math.min(1, dt * 12);

    const off = gun.userData.offset ?? [0, 0, 0];
    gun.position.set(
      0.24 + off[0] + Math.sin(this.bobPhase) * 0.012 * bobAmt + this.sway + rX,
      -0.24 + off[1] + Math.abs(Math.cos(this.bobPhase)) * 0.014 * bobAmt - drawP * 0.3 + rY - this.throwT * 0.18,
      -0.42 + off[2] + this.kick * 0.07,
    );
    gun.rotation.set(this.kick * 0.16 + rRot - drawP * 0.6, this.sway * 2, -rX * 3 + (player.sliding ? 0.15 : 0));

    this.flashT = Math.max(0, this.flashT - dt);
    this.flash.visible = this.flashT > 0;
    if (this.flash.visible) {
      this.flash.position.copy(gun.localToWorld(gun.userData.muzzle.clone()));
    }
    this.vmMuzzleLight.position.copy(this.flash.position);
    this.vmMuzzleLight.intensity = this.flashT > 0 ? 3 : 0;

    // Muzzle POW star + action lines follow the barrel while they're up.
    const muzzleNow = gun.localToWorld(gun.userData.muzzle.clone());
    this.vmStarT = Math.max(0, this.vmStarT - dt);
    this.vmStar.visible = this.vmStarT > 0;
    if (this.vmStar.visible) {
      const t = 1 - this.vmStarT / 0.08;
      this.vmStar.position.copy(muzzleNow);
      this.vmStar.scale.setScalar(this.vmStarSize * (0.7 + 0.5 * Math.sin(Math.min(1, t * 1.6) * Math.PI)));
      this.vmStar.material.opacity = t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4;
    }
    this.vmLinesT = Math.max(0, this.vmLinesT - dt);
    this.vmLines.visible = this.vmLinesT > 0;
    if (this.vmLines.visible) {
      const t = 1 - this.vmLinesT / 0.1;
      this.vmLines.position.copy(muzzleNow);
      this.vmLines.scale.setScalar(this.vmLinesSize * (0.6 + 0.6 * t));
      this.vmLines.material.opacity = 1 - t * t;
    }
    this.vmParticles.update(dt);
  }

  // Shader warm-up. The first time the GPU draws a new kind of material it has to compile a
  // shader, which freezes the game for a moment (the "first shot stutter"). So at load we
  // briefly make one of every effect visible and render it once, off to the side.
  warmup() {
    const temp = [];
    const show = (o) => { temp.push([o, o.visible]); o.visible = true; };
    const at = new THREE.Vector3(0, -50, 0); // somewhere under the map, out of the way
    for (const kind of ['basic', 'toon']) for (const m of this.particles.free[kind].slice(0, 2)) { show(m); m.position.copy(at); }
    for (const d of this.decals.slice(0, 1)) { show(d.mesh); d.mesh.position.copy(at); }
    for (const s of this.stars.slice(0, 1)) { show(s.s); s.s.position.copy(at); }
    this.addTracer(at, at.clone().add(new THREE.Vector3(1, 0, 0)));
    const extras = ['rocket', 'frag', 'knife', 'impulse', 'botshot'].map((k) => makeProjectile(k));
    extras.push(this.makeTargetView({ kind: 'bot' }).g);
    for (const e of extras) { e.position.copy(at); this.scene.add(e); }
    this.addRing(at, 0xffffff, 1, 1, 0.01, 0.5);
    // viewmodel extras
    for (const m of this.vmParticles.free.toon.slice(0, 1).concat(this.vmParticles.free.basic.slice(0, 1))) show(m);
    show(this.vmStar); show(this.vmLines); show(this.flash);
    for (const g of Object.values(this.guns)) show(g);

    this.renderer.render(this.scene, this.camera);
    this.renderViewmodel();

    for (const [o, vis] of temp) o.visible = vis;
    for (const e of extras) this.scene.remove(e);
  }

  applyShake(camera) {
    if (this.shake <= 0) return;
    camera.position.x += (Math.random() - 0.5) * this.shake;
    camera.position.y += (Math.random() - 0.5) * this.shake;
    camera.position.z += (Math.random() - 0.5) * this.shake;
  }

  renderViewmodel() {
    const r = this.renderer;
    r.autoClear = false;
    r.clearDepth();
    r.render(this.vmScene, this.vmCamera);
    r.autoClear = true;
  }
}
