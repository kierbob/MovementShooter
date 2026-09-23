// Movement Shooter multiplayer server.
// Authoritative: every player's movement AND combat is simulated here with the exact same
// code the browser uses (../src/player.js, ../src/combat.js). Clients send their inputs;
// the server steps everyone at 120 ticks/s and sends snapshots at 30/s.
//
// Protocol (JSON):
//   client → server  { t: 'hello', name, loadout }
//                    { t: 'input', cmds: [{ seq, vt, forward, right, jump, fire, ..., yaw, pitch }] }
//                    { t: 'ping', ts }
//   server → client  { t: 'welcome', id, tickRate, snapRate, spawn, map }   (map: { id, name, data } or null)
//                    { t: 'snap', tick, players, proj, ev, me }
//                    { t: 'pong', ts }   { t: 'full' }
//
// Lag compensation: each input carries `vt`, the server tick the client was *looking at*
// when it pressed the button (other players are drawn ~100 ms in the past). While that
// player's shots are processed, everyone else is rewound to where they were at `vt`.
import { WebSocketServer } from 'ws';
import { TICK_DT, TICK_RATE } from '../src/config.js';
import { readFileSync } from 'node:fs';
import { BOXES, ARENA, loadCustomMap } from '../src/world.js';
import { createPlayer, stepPlayer, snapshotState } from '../src/player.js';
import { Combat } from '../src/combat.js';
import { WEAPONS, ABILITIES, DEFAULT_LOADOUT } from '../src/items.js';

const PORT = Number(process.env.PORT) || 8080;

// Which map to host: MAP = a name from maps/ (e.g. bean-street), a path to an exported .json,
// or "hub" for the old dev/arena map. Joining players download it automatically.
const MAP_ARG = process.env.MAP || 'bean-street';
let MAP = null;          // { id, name, data } sent to clients, or null for the hub
let SPAWNS = ARENA.spawns;
if (MAP_ARG !== 'hub') {
  const file = /[\\/.]/.test(MAP_ARG) ? MAP_ARG : new URL(`../maps/${MAP_ARG}.json`, import.meta.url);
  const text = readFileSync(file, 'utf8');
  const data = JSON.parse(text);
  loadCustomMap(data);
  if (data.spawns?.length) SPAWNS = data.spawns;
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
  MAP = { id: h.toString(36), name: data.name || 'Custom map', data };
  console.log(`Map: ${MAP.name} (${data.boxes?.length ?? 0} boxes, ${SPAWNS.length} spawns)`);
} else {
  console.log('Map: hub (dev map, bot arena area)');
}
const MAX_PLAYERS = 8;
const SNAP_RATE = 30;
const MAX_QUEUE = 12;          // buffered input ticks per client before we skip ahead
const HISTORY = 128;           // ticks of position history kept for lag compensation (~1 s)
const MAX_REWIND = 30;         // never rewind more than 250 ms
const RESPAWN_DELAY = 2.5;
const SPAWN_PROTECTION = 1.5;
const REGEN_DELAY = 3;         // matches the Bot Arena
const REGEN_RATE = 30;

const COLORS = [0x4fc3ff, 0xff6b6b, 0x7ee787, 0xffd35a, 0xc792ea, 0xff9e3d, 0x5ce1e6, 0xff7eb6];

const clients = new Map(); // id -> client
let nextId = 1;
let tick = 0;
let events = [];           // gameplay events since the last snapshot (sent to everyone)

const NEUTRAL = {
  forward: 0, right: 0, jump: false, jumpHeld: false, sprint: false, crouch: false,
  slide: false, slidePressed: false, fire: false, firePressed: false, reload: false,
  ability: false, slot: null, cycle: 0, yaw: 0, pitch: 0,
};

function pickSpawn(exclude = null) {
  // Farthest spawn from everyone alive (random among the best few so it isn't predictable).
  const others = [...clients.values()].filter((c) => c !== exclude && !c.player.dead).map((c) => c.player.pos);
  const scored = SPAWNS.map((s) => ({
    s, d: others.length ? Math.min(...others.map((o) => Math.hypot(o.x - s.x, o.z - s.z))) : Math.random(),
  })).sort((a, b) => b.d - a.d);
  return scored[Math.floor(Math.random() * Math.min(3, scored.length))].s;
}

function freeColor() {
  const used = new Set([...clients.values()].map((c) => c.color));
  return COLORS.find((c) => !used.has(c)) ?? COLORS[nextId % COLORS.length];
}

function cleanName(raw) {
  const n = String(raw ?? '').replace(/[^\w \-.!?]/g, '').replace(/\s+/g, ' ').trim().slice(0, 16);
  return n || 'Bean';
}

function cleanLoadout(lo) {
  return {
    primary: WEAPONS[lo?.primary]?.slot === 'primary' ? lo.primary : DEFAULT_LOADOUT.primary,
    secondary: WEAPONS[lo?.secondary]?.slot === 'secondary' ? lo.secondary : DEFAULT_LOADOUT.secondary,
    ability: ABILITIES[lo?.ability] ? lo.ability : DEFAULT_LOADOUT.ability,
  };
}

function send(ws, msg) {
  if (ws.readyState === ws.OPEN) ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg));
}

function spawnPlayer(c) {
  const s = pickSpawn(c);
  const p = c.player;
  p.pos = { x: s.x, y: s.y, z: s.z };
  p.vel = { x: 0, y: 0, z: 0 };
  p.sliding = false;
  p.hp = p.maxHp;
  p.dead = false;
  p.invuln = SPAWN_PROTECTION;
  p.regenDelay = 0;
  c.target.hp = c.target.maxHp;
  c.target.dead = false;
  c.combat.setLoadout(c.loadout); // fresh ammo + ability
  c.lastCmd = { ...NEUTRAL, yaw: s.yaw ?? 0 };
  return s;
}

const wss = new WebSocketServer({ port: PORT });
wss.on('listening', () => {
  console.log(`Movement Shooter server listening on ws://localhost:${PORT}`);
  console.log('In the game: Change Mode -> Multiplayer, server "localhost:8080" (or this PC\'s LAN IP for friends on your Wi-Fi).');
});
wss.on('error', (err) => {
  if (err.code === 'EADDRINUSE') console.error(`Port ${PORT} is already in use - the server is probably already running.`);
  else console.error('Server error:', err.message);
  process.exit(1);
});

wss.on('connection', (ws, req) => {
  let client = null;
  // A dropped connection (tab killed, Wi-Fi blip) can raise a socket error; handle it so it
  // can never take the whole server down. 'close' still fires afterwards and cleans up.
  ws.on('error', (err) => console.warn(`socket error (${client?.name ?? 'unknown'}): ${err.code ?? err.message}`));

  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data); } catch { return; }

    if (msg.t === 'hello' && !client) {
      if (clients.size >= MAX_PLAYERS) { send(ws, { t: 'full' }); ws.close(); return; }
      const id = nextId++;
      const player = createPlayer(SPAWNS[0]);
      const loadout = cleanLoadout(msg.loadout);
      const combat = new Combat(BOXES, []);
      combat.setLoadout(loadout);
      client = {
        id, ws, name: cleanName(msg.name), color: freeColor(), player, loadout, combat,
        // This player's hitboxes, as seen by everyone else's Combat.
        target: {
          id, kind: 'player', name: '', pos: player.pos, base: { ...player.pos }, move: null, yaw: 0,
          hp: player.maxHp, maxHp: player.maxHp, dead: false, respawnT: 0, body: player,
        },
        history: new Array(HISTORY), queue: [], lastCmd: { ...NEUTRAL }, lastSeq: 0, viewTick: 0,
        kills: 0, deaths: 0, respawnT: 0,
      };
      client.target.name = client.name;
      clients.set(id, client);
      const spawn = spawnPlayer(client);
      send(ws, { t: 'welcome', id, tickRate: TICK_RATE, snapRate: SNAP_RATE, spawn, map: MAP });
      events.push({ type: 'join', name: client.name });
      console.log(`+ ${client.name} joined (${clients.size}/${MAX_PLAYERS}) from ${req.socket.remoteAddress}`);
      return;
    }
    if (!client) return;

    if (msg.t === 'input' && Array.isArray(msg.cmds)) {
      for (const c of msg.cmds) {
        if (typeof c?.seq !== 'number' || c.seq <= client.lastSeq) continue; // old/duplicate
        client.queue.push(c);
      }
      // A client that fell far behind (e.g. tab was hidden) skips ahead instead of lagging forever.
      if (client.queue.length > MAX_QUEUE) client.queue.splice(0, client.queue.length - MAX_QUEUE);
    } else if (msg.t === 'ping') {
      send(ws, { t: 'pong', ts: msg.ts });
    }
  });

  ws.on('close', () => {
    if (!client) return;
    clients.delete(client.id);
    events.push({ type: 'leave', name: client.name });
    console.log(`- ${client.name} left (${clients.size}/${MAX_PLAYERS})`);
  });
});

// Only trust the fields the game code reads, with sane types.
function sanitizeCmd(c) {
  const clampAxis = (n) => (n > 0 ? 1 : n < 0 ? -1 : 0);
  return {
    forward: clampAxis(c.forward), right: clampAxis(c.right),
    jump: !!c.jump, jumpHeld: !!c.jumpHeld, sprint: !!c.sprint, crouch: !!c.crouch,
    slide: !!c.slide, slidePressed: !!c.slidePressed,
    fire: !!c.fire, firePressed: !!c.firePressed, reload: !!c.reload, ability: !!c.ability,
    slot: c.slot === 'primary' || c.slot === 'secondary' ? c.slot : null,
    cycle: clampAxis(c.cycle),
    yaw: Number.isFinite(c.yaw) ? c.yaw : 0,
    pitch: Number.isFinite(c.pitch) ? Math.max(-1.6, Math.min(1.6, c.pitch)) : 0,
  };
}

function recordHistory(c) {
  const p = c.player;
  c.history[tick % HISTORY] = { tick, x: p.pos.x, y: p.pos.y, z: p.pos.z, yaw: c.target.yaw, dead: p.dead };
}

// Move every other player's hitbox back to where they were at server tick `vt`.
function rewindOthers(shooter, vt) {
  const back = Math.max(tick - MAX_REWIND, Math.min(tick, vt));
  const saved = [];
  for (const o of clients.values()) {
    if (o === shooter) continue;
    const h = o.history[back % HISTORY];
    if (!h || h.tick !== back) continue;
    saved.push([o.target, o.target.pos, o.target.yaw]);
    o.target.pos = { x: h.x, y: h.y, z: h.z };
    o.target.yaw = h.yaw;
  }
  return () => { for (const [t, pos, yaw] of saved) { t.pos = pos; t.yaw = yaw; } };
}

// Turn this player's combat events into server events: kills, damage, and effects to replicate.
function collectCombatEvents(c) {
  for (const e of c.combat.fx.splice(0)) {
    e.by = c.id;
    events.push(e);
    if (e.type !== 'hit') continue;
    const victim = clients.get(e.target);
    if (!victim) continue;
    victim.player.hp = victim.target.hp;
    victim.player.regenDelay = REGEN_DELAY;
    if (e.kill && !victim.player.dead) {
      victim.player.dead = true;
      victim.respawnT = RESPAWN_DELAY;
      victim.deaths++;
      c.kills++;
      events.push({ type: 'kill', killer: c.name, victim: victim.name, killerId: c.id, victimId: victim.id, weapon: c.combat.weapon.id });
      console.log(`  ${c.name} splatted ${victim.name}`);
    }
  }
}

function stepWorld() {
  tick++;
  const all = [...clients.values()];
  for (const c of all) {
    c.target.pos = c.player.pos;
    c.target.yaw = c.lastCmd.yaw + Math.PI;  // bean models face +Z; camera yaw 0 looks down -Z
    c.target.dead = c.player.dead;
  }

  for (const c of all) {
    const p = c.player;
    // Each player is advanced exactly once per input they sent — the same steps their own
    // screen simulated — so prediction and server agree exactly (movement AND gun timing).
    // The budget allows catching up after a network hiccup, but on average no more than one
    // input per server tick (so nobody can speed-hack by sending inputs faster).
    c.budget = Math.min((c.budget ?? 0) + 1, MAX_QUEUE);

    if (p.dead) {
      // Swallow inputs while dead (so the client's correction stays in sync).
      for (const raw of c.queue) c.lastSeq = raw.seq;
      c.queue.length = 0;
      c.respawnT -= TICK_DT;
      if (c.respawnT <= 0) { spawnPlayer(c); events.push({ type: 'respawn', id: c.id }); }
      continue;
    }

    p.invuln = Math.max(0, p.invuln - TICK_DT);
    p.regenDelay = Math.max(0, p.regenDelay - TICK_DT);
    if (p.regenDelay === 0 && p.hp < p.maxHp) { p.hp = Math.min(p.maxHp, p.hp + REGEN_RATE * TICK_DT); c.target.hp = p.hp; }

    while (c.queue.length && c.budget >= 1 && !p.dead) {
      const raw = c.queue.shift();
      c.budget--;
      const cmd = sanitizeCmd(raw);
      c.lastSeq = raw.seq;
      c.lastCmd = cmd;
      c.target.yaw = cmd.yaw + Math.PI;
      // Combat first (so knockback applies this step), with everyone else rewound to what
      // this player saw when they pressed the button.
      c.combat.targets = all.filter((o) => o !== c).map((o) => o.target);
      const restore = rewindOthers(c, Number.isFinite(raw.vt) ? raw.vt : tick);
      c.combat.tick(p, cmd, TICK_DT);
      restore();
      collectCombatEvents(c);
      stepPlayer(p, cmd, BOXES, TICK_DT);
      if (p.pos.y < -30) spawnPlayer(c);
    }
  }
  for (const c of all) recordHistory(c);
}

function snapshot() {
  const players = JSON.stringify([...clients.values()].map((c) => {
    const p = c.player;
    return {
      id: c.id, name: c.name, color: c.color, seq: c.lastSeq,
      x: +p.pos.x.toFixed(3), y: +p.pos.y.toFixed(3), z: +p.pos.z.toFixed(3),
      vx: +p.vel.x.toFixed(2), vy: +p.vel.y.toFixed(2), vz: +p.vel.z.toFixed(2),
      yaw: +c.lastCmd.yaw.toFixed(3), pitch: +c.lastCmd.pitch.toFixed(3),
      cr: p.crouching ? 1 : 0, sl: p.sliding ? 1 : 0, gr: p.grounded ? 1 : 0,
      dead: p.dead ? 1 : 0, k: c.kills, d: c.deaths, w: c.combat.weapon.id,
    };
  }));
  // Every live projectile, tagged with its owner (clients draw everyone else's).
  const proj = [];
  for (const c of clients.values()) {
    for (const pr of c.combat.projectiles) {
      proj.push({ id: pr.id, o: c.id, k: pr.kind, st: pr.stuck ? 1 : 0,
        x: +pr.pos.x.toFixed(2), y: +pr.pos.y.toFixed(2), z: +pr.pos.z.toFixed(2),
        vx: +pr.vel.x.toFixed(2), vy: +pr.vel.y.toFixed(2), vz: +pr.vel.z.toFixed(2) });
    }
  }
  const head = `{"t":"snap","tick":${tick},"players":${players},"proj":${JSON.stringify(proj)},"ev":${JSON.stringify(events)}`;
  events = [];
  for (const c of clients.values()) {
    if (c.ws.readyState !== c.ws.OPEN) continue;
    // Each client also gets its own full movement state for exact prediction correction.
    const me = { seq: c.lastSeq, state: snapshotState(c.player), respawnIn: c.player.dead ? +c.respawnT.toFixed(2) : 0 };
    c.ws.send(`${head},"me":${JSON.stringify(me)}}`);
  }
}

// Fixed-rate loop. setInterval alone drifts on Windows, so we accumulate real time and
// run as many fixed ticks as are due.
let last = process.hrtime.bigint();
let acc = 0;
let snapAcc = 0;
setInterval(() => {
  const now = process.hrtime.bigint();
  const dt = Number(now - last) / 1e9;
  last = now;
  acc += Math.min(dt, 0.25);
  snapAcc += Math.min(dt, 0.25);
  while (acc >= TICK_DT) { stepWorld(); acc -= TICK_DT; }
  if (snapAcc >= 1 / SNAP_RATE) { snapshot(); snapAcc %= 1 / SNAP_RATE; }
}, 2);
