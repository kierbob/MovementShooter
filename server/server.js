// Movement Shooter multiplayer server.
// Authoritative: every player's movement is simulated HERE with the exact same code the
// browser uses (../src/player.js). Clients send their inputs; the server steps everyone at
// 120 ticks/s and broadcasts snapshots at 30/s.
//
// Protocol (JSON messages):
//   client → server  { t: 'hello', name }
//                    { t: 'input', cmds: [{ seq, forward, right, jump, ..., yaw, pitch }] }
//                    { t: 'ping', ts }
//   server → client  { t: 'welcome', id, tickRate, snapRate }
//                    { t: 'snap', tick, players: [...] }
//                    { t: 'pong', ts }
//                    { t: 'full' }  (server is full)
import { WebSocketServer } from 'ws';
import { TICK_DT, TICK_RATE } from '../src/config.js';
import { BOXES, ARENA } from '../src/world.js';
import { createPlayer, stepPlayer } from '../src/player.js';

const PORT = Number(process.env.PORT) || 8080;
const MAX_PLAYERS = 8;
const SNAP_RATE = 30;
const MAX_QUEUE = 12; // buffered input ticks per client before we start skipping ahead

const COLORS = [0x4fc3ff, 0xff6b6b, 0x7ee787, 0xffd35a, 0xc792ea, 0xff9e3d, 0x5ce1e6, 0xff7eb6];

const clients = new Map(); // id -> client
let nextId = 1;
let tick = 0;

const NEUTRAL = {
  forward: 0, right: 0, jump: false, jumpHeld: false, sprint: false, crouch: false,
  slide: false, slidePressed: false, yaw: 0, pitch: 0,
};

function pickSpawn() {
  // Farthest spawn from everyone else (random among the best few so it isn't predictable).
  const others = [...clients.values()].map((c) => c.player.pos);
  const scored = ARENA.spawns.map((s) => ({
    s, d: others.length ? Math.min(...others.map((o) => Math.hypot(o.x - s.x, o.z - s.z))) : Math.random(),
  })).sort((a, b) => b.d - a.d);
  return scored[Math.floor(Math.random() * Math.min(3, scored.length))].s;
}

function freeColor() {
  const used = new Set([...clients.values()].map((c) => c.color));
  return COLORS.find((c) => !used.has(c)) ?? COLORS[nextId % COLORS.length];
}

function cleanName(raw) {
  const n = String(raw ?? '').replace(/[^\w \-.!?]/g, '').trim().slice(0, 16);
  return n || 'Bean';
}

function send(ws, msg) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
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
      const spawn = pickSpawn();
      const player = createPlayer(spawn);
      player.pos = { x: spawn.x, y: spawn.y, z: spawn.z };
      client = {
        id: nextId++, ws, name: cleanName(msg.name), color: freeColor(), player,
        queue: [], lastCmd: { ...NEUTRAL, yaw: spawn.yaw ?? 0 }, lastSeq: 0,
      };
      clients.set(client.id, client);
      send(ws, { t: 'welcome', id: client.id, tickRate: TICK_RATE, snapRate: SNAP_RATE, spawn });
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
    console.log(`- ${client.name} left (${clients.size}/${MAX_PLAYERS})`);
  });
});

// Only trust the fields the movement code reads, with sane types.
function sanitizeCmd(c) {
  const clampAxis = (n) => (n > 0 ? 1 : n < 0 ? -1 : 0);
  return {
    forward: clampAxis(c.forward), right: clampAxis(c.right),
    jump: !!c.jump, jumpHeld: !!c.jumpHeld, sprint: !!c.sprint, crouch: !!c.crouch,
    slide: !!c.slide, slidePressed: !!c.slidePressed,
    yaw: Number.isFinite(c.yaw) ? c.yaw : 0,
    pitch: Number.isFinite(c.pitch) ? Math.max(-1.6, Math.min(1.6, c.pitch)) : 0,
  };
}

function stepWorld() {
  tick++;
  for (const c of clients.values()) {
    const raw = c.queue.shift();
    let cmd;
    if (raw) {
      cmd = sanitizeCmd(raw);
      c.lastSeq = raw.seq;
      c.lastCmd = cmd;
    } else {
      // No input arrived for this tick (network hiccup): keep doing what they were doing,
      // but don't repeat one-shot presses.
      cmd = { ...c.lastCmd, jump: false, slidePressed: false };
    }
    stepPlayer(c.player, cmd, BOXES, TICK_DT);
    if (c.player.pos.y < -30) {
      const s = pickSpawn();
      c.player.pos = { x: s.x, y: s.y, z: s.z };
      c.player.vel = { x: 0, y: 0, z: 0 };
    }
  }
}

function snapshot() {
  const players = [...clients.values()].map((c) => {
    const p = c.player;
    return {
      id: c.id, name: c.name, color: c.color, seq: c.lastSeq,
      x: +p.pos.x.toFixed(3), y: +p.pos.y.toFixed(3), z: +p.pos.z.toFixed(3),
      vx: +p.vel.x.toFixed(3), vy: +p.vel.y.toFixed(3), vz: +p.vel.z.toFixed(3),
      yaw: +c.lastCmd.yaw.toFixed(3), pitch: +c.lastCmd.pitch.toFixed(3),
      cr: p.crouching ? 1 : 0, sl: p.sliding ? 1 : 0, gr: p.grounded ? 1 : 0,
    };
  });
  const msg = JSON.stringify({ t: 'snap', tick, players });
  for (const c of clients.values()) if (c.ws.readyState === c.ws.OPEN) c.ws.send(msg);
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
