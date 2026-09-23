import { TICK_RATE, MOVE, WALL } from './config.js';
import { horizontalSpeed } from './player.js';
import { keyLabel, settings } from './settings.js';
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);

// Top-left stats panel. Tracks frame timing itself; everything else is read from game state.
export class DebugPanel {
  constructor(el) {
    this.el = el;
    this.frames = 0;
    this.fps = 0;
    this.frameMs = 0;
    this.worstMs = 0;
    this._worst = 0;
    this._window = performance.now();
    this._lastDraw = 0;
    this.topSpeed = 0;
    this.ticksPerSec = 0;
    this._ticks = 0;
  }

  frame(dtMs, ticksThisFrame) {
    this.frames++;
    this._ticks += ticksThisFrame;
    this.frameMs = dtMs;
    this._worst = Math.max(this._worst, dtMs);
    const now = performance.now();
    if (now - this._window >= 500) {
      const secs = (now - this._window) / 1000;
      this.fps = this.frames / secs;
      this.ticksPerSec = this._ticks / secs;
      this.worstMs = this._worst;
      this.frames = this._ticks = this._worst = 0;
      this._window = now;
    }
  }

  // 'full' | 'compact' | 'off' — cycled with the Stats Panel key (F4 by default).
  setMode(mode) {
    this.mode = mode;
    this.el.style.display = mode === 'off' ? 'none' : '';
    this.el.classList.toggle('compact', mode === 'compact');
    this._lastDraw = 0;
  }

  draw(player, input, combat, prof, info, ping = null) {
    const speed = horizontalSpeed(player);
    this.topSpeed = Math.max(this.topSpeed, speed);
    const now = performance.now();
    if (this.mode === 'off' || now - this._lastDraw < 50) return; // redraw at 20 Hz so the numbers are readable
    this._lastDraw = now;

    if (this.mode === 'compact') {
      const pingText = ping == null ? '' : `  ·  ${Math.round(ping)} ms ping`;
      this.el.textContent = `${this.fps.toFixed(0)} FPS  ·  ${this.frameMs.toFixed(1)} ms${pingText}  ·  ${keyLabel(settings.keys.stats)} for stats`;
      return;
    }

    const p = player.pos, v = player.vel;
    const keys = [...input.held].map(keyLabel).join(' ') || '—';
    const ev = input.lastEvent;
    const evText = ev ? `${ev.type} ${keyLabel(ev.code)} (${((now - ev.t) / 1000).toFixed(1)}s ago)` : '—';
    const log = player.events.slice(-6).reverse()
      .map((e) => `  ${e.t.toFixed(2).padStart(7)}s ${e.name}${e.detail ? ' ' + e.detail : ''}`)
      .join('\n') || '  —';
    const w = combat.weapon, st = combat.weaponState, lh = combat.lastHit;
    const lastHit = lh ? `${lh.dmg.toFixed(1)} ${lh.zone}${lh.kill ? ' KILL' : ''} (${(combat.time - lh.time).toFixed(1)}s ago)` : '—';
    const alive = combat.targets.filter((t) => !t.dead).length;

    this.el.innerHTML =
`<span class="h">PERFORMANCE</span>
FPS        ${this.fps.toFixed(0)}
frame      ${this.frameMs.toFixed(2)} ms  <span class="dim">(worst ${this.worstMs.toFixed(1)})</span>
sim        ${this.ticksPerSec.toFixed(0)} / ${TICK_RATE} ticks/s
${prof ? `cpu ms     ${['sim', 'fx', 'world', 'gun', 'hud'].map((k) => `${k} ${(prof.avg[k] ?? 0).toFixed(2)}`).join('  ')}
cpu peak   ${['sim', 'fx', 'world', 'gun', 'hud'].map((k) => `${k} ${(prof.peak[k] ?? 0).toFixed(1)}`).join('  ')}
draws      ${info?.calls ?? '?'} calls, ${((info?.triangles ?? 0) / 1000).toFixed(0)}k tris` : ''}

<span class="h">MOVEMENT</span>
speed      ${speed.toFixed(2)} m/s  <span class="dim">(top ${this.topSpeed.toFixed(2)}, cap ${MOVE.maxSpeed})</span>
vel y      ${v.y.toFixed(2)} m/s
state      ${player.state}
grounded   ${player.grounded ? 'yes' : 'no'}
crouch     ${player.crouching ? 'yes' : 'no'}  <span class="dim">(hitbox ${player.height.toFixed(1)} m)</span>
slide cd   ${player.slideCooldown > 0 ? player.slideCooldown.toFixed(2) + ' s' : 'ready'}
wall jumps ${player.wallJumps}/${WALL.maxJumps}${player.wallCoyote > 0 ? '  <span class="dim">(touching wall)</span>' : ''}
pos        ${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)}

<span class="h">INPUT</span>
keys held  ${esc(keys)}
last event ${esc(evText)}
key→sim    ${input.lastDelayMs.toFixed(2)} ms
mouse      ${input.locked ? 'locked' : 'free'}, ${input.rawMouse ? 'raw' : 'OS accel'}, ${input.mouseRate} ev/s
keyboard   ${input.keyboardLocked ? 'locked (browser shortcuts blocked)' : '<span style="color:#f0883e">not locked — Ctrl+W asks before closing</span>'}
yaw/pitch  ${(input.yaw * 180 / Math.PI).toFixed(1)}°, ${(input.pitch * 180 / Math.PI).toFixed(1)}°

<span class="h">COMBAT</span>
weapon     ${w.name} ${st.ammo}/${w.mag}${st.reloadT > 0 ? ` reloading ${st.reloadT.toFixed(2)}s` : ''}${combat.drawT > 0 ? ' drawing' : ''}
ability    ${combat.ability.name} ${combat.abilityCd > 0 ? combat.abilityCd.toFixed(1) + ' s' : 'ready'}
last hit   ${lastHit}
world      ${combat.projectiles.length} projectiles, ${alive}/${combat.targets.length} dummies up

<span class="h">MOVE EVENTS</span>
${esc(log)}`;
  }
}
