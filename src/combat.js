// Weapons, abilities, projectiles, damage and knockback. Pure math (no three.js) and runs
// inside the fixed sim tick, so a server can run the exact same code later.
// Visual/audio code reads `combat.fx` (a queue of events) and clears it every frame.
import { WEAPONS, ABILITIES, DEFAULT_LOADOUT } from './items.js';
import { PLAYER } from './config.js';
import { applyImpulse, eyePosition } from './player.js';
import { rampPlane } from './world.js';

const SWITCH_TIME = 0.3;   // seconds to draw a weapon
const SEMI_BUFFER = 0.12;  // a click this early before the gun is ready still fires

// Bean characters are just two capsules (segment a→b with radius r, relative to the feet):
// a big body bean and a separate floating head bean — no limbs, so nothing to animate.
// zone decides the damage multiplier: head = weapon headMult, body = 1 (legs zone kept for
// future models: LEG_MULT).
export const DUMMY_PARTS = [
  { zone: 'body', a: [0, 0.38, 0], b: [0, 1.06, 0], r: 0.38 },
  { zone: 'head', a: [0, 1.7, 0], b: [0, 1.76, 0], r: 0.2 },
];
const LEG_MULT = 0.75;
const DUMMY_HP = 150;
const DUMMY_RESPAWN = 2.5;
const PLAYER_REGEN_DELAY = 3; // seconds without damage before your health starts coming back

// ---------- small vector helpers (plain {x,y,z}) ----------
const v = (x, y, z) => ({ x, y, z });
const add = (a, b) => v(a.x + b.x, a.y + b.y, a.z + b.z);
const sub = (a, b) => v(a.x - b.x, a.y - b.y, a.z - b.z);
const scale = (a, s) => v(a.x * s, a.y * s, a.z * s);
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const len = (a) => Math.sqrt(dot(a, a));
const norm = (a) => { const l = len(a) || 1; return scale(a, 1 / l); };
const cross = (a, b) => v(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);

export function aimDir(yaw, pitch) {
  const cp = Math.cos(pitch);
  return v(-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp);
}

function spreadDir(d, degrees) {
  if (!degrees) return d;
  const up = Math.abs(d.y) > 0.99 ? v(1, 0, 0) : v(0, 1, 0);
  const right = norm(cross(d, up));
  const up2 = cross(right, d);
  const angle = (degrees * Math.PI / 180) * Math.sqrt(Math.random());
  const phi = Math.random() * Math.PI * 2;
  const off = add(scale(right, Math.cos(phi)), scale(up2, Math.sin(phi)));
  return norm(add(scale(d, Math.cos(angle)), scale(off, Math.sin(angle))));
}

// Ray vs AABB (slab method). Returns { t, normal } or null. Rays starting inside are ignored.
function rayBox(o, d, b, maxT) {
  let tmin = 0, tmax = maxT, axis = null, sign = 0;
  for (const a of ['x', 'y', 'z']) {
    if (Math.abs(d[a]) < 1e-9) {
      if (o[a] < b.min[a] || o[a] > b.max[a]) return null;
      continue;
    }
    let t1 = (b.min[a] - o[a]) / d[a], t2 = (b.max[a] - o[a]) / d[a], s = -1;
    if (t1 > t2) { [t1, t2] = [t2, t1]; s = 1; }
    if (t1 > tmin) { tmin = t1; axis = a; sign = s; }
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  // Ramps: also clip against the sloped top (a half-space n·p <= c).
  let planeN = null;
  if (b.ramp) {
    const { n, c } = rampPlane(b);
    const denom = n.x * d.x + n.y * d.y + n.z * d.z;
    const dist = c - (n.x * o.x + n.y * o.y + n.z * o.z);
    if (Math.abs(denom) < 1e-9) {
      if (dist < 0) return null;
    } else {
      const t = dist / denom;
      if (denom < 0) { if (t > tmin) { tmin = t; planeN = n; } } else tmax = Math.min(tmax, t);
      if (tmin > tmax) return null;
    }
  }
  if (planeN) {
    const l = Math.hypot(planeN.x, planeN.y, planeN.z);
    return { t: tmin, normal: v(planeN.x / l, planeN.y / l, planeN.z / l) };
  }
  if (axis === null) return null;
  const normal = v(0, 0, 0);
  normal[axis] = sign;
  return { t: tmin, normal };
}

function closestOnSegment(p, a, b) {
  const ab = sub(b, a);
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / (dot(ab, ab) || 1)));
  return add(a, scale(ab, t));
}

// Ray vs capsule (segment a→b, radius r). d must be normalized. Returns t or null.
function rayCapsule(o, d, a, b, r, maxT) {
  const ba = sub(b, a), oa = sub(o, a);
  const baba = dot(ba, ba), bard = dot(ba, d), baoa = dot(ba, oa), rdoa = dot(d, oa), oaoa = dot(oa, oa);
  const A = baba - bard * bard;
  const B = baba * rdoa - baoa * bard;
  const C = baba * oaoa - baoa * baoa - r * r * baba;
  const h = B * B - A * C;
  if (h < 0) return null;
  if (A > 1e-9) {
    const t = (-B - Math.sqrt(h)) / A;
    const y = baoa + t * bard;
    if (y > 0 && y < baba) return t >= 0 && t <= maxT ? t : null;
  }
  // End caps (spheres).
  for (const c of [a, b]) {
    const oc = sub(o, c);
    const b2 = dot(d, oc), c2 = dot(oc, oc) - r * r, h2 = b2 * b2 - c2;
    if (h2 > 0) {
      const t = -b2 - Math.sqrt(h2);
      if (t >= 0 && t <= maxT) return t;
    }
  }
  return null;
}

// Part endpoints in world space. Dummies turn to face the player (yaw), hitboxes included.
function partWorld(target, part) {
  const p = target.pos, c = Math.cos(target.yaw), s = Math.sin(target.yaw);
  const tr = (o) => v(p.x + o[0] * c + o[2] * s, p.y + o[1], p.z - o[0] * s + o[2] * c);
  return { a: tr(part.a), b: tr(part.b) };
}

export class Combat {
  constructor(boxes, targets) {
    this.boxes = boxes;
    this.targets = targets.map((t, id) => ({
      id, kind: 'dummy', base: v(t.x, t.y, t.z), pos: v(t.x, t.y, t.z), move: t.move ?? null, yaw: 0,
      hp: DUMMY_HP, maxHp: DUMMY_HP, dead: false, respawnT: 0,
    }));
    this.nextTargetId = this.targets.length;
    this.projectiles = [];
    this.fx = [];
    this.time = 0;
    this.enabled = true;
    this.setLoadout(DEFAULT_LOADOUT);
  }

  setLoadout(lo) {
    this.loadout = { ...lo };
    this.slots = { primary: WEAPONS[lo.primary], secondary: WEAPONS[lo.secondary] };
    this.state = {
      primary: { ammo: this.slots.primary.mag, reloadT: 0, nextFire: 0 },
      secondary: { ammo: this.slots.secondary.mag, reloadT: 0, nextFire: 0 },
    };
    this.active = 'primary';
    this.drawT = 0;
    this.ability = ABILITIES[lo.ability];
    this.abilityCd = 0;
    this.fireQueued = 0;
    this.projectiles.length = 0;
    this.lastHit = null;
  }

  resetTargets() {
    for (const t of this.targets) {
      if (t.kind === 'bot') continue;
      t.hp = t.maxHp; t.dead = false; t.respawnT = 0; t.pos = { ...t.base };
    }
  }

  get weapon() { return this.slots[this.active]; }
  get weaponState() { return this.state[this.active]; }

  tick(p, cmd, dt) {
    this.time += dt;
    this.updateTargets(p, dt);
    // Guns-off modes (e.g. the movement time trial): no firing or throwing.
    if (!this.enabled) {
      this.updateProjectiles(p, dt);
      return;
    }

    // Reloads tick on BOTH guns, so a holstered gun keeps reloading at the normal speed.
    for (const slot of ['primary', 'secondary']) {
      const s = this.state[slot];
      if (s.reloadT > 0) {
        s.reloadT -= dt;
        if (s.reloadT <= 0) { s.reloadT = 0; s.ammo = this.slots[slot].mag; }
      }
    }

    // Weapon switching. An empty gun starts reloading whether you switch to it or away from it.
    let want = cmd.slot;
    if (!want && cmd.cycle) want = this.active === 'primary' ? 'secondary' : 'primary';
    if (want && want !== this.active) {
      const prev = this.active;
      this.active = want;
      this.drawT = SWITCH_TIME;
      this.fx.push({ type: 'switch', slot: want });
      for (const slot of [prev, want]) {
        if (this.state[slot].ammo === 0 && this.state[slot].reloadT === 0) this.startReload(slot);
      }
    }
    this.drawT = Math.max(0, this.drawT - dt);

    const w = this.weapon, st = this.weaponState;
    if (cmd.reload && st.reloadT === 0 && st.ammo < w.mag) this.startReload();

    this.fireQueued = cmd.firePressed ? SEMI_BUFFER : Math.max(0, this.fireQueued - dt);
    const wantFire = w.auto ? cmd.fire : this.fireQueued > 0;
    if (wantFire && this.drawT === 0 && st.reloadT === 0 && this.time >= st.nextFire) {
      if (st.ammo <= 0) {
        this.startReload();
      } else {
        this.fireQueued = 0;
        this.fire(p, cmd, w);
        st.ammo--;
        st.nextFire = this.time + 1 / w.fireRate;
        if (st.ammo === 0) this.startReload();
      }
    }

    this.abilityCd = Math.max(0, this.abilityCd - dt);
    if (cmd.ability && this.abilityCd === 0) this.throwAbility(p, cmd);

    this.updateProjectiles(p, dt);
  }

  startReload(slot = this.active) {
    this.state[slot].reloadT = this.slots[slot].reload;
    // Only the gun in your hands makes reload noise/animation.
    if (slot === this.active) this.fx.push({ type: 'reload', weapon: this.slots[slot].id });
  }

  // ---------- raycasting ----------
  // pad: extra radius on every dummy part (projectiles have size; knives get extra forgiveness).
  // withTargets: false = walls only (line-of-sight checks, bot shots).
  raycast(o, d, maxT, pad = 0, withTargets = true) {
    let best = null;
    for (const b of this.boxes) {
      const h = rayBox(o, d, b, best ? best.t : maxT);
      if (h) best = { t: h.t, normal: h.normal, target: null, zone: null };
    }
    for (const tg of withTargets ? this.targets : []) {
      if (tg.dead) continue;
      for (const part of DUMMY_PARTS) {
        const { a, b } = partWorld(tg, part);
        // Heads only get half the padding so body throws don't turn into free headshots.
        const r = part.r + (part.zone === 'head' ? pad * 0.5 : pad);
        const t = rayCapsule(o, d, a, b, r, best ? best.t : maxT);
        if (t !== null) {
          const point = add(o, scale(d, t));
          best = { t, normal: norm(sub(point, closestOnSegment(point, a, b))), target: tg, zone: part.zone };
        }
      }
    }
    if (best) best.point = add(o, scale(d, best.t));
    // With padded (fattened) hitboxes the first shape the ray touches isn't always the part it
    // was really aimed at — the fat body can reach out in front of the head. Pick the zone
    // whose real (unpadded) shape the path passes closest to.
    if (best?.target && pad > 0) best.zone = this.closestZone(best.target, o, d, best.t, pad);
    return best;
  }

  closestZone(target, o, d, t0, pad) {
    let bestZone = 'body', bestGap = Infinity;
    for (let i = 0; i <= 12; i++) {
      const p = add(o, scale(d, t0 + (i / 12) * (pad * 2 + 0.8)));
      for (const part of DUMMY_PARTS) {
        const { a, b } = partWorld(target, part);
        const gap = len(sub(p, closestOnSegment(p, a, b))) - part.r;
        if (gap < bestGap) { bestGap = gap; bestZone = part.zone; }
      }
    }
    return bestZone;
  }

  zoneMult(zone, headMult) {
    return zone === 'head' ? headMult : zone === 'legs' ? LEG_MULT : 1;
  }

  damageTarget(t, dmg, zone, point) {
    if (t.dead) return;
    if (t.body?.invuln > 0) return; // spawn protection
    // Other online players: shots stop on them, but damage will be decided by the server (step 3).
    if (t.kind === 'remote') { this.fx.push({ type: 'impact', pos: point, normal: { x: 0, y: 1, z: 0 } }); return; }
    t.hp -= dmg;
    const kill = t.hp <= 0;
    if (kill) { t.dead = true; t.hp = 0; t.respawnT = DUMMY_RESPAWN; }
    this.lastHit = { dmg, zone, kill, time: this.time };
    this.fx.push({ type: 'hit', target: t.id, pos: point, dmg, zone, kill, name: t.name, bot: t.kind === 'bot' });
  }

  // ---------- bots (targets with a body that shoot back) ----------
  addTarget(opts) {
    const t = {
      id: this.nextTargetId++, kind: 'dummy', base: { ...opts.pos }, pos: opts.pos, move: null, yaw: 0,
      hp: DUMMY_HP, maxHp: DUMMY_HP, dead: false, respawnT: 0, ...opts,
    };
    this.targets.push(t);
    return t;
  }

  removeTarget(t) {
    this.targets = this.targets.filter((x) => x !== t);
    this.projectiles = this.projectiles.filter((pr) => pr.owner !== t);
  }

  // A bot fires a dodgeable shot. def: { speed, radius, damage }
  botShoot(bot, origin, dir, def) {
    this.projectiles.push({
      id: Math.random(), kind: 'botshot', def: { ...def, impact: 'player' }, owner: bot,
      pos: add(origin, scale(dir, 0.6)), vel: scale(dir, def.speed), age: 0, alive: true, stuck: false, resting: false,
    });
    this.fx.push({ type: 'botShot', pos: origin, target: bot.id });
  }

  // Damage to the player (bot arena). Returns true if it killed you.
  damagePlayer(p, dmg, from, by = null) {
    if (p.dead || p.invuln > 0) return false;
    p.hp = Math.max(0, p.hp - dmg);
    p.regenDelay = PLAYER_REGEN_DELAY;
    this.fx.push({ type: 'hurt', dmg, from: from ? { ...from } : null });
    if (p.hp <= 0) {
      p.dead = true;
      this.fx.push({ type: 'death', by });
      return true;
    }
    return false;
  }

  // Bot shots only care about walls and the player (bots can't hurt each other).
  updateBotShot(pr, p, dt) {
    const speed = len(pr.vel);
    const dir = scale(pr.vel, 1 / (speed || 1));
    const step = speed * dt + pr.def.radius;
    const wall = this.raycast(pr.pos, dir, step, 0, false);
    let playerT = null;
    if (!p.dead) {
      const hw = PLAYER.halfWidth + pr.def.radius;
      const box = {
        min: v(p.pos.x - hw, p.pos.y - pr.def.radius, p.pos.z - hw),
        max: v(p.pos.x + hw, p.pos.y + p.height + pr.def.radius, p.pos.z + hw),
      };
      playerT = rayBox(pr.pos, dir, box, wall ? wall.t : step)?.t ?? null;
    }
    if (playerT !== null) {
      this.damagePlayer(p, pr.def.damage, pr.owner?.pos, pr.owner?.name);
      this.fx.push({ type: 'botShotHit', pos: add(pr.pos, scale(dir, playerT)), player: true });
      pr.alive = false;
    } else if (wall) {
      this.fx.push({ type: 'botShotHit', pos: wall.point, normal: wall.normal, player: false });
      pr.alive = false;
    } else {
      pr.pos = add(pr.pos, scale(pr.vel, dt));
    }
    if (pr.age > 5) pr.alive = false;
  }

  // ---------- firing ----------
  fire(p, cmd, w) {
    const o = eyePosition(p);
    const d = aimDir(cmd.yaw, cmd.pitch);
    if (w.type === 'hitscan') {
      const ends = [];
      const perTarget = new Map(); // add up pellets so a shotgun blast shows one number per dummy
      for (let i = 0; i < w.pellets; i++) {
        const dir = spreadDir(d, w.spread);
        const hit = this.raycast(o, dir, w.range);
        ends.push(hit ? hit.point : add(o, scale(dir, w.range)));
        if (hit?.target) {
          const acc = perTarget.get(hit.target) ?? { dmg: 0, zone: hit.zone, point: hit.point };
          acc.dmg += w.damage * this.zoneMult(hit.zone, w.headMult);
          if (hit.zone === 'head') acc.zone = 'head';
          perTarget.set(hit.target, acc);
        } else if (hit) {
          this.fx.push({ type: 'impact', pos: hit.point, normal: hit.normal });
        }
      }
      for (const [t, acc] of perTarget) this.damageTarget(t, acc.dmg, acc.zone, acc.point);
      this.fx.push({ type: 'shot', weapon: w.id, origin: o, ends });
    } else {
      this.spawnProjectile(w.id, w.projectile, o, d, null);
      this.fx.push({ type: 'shot', weapon: w.id, origin: o, ends: [] });
    }
    if (w.knockback) {
      applyImpulse(p, scale(d, -w.knockback), w.name);
    }
  }

  throwAbility(p, cmd) {
    const a = this.ability;
    const d = aimDir(cmd.yaw, cmd.pitch);
    this.spawnProjectile(a.id, a.projectile, eyePosition(p), d, a.projectile.inherit === false ? null : p.vel);
    this.abilityCd = a.cooldown;
    this.fx.push({ type: 'throw', ability: a.id });
  }

  spawnProjectile(kind, def, origin, d, inheritVel) {
    const vel = add(scale(d, def.speed), v(0, def.up || 0, 0));
    if (inheritVel) { vel.x += inheritVel.x; vel.z += inheritVel.z; vel.y += Math.max(0, inheritVel.y) * 0.5; }
    this.projectiles.push({
      id: Math.random(), kind, def, pos: add(origin, scale(d, 0.5)), vel, age: 0,
      alive: true, stuck: false, resting: false,
    });
  }

  updateProjectiles(p, dt) {
    for (const pr of this.projectiles) {
      pr.age += dt;
      const def = pr.def;
      if (pr.kind === 'botshot') { this.updateBotShot(pr, p, dt); continue; }
      if (pr.stuck) {
        if (pr.age > 4) pr.alive = false;
        continue;
      }
      if (def.fuse && pr.age >= def.fuse) {
        this.explode(pr.pos, def.explode, p, pr.kind);
        pr.alive = false;
        continue;
      }
      if (pr.age > 8) { pr.alive = false; continue; }
      if (pr.resting) continue;

      pr.vel.y -= (def.gravity || 0) * dt;
      const speed = len(pr.vel);
      const dir = scale(pr.vel, 1 / (speed || 1));
      const hit = this.raycast(pr.pos, dir, speed * dt + def.radius, def.radius + (def.hitPad ?? 0));
      if (!hit) {
        pr.pos = add(pr.pos, scale(pr.vel, dt));
        continue;
      }
      if (def.impact === 'explode') {
        this.explode(add(hit.point, scale(dir, -0.1)), def.explode, p, pr.kind);
        pr.alive = false;
      } else if (def.impact === 'stick') {
        if (hit.target) {
          this.damageTarget(hit.target, def.damage * this.zoneMult(hit.zone, def.headMult), hit.zone, hit.point);
          pr.alive = false;
        } else {
          pr.pos = add(hit.point, scale(dir, -def.radius));
          pr.stuck = true;
          pr.age = 0;
          this.fx.push({ type: 'impact', pos: hit.point, normal: hit.normal });
        }
      } else if (def.impact === 'bounce') {
        const n = hit.normal;
        const vn = dot(pr.vel, n);
        pr.vel = scale(sub(pr.vel, scale(n, 2 * vn)), def.bounce);
        pr.pos = add(hit.point, scale(n, def.radius + 0.01));
        if (len(pr.vel) < 1.5 && n.y > 0.7) { pr.vel = v(0, 0, 0); pr.resting = true; }
      }
    }
    this.projectiles = this.projectiles.filter((pr) => pr.alive);
  }

  explode(pos, e, p, kind) {
    for (const t of this.targets) {
      if (t.dead) continue;
      let dMin = Infinity, zone = 'body';
      for (const part of DUMMY_PARTS) {
        const { a, b } = partWorld(t, part);
        const d = Math.max(0, len(sub(pos, closestOnSegment(pos, a, b))) - part.r);
        if (d < dMin) { dMin = d; zone = part.zone; }
      }
      if (dMin < e.radius) {
        const dmg = e.damage * (1 - 0.6 * (dMin / e.radius));
        this.damageTarget(t, dmg, zone === 'head' ? 'body' : zone, add(t.pos, v(0, 1.2, 0)));
        // Bots have real bodies — explosions launch them too.
        if (t.body && !t.dead) {
          const dir = norm(add(norm(sub(add(t.pos, v(0, 0.9, 0)), pos)), v(0, 0.5, 0)));
          applyImpulse(t.body, scale(dir, e.knockback * (1 - 0.5 * (dMin / e.radius))), kind);
        }
      }
    }

    // Knockback on the player (no self-damage on the dev server).
    const hw = PLAYER.halfWidth;
    const closest = v(
      Math.max(p.pos.x - hw, Math.min(pos.x, p.pos.x + hw)),
      Math.max(p.pos.y, Math.min(pos.y, p.pos.y + p.height)),
      Math.max(p.pos.z - hw, Math.min(pos.z, p.pos.z + hw)),
    );
    const d = len(sub(pos, closest));
    if (d < e.radius) {
      const center = v(p.pos.x, p.pos.y + p.height / 2, p.pos.z);
      // Bias upward so explosions always lift a bit — rocket/grenade jumps feel consistent.
      const dir = norm(add(norm(sub(center, pos)), v(0, 0.5, 0)));
      const strength = e.knockback * (1 - 0.5 * (d / e.radius));
      applyImpulse(p, scale(dir, strength), kind);
    }
    this.fx.push({ type: 'explosion', pos, radius: e.radius, kind });
  }

  updateTargets(p, dt) {
    for (const t of this.targets) {
      if (t.kind !== 'dummy') continue; // bots / players move, aim and respawn themselves
      if (t.dead) {
        t.respawnT -= dt;
        if (t.respawnT <= 0) { t.dead = false; t.hp = t.maxHp; }
      }
      if (t.move) {
        t.pos[t.move.axis] = t.base[t.move.axis] + Math.sin(this.time * t.move.speed) * t.move.amp;
      }
      t.yaw = Math.atan2(p.pos.x - t.pos.x, p.pos.z - t.pos.z);
    }
  }
}
