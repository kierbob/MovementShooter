// Visuals for the time trial: the timer board, teleport portals, and START / FINISH banners.
import * as THREE from 'three';
import { TRIAL, PORTALS, SPAWN } from './world.js';
import { formatTime } from './trial.js';
import { toonGradient } from './particles.js';
import { addOutline } from './outline.js';

const INK = '#15151f';
const FONT = "'Bangers', 'Bebas Neue', sans-serif";

function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.userData.redraw = () => { draw(c.getContext('2d'), w, h); tex.needsUpdate = true; };
  tex.userData.redraw();
  // Redraw once the comic font has loaded so labels don't stay in the fallback font.
  document.fonts?.ready.then(() => tex.userData.redraw());
  return tex;
}

function comicText(g, text, x, y, size, fill, align = 'center') {
  g.font = `${size}px ${FONT}`;
  g.textAlign = align;
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  g.lineWidth = size * 0.16;
  g.strokeStyle = INK;
  g.fillStyle = INK;
  g.fillText(text, x + size * 0.06, y + size * 0.06); // drop shadow
  g.strokeText(text, x, y);
  g.fillStyle = fill;
  g.fillText(text, x, y);
}

function labelSprite(lines) {
  const tex = canvasTexture(512, 192, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    comicText(g, lines[0], w / 2, 62, 64, '#ffe14d');
    if (lines[1]) comicText(g, lines[1], w / 2, 138, 52, lines[2] ?? '#ffffff');
  });
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  s.scale.set(3.6, 1.35, 1);
  return s;
}

function swirlTexture(color) {
  return canvasTexture(256, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.translate(w / 2, h / 2);
    const grad = g.createRadialGradient(0, 0, 10, 0, 0, 128);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.5, color);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.beginPath(); g.arc(0, 0, 128, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.8)';
    g.lineWidth = 10; g.lineCap = 'round';
    for (let i = 0; i < 4; i++) {
      g.rotate(Math.PI / 2);
      g.beginPath();
      g.arc(22, 0, 70, -0.4, 1.4);
      g.stroke();
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
  });
}

function checkerTexture() {
  const tex = canvasTexture(256, 64, (g, w, h) => {
    const s = 32;
    for (let y = 0; y < h / s; y++) for (let x = 0; x < w / s; x++) {
      g.fillStyle = (x + y) % 2 ? '#15151f' : '#ffffff';
      g.fillRect(x * s, y * s, s, s);
    }
  });
  return tex;
}

export class TrialView {
  constructor(scene, trial) {
    this.scene = scene;
    this.trial = trial;
    this.portals = [];
    this.time = 0;

    for (const p of PORTALS) this.addPortal(p, p.guns ? '#ff9a3c' : '#3cf0a0', [p.label, p.sub, p.guns ? '#ffb45a' : '#7dffc4'], SPAWN);
    this.addPortal(TRIAL.exit, '#7ab8ff', [TRIAL.exit.label, '', '#ffffff'], TRIAL.start);
    this.buildBoard();
    this.buildBanners();
  }

  // The ring turns to face `faceToward`, so you see it head-on on your way over.
  addPortal(p, color, lines, faceToward) {
    const g = new THREE.Group();
    g.position.set(p.x, p.y, p.z);
    g.rotation.y = Math.atan2(faceToward.x - p.x, faceToward.z - p.z);
    const toon = (c) => new THREE.MeshToonMaterial({ color: c, gradientMap: toonGradient() });
    const base = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.4, 0.2, 28), toon(0x2a3150));
    base.position.y = 0.1;
    addOutline(base);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.1, 0.14, 12, 40), toon(new THREE.Color(color)));
    ring.position.y = 1.35;
    addOutline(ring);
    const swirlMat = new THREE.MeshBasicMaterial({ map: swirlTexture(color), transparent: true, side: THREE.DoubleSide, depthWrite: false });
    const swirl = new THREE.Mesh(new THREE.CircleGeometry(1.0, 32), swirlMat);
    swirl.position.y = 1.35;
    const label = labelSprite(lines);
    label.position.y = 3.3;
    g.add(base, ring, swirl, label);
    this.scene.add(g);
    this.portals.push({ g, ring, swirl });
  }

  buildBoard() {
    const b = TRIAL.board;
    this.boardTex = canvasTexture(1024, 384, (g, w, h) => this.drawBoard(g, w, h));
    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(b.w + 0.4, b.h + 0.4, 0.3),
      new THREE.MeshToonMaterial({ color: 0xffd35a, gradientMap: toonGradient() }),
    );
    frame.position.set(b.x, b.y, b.z - 0.1);
    addOutline(frame);
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(b.w, b.h), new THREE.MeshBasicMaterial({ map: this.boardTex }));
    screen.position.set(b.x, b.y, b.z + 0.06);
    this.scene.add(frame, screen);
    this.boardKey = '';
  }

  drawBoard(g, w, h) {
    const t = this.trial;
    g.fillStyle = '#141a3a';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#1d2554';
    for (let i = 0; i < 12; i++) g.fillRect(i * 90 - 20, 0, 40, h); // subtle stripes
    comicText(g, 'TIME TRIAL', w / 2, 54, 64, '#ffe14d');
    const mode = t.guns ? 'GUNS ON' : 'GUNS OFF';
    comicText(g, mode, w / 2, 112, 38, t.guns ? '#ffb45a' : '#7dffc4');
    // Big clock: live time while running, otherwise your last run in this mode
    const big = t.running ? t.time : t.last[t.mode] ?? 0;
    comicText(g, formatTime(big), w / 2, 200, 112, t.running ? '#ffffff' : '#9ff0ff');
    const col = (x, title, k) => {
      comicText(g, title, x, 290, 30, k === 'off' ? '#7dffc4' : '#ffb45a');
      comicText(g, `BEST ${formatTime(t.best[k])}`, x, 328, 30, '#ffffff');
      comicText(g, `LAST ${formatTime(t.last[k])}`, x, 362, 26, '#b9c3e6');
    };
    col(w * 0.27, 'GUNS OFF', 'off');
    col(w * 0.73, 'GUNS ON', 'on');
  }

  buildBanners() {
    // START banner on the gate beam, facing back toward the start room
    const start = labelSprite(['START', '', '#ffffff']);
    start.position.set(TRIAL.start.x, 5.0, 1.2);
    start.scale.set(3, 1.1, 1);
    this.scene.add(start);

    // Checkered FINISH arch
    const f = TRIAL.finish;
    const cx = (f.min.x + f.max.x) / 2, cz = (f.min.z + f.max.z) / 2;
    const toon = (c) => new THREE.MeshToonMaterial({ color: c, gradientMap: toonGradient() });
    for (const x of [f.min.x, f.max.x]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.5, 5, 0.5), toon(0xffffff));
      post.position.set(x, f.min.y + 2.5, cz);
      addOutline(post);
      this.scene.add(post);
    }
    const checker = checkerTexture();
    checker.wrapS = THREE.RepeatWrapping;
    checker.repeat.set(2, 1);
    const beam = new THREE.Mesh(new THREE.BoxGeometry(f.max.x - f.min.x + 0.5, 1, 0.5), new THREE.MeshBasicMaterial({ map: checker }));
    beam.position.set(cx, f.min.y + 5, cz);
    addOutline(beam);
    this.scene.add(beam);
    const label = labelSprite(['FINISH!', '', '#ffffff']);
    label.position.set(cx, f.min.y + 6.6, cz);
    this.scene.add(label);
  }

  update(dt) {
    this.time += dt;
    for (const p of this.portals) {
      p.swirl.rotation.z -= dt * 2.5;
      p.ring.scale.setScalar(1 + Math.sin(this.time * 3) * 0.03);
    }
    const t = this.trial;
    // Redraw the board only when what it shows changes (10x/s while the clock runs).
    const key = `${t.guns}|${t.running}|${t.running ? Math.floor(t.time * 10) : t.last[t.mode]}|${t.best.on}|${t.best.off}|${t.last.on}|${t.last.off}`;
    if (key !== this.boardKey) {
      this.boardKey = key;
      this.boardTex.userData.redraw();
    }
  }
}
