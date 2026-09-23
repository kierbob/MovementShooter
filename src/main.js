import { TICK_DT, PLAYER, MOVE } from './config.js';
import { BOXES, SPAWN, TARGETS, loadCustomMap } from './world.js';
import { createPlayer, stepPlayer, respawn, horizontalSpeed, restoreState, applyImpulse } from './player.js';
import { Input } from './input.js';
import { createRenderer, LIGHTING } from './render.js';
import { DebugPanel } from './debug.js';
import { Menu } from './menu.js';
import { Combat } from './combat.js';
import { FX } from './fx.js';
import { HUD } from './hud.js';
import { settings, saveSettings } from './settings.js';
import { Sound } from './sound.js';
import { TimeTrial } from './trial.js';
import { Bots } from './bots.js';
import { Net, normalizeServerUrl } from './net.js';
import { ARENA } from './world.js';
import { TrialView } from './trialview.js';

// Which sound each game event makes.
function playCombatSounds(sound, events) {
  for (const e of events) {
    if (e.type === 'shot') sound.play(e.weapon, { gap: 0 });
    else if (e.type === 'hit') sound.play(e.kill ? 'kill' : e.zone === 'head' ? 'headshot' : 'hit', { gap: 0.03 });
    else if (e.type === 'impact') sound.play('impact', { pos: e.pos, gap: 0.03 });
    else if (e.type === 'explosion') sound.play(e.kind === 'impulse' ? 'impulse' : 'explosion', { pos: e.pos, gap: 0 });
    else if (e.type === 'throw') sound.play(e.ability === 'knife' ? 'knifeThrow' : 'throw');
    // (reload sounds come from the gun-toss animation in fx.js: throw → catch)
    else if (e.type === 'switch') sound.play('switch');
  }
}

// Movement sounds come from the player's event log (jump, land, slide...).
let lastMoveEventT = -1;
function playMovementSounds(sound, player) {
  for (const e of player.events) {
    if (e.t <= lastMoveEventT) continue;
    lastMoveEventT = e.t;
    if (e.name.endsWith('jump') && e.name !== 'wall jump') sound.play('jump');
    else if (e.name === 'wall jump') sound.play('wallJump');
    else if (e.name === 'land') {
      const air = parseFloat(e.detail.split('after ')[1]) || 0;
      if (air > 0.15) sound.play('land', { strength: air / 1.2 });
    } else if (e.name === 'slide' || e.name === 'land slide') sound.play('slide');
    else if (e.name === 'jump pad') sound.play('pad');
  }
}

// ?testmap = play the map from the map editor (editor.html) instead of the dev map.
const testMap = (() => {
  if (!new URLSearchParams(location.search).has('testmap')) return null;
  try { return JSON.parse(localStorage.getItem('movement-shooter.testmap')); } catch { return null; }
})();
if (testMap) {
  loadCustomMap(testMap);
  settings.mode = 'dev'; // test maps are solo
  const tag = document.createElement('div');
  tag.className = 'testmap-tag';
  tag.textContent = `TEST MAP · ${testMap.name || 'Untitled'}`;
  document.body.append(tag);
}

const { renderer, scene, camera, sun, applyLighting, lighting, updateSky, applyQuality } = createRenderer(BOXES);
applyQuality(settings.quality);
const input = new Input(renderer.domElement);
const debug = new DebugPanel(document.getElementById('debug'));
const combat = new Combat(BOXES, TARGETS);
const fx = new FX(renderer, scene, camera, combat);
const hud = new HUD(document.getElementById('hud'), camera);
const sound = new Sound();
fx.onWord = (text, where, style) => hud.word(text, where, style);
fx.onSound = (name, opts) => sound.play(name, opts);
const trial = new TimeTrial();
const trialView = new TrialView(scene, trial);

function setLighting(id) {
  fx.setLighting(applyLighting(id));
}
if (!LIGHTING[settings.lighting]) settings.lighting = 'pastel'; // e.g. a removed preset was saved
setLighting(settings.lighting);

// Guns are off on the "guns off" time trial; everything else has them.
function updateGunsMode() {
  combat.enabled = !trial.active || trial.guns;
  document.body.dataset.guns = combat.enabled ? 'on' : 'off';
}

// Time trial events: teleports snap the camera, plus the cartoon/sound feedback.
function handleTrialEvents(events) {
  for (const e of events) {
    if (e.type === 'teleport') {
      prevPos = { ...player.pos };
      input.yaw = e.to.yaw ?? input.yaw;
      input.pitch = 0;
      sound.play('teleport');
    } else if (e.type === 'enter' || e.type === 'leave') {
      updateGunsMode();
    } else if (e.type === 'start') {
      sound.play('go');
      hud.word('GO!', { screen: { x: 0.5, y: 0.32 } }, 'big');
    } else if (e.type === 'finish') {
      sound.play('finish');
      hud.word(e.best ? 'NEW BEST!' : 'FINISH!', { screen: { x: 0.5, y: 0.3 } }, e.best ? 'head' : 'big');
    } else if (e.type === 'fell') {
      hud.word('WHOOPS!', { screen: { x: 0.5, y: 0.3 } }, 'kill');
    }
  }
}

// Audio can only start after a click/key press.
window.addEventListener('pointerdown', () => sound.unlock());
window.addEventListener('keydown', () => sound.unlock());

const player = createPlayer(SPAWN);
let prevPos = { ...player.pos };

// ---------- game state: 'menu' | 'playing' | 'paused' ----------
let state = 'menu';

function setState(s) {
  state = s;
  input.enabled = s === 'playing';
  document.body.dataset.state = s;
  menu.show(s === 'menu' ? 'main' : s === 'paused' ? 'pause' : null);
}

async function captureMouse() {
  const ok = await input.enterGame();
  if (!ok) menu.setHint('Mouse capture was blocked — wait a second and click again.');
}

// ---------- modes ----------
const bots = new Bots(combat, BOXES);
const arena = { active: false, kills: 0, deaths: 0, respawnT: 0 };
const RESPAWN_DELAY = 2.5;

function placePlayer(spot) {
  respawn(player, spot);
  prevPos = { ...player.pos };
  input.yaw = spot.yaw ?? 0;
  input.pitch = 0;
}

function resetHealth(invuln = 0) {
  player.hp = player.maxHp;
  player.dead = false;
  player.regenDelay = 0;
  player.invuln = invuln;
}

// ---------- multiplayer ----------
const net = new Net();
const online = {
  active: false,
  remotes: new Map(),             // server player id -> local combat target (their bean)
  history: [],                    // our recent inputs: [{ seq, cmd, impulses }] for replay
  proj: new Map(),                // server projectile id -> drawable projectile (other players')
  visualOffset: { x: 0, y: 0, z: 0 },
};

function stopOnline() {
  online.active = false;
  net.close();
  for (const t of online.remotes.values()) combat.removeTarget(t);
  online.remotes.clear();
  online.history = [];
  online.proj.clear();
  fx.extraProjectiles = null;
  player.impulseLog = null;
}

// Prediction correction ("reconciliation"). The server sent our authoritative state as of input
// #seq. Rewind to it, then replay every input we've sent since (plus our own predicted
// knockback) — so we stay responsive but always converge to the server's truth, including
// knockback from other players' explosions. Any visible jump is eased out by visualOffset.
function reconcile() {
  net.meFresh = false;
  const me = net.me;
  online.history = online.history.filter((h) => h.seq > me.seq);
  const before = { ...player.pos };
  restoreState(player, me.state);
  player.quiet = true;
  for (const h of online.history) {
    for (const imp of h.impulses ?? []) applyImpulse(player, imp);
    if (!player.dead) stepPlayer(player, h.cmd, BOXES, TICK_DT);
  }
  player.quiet = false;
  const dx = before.x - player.pos.x, dy = before.y - player.pos.y, dz = before.z - player.pos.z;
  if (Math.hypot(dx, dy, dz) < 3) {
    online.visualOffset.x += dx; online.visualOffset.y += dy; online.visualOffset.z += dz;
  } else {
    online.visualOffset = { x: 0, y: 0, z: 0 }; // respawn / big correction: just go there
  }
  prevPos = { x: prevPos.x - dx, y: prevPos.y - dy, z: prevPos.z - dz };
}

// Where a remote player's floating gun is (for their muzzle flash / tracers).
function remoteGunPos(t) {
  const c = Math.cos(t.yaw), s = Math.sin(t.yaw), ox = -0.52, oz = 0.6;
  return { x: t.pos.x + ox * c + oz * s, y: t.pos.y + 1.0, z: t.pos.z - ox * s + oz * c };
}

// Gameplay events from the server. Our own shots/explosions were already shown locally
// (prediction), so from ourselves we only take the confirmed hits. Everyone else's effects are
// shown in a lighter form: muzzle flash + tracers, no comic words.
function handleNetEvents(evs) {
  const myId = net.id;
  for (const e of evs) {
    if (e.type === 'kill') {
      const mine = e.killerId === myId, me = e.victimId === myId;
      hud.feed(`<b class="${mine ? 'you' : 'bot'}">${mine ? 'YOU' : e.killer}</b><span class="verb">SPLATTED</span><b class="${me ? 'you' : 'bot'}">${me ? 'YOU' : e.victim}</b>`,
        mine ? 'mine' : me ? 'died' : '');
      if (me) sound.play('death');
      continue;
    }
    if (e.type === 'join' || e.type === 'leave') {
      hud.feed(`<b class="bot">${e.name}</b> ${e.type === 'join' ? 'joined' : 'left'}`);
      continue;
    }
    if (e.type === 'hit') {
      if (e.target === myId) {
        // We got hit: hurt flash, direction arrow, sound.
        const shooter = online.remotes.get(e.by);
        const hurt = [{ type: 'hurt', dmg: e.dmg, from: shooter ? { ...shooter.pos } : null }];
        hud.handle(hurt);
        fx.handle(hurt, player);
        sound.play('hurt', { gap: 0.06 });
        continue;
      }
      const victim = online.remotes.get(e.target);
      if (!victim) continue;
      const local = { ...e, target: victim.id, bot: false };
      if (e.by === myId) {
        // Our hit, confirmed by the server: hitmarker, damage number, splat, sound.
        hud.handle([local]);
        fx.handle([local], player);
        playCombatSounds(sound, [local]);
      } else {
        fx.handle([{ ...local, quiet: true }], player);
      }
      continue;
    }
    if (e.by === myId) continue; // our own shots/impacts/explosions were predicted locally
    if (e.type === 'shot') {
      const shooter = online.remotes.get(e.by);
      if (!shooter) continue;
      const gun = remoteGunPos(shooter);
      fx.remoteShot(e, gun);
      sound.play(e.weapon, { pos: gun, gap: 0 });
    } else if (e.type === 'impact' || e.type === 'explosion') {
      fx.handle([{ ...e, quiet: true }], player);
      playCombatSounds(sound, [e]);
    }
  }
}

// Other players' rockets/grenades/knives: positions from snapshots, extrapolated between them.
function syncRemoteProjectiles(dt) {
  const seen = new Set();
  for (const s of net.proj) {
    if (s.o === net.id) continue; // ours are simulated locally
    seen.add(s.id);
    let p = online.proj.get(s.id);
    if (!p) { p = { id: s.id, kind: s.k, pos: {}, vel: {}, stuck: false, resting: false }; online.proj.set(s.id, p); }
    if (p.snapKey !== s) { // new snapshot data: jump to it
      p.snapKey = s;
      p.pos = { x: s.x, y: s.y, z: s.z };
      p.vel = { x: s.vx, y: s.vy, z: s.vz };
      p.stuck = !!s.st;
    } else if (!p.stuck) {
      p.pos = { x: p.pos.x + p.vel.x * dt, y: p.pos.y + p.vel.y * dt, z: p.pos.z + p.vel.z * dt };
    }
  }
  for (const id of [...online.proj.keys()]) if (!seen.has(id)) online.proj.delete(id);
  fx.extraProjectiles = [...online.proj.values()];
}

net.onDisconnect = () => {
  if (!online.active) return;
  quitToMenu();
  menu.setHint('Disconnected from the server.');
};

// Keep one combat target per remote player, drawn at its smoothed (interpolated) position.
function syncRemotes() {
  const seen = new Set();
  for (const r of net.remotes.values()) {
    const s = net.sample(r);
    if (!s) continue;
    seen.add(r.id);
    let t = online.remotes.get(r.id);
    if (!t) {
      t = combat.addTarget({ kind: 'remote', name: r.name, color: r.color, pos: { x: s.x, y: s.y, z: s.z } });
      online.remotes.set(r.id, t);
    }
    t.pos = { x: s.x, y: s.y, z: s.z };
    t.yaw = s.yaw + Math.PI; // bean models face +Z; camera yaw 0 looks down -Z
    t.low = !!(s.cr || s.sl);
    t.dead = !!s.dead;
  }
  for (const [id, t] of online.remotes) {
    if (!seen.has(id)) { combat.removeTarget(t); online.remotes.delete(id); }
  }
}

async function startOnline() {
  // Grab the mouse first (browsers only allow that straight after a click), then connect.
  captureMouse();
  menu.setHint('Connecting…');
  try {
    // A few quick retries: a just-started tunnel can take a moment to answer.
    let welcome = null;
    for (let attempt = 1; ; attempt++) {
      try {
        welcome = await net.connect(settings.serverUrl, settings.playerName || 'Bean', settings.loadout);
        break;
      } catch (err) {
        if (attempt >= 4 || /full/i.test(err.message)) throw err;
        menu.setHint(`Connecting… (try ${attempt + 1} of 4)`);
        await new Promise((r) => setTimeout(r, 2500));
      }
    }
    online.active = true;
    document.body.dataset.mode = 'online';
    placePlayer(welcome.spawn);
    resetHealth();
    menu.setHint('');
  } catch (err) {
    stopOnline();
    quitToMenu();
    const url = normalizeServerUrl(settings.serverUrl);
    const localFromPublicSite = location.protocol === 'https:' && /^ws:\/\/(localhost|127\.0\.0\.1|\[::1\])/i.test(url);
    menu.setHint(localFromPublicSite
      // Chrome's "Local network access" protection blocks public sites from reaching your own PC
      // unless you allow it for the site.
      ? `Couldn't reach your local server. If start-server.bat is running, your browser is blocking it: `
        + `click the icon left of the address bar → Site settings → Local network access → Allow, then reload. `
        + `(Or play from start.bat at http://localhost:5173.)`
      : `${err.message}. Is the server running? (host-online.bat / start-server.bat)`);
  }
}

function startGame() {
  player.events.length = 0;
  debug.topSpeed = 0;
  combat.setLoadout(settings.loadout);
  combat.resetTargets();
  trial.active = false;
  trial.running = false;
  bots.stop();
  arena.active = settings.mode === 'arena';
  arena.kills = arena.deaths = 0;
  document.body.dataset.mode = settings.mode;
  stopOnline();
  if (settings.mode === 'online') {
    placePlayer(SPAWN); // parked in the hub until the server says where we spawn
    resetHealth();
    updateGunsMode();
    startOnline();
    return;
  }
  if (arena.active) {
    bots.start(settings.difficulty, player);
    placePlayer(bots.farSpawn(ARENA.center));
    resetHealth(1.5);
  } else {
    placePlayer(SPAWN);
    resetHealth();
  }
  updateGunsMode();
  captureMouse(); // pointerlockchange flips us to 'playing'
}

function quitToMenu() {
  setState('menu');
  bots.stop();
  arena.active = false;
  stopOnline();
  if (document.pointerLockElement) document.exitPointerLock();
}

const DEAD_CMD = {
  forward: 0, right: 0, jump: false, jumpHeld: false, sprint: false, crouch: false, slide: false, slidePressed: false,
  fire: false, firePressed: false, reload: false, ability: false, slot: null, cycle: 0,
};

// Arena: health regen, spawn protection, and respawning after a death.
function arenaTick(dt) {
  player.invuln = Math.max(0, player.invuln - dt);
  if (player.dead && !arena.wasDead) arena.respawnT = RESPAWN_DELAY;
  arena.wasDead = player.dead;
  if (player.dead) {
    arena.respawnT -= dt;
    if (arena.respawnT <= 0) {
      // Spawn as far from the bots as possible.
      const alive = bots.list.filter((b) => !b.target.dead);
      const c = alive.length
        ? { x: alive.reduce((s, b) => s + b.body.pos.x, 0) / alive.length, z: alive.reduce((s, b) => s + b.body.pos.z, 0) / alive.length }
        : ARENA.center;
      placePlayer(bots.farSpawn(c));
      resetHealth(1.5);
      sound.play('teleport');
    }
    return;
  }
  player.regenDelay = Math.max(0, player.regenDelay - dt);
  if (player.regenDelay === 0 && player.hp < player.maxHp) player.hp = Math.min(player.maxHp, player.hp + 30 * dt);
}

// Kill feed + scoreboard + sounds for arena events.
function handleArenaEvents(events) {
  for (const e of events) {
    if (e.type === 'hit' && e.kill && e.bot) {
      arena.kills++;
      hud.feed(`<b class="you">YOU</b><span class="verb">SPLATTED</span><b class="bot">${e.name}</b>`, 'mine');
    } else if (e.type === 'death') {
      arena.deaths++;
      hud.feed(`<b class="bot">${e.by ?? 'A bot'}</b><span class="verb">SPLATTED</span><b class="you">YOU</b>`, 'died');
      sound.play('death');
    } else if (e.type === 'hurt') {
      sound.play('hurt', { gap: 0.06 });
    } else if (e.type === 'botShot') {
      sound.play('botShot', { pos: e.pos, gap: 0.02 });
    }
  }
}

const menu = new Menu(document.getElementById('menu'), {
  onPlay: startGame,
  onResume: captureMouse,
  onQuit: quitToMenu,
  onVolume: (v) => sound.setVolume(v),
  onLighting: setLighting,
  onQuality: applyQuality,
});
document.getElementById('menu').addEventListener('click', (e) => {
  if (e.target.closest('button')) sound.play('ui', { gap: 0.05 });
});

input.onLockChange = (locked) => {
  if (locked && state !== 'playing') setState('playing');
  else if (!locked && state === 'playing') setState('paused');
};

// Stats panel: full → compact → off (F4 by default). Works in game and in menus.
debug.setMode(settings.statsPanel);
window.addEventListener('keydown', (e) => {
  if (e.code !== settings.keys.stats || e.repeat || menu.listening) return;
  e.preventDefault();
  const order = ['full', 'compact', 'off'];
  settings.statsPanel = order[(order.indexOf(settings.statsPanel) + 1) % order.length];
  saveSettings();
  debug.setMode(settings.statsPanel);
});

// The Open Menu key also resumes from the pause menu.
window.addEventListener('keydown', (e) => {
  if (state === 'paused' && menu.screen === 'pause' && e.code === settings.keys.menu && !e.repeat) captureMouse();
});

setState('menu');

// Compile every effect's shader up front (once the gun models have had a moment to load),
// so the first shot/explosion/bullet hole doesn't freeze the game.
setTimeout(() => fx.warmup(), 1500);

// ---------- loop ----------
let last = performance.now();
let acc = 0;
const BASE_FOV = camera.fov;
let eye = PLAYER.eyeHeight;
let roll = 0;

function setFov(fov) {
  if (Math.abs(fov - camera.fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
}

// Per-section CPU timings for the stats panel: smoothed average + worst in the last half second.
// (renderer.render only measures the CPU side of drawing; if frames are slow but these are
// small, the GPU is the bottleneck.)
const prof = {
  avg: {}, peak: {}, _peak: {}, _t: performance.now(),
  mark(k, t0) {
    const d = performance.now() - t0;
    this.avg[k] = this.avg[k] == null ? d : this.avg[k] * 0.9 + d * 0.1;
    this._peak[k] = Math.max(this._peak[k] ?? 0, d);
    if (performance.now() - this._t > 500) {
      this.peak = this._peak; this._peak = {}; this._t = performance.now();
    }
  },
};

renderer.info.autoReset = false; // count draw calls for the whole frame (world + gun)

function frame(now) {
  const tFrame = performance.now();
  renderer.info.reset();
  const dtMs = now - last;
  last = now;
  const dt = Math.min(dtMs / 1000, 0.1);
  let ticks = 0;

  if (online.active && net.meFresh) reconcile();

  // Online the match never stops: with the menu open you keep simulating (standing still) so the
  // server keeps getting inputs and you can still be shot. Offline modes freeze while paused.
  const live = state === 'playing' || (state === 'paused' && online.active);
  if (live) {
    acc += Math.min(dtMs / 1000, 0.25);
    // Fixed-rate simulation, decoupled from frame rate.
    while (acc >= TICK_DT) {
      prevPos = { ...player.pos };
      if (input.respawnPressed && state === 'playing') {
        input.respawnPressed = false;
        if (arena.active) { /* no free respawns in the arena */ }
        else if (trial.active) trial.restart(player); // on the course, respawn = restart the run
        else respawn(player, SPAWN);
        prevPos = { ...player.pos };
      }
      let cmd = state === 'playing' ? input.sample(performance.now()) : { ...DEAD_CMD, yaw: input.yaw, pitch: input.pitch };
      if (player.dead) cmd = { ...DEAD_CMD, yaw: cmd.yaw, pitch: cmd.pitch }; // no moving or shooting while splatted
      if (online.active) player.impulseLog = []; // record our own knockback so it can be replayed
      combat.tick(player, cmd, TICK_DT); // before movement so knockback applies this tick
      if (!player.dead) stepPlayer(player, cmd, BOXES, TICK_DT);
      if (online.active) {
        const seq = net.queueCmd(cmd);
        online.history.push({ seq, cmd, impulses: player.impulseLog });
        player.impulseLog = null;
        if (online.history.length > 360) online.history.shift();
      } else if (arena.active) {
        bots.tick(player, TICK_DT);
        arenaTick(TICK_DT);
      } else {
        trial.tick(player, TICK_DT);
        handleTrialEvents(trial.events.splice(0));
      }
      if (player.pos.y < -30 && !online.active) { // online, the server handles falling out
        if (arena.active) placePlayer(bots.farSpawn(ARENA.center));
        else respawn(player, SPAWN);
      }
      acc -= TICK_DT;
      ticks++;
    }
  } else {
    acc = 0; // paused / menu: offline modes freeze
  }

  if (state === 'menu') {
    // Slow orbit around the map behind the main menu.
    const t = now / 1000;
    camera.position.set(Math.sin(t * 0.06) * 42, 20, Math.cos(t * 0.06) * 42);
    camera.lookAt(0, 3, 0);
    setFov(BASE_FOV);
    roll = 0;
  } else {
    // Camera effects ease toward targets so crouch/slide transitions aren't instant snaps.
    const ease = (cur, target, rate) => cur + (target - cur) * Math.min(1, dt * rate);
    eye = ease(eye, player.crouching ? PLAYER.crouchEyeHeight : PLAYER.eyeHeight, 14);
    roll = ease(roll, player.sliding ? -0.05 : 0, 10);
    const speedT = Math.min(1, Math.max(0, (horizontalSpeed(player) - MOVE.walkSpeed) / (MOVE.maxSpeed - MOVE.walkSpeed)));
    setFov(ease(camera.fov, BASE_FOV + speedT * 15, 6));

    // Interpolate between the last two ticks; look direction is applied instantly.
    const a = acc / TICK_DT;
    // Online corrections are eased out over a few frames instead of popping the camera.
    const k = Math.exp(-dt * 12);
    const vo = online.visualOffset;
    vo.x *= k; vo.y *= k; vo.z *= k;
    camera.position.set(
      prevPos.x + (player.pos.x - prevPos.x) * a + vo.x,
      prevPos.y + (player.pos.y - prevPos.y) * a + eye + vo.y,
      prevPos.z + (player.pos.z - prevPos.z) * a + vo.z,
    );
    camera.rotation.set(input.pitch, input.yaw, roll);
    fx.applyShake(camera);
  }
  camera.updateMatrixWorld();

  if (online.active) {
    net.flush();
    syncRemotes();
    syncRemoteProjectiles(dt);
  }
  prof.mark('sim', tFrame);
  let t0 = performance.now();
  const events = combat.fx.splice(0);
  sound.setListener(camera.position, input.yaw);
  if (online.active) handleNetEvents(net.takeEvents());
  playCombatSounds(sound, events);
  if (arena.active) handleArenaEvents(events);
  if (live) playMovementSounds(sound, player);
  fx.handle(events, player);
  hud.handle(events);
  fx.update(dt, combat, player, input, state !== 'menu' && combat.enabled);
  trialView.update(dt);

  // Keep the sun's shadow area centered on the player (the time trial is far from the hub).
  const focus = state === 'menu' ? { x: 0, z: 0 } : player.pos;
  const sd = lighting.preset.sunDir;
  sun.position.set(focus.x + sd[0], sd[1], focus.z + sd[2]);
  updateSky(camera, dt);
  sun.target.position.set(focus.x, 0, focus.z);
  prof.mark('fx', t0);

  t0 = performance.now();
  renderer.render(scene, camera);
  prof.mark('world', t0);
  if (state !== 'menu') {
    t0 = performance.now();
    if (combat.enabled) fx.renderViewmodel();
    prof.mark('gun', t0);
    t0 = performance.now();
    hud.update(dt, combat);
    hud.updateTrial(trial);
    hud.updateFeed(dt);
    if (arena.active) {
      hud.updatePlayer(dt, player, input.yaw, arena.respawnT);
      hud.updateArena(arena);
    }
    // Hold Tab: scoreboard (online: everyone from the server; Bot Arena: just your score).
    const showBoard = state === 'playing' && input.isDown('scoreboard') && (online.active || arena.active);
    hud.updateScoreboard(showBoard, !showBoard ? [] : online.active
      ? (net.players ?? []).map((p) => ({ name: p.name, k: p.k, d: p.d, color: p.color, you: p.id === net.id }))
      : [{ name: settings.playerName || 'You', k: arena.kills, d: arena.deaths, color: 0xffe14d, you: true }]);
    if (online.active) {
      hud.updateOnline(net.remotes.size + 1, net.ping);
      hud.updatePlayer(dt, player, input.yaw, net.me?.respawnIn ?? 0);
      hud.updateArena({ kills: net.self?.k ?? 0, deaths: net.self?.d ?? 0 });
    }
    prof.mark('hud', t0);
    debug.draw(player, input, combat, prof, renderer.info.render, online.active ? net.ping : null);
  }
  debug.frame(dtMs, ticks);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Handy for poking at things from the dev console. forceState skips mouse capture (for testing).
window.game = {
  player, input, menu, combat, fx, hud, sound, trial, bots, arena, setLighting, prof, renderer, net, online,
  // Render one frame right now and return it as a JPEG data URL (for lighting comparisons).
  snapshot: (w = 480, h = 270) => {
    updateSky(camera);
    renderer.render(scene, camera);
    if (combat.enabled) fx.renderViewmodel();
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(renderer.domElement, 0, 0, w, h);
    return c;
  },
  get state() { return state; },
  forceState: setState,
  start: () => { startGame(); setState('playing'); },
};
