// Movement simulation. No three.js here — pure data + math so a server can run it too.
import { PLAYER, MOVE, SLIDE, AIR, JUMP_PAD, WALL } from './config.js';
import { overlaps, solidFor, rampSlope, PADS } from './world.js';

export function createPlayer(spawn) {
  return {
    pos: { x: spawn.x, y: spawn.y, z: spawn.z },
    vel: { x: 0, y: 0, z: 0 },
    height: PLAYER.height,
    grounded: false,
    crouching: false,
    sliding: false,
    slideCooldown: 0,  // time until the next slide gives a boost
    coyote: 0,
    jumpBuffer: 0,
    airTime: 0,
    frictionGrace: 0,  // skip ground friction briefly after knockback
    landGrace: 0,      // skip ground friction briefly after landing (keeps jump chains fast)
    hp: 100,           // health (only matters where something can hurt you — the bot arena)
    maxHp: 100,
    dead: false,
    regenDelay: 0,     // time until health starts regenerating
    invuln: 0,         // spawn protection
    sprinting: false,
    padCooldown: 0,
    padLaunches: 0,    // increments on every jump pad launch (visuals watch this)
    lastPad: -1,
    wallNormal: null,        // outward normal of the wall we're touching / last touched
    wallCoyote: 0,           // can still wall jump this long after leaving a wall
    wallJumps: 0,            // wall jumps since last touching the ground
    lastWallJumpT: -1,
    lastWallJumpNormal: null,
    state: 'air',
    time: 0,
    events: [], // movement events for the debug log: { t, name, detail }
  };
}

export function respawn(p, spawn) {
  p.pos = { x: spawn.x, y: spawn.y, z: spawn.z };
  p.vel = { x: 0, y: 0, z: 0 };
  p.sliding = false;
  p.slideCooldown = 0;
  logEvent(p, 'respawn');
}

// ---------- networking helpers ----------
// Everything the movement code reads/writes, as plain JSON (events log excluded).
export function snapshotState(p) {
  const s = {};
  for (const k of Object.keys(p)) {
    if (k === 'events' || k === 'impulseLog' || k === 'quiet') continue;
    const v = p[k];
    s[k] = v && typeof v === 'object' ? { ...v } : v;
  }
  return s;
}

// Put a player back into a state produced by snapshotState (keeps its events log).
export function restoreState(p, s) {
  for (const k of Object.keys(s)) {
    const v = s[k];
    p[k] = v && typeof v === 'object' ? { ...v } : v;
  }
}

function logEvent(p, name, detail = '') {
  if (p.quiet) return; // replaying inputs for network correction — don't re-log jumps/landings
  p.events.push({ t: p.time, name, detail });
  if (p.events.length > 8) p.events.shift();
}

export function eyePosition(p) {
  return { x: p.pos.x, y: p.pos.y + (p.crouching ? PLAYER.crouchEyeHeight : PLAYER.eyeHeight), z: p.pos.z };
}

// Knockback from guns/explosions. Anything pushing up cancels your fall first,
// so a rocket jump works the same whether you're rising or falling.
export function applyImpulse(p, imp, source = '') {
  // Online: the client records its own predicted knockback so it can be replayed exactly.
  if (p.impulseLog) p.impulseLog.push({ x: imp.x, y: imp.y, z: imp.z });
  if (imp.y > 0) {
    p.vel.y = Math.max(p.vel.y, 0);
    p.grounded = false;
    p.coyote = 0;
  }
  p.vel.x += imp.x;
  p.vel.y += imp.y;
  p.vel.z += imp.z;
  const strength = Math.hypot(imp.x, imp.y, imp.z);
  p.frictionGrace = Math.max(p.frictionGrace, MOVE.knockbackGrace + MOVE.knockbackGracePer * strength);
  logEvent(p, 'knockback', `${strength.toFixed(1)} m/s ${source}`);
}

// Returns the outward normal ({x, z}, axis-aligned) of a wall right next to the player, or null.
// Probes a thin slice on each side of the hitbox, ignoring the feet/head so floors and
// ceilings don't count as walls.
function findWall(p, boxes) {
  const hw = PLAYER.halfWidth, r = WALL.reach;
  const y0 = p.pos.y + 0.3, y1 = p.pos.y + p.height - 0.1;
  let best = null, bestScore = -Infinity;
  for (const [nx, nz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const probe = {
      min: { x: p.pos.x - hw - (nx > 0 ? r : 0), y: y0, z: p.pos.z - hw - (nz > 0 ? r : 0) },
      max: { x: p.pos.x + hw + (nx < 0 ? r : 0), y: y1, z: p.pos.z + hw + (nz < 0 ? r : 0) },
    };
    // Only the slice beyond the hitbox on the wall side matters. Shrink it a bit sideways so a
    // wall we're pressed flat against doesn't also register as a wall on our left/right.
    if (nx > 0) probe.max.x = p.pos.x - hw;
    if (nx < 0) probe.min.x = p.pos.x + hw;
    if (nz > 0) probe.max.z = p.pos.z - hw;
    if (nz < 0) probe.min.z = p.pos.z + hw;
    if (nx !== 0) { probe.min.z += 0.05; probe.max.z -= 0.05; }
    if (nz !== 0) { probe.min.x += 0.05; probe.max.x -= 0.05; }
    if (!boxes.some((b) => overlapsLoose(probe, solidFor(b, probe)))) continue;
    const score = -(p.vel.x * nx + p.vel.z * nz); // prefer the wall we're moving into
    if (score > bestScore) { bestScore = score; best = { x: nx, z: nz }; }
  }
  return best;
}

// Touching counts here (the probe sits flush against the wall face).
function overlapsLoose(a, b) {
  return a.min.x <= b.max.x && a.max.x >= b.min.x &&
    a.min.y < b.max.y && a.max.y > b.min.y &&
    a.min.z <= b.max.z && a.max.z >= b.min.z;
}

// Kick off the wall: keep momentum along the wall, push away from it (bent toward where
// you're steering), pop upward, and add a little speed bump.
function wallJump(p, n, wishDir) {
  const before = horizontalSpeed(p);
  const vn = p.vel.x * n.x + p.vel.z * n.z;
  const tx = p.vel.x - n.x * vn, tz = p.vel.z - n.z * vn;
  let dx = n.x, dz = n.z;
  if (wishDir) {
    const bx = n.x + wishDir.x, bz = n.z + wishDir.z, bl = Math.hypot(bx, bz);
    if (bl > 1e-3 && (bx * n.x + bz * n.z) / bl >= 0.3) { dx = bx / bl; dz = bz / bl; }
  }
  p.vel.x = tx * WALL.keepAlong + dx * WALL.jumpPush;
  p.vel.z = tz * WALL.keepAlong + dz * WALL.jumpPush;
  // The push only sets the direction; speed is what you had plus a small bump, so chaining
  // wall jumps is a steady gain instead of snowballing.
  setHorizontalSpeed(p, Math.max(before, MOVE.walkSpeed) + WALL.speedBump);
  p.vel.y = WALL.jumpUp;
  p.wallJumps++;
  p.jumpBuffer = 0;
  p.wallCoyote = 0;
  p.lastWallJumpT = p.time;
  p.lastWallJumpNormal = { ...n };
  p.frictionGrace = 0;
  logEvent(p, 'wall jump', `#${p.wallJumps} ${horizontalSpeed(p).toFixed(1)} m/s`);
}

function checkPads(p) {
  if (p.padCooldown > 0) return;
  for (let i = 0; i < PADS.length; i++) {
    const pad = PADS[i];
    const feet = p.pos.y - pad.y;
    if (feet < -0.1 || feet > 0.4) continue;
    if (Math.hypot(p.pos.x - pad.x, p.pos.z - pad.z) > pad.radius) continue;

    p.vel.y = pad.launch ?? JUMP_PAD.launch;
    if (pad.dir) {
      // Directional pad: fling along its arrow, keeping extra speed if you were already faster.
      const along = p.vel.x * pad.dir.x + p.vel.z * pad.dir.z;
      const f = Math.max(pad.forward, along);
      p.vel.x = pad.dir.x * f;
      p.vel.z = pad.dir.z * f;
    } else {
      const speed = horizontalSpeed(p);
      if (speed > 1) setHorizontalSpeed(p, speed + (pad.forward ?? JUMP_PAD.forwardBoost));
    }
    p.grounded = false;
    p.coyote = 0;
    p.sliding = false;
    p.padCooldown = JUMP_PAD.cooldown;
    p.padLaunches++;
    p.wallJumps = 0;
    p.lastPad = i;
    logEvent(p, 'jump pad', `${horizontalSpeed(p).toFixed(1)} m/s`);
    return;
  }
}

export function horizontalSpeed(p) {
  return Math.hypot(p.vel.x, p.vel.z);
}

function setHorizontalSpeed(p, speed) {
  const cur = horizontalSpeed(p);
  if (cur < 1e-6) return;
  p.vel.x *= speed / cur;
  p.vel.z *= speed / cur;
}

function aabb(p) {
  const hw = PLAYER.halfWidth;
  return {
    min: { x: p.pos.x - hw, y: p.pos.y, z: p.pos.z - hw },
    max: { x: p.pos.x + hw, y: p.pos.y + p.height, z: p.pos.z + hw },
  };
}

function blocked(p, boxes) {
  const a = aabb(p);
  return boxes.some((b) => overlaps(a, solidFor(b, a)));
}

// The ramp we're standing on, if any.
function rampUnder(p, boxes) {
  const a = aabb(p);
  a.min.y -= 0.06;
  for (const b of boxes) {
    if (!b.ramp) continue;
    const s = solidFor(b, a);
    if (overlaps(a, s) && Math.abs(s.max.y - p.pos.y) < 0.06) return b;
  }
  return null;
}

// After walking down a ramp (or off its bottom), put our feet back on the ground if it's
// only a little below — otherwise every downhill step would be a tiny fall.
function snapDown(p, boxes, maxDrop) {
  const a = aabb(p);
  a.min.y -= maxDrop;
  let top = -Infinity;
  for (const b of boxes) {
    const s = solidFor(b, a);
    if (!overlaps(a, s)) continue;
    if (s.max.y > p.pos.y + 1e-6) return false; // something at our feet level: not a clean drop
    top = Math.max(top, s.max.y);
  }
  if (top === -Infinity) return false;
  p.pos.y = top;
  return true;
}

// Quake-style acceleration toward wishDir, but input alone can never raise total
// horizontal speed above max(current speed, walkSpeed) — this kills air/ground strafe gain.
// Speed above walkSpeed has to come from other sources (slides, knockback, etc.).
function accelerate(vel, wishDir, wishSpeed, accel, dt) {
  const before = Math.hypot(vel.x, vel.z);
  const current = vel.x * wishDir.x + vel.z * wishDir.z;
  const add = wishSpeed - current;
  if (add <= 0) return;
  const amount = Math.min(accel * wishSpeed * dt, add);
  vel.x += wishDir.x * amount;
  vel.z += wishDir.z * amount;
  const cap = Math.max(before, wishSpeed);
  const after = Math.hypot(vel.x, vel.z);
  if (after > cap) {
    vel.x *= cap / after;
    vel.z *= cap / after;
  }
}

function applyFriction(vel, dt) {
  const speed = Math.hypot(vel.x, vel.z);
  if (speed < 1e-4) { vel.x = vel.z = 0; return; }
  const drop = Math.max(speed, MOVE.stopSpeed) * MOVE.friction * dt;
  const scale = Math.max(speed - drop, 0) / speed;
  vel.x *= scale;
  vel.z *= scale;
}

// Turn horizontal velocity toward wishDir by at most maxTurn radians, keeping speed.
function steer(vel, wishDir, maxTurn) {
  const speed = Math.hypot(vel.x, vel.z);
  if (speed < 1e-4) return;
  const cur = Math.atan2(vel.z, vel.x);
  let diff = Math.atan2(wishDir.z, wishDir.x) - cur;
  diff = Math.atan2(Math.sin(diff), Math.cos(diff));
  if (Math.abs(diff) > Math.PI * 0.75) return; // holding back doesn't reverse momentum
  const a = cur + Math.max(-maxTurn, Math.min(maxTurn, diff));
  vel.x = Math.cos(a) * speed;
  vel.z = Math.sin(a) * speed;
}

// Apex-style air control: your momentum swings toward where you're steering (keys + aim)
// at a fixed turn rate, keeping its speed. Steering backwards brakes instead of reversing.
// Below walk speed you can still accelerate normally (e.g. a standing jump then W).
// noBrake: right after a gun knockback, holding the "wrong" way doesn't cancel the boost.
function airControl(vel, wishDir, dt, noBrake = false) {
  const speed = Math.hypot(vel.x, vel.z);
  if (speed > 0.5) {
    const cur = Math.atan2(vel.z, vel.x);
    let diff = Math.atan2(wishDir.z, wishDir.x) - cur;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    if (Math.abs(diff) > AIR.brakeAngle) {
      if (noBrake) return;
      const s = Math.max(0, speed - AIR.brake * dt);
      vel.x *= s / speed;
      vel.z *= s / speed;
      return;
    }
    steer(vel, wishDir, AIR.turnRate * dt);
  }
  accelerate(vel, wishDir, MOVE.walkSpeed, AIR.accel, dt);
}

// Crouch shrinks the hitbox from the top. Standing up needs headroom.
function updateCrouch(p, wantCrouch, boxes) {
  if (wantCrouch && !p.crouching) {
    p.crouching = true;
    p.height = PLAYER.crouchHeight;
  } else if (!wantCrouch && p.crouching) {
    p.height = PLAYER.height;
    if (blocked(p, boxes)) p.height = PLAYER.crouchHeight; // no room, stay down
    else p.crouching = false;
  }
}

function startSlide(p, reason, allowBoost = true) {
  const speed = horizontalSpeed(p);
  if (speed < SLIDE.minSpeed) return;
  let newSpeed = speed;
  if (allowBoost && p.slideCooldown <= 0) {
    newSpeed = Math.max(speed, Math.min(speed + SLIDE.boost, SLIDE.boostMaxSpeed));
    setHorizontalSpeed(p, newSpeed);
    p.slideCooldown = SLIDE.boostCooldown;
  }
  p.sliding = true;
  const boosted = newSpeed > speed + 0.01;
  logEvent(p, reason, boosted ? `${speed.toFixed(1)}→${newSpeed.toFixed(1)} m/s` : `${speed.toFixed(1)} m/s (no boost)`);
}

// Move along one axis and push out of anything we hit. Returns the box hit, if any.
function moveAxis(p, axis, delta, boxes) {
  if (delta === 0) return null;
  p.pos[axis] += delta;
  let hit = null;
  const hw = PLAYER.halfWidth;
  for (const box of boxes) {
    const a = aabb(p);
    const b = solidFor(box, a);
    if (!overlaps(a, b)) continue;
    hit = b;
    if (axis === 'y') {
      p.pos.y = delta < 0 ? b.max.y : b.min.y - p.height;
    } else {
      p.pos[axis] = delta > 0 ? b.min[axis] - hw : b.max[axis] + hw;
    }
  }
  return hit;
}

// Horizontal move with automatic step-up onto low ledges while grounded.
function moveHorizontal(p, axis, delta, boxes, wasGrounded) {
  const start = p.pos[axis];
  const hit = moveAxis(p, axis, delta, boxes);
  if (!hit) return;
  const rise = hit.max.y - p.pos.y;
  if (wasGrounded && rise > 0 && rise <= PLAYER.stepHeight) {
    const saved = { ...p.pos };
    p.pos[axis] = start + delta;
    p.pos.y = hit.max.y + 1e-4;
    if (!blocked(p, boxes)) {
      logEvent(p, 'step-up', `${rise.toFixed(2)} m`);
      return;
    }
    p.pos = saved;
  }
  p.vel[axis] = 0;
}

export function stepPlayer(p, cmd, boxes, dt) {
  p.time += dt;
  const wasGrounded = p.grounded;

  // Wish direction from yaw. Yaw 0 looks down -Z.
  const sin = Math.sin(cmd.yaw), cos = Math.cos(cmd.yaw);
  let wx = -sin * cmd.forward + cos * cmd.right;
  let wz = -cos * cmd.forward - sin * cmd.right;
  const len = Math.hypot(wx, wz);
  if (len > 0) { wx /= len; wz /= len; }
  const wishDir = { x: wx, z: wz };

  if (cmd.jump) p.jumpBuffer = MOVE.jumpBuffer;
  else p.jumpBuffer = Math.max(0, p.jumpBuffer - dt);
  p.coyote = p.grounded ? MOVE.coyoteTime : Math.max(0, p.coyote - dt);
  p.slideCooldown = Math.max(0, p.slideCooldown - dt);
  p.frictionGrace = Math.max(0, p.frictionGrace - dt);
  p.landGrace = Math.max(0, p.landGrace - dt);
  p.padCooldown = Math.max(0, p.padCooldown - dt);

  // Ramps: sliding downhill speeds you up; running uphill carries you up and off the top.
  const ramp = p.grounded ? rampUnder(p, boxes) : null;
  let rampVy = 0;
  if (ramp) {
    const s = rampSlope(ramp);
    const up = { x: 0, z: 0 };
    up[ramp.ramp.axis] = ramp.ramp.dir;
    rampVy = Math.max(0, p.vel.x * up.x + p.vel.z * up.z) * s;
    p.rampDown = { x: -up.x, z: -up.z, a: (MOVE.gravity * s) / Math.hypot(1, s) };
  } else {
    p.rampDown = null;
  }

  // Slide (hold slide key) and crouch (hold crouch key) are separate.
  if (p.grounded && cmd.slidePressed && !p.sliding) startSlide(p, 'slide');
  if (p.sliding && !cmd.slide) { p.sliding = false; logEvent(p, 'slide cancel'); }
  if (p.sliding && horizontalSpeed(p) < SLIDE.endSpeed) { p.sliding = false; logEvent(p, 'slide end'); }
  updateCrouch(p, cmd.crouch || p.sliding, boxes);

  if (p.grounded) {
    if (p.sliding) {
      setHorizontalSpeed(p, Math.max(0, horizontalSpeed(p) - SLIDE.friction * dt));
      if (p.rampDown) { // gravity pulls you down the slope
        p.vel.x += p.rampDown.x * p.rampDown.a * dt;
        p.vel.z += p.rampDown.z * p.rampDown.a * dt;
      }
      if (len > 0) steer(p.vel, wishDir, SLIDE.steerRate * dt);
    } else {
      // Sprint only counts when moving forward-ish (not backpedaling or pure strafing).
      const sprinting = cmd.sprint && cmd.forward > 0 && !p.crouching;
      const wishSpeed = p.crouching ? PLAYER.crouchSpeed : sprinting ? MOVE.sprintSpeed : MOVE.walkSpeed;
      const speed = horizontalSpeed(p);
      const along = len > 0 && speed > 0.01 ? (p.vel.x * wishDir.x + p.vel.z * wishDir.z) / speed : -1;
      if (p.frictionGrace > 0 || p.landGrace > 0) {
        // just landed / just got knocked back: keep everything for a moment
      } else if (speed > wishSpeed && along > 0.7) {
        // Carrying extra speed and still pushing that way: let it fade slowly (momentum!)
        setHorizontalSpeed(p, Math.max(wishSpeed, speed - MOVE.overspeedDecay * dt));
      } else {
        applyFriction(p.vel, dt);
      }
      p.sprinting = sprinting && speed > MOVE.walkSpeed - 0.5;
      if (len > 0) accelerate(p.vel, wishDir, wishSpeed, MOVE.groundAccel, dt);
    }
  } else if (len > 0) {
    airControl(p.vel, wishDir, dt, p.frictionGrace > 0);
  }

  // Walls: touching one in the air lets you wall jump off it.
  const wall = p.grounded ? null : findWall(p, boxes);
  if (wall) {
    p.wallNormal = wall;
    p.wallCoyote = WALL.coyoteTime;
  } else {
    p.wallCoyote = Math.max(0, p.wallCoyote - dt);
  }

  if (p.jumpBuffer > 0 && p.coyote > 0) {
    p.vel.y = MOVE.jumpVelocity + rampVy; // jumping while running up a ramp goes higher
    p.grounded = false;
    p.coyote = 0;
    p.jumpBuffer = 0;
    const name = p.sliding ? 'slide jump' : wasGrounded ? 'jump' : 'coyote jump';
    p.sliding = false;
    logEvent(p, name, `${horizontalSpeed(p).toFixed(1)} m/s`);
  } else if (p.jumpBuffer > 0 && !p.grounded && p.wallCoyote > 0 && p.wallJumps < WALL.maxJumps) {
    const n = p.wallNormal;
    const sameWall = p.lastWallJumpNormal && p.lastWallJumpNormal.x === n.x && p.lastWallJumpNormal.z === n.z;
    if (!sameWall || p.time - p.lastWallJumpT >= WALL.sameWallDelay) wallJump(p, n, len > 0 ? wishDir : null);
  }

  p.vel.y = Math.min(Math.max(p.vel.y - MOVE.gravity * dt, -MOVE.maxFallSpeed), MOVE.maxRiseSpeed);

  // Hard momentum cap — nothing gets you past this.
  if (horizontalSpeed(p) > MOVE.maxSpeed) setHorizontalSpeed(p, MOVE.maxSpeed);

  // Substep so fast movement can't tunnel through thin geometry.
  const maxStep = 0.25;
  const dist = Math.max(Math.abs(p.vel.x), Math.abs(p.vel.y), Math.abs(p.vel.z)) * dt;
  const steps = Math.max(1, Math.ceil(dist / maxStep));
  const sdt = dt / steps;
  let landed = false;
  for (let i = 0; i < steps; i++) {
    moveHorizontal(p, 'x', p.vel.x * sdt, boxes, wasGrounded);
    moveHorizontal(p, 'z', p.vel.z * sdt, boxes, wasGrounded);
    const vy = p.vel.y;
    if (moveAxis(p, 'y', vy * sdt, boxes)) {
      if (vy < 0) landed = true;
      p.vel.y = 0;
    }
  }

  // Ramps: stick to the slope going down; fly off the top going up.
  if (wasGrounded && !landed && p.vel.y <= 0) {
    if (ramp && snapDown(p, boxes, horizontalSpeed(p) * dt * 1.5 + 0.05)) {
      landed = true;
      p.vel.y = 0;
    } else if (rampVy > 0) {
      p.vel.y = rampVy;
      logEvent(p, 'ramp launch', `${rampVy.toFixed(1)} m/s up`);
    }
  }

  if (landed && !wasGrounded) {
    p.landGrace = MOVE.landGrace;
    logEvent(p, 'land', `${horizontalSpeed(p).toFixed(1)} m/s after ${p.airTime.toFixed(2)} s`);
    // Only a real fall/jump earns a boosted landing slide. Dropping off a small box
    // mid-slide just carries the slide on, with no new boost.
    if (cmd.slide && !p.sliding) {
      const realFall = p.airTime >= SLIDE.landMinAirTime;
      startSlide(p, realFall ? 'land slide' : 'slide continue', realFall);
    }
  }
  if (!landed && wasGrounded && p.vel.y <= 0) logEvent(p, 'left ground');
  p.grounded = landed;
  p.airTime = p.grounded ? 0 : p.airTime + dt;
  if (p.grounded) {
    p.wallJumps = 0;
    p.wallCoyote = 0;
    p.lastWallJumpNormal = null;
  }
  if (!p.grounded && p.sliding && p.vel.y < 0) p.sliding = false; // slid off a ledge
  checkPads(p);

  const speed = horizontalSpeed(p);
  if (!p.grounded) p.state = p.vel.y > 0 ? 'rising' : 'falling';
  else if (p.sliding) p.state = 'sliding';
  else if (p.crouching) p.state = speed > 0.5 ? 'crouch walk' : 'crouched';
  else p.state = speed > 0.5 ? (p.sprinting ? 'sprinting' : 'walking') : 'idle';
}
