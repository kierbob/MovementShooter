// Time trial: portals in the hub take you to the course; the clock starts when you cross the
// start line and stops in the finish gate, which sends you back to the start board.
// Pure logic (no three.js) and runs in the fixed sim tick.
import { TRIAL, PORTALS, SPAWN } from './world.js';

// Bump the version whenever the course layout changes, so old records don't carry over.
const STORAGE_KEY = 'movement-shooter.trials.v2';

function loadBest() {
  try {
    const b = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return { on: typeof b?.on === 'number' ? b.on : null, off: typeof b?.off === 'number' ? b.off : null };
  } catch {
    return { on: null, off: null };
  }
}

export function formatTime(t) {
  if (t == null) return '--:--.---';
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${String(m).padStart(2, '0')}:${s.toFixed(3).padStart(6, '0')}`;
}

function inPortal(p, portal) {
  const dy = p.pos.y - portal.y;
  return dy > -0.5 && dy < 2 && Math.hypot(p.pos.x - portal.x, p.pos.z - portal.z) < 1.1;
}

function inBox(p, b) {
  return p.pos.x > b.min.x && p.pos.x < b.max.x && p.pos.y > b.min.y && p.pos.y < b.max.y &&
    p.pos.z > b.min.z && p.pos.z < b.max.z;
}

// Put the player somewhere with no leftover momentum or movement state.
function teleport(p, to) {
  p.pos = { x: to.x, y: to.y, z: to.z };
  p.vel = { x: 0, y: 0, z: 0 };
  p.grounded = false;
  p.sliding = false;
  p.wallJumps = 0;
  p.airTime = 0;
  p.frictionGrace = 0;
}

export class TimeTrial {
  constructor() {
    this.active = false;   // on the course
    this.guns = false;     // which mode
    this.running = false;  // clock ticking
    this.time = 0;
    this.last = { on: null, off: null };
    this.best = loadBest();
    this.cooldown = 0;     // stops portals re-triggering right after a teleport
    this.events = [];      // { type: 'teleport', to } | 'enter' | 'leave' | 'start' | 'finish' | 'fell'
  }

  get mode() { return this.guns ? 'on' : 'off'; }

  go(p, to, type, extra = {}) {
    teleport(p, to);
    this.cooldown = 0.6;
    this.events.push({ type: 'teleport', to });
    this.events.push({ type, ...extra });
  }

  enter(p, guns) {
    this.active = true;
    this.guns = guns;
    this.running = false;
    this.time = 0;
    this.go(p, TRIAL.start, 'enter', { guns });
  }

  leave(p) {
    this.active = false;
    this.running = false;
    this.go(p, SPAWN, 'leave');
  }

  restart(p, reason = 'restart') {
    this.running = false;
    this.time = 0;
    this.go(p, TRIAL.start, reason);
  }

  tick(p, dt) {
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (!this.active) {
      if (this.cooldown === 0) {
        const portal = PORTALS.find((pt) => inPortal(p, pt));
        if (portal) this.enter(p, portal.guns);
      }
      return;
    }
    if (this.cooldown === 0 && inPortal(p, TRIAL.exit)) { this.leave(p); return; }
    if (p.pos.y < TRIAL.killY) { this.restart(p, 'fell'); return; }

    if (!this.running && p.pos.z < TRIAL.startLineZ) {
      this.running = true;
      this.time = 0;
      this.events.push({ type: 'start' });
    }
    if (!this.running) return;
    this.time += dt;
    if (inBox(p, TRIAL.finish)) this.finish(p);
  }

  finish(p) {
    const k = this.mode, t = this.time;
    this.running = false;
    this.last[k] = t;
    const isBest = this.best[k] == null || t < this.best[k];
    if (isBest) {
      this.best[k] = t;
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.best)); } catch { /* ignore */ }
    }
    this.go(p, TRIAL.start, 'finish', { time: t, best: isBest });
  }
}
