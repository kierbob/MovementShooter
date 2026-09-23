import { TICK_DT, PLAYER, MOVE } from './config.js';
import { BOXES, SPAWN, TARGETS } from './world.js';
import { createPlayer, stepPlayer, respawn, horizontalSpeed } from './player.js';
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
import { Net } from './net.js';
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
const online = { active: false, remotes: new Map() }; // remote player id -> combat target

function stopOnline() {
  online.active = false;
  net.close();
  for (const t of online.remotes.values()) combat.removeTarget(t);
  online.remotes.clear();
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
    const welcome = await net.connect(settings.serverUrl, settings.playerName || 'Bean');
    online.active = true;
    document.body.dataset.mode = 'online';
    placePlayer(welcome.spawn);
    resetHealth();
    menu.setHint('');
  } catch (err) {
    stopOnline();
    quitToMenu();
    menu.setHint(`${err.message}. Is the server running? (start-server.bat)`);
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

  if (state === 'playing') {
    acc += Math.min(dtMs / 1000, 0.25);
    // Fixed-rate simulation, decoupled from frame rate.
    while (acc >= TICK_DT) {
      prevPos = { ...player.pos };
      if (input.respawnPressed) {
        input.respawnPressed = false;
        if (arena.active) { /* no free respawns in the arena */ }
        else if (trial.active) trial.restart(player); // on the course, respawn = restart the run
        else respawn(player, SPAWN);
        prevPos = { ...player.pos };
      }
      let cmd = input.sample(performance.now());
      if (player.dead) cmd = { ...DEAD_CMD, yaw: cmd.yaw, pitch: cmd.pitch }; // no moving or shooting while splatted
      combat.tick(player, cmd, TICK_DT); // before movement so knockback applies this tick
      if (!player.dead) stepPlayer(player, cmd, BOXES, TICK_DT);
      if (online.active) {
        net.queueCmd(cmd);
        // Step 1 correction: if we've drifted far from where the server has us, snap back.
        // (Step 2 replaces this with proper replay-based reconciliation.)
        const s = net.self;
        if (s && Math.hypot(s.x - player.pos.x, s.y - player.pos.y, s.z - player.pos.z) > 3) {
          player.pos = { x: s.x, y: s.y, z: s.z };
          player.vel = { x: s.vx, y: s.vy, z: s.vz };
          prevPos = { ...player.pos };
        }
      } else if (arena.active) {
        bots.tick(player, TICK_DT);
        arenaTick(TICK_DT);
      } else {
        trial.tick(player, TICK_DT);
        handleTrialEvents(trial.events.splice(0));
      }
      if (player.pos.y < -30) {
        if (arena.active) placePlayer(bots.farSpawn(ARENA.center));
        else respawn(player, SPAWN);
      }
      acc -= TICK_DT;
      ticks++;
    }
  } else {
    acc = 0; // paused / menu: the dev server freezes
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
    camera.position.set(
      prevPos.x + (player.pos.x - prevPos.x) * a,
      prevPos.y + (player.pos.y - prevPos.y) * a + eye,
      prevPos.z + (player.pos.z - prevPos.z) * a,
    );
    camera.rotation.set(input.pitch, input.yaw, roll);
    fx.applyShake(camera);
  }
  camera.updateMatrixWorld();

  if (online.active) {
    net.flush();
    syncRemotes();
  }
  prof.mark('sim', tFrame);
  let t0 = performance.now();
  const events = combat.fx.splice(0);
  sound.setListener(camera.position, input.yaw);
  playCombatSounds(sound, events);
  if (arena.active) handleArenaEvents(events);
  if (state === 'playing') playMovementSounds(sound, player);
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
    if (online.active) hud.updateOnline(net.remotes.size + 1, net.ping);
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
