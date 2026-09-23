// Map data is plain boxes so the same collision can run on a server later.
// box(cx, cz, width, depth, height, bottomY, kind)
function box(cx, cz, w, d, h, y = 0, kind = 'block') {
  return {
    min: { x: cx - w / 2, y, z: cz - d / 2 },
    max: { x: cx + w / 2, y: y + h, z: cz + d / 2 },
    kind,
  };
}

const HALF = 40; // map is 80 x 80

export const SPAWN = { x: 0, y: 0, z: 30, yaw: 0 };

export const BOXES = [
  // Floor and outer walls
  box(0, 0, HALF * 2, HALF * 2, 1, -1, 'floor'),
  box(0, -HALF - 0.5, HALF * 2 + 2, 1, 8, 0, 'wall'),
  box(0, HALF + 0.5, HALF * 2 + 2, 1, 8, 0, 'wall'),
  box(-HALF - 0.5, 0, 1, HALF * 2, 8, 0, 'wall'),
  box(HALF + 0.5, 0, 1, HALF * 2, 8, 0, 'wall'),

  // Step test row near spawn: 0.3 and 0.45 auto-step, 0.6+ must be jumped
  box(-10, 22, 2, 2, 0.3, 0, 'test'),
  box(-7, 22, 2, 2, 0.45, 0, 'test'),
  box(-4, 22, 2, 2, 0.6, 0, 'test'),
  box(-1, 22, 2, 2, 1.0, 0, 'test'),
  box(2, 22, 2, 2, 1.4, 0, 'test'),
  box(5, 22, 2, 2, 2.0, 0, 'test'),

  // Slide tunnel: 1.2 m clearance, too low to stand in
  box(10, 16, 4.5, 8, 0.5, 1.2, 'low'),
  box(7.5, 16, 0.5, 8, 1.2, 0, 'low'),
  box(12.5, 16, 0.5, 8, 1.2, 0, 'low'),

  // Central tower with a staircase up the south side
  box(0, 0, 10, 10, 3.2, 0, 'block'),
  // 0.4 m rises, tallest step against the tower
  ...[3.2, 2.8, 2.4, 2.0, 1.6, 1.2, 0.8, 0.4].map((h, i) => box(0, 5.5 + i, 4, 1, h, 0, 'stair')),

  // Pillars
  box(-15, -10, 2, 2, 6, 0, 'pillar'),
  box(15, -10, 2, 2, 6, 0, 'pillar'),
  box(-15, 10, 2, 2, 6, 0, 'pillar'),
  box(15, 10, 2, 2, 6, 0, 'pillar'),
  box(-8, -22, 2, 2, 6, 0, 'pillar'),
  box(8, -22, 2, 2, 6, 0, 'pillar'),

  // Parallel walls (for wall-jump climbing later)
  box(26, -5, 1, 14, 10, 0, 'wall'),
  box(30, -5, 1, 14, 10, 0, 'wall'),

  // Wall-jump corridor: two long walls 4 m apart, zig-zag between them
  box(-14, -32, 24, 1, 7, 0, 'wall'),
  box(-14, -37, 24, 1, 7, 0, 'wall'),

  // Speed runway along the west side
  box(-30, 0, 1, 60, 1.2, 0, 'low'),
  box(-36, 0, 1, 60, 1.2, 0, 'low'),

  // Parkour platforms climbing toward the NE corner
  box(18, 22, 3, 3, 1.0, 0, 'plat'),
  box(22, 26, 3, 3, 2.0, 0, 'plat'),
  box(26, 30, 3, 3, 3.0, 0, 'plat'),
  box(31, 33, 3, 3, 4.0, 0, 'plat'),
  box(35, 28, 4, 8, 5.0, 0, 'plat'),
];

// ---------- Time trial course (far away at x ≈ 200, runs toward -Z) ----------
// Start room → sprint & slide under a bar → gap jumps → jump pad up → wall-jump gap →
// slide-jump gap → launcher → finish. Falling below killY sends you back to the start.
// Gap sizes are tuned to MOVE.walkSpeed / sprintSpeed / SLIDE — re-check with a sim if those change.
const TX = 200;
BOXES.push(
  // Start room
  box(TX, 10, 16, 20, 1, -1, 'trialfloor'),
  box(TX - 8.5, 10, 1, 20, 5, 0, 'wall'),
  box(TX + 8.5, 10, 1, 20, 5, 0, 'wall'),
  box(TX, 20.5, 18, 1, 5, 0, 'wall'),
  // Start gate
  box(TX - 4.5, 0, 1, 1, 4, 0, 'gate'),
  box(TX + 4.5, 0, 1, 1, 4, 0, 'gate'),
  box(TX, 0, 10, 1, 1, 4, 'gate'),
  // 1. Sprint + slide under the bar (1.1 m clearance — standing won't fit)
  box(TX, -20, 8, 40, 1, -1, 'trialfloor'),
  box(TX - 4.5, -20, 1, 40, 0.6, 0, 'low'),
  box(TX + 4.5, -20, 1, 40, 0.6, 0, 'low'),
  box(TX, -22, 8, 1.2, 1.5, 1.1, 'gate'),
  // 2. Gap jumps: 5 m (walk jump), 6 m, 7 m (need a sprint jump)
  box(TX, -48, 6, 6, 1, -1, 'plat'),
  box(TX, -60, 6, 6, 1, -1, 'plat'),
  box(TX, -73.5, 6, 7, 1, -1, 'plat'),   // jump pad on this one
  // 3. High platform (pad launches you up here)
  box(TX, -90, 8, 14, 1, 5, 'plat'),
  // 4. Wall-jump gap: no floor, zig-zag between the walls
  box(TX - 3.5, -109, 1, 20, 12, -2, 'wall'),
  box(TX + 3.5, -109, 1, 20, 12, -2, 'wall'),
  box(TX, -129, 8, 16, 1, 4, 'plat'),   // long, so a fast wall-jump exit still lands
  // 5. Slide-jump gap: 9 m — a sprint jump falls short, a sprint-slide jump clears it
  box(TX, -151, 8, 10, 1, 4, 'plat'),
  // 6. Finish platform (the launcher on the last platform flings you here) + back wall
  box(TX, -177, 12, 24, 1, 2, 'trialfloor'),
  box(TX, -189.5, 14, 1, 6, 3, 'wall'),
);

export const TRIAL = {
  start: { x: TX, y: 0, z: 14, yaw: 0 },
  startLineZ: 0,                  // the clock starts when you cross this
  killY: -8,
  // Finish trigger volume (under the checkered gate)
  finish: { min: { x: TX - 6, y: 2, z: -188 }, max: { x: TX + 6, y: 10, z: -168 } },
  exit: { x: TX - 5.5, y: 0, z: 17, label: 'BACK TO HUB' }, // portal back to the dev map
  board: { x: TX, y: 7.2, z: 0.6, w: 9, h: 3.4 },            // timer board above the start gate
};

// ---------- Bot arena (far away at x ≈ -200) ----------
// 70x70 box arena: raised center with jump pads, pillars, cover walls, side ledges and
// wall-jump walls. Bots and the player spawn around the edges.
const AX = -200;
BOXES.push(
  box(AX, 0, 72, 72, 1, -1, 'arenafloor'),
  box(AX, -36.5, 74, 1, 9, 0, 'wall'),
  box(AX, 36.5, 74, 1, 9, 0, 'wall'),
  box(AX - 36.5, 0, 1, 72, 9, 0, 'wall'),
  box(AX + 36.5, 0, 1, 72, 9, 0, 'wall'),
  // Raised center (jump pads on the east/west sides, stairs north/south)
  box(AX, 0, 12, 12, 3, 0, 'block'),
  // 0.4 m steps (walkable — anything over 0.45 m needs a jump)
  ...[2.6, 2.2, 1.8, 1.4, 1.0, 0.6, 0.2].map((h, i) => box(AX, 6.5 + i, 4, 1, h, 0, 'stair')),
  ...[2.6, 2.2, 1.8, 1.4, 1.0, 0.6, 0.2].map((h, i) => box(AX, -6.5 - i, 4, 1, h, 0, 'stair')),
  // Pillars
  box(AX - 15, -15, 3, 3, 6, 0, 'pillar'),
  box(AX + 15, -15, 3, 3, 6, 0, 'pillar'),
  box(AX - 15, 15, 3, 3, 6, 0, 'pillar'),
  box(AX + 15, 15, 3, 3, 6, 0, 'pillar'),
  // Low cover walls (crouch/slide behind them)
  box(AX - 7, -22, 7, 1, 1.4, 0, 'low'),
  box(AX + 7, 22, 7, 1, 1.4, 0, 'low'),
  box(AX - 24, 5, 1, 7, 1.4, 0, 'low'),
  box(AX + 24, -5, 1, 7, 1.4, 0, 'low'),
  box(AX + 8, -26, 1, 5, 1.4, 0, 'low'),
  box(AX - 8, 26, 1, 5, 1.4, 0, 'low'),
  // Side ledges (high ground along the east/west walls)
  box(AX - 31, -18, 10, 14, 2.5, 0, 'plat'),
  box(AX + 31, 18, 10, 14, 2.5, 0, 'plat'),
  // Wall-jump walls (tall, parallel pairs)
  box(AX - 26, 24, 1, 12, 7, 0, 'wall'),
  box(AX - 21, 24, 1, 12, 7, 0, 'wall'),
  box(AX + 26, -24, 1, 12, 7, 0, 'wall'),
  box(AX + 21, -24, 1, 12, 7, 0, 'wall'),
);

export const ARENA = {
  center: { x: AX, z: 0 },
  // Spread around the edges; the game picks the spawn farthest from the action.
  spawns: [
    { x: AX, y: 0, z: 31, yaw: 0 }, { x: AX, y: 0, z: -31, yaw: Math.PI },
    { x: AX + 31, y: 0, z: 0, yaw: Math.PI / 2 }, { x: AX - 31, y: 0, z: 0, yaw: -Math.PI / 2 },
    { x: AX + 30, y: 0, z: 30, yaw: Math.PI / 4 }, { x: AX - 30, y: 0, z: -30, yaw: -3 * Math.PI / 4 },
    { x: AX - 30, y: 0, z: 31, yaw: -Math.PI / 4 }, { x: AX + 30, y: 0, z: -31, yaw: 3 * Math.PI / 4 },
  ],
  // Places bots wander between when they can't see you.
  roam: [
    { x: AX, z: 0 }, { x: AX - 20, z: 0 }, { x: AX + 20, z: 0 }, { x: AX, z: 20 }, { x: AX, z: -20 },
    { x: AX - 20, z: -28 }, { x: AX + 20, z: 28 }, { x: AX - 28, z: 28 }, { x: AX + 28, z: -28 },
    { x: AX - 10, z: 12 }, { x: AX + 10, z: -12 },
  ],
  bounds: { minX: AX - 35, maxX: AX + 35, minZ: -35, maxZ: 35 },
};

// Teleporters in the dev map that take you to the time trial.
export const PORTALS = [
  { x: 13, y: 0, z: 35, guns: false, label: 'TIME TRIAL', sub: 'GUNS OFF' },
  { x: 19, y: 0, z: 35, guns: true, label: 'TIME TRIAL', sub: 'GUNS ON' },
];

// Octane-style jump pads (non-solid triggers on the floor). Defaults in config.JUMP_PAD.
// dir makes a directional launcher: fling along dir at `forward` m/s.
export const PADS = [
  { x: 6, y: 0, z: 30, radius: 1.2 },                // next to spawn
  { x: -7, y: 0, z: 8, radius: 1.2 },                // up onto the tower
  { x: 28, y: 0, z: -5, radius: 1.2 },               // inside the wall chimney
  { x: 30, y: 0, z: 22, radius: 1.2 },               // up to the high platform
  { x: -33, y: 0, z: 26, radius: 1.3, launch: 9, forward: 20, dir: { x: 0, z: -1 } }, // runway launcher
  // Bot arena: onto the raised center from the east and west
  { x: AX - 8.5, y: 0, z: 0, radius: 1.3 },
  { x: AX + 8.5, y: 0, z: 0, radius: 1.3 },
  // ...and up onto the side ledges
  { x: AX - 24, y: 0, z: -18, radius: 1.2 },
  { x: AX + 24, y: 0, z: 18, radius: 1.2 },
  // Time trial
  { x: TX, y: 0, z: -75, radius: 1.3 },                                                 // up to the high platform
  { x: TX, y: 5, z: -153, radius: 3.8, launch: 9, forward: 18, dir: { x: 0, z: -1 } },   // launcher to the finish (platform-wide — can't miss it at speed)
];

// Bean dummies (see combat.js). move = oscillate along an axis for tracking practice.
export const TARGETS = [
  { x: 0, y: 0, z: -15 },
  { x: -4, y: 0, z: -15 },
  { x: 4, y: 0, z: -15 },
  { x: -10, y: 0, z: -28 },
  { x: 10, y: 0, z: -28 },
  { x: 2.5, y: 3.2, z: -2.5 },   // on the tower
  { x: 35, y: 5, z: 30 },        // high platform
  { x: 20, y: 0, z: 0, move: { axis: 'z', amp: 4, speed: 1.2 } },
  { x: -20, y: 0, z: -15, move: { axis: 'x', amp: 5, speed: 0.9 } },
];

// Custom maps from the map editor (editor.html). Replaces the dev map's contents in place, so it
// must run before anything builds from BOXES / PADS (see main.js). Format:
//   { name, boxes: [{ x, z, w, d, h, y, kind }], pads: [{ x, y, z, radius, launch?, forward?, dir? }],
//     spawns: [{ x, y, z, yaw }] }
export function loadCustomMap(m) {
  BOXES.length = 0;
  for (const b of m.boxes ?? []) BOXES.push(box(b.x, b.z, b.w, b.d, b.h, b.y ?? 0, b.kind ?? 'block'));
  PADS.length = 0;
  for (const p of m.pads ?? []) {
    const pad = { x: p.x, y: p.y ?? 0, z: p.z, radius: p.radius ?? 1.2 };
    if (p.launch != null) pad.launch = p.launch;
    if (p.dir) { pad.dir = { x: p.dir.x, z: p.dir.z }; pad.forward = p.forward ?? 18; }
    PADS.push(pad);
  }
  const s = m.spawns?.[0];
  if (s) Object.assign(SPAWN, { x: s.x, y: s.y ?? 0, z: s.z, yaw: s.yaw ?? 0 });
  PORTALS.length = 0;
  TARGETS.length = 0;
}

export function overlaps(a, b) {
  const e = 1e-6;
  return (
    a.min.x < b.max.x - e && a.max.x > b.min.x + e &&
    a.min.y < b.max.y - e && a.max.y > b.min.y + e &&
    a.min.z < b.max.z - e && a.max.z > b.min.z + e
  );
}
