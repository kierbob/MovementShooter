// Runs the Bean Street movement routes through the real movement code (src/player.js).
//   node tools/check_bean_street.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const W = await import(new URL('../src/world.js', import.meta.url));
const { createPlayer, stepPlayer } = await import(new URL('../src/player.js', import.meta.url));
const { TICK_DT, PLAYER } = await import(new URL('../src/config.js', import.meta.url));
const map = JSON.parse(readFileSync(join(root, 'maps', 'bean-street.json'), 'utf8'));
W.loadCustomMap(map);

const E = Math.PI / 2;
const base = {
  forward: 0, right: 0, jump: false, jumpHeld: false, sprint: false, crouch: false, slide: false, slidePressed: false,
  fire: false, firePressed: false, reload: false, ability: false, slot: null, cycle: 0, yaw: 0, pitch: 0,
};
// brain(p, t) returns the command for this tick, or null to stop.
function sim(start, secs, brain) {
  const p = createPlayer(start);
  let maxY = p.pos.y, maxSpeed = 0;
  for (let t = 0; t < secs; t += TICK_DT) {
    const c = brain(p, t);
    if (!c) break;
    stepPlayer(p, { ...base, ...c }, W.BOXES, TICK_DT);
    maxY = Math.max(maxY, p.pos.y);
    maxSpeed = Math.max(maxSpeed, Math.hypot(p.vel.x, p.vel.z));
  }
  return { p, maxY, maxSpeed };
}
const fmt = (r) => `pos (${r.p.pos.x.toFixed(1)}, ${r.p.pos.y.toFixed(2)}, ${r.p.pos.z.toFixed(1)}) maxY ${r.maxY.toFixed(2)} maxSpeed ${r.maxSpeed.toFixed(1)}`;
let fails = 0;
function check(name, ok, r) {
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${r ? fmt(r) : ''}`);
}

// Nothing spawns inside geometry.
const hw = PLAYER.halfWidth;
const inside = (x, y, z, h) => W.BOXES.some((b) => {
  const a = { min: { x: x - hw, y: y + 0.01, z: z - hw }, max: { x: x + hw, y: y + h, z: z + hw } };
  return W.overlaps(a, W.solidFor(b, a));
});
check('spawns clear', map.spawns.every((s) => !inside(s.x, s.y, s.z, 1.8)));
check('pads clear', map.pads.every((p) => !inside(p.x, p.y, p.z, 0.2)));

// House ramp onto the upper floor.
let r = sim({ x: -12.9, y: 0, z: 3.8 }, 1.2, (p, t) => (t < 0.62 ? { forward: 1, yaw: E } : { forward: 1, yaw: 0 }));
check('house ramp -> upper floor', Math.abs(r.p.pos.y - 3.2) < 0.05 && r.p.pos.z < 2.6, r);

// Backyard launch ramp -> jump at the top -> through the upstairs back window.
r = sim({ x: -36.3, y: 0, z: 0 }, 2.5, (p) => ({ forward: 1, sprint: true, yaw: -E, jump: p.pos.x > -29.8 && p.pos.x < -28 && p.grounded, jumpHeld: true }));
check('launch ramp -> upstairs back window', Math.abs(r.p.pos.y - 3.2) < 0.05 && r.p.pos.x > -23.8, r);

// Wall-jump chimney between the border (x = -37) and the billboard (x = -34..-33).
r = sim({ x: -35.5, y: 0, z: 17 }, 4, (p, t) => {
  const towardBillboard = p.pos.x < -35.5;
  const aim = towardBillboard ? -E : E;     // steer at the wall we're about to kick off
  const touching = p.wallCoyote > 0 && p.wallNormal;
  const kick = touching && p.vel.y < 1.5;
  const away = touching ? (p.wallNormal.x > 0 ? -E : E) : aim;
  if (p.maxClimbDone) return { forward: 1, yaw: -E };   // hop onto the billboard top
  if (p.wallJumps >= 4 && p.vel.y < 0.5 && p.pos.y > 5) p.maxClimbDone = true;
  return { forward: 1, yaw: kick ? away : aim, jump: p.grounded && t < 0.2 || kick, jumpHeld: true };
});
const billboardTop = W.BOXES.find((b) => b.min.x === -34 && b.max.x === -33).max.y;
console.log(`      chimney climb reached ${r.maxY.toFixed(2)} m (billboard top ${billboardTop} m)`);
check('chimney -> billboard top', r.maxY > billboardTop + 0.3, r);

// Bus bridge: sprint up, over the roof, slide down the far ramp.
r = sim({ x: 0, y: 0, z: 14 }, 2.6, (p) => {
  const onFarRamp = p.pos.z < -5.4 && p.pos.y > 0.2;
  return { forward: 1, sprint: true, yaw: 0, slide: onFarRamp || p.sliding, slidePressed: onFarRamp && !p.sliding };
});
check('bus bridge slide boost (> 16 m/s)', r.maxSpeed > 16, r);

// Truck: ramp onto the cab, jump onto the box.
r = sim({ x: -6, y: 0, z: 3 }, 1.6, (p) => p.pos.z > 16 ? null : ({ forward: 1, sprint: true, yaw: Math.PI, jump: p.pos.z > 10.6 && p.pos.z < 11.6 && p.grounded, jumpHeld: true }));
check('truck ramp -> truck roof', Math.abs(r.p.pos.y - 3.0) < 0.05, r);

// Street-end overlook.
r = sim({ x: 15, y: 0, z: -25.75 }, 1.2, () => ({ forward: 1, yaw: E }));
check('overlook ramp -> overlook', Math.abs(r.p.pos.y - 3.2) < 0.05, r);

// Shed ramp.
r = sim({ x: -31, y: 0, z: -7 }, 1.2, () => ({ forward: 1, yaw: 0 }));
check('shed ramp -> shed roof', Math.abs(r.p.pos.y - 2.8) < 0.05, r);

// Yard pad -> roof.
r = sim({ x: -26.5, y: 0, z: 6.5 }, 2, (p, t) => (t < 0.2 ? {} : { forward: 1, yaw: -E }));
check('yard pad -> roof', Math.abs(r.p.pos.y - 6.5) < 0.05, r);

// Crouch-jump through a downstairs front window (from the yard, into the house).
r = sim({ x: -4, y: 0, z: 4.5 }, 1.2, (p) => ({ forward: 1, sprint: true, yaw: E, crouch: p.pos.x < -10, jump: p.pos.x < -10.3 && p.pos.x > -11.5 && p.grounded, jumpHeld: true }));
check('crouch-jump through front window', r.p.pos.x < -12.5, r);

console.log(fails ? `\n${fails} check(s) failed` : '\nall routes OK');
process.exitCode = fails ? 1 : 0;
