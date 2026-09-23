// In-game HUD: ammo, weapon slots, ability cooldown, hitmarker and floating damage numbers.
import * as THREE from 'three';
import { settings, keyLabel } from './settings.js';
import { WEAPONS } from './items.js';
import { formatTime } from './trial.js';

const TEMPLATE = `
<svg class="crosshair" data-crosshair viewBox="-100 -100 200 200" width="200" height="200"></svg>
<div class="hitmarker" data-hitmarker><i></i><i></i><i></i><i></i></div>
<div class="dmg-layer" data-dmg></div>
<div class="word-layer" data-words></div>
<div class="trial-timer" data-trial><div class="trial-mode" data-trial-mode></div><div class="trial-time" data-trial-time></div><div class="trial-best" data-trial-best></div></div>
<div class="plain-dot"></div>
<div class="vignette" data-vignette></div>
<div class="dmg-dir" data-dmgdir><i></i></div>
<div class="health" data-health><div class="hp-num" data-hp-num></div><div class="hp-bar"><div data-hp-fill></div></div></div>
<div class="arena-score" data-arena><span data-arena-k>0</span><small> KILLS</small><b>·</b><span data-arena-d>0</span><small> DEATHS</small></div>
<div class="killfeed" data-feed></div>
<div class="death" data-death><div class="death-word">SPLATTED!</div><div class="death-sub" data-death-sub></div></div>
<div class="ability" data-ability>
  <div class="ability-icon"><div class="ability-cd" data-ability-cd></div><span data-ability-key></span></div>
  <div class="ability-name" data-ability-name></div>
</div>
<div class="weapon-panel">
  <div class="slots" data-slots></div>
  <div class="ammo"><span data-ammo></span><small data-mag></small></div>
  <div class="reload" data-reload><div data-reload-bar></div></div>
</div>`;

const ZONE_CLASS = { head: 'head', body: 'body', legs: 'legs' };

// Crosshair shapes (SVG, units = screen px, centered on 0,0). `gap` grows with recoil bloom;
// `ring` is the shotgun's real spread cone projected to the screen.
const dot = (r = 2.4) => `<circle class="dot" r="${r}"/>`;
const ln = (x1, y1, x2, y2) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;
const CROSSHAIRS = {
  ring: ({ ring }) => `<circle r="${ring}"/>${dot()}`,
  cross: ({ bloom }) => {
    const g = 6 + bloom * 10, l = 8;
    return ln(0, -g, 0, -g - l) + ln(0, g, 0, g + l) + ln(-g, 0, -g - l, 0) + ln(g, 0, g + l, 0);
  },
  dot: ({ bloom }) => {
    const g = 9 + bloom * 7, l = 4;
    return dot(2.8) + ln(0, -g, 0, -g - l) + ln(0, g, 0, g + l) + ln(-g, 0, -g - l, 0) + ln(g, 0, g + l, 0);
  },
  rocket: ({ bloom }) => {
    const r = 13 + bloom * 5;
    return `<circle r="${r}"/>${dot(2)}` + ln(-7, r + 9, 7, r + 9) + ln(-4, r + 17, 4, r + 17);
  },
  bracket: ({ bloom }) => {
    const g = 12 + bloom * 9, h = 9;
    return `<polyline points="${-g + 5},${-h} ${-g},${-h} ${-g},${h} ${-g + 5},${h}"/>` +
      `<polyline points="${g - 5},${-h} ${g},${-h} ${g},${h} ${g - 5},${h}"/>` + dot();
  },
};

export class HUD {
  constructor(root, camera) {
    this.root = root;
    this.camera = camera;
    root.innerHTML = TEMPLATE;
    const q = (s) => root.querySelector(`[data-${s}]`);
    this.el = {
      hitmarker: q('hitmarker'), dmg: q('dmg'), abilityCd: q('ability-cd'), abilityKey: q('ability-key'),
      abilityName: q('ability-name'), slots: q('slots'), ammo: q('ammo'), mag: q('mag'),
      reload: q('reload'), reloadBar: q('reload-bar'), ability: q('ability'), crosshair: q('crosshair'),
      words: q('words'), trial: q('trial'), trialMode: q('trial-mode'), trialTime: q('trial-time'), trialBest: q('trial-best'),
      vignette: q('vignette'), dmgDir: q('dmgdir'), health: q('health'), hpNum: q('hp-num'), hpFill: q('hp-fill'),
      arena: q('arena'), arenaK: q('arena-k'), arenaD: q('arena-d'), feed: q('feed'), death: q('death'), deathSub: q('death-sub'),
    };
    this.hurtFlash = 0;
    this.dmgFrom = null;
    this.dmgDirT = 0;
    this.feedItems = [];
    this.words = [];
    this.bloom = 0;
    this.crosshairKey = '';
    this.numbers = [];
    this.hitT = 0;
    this.slotKey = '';
    this.v = new THREE.Vector3();
  }

  handle(events) {
    for (const e of events) {
      if (e.type === 'shot') this.bloom = Math.min(1, this.bloom + WEAPONS[e.weapon].kick * 0.8);
      if (e.type === 'hurt') {
        this.hurtFlash = Math.min(1, this.hurtFlash + 0.35 + e.dmg * 0.02);
        if (e.from) { this.dmgFrom = e.from; this.dmgDirT = 1.2; }
      }
      if (e.type !== 'hit') continue;
      this.hitT = 0.18;
      this.el.hitmarker.className = 'hitmarker show' + (e.kill ? ' kill' : e.zone === 'head' ? ' head' : '');
      this.addNumber(e);
    }
  }

  addNumber(e) {
    const div = document.createElement('div');
    div.className = 'dmg ' + (e.kill ? 'kill' : ZONE_CLASS[e.zone] ?? 'body');
    div.textContent = Math.round(e.dmg);
    this.el.dmg.appendChild(div);
    this.numbers.push({ div, pos: new THREE.Vector3(e.pos.x, e.pos.y, e.pos.z), age: 0, drift: (Math.random() - 0.5) * 40 });
    if (this.numbers.length > 40) this.numbers.shift().div.remove();
  }

  // Comic word ("BLAM!", "KABOOM!"...). where = { screen: {x, y} in 0..1 } or { world: {x, y, z} }.
  // style: 'small' | 'big' | 'head' | 'kill' | 'blue'
  word(text, where, style = 'small') {
    const div = document.createElement('div');
    div.className = `comic-word ${style}`;
    div.textContent = text;
    div.style.setProperty('--rot', `${(Math.random() * 20 - 10).toFixed(1)}deg`);
    this.el.words.appendChild(div);
    const w = { div, age: 0, where, jitter: { x: (Math.random() - 0.5) * 30, y: (Math.random() - 0.5) * 20 } };
    this.words.push(w);
    if (this.words.length > 12) this.words.shift().div.remove();
    this.placeWord(w);
  }

  placeWord(w) {
    const W = window.innerWidth, H = window.innerHeight;
    let x, y;
    if (w.where.screen) {
      x = w.where.screen.x * W - 40; // a little left/up of the muzzle so it doesn't cover the gun
      y = w.where.screen.y * H - 50;
    } else {
      this.v.set(w.where.world.x, w.where.world.y, w.where.world.z).project(this.camera);
      if (this.v.z > 1) { w.div.style.visibility = 'hidden'; return; }
      w.div.style.visibility = '';
      x = (this.v.x + 1) / 2 * W;
      y = (1 - this.v.y) / 2 * H - 30 - w.age * 40;
    }
    w.div.style.left = `${x + w.jitter.x}px`;
    w.div.style.top = `${y + w.jitter.y}px`;
  }

  update(dt, combat) {
    this.words = this.words.filter((w) => {
      w.age += dt;
      if (w.age > 0.8) { w.div.remove(); return false; }
      if (w.where.world) this.placeWord(w);
      return true;
    });

    // Hitmarker
    this.hitT = Math.max(0, this.hitT - dt);
    if (this.hitT === 0) this.el.hitmarker.classList.remove('show');

    // Damage numbers float up and fade
    const w = window.innerWidth, h = window.innerHeight;
    this.numbers = this.numbers.filter((n) => {
      n.age += dt;
      if (n.age > 0.9) { n.div.remove(); return false; }
      this.v.copy(n.pos).project(this.camera);
      if (this.v.z > 1) { n.div.style.opacity = 0; return true; }
      const x = (this.v.x + 1) / 2 * w + n.drift * n.age;
      const y = (1 - this.v.y) / 2 * h - 60 * n.age;
      n.div.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%) scale(${n.age < 0.08 ? 1.4 : 1})`;
      n.div.style.opacity = n.age < 0.6 ? 1 : 1 - (n.age - 0.6) / 0.3;
      return true;
    });

    // Weapon slots (rebuilt only when something changes)
    const k = settings.keys;
    const slotKey = `${combat.active}|${combat.slots.primary.id}|${combat.slots.secondary.id}|${k.primary}|${k.secondary}`;
    if (slotKey !== this.slotKey) {
      this.slotKey = slotKey;
      this.el.slots.innerHTML = ['primary', 'secondary'].map((s) =>
        `<div class="slot${combat.active === s ? ' active' : ''}"><b>${keyLabel(k[s])}</b>${combat.slots[s].name}</div>`,
      ).join('');
    }

    const weapon = combat.weapon, st = combat.weaponState;
    this.updateCrosshair(dt, weapon, h);
    this.el.ammo.textContent = st.ammo;
    this.el.ammo.classList.toggle('low', st.ammo <= Math.ceil(weapon.mag * 0.25));
    this.el.mag.textContent = ` / ${weapon.mag}`;
    const reloading = st.reloadT > 0;
    this.el.reload.classList.toggle('show', reloading);
    if (reloading) this.el.reloadBar.style.width = `${(1 - st.reloadT / weapon.reload) * 100}%`;

    // Ability
    const a = combat.ability;
    this.el.abilityKey.textContent = keyLabel(k.ability);
    this.el.abilityName.textContent = a.name;
    const cdFrac = combat.abilityCd / a.cooldown;
    this.el.abilityCd.style.background = cdFrac > 0
      ? `conic-gradient(rgba(0,0,0,0.65) ${cdFrac * 360}deg, transparent 0)`
      : 'transparent';
    this.el.ability.classList.toggle('ready', cdFrac === 0);
    this.el.abilityCd.textContent = cdFrac > 0 ? combat.abilityCd.toFixed(1) : '';
  }

  // Health, hurt flash, damage direction and the death screen (bot arena).
  updatePlayer(dt, player, yaw, respawnIn) {
    const frac = player.hp / player.maxHp;
    this.el.hpNum.textContent = Math.ceil(player.hp);
    this.el.hpFill.style.width = `${frac * 100}%`;
    this.el.health.classList.toggle('low', frac <= 0.3);
    this.el.health.classList.toggle('protected', player.invuln > 0);
    // Red edges: flash on every hit, plus a steady glow when you're low
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 2.2);
    this.el.vignette.style.opacity = Math.min(1, this.hurtFlash + (frac < 0.35 ? (0.35 - frac) * 1.4 : 0));
    // Arrow around the crosshair pointing at whoever just shot you
    this.dmgDirT = Math.max(0, this.dmgDirT - dt);
    if (this.dmgFrom && this.dmgDirT > 0) {
      const dx = this.dmgFrom.x - player.pos.x, dz = this.dmgFrom.z - player.pos.z;
      const right = dx * Math.cos(yaw) - dz * Math.sin(yaw);
      const fwd = -dx * Math.sin(yaw) - dz * Math.cos(yaw);
      this.el.dmgDir.style.transform = `translate(-50%, -50%) rotate(${Math.atan2(right, fwd)}rad)`;
      this.el.dmgDir.style.opacity = Math.min(1, this.dmgDirT);
    } else {
      this.el.dmgDir.style.opacity = 0;
    }
    this.el.death.classList.toggle('show', player.dead);
    if (player.dead) this.el.deathSub.textContent = `Respawning in ${Math.max(0, respawnIn).toFixed(1)}`;
  }

  updateArena(stats) {
    this.el.arenaK.textContent = stats.kills;
    this.el.arenaD.textContent = stats.deaths;
  }

  // Kill feed, top right. Entries fade out after a few seconds.
  feed(html, style = '') {
    const div = document.createElement('div');
    div.className = `feed-item ${style}`;
    div.innerHTML = html;
    this.el.feed.prepend(div);
    this.feedItems.push({ div, age: 0 });
    if (this.feedItems.length > 5) this.feedItems.shift().div.remove();
  }

  updateFeed(dt) {
    this.feedItems = this.feedItems.filter((f) => {
      f.age += dt;
      if (f.age > 5) { f.div.remove(); return false; }
      if (f.age > 4) f.div.style.opacity = 5 - f.age;
      return true;
    });
  }

  // Big clock at the top of the screen while you're on the time trial course.
  updateTrial(trial) {
    this.el.trial.classList.toggle('show', trial.active);
    if (!trial.active) return;
    this.el.trial.classList.toggle('running', trial.running);
    this.el.trialMode.textContent = trial.guns ? 'TIME TRIAL · GUNS ON' : 'TIME TRIAL · GUNS OFF';
    this.el.trialTime.textContent = formatTime(trial.running ? trial.time : trial.last[trial.mode] ?? 0);
    this.el.trialBest.textContent = `BEST ${formatTime(trial.best[trial.mode])}  ·  ${keyLabel(settings.keys.respawn)} RESTART`;
  }

  updateCrosshair(dt, weapon, screenH) {
    this.bloom = Math.max(0, this.bloom - dt * 4);
    const fov = (this.camera.fov * Math.PI) / 180;
    const spread = ((weapon.spread || 0) * Math.PI) / 180;
    const ring = Math.min(95, Math.max(8, (Math.tan(spread) / Math.tan(fov / 2)) * (screenH / 2))) * (1 + this.bloom * 0.25);
    // Quantized, so the SVG is only rebuilt ~20 times per recoil instead of every frame.
    const bloomQ = Math.round(this.bloom * 20) / 20;
    const ringQ = Math.round(ring);
    const params = { bloom: bloomQ, ring: ringQ };
    const key = `${weapon.crosshair}|${bloomQ}|${ringQ}`;
    if (key === this.crosshairKey) return; // only touch the DOM when it changes
    this.crosshairKey = key;
    const shapes = (CROSSHAIRS[weapon.crosshair] ?? CROSSHAIRS.dot)(params);
    // Drawn twice: fat dark outline underneath, white on top — reads on any background.
    this.el.crosshair.innerHTML = `<g class="xo">${shapes}</g><g class="xi">${shapes}</g>`;
  }
}
