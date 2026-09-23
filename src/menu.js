import {
  ACTIONS, settings, bindKey, resetSettings, saveSettings, setLoadout, keyLabel, cmPer360,
} from './settings.js';
import { WEAPONS, ABILITIES, weaponsForSlot, weaponStats, abilityStats, itemClass } from './items.js';
import { Showcase } from './showcase.js';
import { LIGHTING, QUALITY } from './render.js';

const SLOTS = [
  { id: 'primary', label: 'Primary', title: 'Primary Weapons' },
  { id: 'secondary', label: 'Secondary', title: 'Secondary Weapons' },
  { id: 'ability', label: 'Ability', title: 'Abilities' },
];

const TEMPLATE = `
<header class="topbar" data-topbar>
  <div class="logo">MOVEMENT <span>SHOOTER</span></div>
  <nav class="tabs">
    <button class="tab" type="button" data-action="tab-main" data-tab="main">Play</button>
    <button class="tab" type="button" data-action="tab-loadout" data-tab="loadout">Loadout</button>
    <button class="tab" type="button" data-action="open-settings" data-tab="settings">Settings</button>
  </nav>
  <button type="button" class="name-chip" data-action="edit-name" title="Change username"><span data-name-chip></span></button>
  <div class="build">DEV BUILD</div>
</header>

<div class="name-prompt hidden" data-name-prompt>
  <form class="name-box" data-name-form>
    <div class="kicker">Welcome, bean</div>
    <h2>Pick a name</h2>
    <p>This is what other players see above your head.</p>
    <input type="text" maxlength="16" placeholder="Your name" data-name-input autocomplete="off" spellcheck="false">
    <div class="name-hint" data-name-hint>Letters, numbers, spaces and _ - . ! ? — up to 16 characters.</div>
    <div class="name-actions">
      <button class="btn ghost" type="button" data-action="skip-name">Skip</button>
      <button class="btn primary" type="submit">Let's go!</button>
    </div>
  </form>
</div>

<div class="screen main" data-screen="main">
  <div class="mode-area">
    <div class="loadout-chips" data-chips></div>
    <button type="button" class="mode-card" data-action="open-modes" data-current-mode></button>
    <button class="play-btn" type="button" data-action="play">Play</button>
    <div class="hint" data-hint></div>
  </div>
</div>

<div class="screen modes" data-screen="modes">
  <div class="modes-wrap">
    <div class="screen-head">
      <div><div class="kicker">Choose how to play</div><h2>Select Mode</h2></div>
      <button class="back-btn" type="button" data-action="tab-main"><span>Back</span><kbd>Esc</kbd></button>
    </div>
    <div class="mode-grid" data-modes></div>
  </div>
</div>

<div class="screen loadout" data-screen="loadout">
  <div class="locker">
    <nav class="locker-slots" data-slots></nav>
    <section class="locker-stage">
      <div class="stage-floor"></div>
      <canvas class="stage-canvas" data-stage></canvas>
      <div class="stage-info" data-stage-info></div>
      <div class="stage-hint">Drag to spin</div>
    </section>
    <div class="locker-items">
      <div class="items-title" data-options-title></div>
      <div class="items-row" data-options></div>
    </div>
  </div>
</div>

<div class="screen settings" data-screen="settings">
  <div class="set-wrap">
    <nav class="set-nav">
      <div class="locker-head">Settings</div>
      <button type="button" class="set-tab" data-sec-tab="mouse"><span>Mouse</span></button>
      <button type="button" class="set-tab" data-sec-tab="audio"><span>Audio</span></button>
      <button type="button" class="set-tab" data-sec-tab="graphics"><span>Graphics</span></button>
      <button type="button" class="set-tab" data-sec-tab="controls"><span>Controls</span></button>
      <div class="set-nav-foot">
        <button class="back-btn" type="button" data-action="settings-back"><span>Back</span><kbd>Esc</kbd></button>
      </div>
    </nav>
    <div class="set-body">
      <section class="set-sec" data-sec="mouse">
        <div class="kicker">Aim</div><h2>Mouse</h2>
        <div class="set-row">
          <label for="sens-range">Sensitivity</label>
          <input type="range" id="sens-range" min="0.1" max="10" step="0.01">
          <input type="number" id="sens-num" min="0.05" max="20" step="0.01">
        </div>
        <div class="set-note" data-sens-info></div>
        <div class="set-note">Same scale as CS2 / Apex, so use your usual sens.</div>
        <label class="set-toggle"><input type="checkbox" data-raw-input><span>Raw input</span></label>
        <div class="set-note">Smoothest aim: skips Windows mouse acceleration. Turn it off only if your cursor slips onto another monitor while playing (a browser bug on some multi-monitor PCs). Takes effect next time you click in.</div>
      </section>
      <section class="set-sec" data-sec="audio">
        <div class="kicker">Sound</div><h2>Audio</h2>
        <div class="set-row">
          <label for="vol-range">Master volume</label>
          <input type="range" id="vol-range" min="0" max="1" step="0.01">
          <span class="set-val" data-vol-num></span>
        </div>
      </section>
      <section class="set-sec" data-sec="graphics">
        <div class="kicker">Look &amp; performance</div><h2>Graphics</h2>
        <div class="set-label">Lighting</div>
        <div class="light-grid" data-lights></div>
        <div class="set-label">Quality</div>
        <div class="quality-btns" data-quality></div>
        <div class="set-note">Lower quality = fewer pixels and simpler shadows. Try Performance if you get frame drops.</div>
      </section>
      <section class="set-sec" data-sec="controls">
        <div class="kicker">Keybinds</div><h2>Controls</h2>
        <div class="binds" data-binds></div>
        <div class="set-note">Click a bind, then press a key or mouse button. Esc cancels. Binding something already used swaps them.</div>
        <button class="back-btn reset" type="button" data-action="reset"><span>Reset controls to defaults</span></button>
      </section>
    </div>
  </div>
</div>

<div class="screen pause" data-screen="pause">
  <div class="pause-side">
    <div class="pause-mode" data-pause-mode></div>
    <h2 class="pause-title" data-pause-title>Paused</h2>
    <div class="pause-live" data-pause-live><i></i>Match is still live · you can still get splatted</div>
    <nav class="pause-nav">
      <button type="button" class="pnav primary" data-action="resume"><span>Resume</span><kbd data-pause-key></kbd></button>
      <button type="button" class="pnav" data-action="pause-settings"><span>Settings</span></button>
      <button type="button" class="pnav danger" data-action="quit"><span data-quit-label>Main Menu</span></button>
    </nav>
    <div class="hint" data-hint></div>
    <div class="pause-kit" data-pause-kit></div>
    <p class="note" data-pause-note></p>
  </div>
</div>`;

export const MODES = {
  dev: {
    tag: 'Sandbox', name: 'Dev Server', art: 'DEV', grad: 'linear-gradient(135deg, #2f6bff 0%, #8a3dff 100%)',
    desc: 'Movement playground · bean dummies · time trials · Solo',
  },
  arena: {
    tag: 'Aim Training', name: 'Bot Arena', art: 'BOTS', grad: 'linear-gradient(135deg, #ff4fd8 0%, #7a2dff 100%)',
    desc: 'Free-for-all against bean bots that fight back',
  },
  online: {
    tag: 'Online', name: 'Multiplayer', art: 'MP', grad: 'linear-gradient(135deg, #22c38e 0%, #1f6dff 100%)',
    desc: 'Free-for-all with friends · up to 8 players',
  },
};
const DIFFS = [['easy', 'Easy', '4 bots'], ['normal', 'Normal', '6 bots'], ['hard', 'Hard', '8 bots']];

function modeCardHTML(id, extra = '') {
  const m = MODES[id];
  const diff = id === 'arena' ? ` · ${DIFFS.find((d) => d[0] === settings.difficulty)[1]}` : '';
  return `
    <div class="mode-art" style="background-image: repeating-linear-gradient(0deg, rgba(255,255,255,0.08) 0 2px, transparent 2px 28px), repeating-linear-gradient(90deg, rgba(255,255,255,0.08) 0 2px, transparent 2px 28px), ${m.grad}">
      <span>${m.art}</span>${extra}
    </div>
    <div class="mode-info">
      <div class="mode-tag">${m.tag}${diff}</div>
      <div class="mode-name">${m.name}</div>
      <div class="mode-desc">${m.desc}</div>
    </div>`;
}

// Same rules as the server: letters, numbers, spaces and _ - . ! ? — max 16.
export function cleanName(raw) {
  return String(raw ?? '').replace(/[^\w \-.!?]/g, '').replace(/\s+/g, ' ').trim().slice(0, 16);
}

const bars = (stats) => stats.map(([name, v]) =>
  `<div class="stat"><span>${name}</span><div class="bar"><i style="width:${Math.round(v * 100)}%"></i></div></div>`,
).join('');

// Main menu, loadout, pause menu and settings. Pure DOM; the game tells it which screen to show.
export class Menu {
  constructor(root, { onPlay, onResume, onQuit, onVolume, onLighting, onQuality }) {
    this.onLighting = onLighting;
    this.onQuality = onQuality;
    this.root = root;
    this.screen = null;
    this.settingsBack = 'main';
    this.listening = null; // action id waiting for a new key
    this.loadoutSlot = 'primary';
    root.innerHTML = TEMPLATE;

    const actions = {
      play: onPlay,
      resume: onResume,
      quit: onQuit,
      'tab-main': () => this.show('main'),
      'edit-name': () => this.openNamePrompt(),
      'skip-name': () => this.finishName(''),
      'open-modes': () => this.show('modes'),
      'tab-loadout': () => this.show('loadout'),
      'open-settings': () => this.openSettings(this.screen === 'loadout' ? 'loadout' : 'main'),
      'pause-settings': () => this.openSettings('pause'),
      'settings-back': () => this.show(this.settingsBack),
      reset: () => { resetSettings(); this.refreshSettings(); },
    };
    root.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (btn) actions[btn.dataset.action]?.();
      const secTab = e.target.closest('[data-sec-tab]');
      if (secTab) { this.settingsSec = secTab.dataset.secTab; this.refreshSettingsTab(); return; }
      const slot = e.target.closest('[data-slot]');
      if (slot) { this.loadoutSlot = slot.dataset.slot; this.refreshLoadout(); }
      const opt = e.target.closest('[data-option]');
      if (opt) { setLoadout(this.loadoutSlot, opt.dataset.option); this.previewId = null; this.refreshLoadout(); }
      const q = e.target.closest('[data-q]');
      if (q) {
        settings.quality = q.dataset.q;
        saveSettings();
        this.onQuality?.(settings.quality);
        this.refreshLights();
        return;
      }
      const light = e.target.closest('[data-light]');
      if (light) {
        settings.lighting = light.dataset.light;
        saveSettings();
        this.onLighting?.(settings.lighting);
        this.refreshLights();
        return;
      }
      const diff = e.target.closest('[data-diff]');
      if (diff) {
        settings.mode = 'arena';
        settings.difficulty = diff.dataset.diff;
        saveSettings();
        this.refreshModes();
        return;
      }
      const pick = e.target.closest('[data-pick-mode]');
      if (pick) {
        settings.mode = pick.dataset.pickMode;
        saveSettings();
        this.show('main');
      }
    });

    this.sensRange = root.querySelector('#sens-range');
    this.sensNum = root.querySelector('#sens-num');
    const setSens = (v) => {
      if (!Number.isFinite(v) || v <= 0) return;
      settings.sensitivity = Math.min(20, Math.max(0.05, v));
      saveSettings();
      this.refreshSens();
    };
    this.sensRange.addEventListener('input', () => setSens(parseFloat(this.sensRange.value)));
    this.sensNum.addEventListener('change', () => setSens(parseFloat(this.sensNum.value)));

    this.rawInput = root.querySelector('[data-raw-input]');
    this.rawInput.addEventListener('change', () => {
      settings.rawMouse = this.rawInput.checked;
      saveSettings();
    });

    this.volRange = root.querySelector('#vol-range');
    this.volRange.addEventListener('input', () => {
      settings.volume = parseFloat(this.volRange.value);
      saveSettings();
      onVolume?.(settings.volume);
      this.refreshVolume();
    });

    // Hovering an item tile previews it on the stage; leaving the row goes back to the equipped one.
    const itemsRow = root.querySelector('[data-options]');
    itemsRow.addEventListener('pointerover', (e) => {
      const opt = e.target.closest('[data-option]');
      if (opt && opt.dataset.option !== this.previewId) { this.previewId = opt.dataset.option; this.refreshStage(); }
    });
    itemsRow.addEventListener('pointerleave', () => { this.previewId = null; this.refreshStage(); });
    this.thumbs = {};

    this.bindsEl = root.querySelector('[data-binds]');
    this.bindsEl.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-bind]');
      if (!btn) return;
      this.listening = btn.dataset.bind;
      this.refreshBinds();
    });

    this.root.querySelector('[data-name-form]').addEventListener('submit', (e) => {
      e.preventDefault();
      this.finishName(this.root.querySelector('[data-name-input]').value);
    });

    // Multiplayer name / server boxes save as you type (and picking them selects the mode).
    root.addEventListener('input', (e) => {
      if (e.target.matches('[data-mp-name]')) settings.playerName = e.target.value.slice(0, 16);
      else if (e.target.matches('[data-mp-server]')) settings.serverUrl = e.target.value.trim();
      else return;
      if (settings.mode !== 'online') { settings.mode = 'online'; this.refreshModesSelection(); }
      saveSettings();
    });

    // Capture phase so a key/button pressed while rebinding never reaches the game.
    window.addEventListener('keydown', (e) => this.onKey(e), true);
    window.addEventListener('mousedown', (e) => {
      if (!this.listening) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      this.swallowClickUntil = performance.now() + 600;
      this.finishBind('Mouse' + e.button);
    }, true);
    // The click that follows a mouse-button bind must not start listening again.
    window.addEventListener('click', (e) => {
      if (performance.now() < (this.swallowClickUntil ?? 0)) {
        e.preventDefault();
        e.stopImmediatePropagation();
        this.swallowClickUntil = 0;
      }
    }, true);
  }

  finishBind(code) {
    if (code !== 'Escape') bindKey(this.listening, code);
    this.listening = null;
    this.refreshBinds();
  }

  onKey(e) {
    if (this.listening) {
      e.preventDefault();
      e.stopImmediatePropagation();
      this.finishBind(e.code);
      return;
    }
    if (e.code !== 'Escape') return;
    if (this.screen === 'settings') this.show(this.settingsBack);
    else if (this.screen === 'loadout' || this.screen === 'modes') this.show('main');
  }

  show(screen) {
    this.screen = screen;
    this.listening = null;
    this.root.classList.toggle('hidden', !screen);
    for (const el of this.root.querySelectorAll('[data-screen]')) {
      el.classList.toggle('hidden', el.dataset.screen !== screen);
    }
    const withTopbar = ['main', 'loadout', 'modes'].includes(screen) || (screen === 'settings' && this.settingsBack !== 'pause');
    this.root.querySelector('[data-topbar]').classList.toggle('hidden', !withTopbar);
    this.root.querySelector('[data-screen="settings"]').classList.toggle('over-game', this.settingsBack === 'pause');
    if (screen === 'modes') this.refreshModes();
    for (const t of this.root.querySelectorAll('[data-tab]')) t.classList.toggle('active', t.dataset.tab === screen);
    this.setHint('');
    if (screen === 'settings') this.refreshSettings();
    if (screen === 'loadout') this.openLoadout();
    else this.showcase?.stop();
    if (screen === 'main') {
      this.refreshChips();
      this.refreshName();
      // First launch: ask for a username.
      if (!settings.playerName) this.openNamePrompt();
    }
    if (screen === 'pause') this.refreshPause();
  }

  // ---------- username ----------
  openNamePrompt() {
    const input = this.root.querySelector('[data-name-input]');
    input.value = settings.playerName;
    this.root.querySelector('[data-name-prompt]').classList.remove('hidden');
    setTimeout(() => { input.focus(); input.select(); }, 0);
  }

  // Blank / skipped = Player_ + 5 random digits.
  finishName(raw) {
    const name = cleanName(raw) || `Player_${Math.floor(10000 + Math.random() * 90000)}`;
    settings.playerName = name;
    saveSettings();
    this.root.querySelector('[data-name-prompt]').classList.add('hidden');
    this.refreshName();
    if (this.screen === 'modes') this.refreshModes();
  }

  refreshName() {
    this.root.querySelector('[data-name-chip]').textContent = settings.playerName || 'Set username';
  }

  openSettings(from) {
    this.settingsBack = from;
    this.show('settings');
  }

  setHint(text) {
    for (const el of this.root.querySelectorAll('[data-hint]')) el.textContent = text;
  }

  // ---------- loadout ----------
  itemName(slot, id) {
    return slot === 'ability' ? ABILITIES[id].name : WEAPONS[id].name;
  }

  // Update just the "selected" highlight without re-rendering (keeps focus in the text boxes).
  refreshModesSelection() {
    for (const pick of this.root.querySelectorAll('.mode-pick')) {
      const id = pick.querySelector('[data-pick-mode]').dataset.pickMode;
      pick.classList.toggle('selected', settings.mode === id);
    }
  }

  refreshModes() {
    this.root.querySelector('[data-modes]').innerHTML = Object.keys(MODES).map((id) => {
      const selected = settings.mode === id;
      let diffs = id === 'arena'
        ? `<div class="diff-row">${DIFFS.map(([d, label, count]) =>
          `<button type="button" class="diff${settings.difficulty === d ? ' on' : ''}" data-diff="${d}">${label}<small>${count}</small></button>`).join('')}</div>`
        : '';
      if (id === 'online') {
        const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
        diffs = `<div class="mp-fields">
          <label>Name<input type="text" maxlength="16" placeholder="Bean" data-mp-name value="${esc(settings.playerName)}"></label>
          <label>Server<input type="text" placeholder="localhost:8080" data-mp-server value="${esc(settings.serverUrl)}"></label>
        </div>`;
      }
      return `
        <div class="mode-pick${selected ? ' selected' : ''}">
          <button type="button" class="mode-card" data-pick-mode="${id}">${modeCardHTML(id, selected ? '<em class="badge">Selected</em>' : '')}</button>
          ${diffs}
        </div>`;
    }).join('');
  }

  refreshChips() {
    this.root.querySelector('[data-current-mode]').innerHTML = modeCardHTML(settings.mode, '<em class="change">Change mode</em>');
    const lo = settings.loadout;
    this.root.querySelector('[data-chips]').innerHTML = SLOTS.map((s) =>
      `<span class="chip"><b>${s.label}</b>${this.itemName(s.id, lo[s.id])}</span>`).join('');
  }

  openLoadout() {
    if (!this.showcase) {
      try {
        this.showcase = new Showcase(this.root.querySelector('[data-stage]'));
        const ids = [...Object.keys(WEAPONS), ...Object.keys(ABILITIES)];
        this.showcase.thumbnails(ids, (id, url) => {
          this.thumbs[id] = url;
          for (const img of this.root.querySelectorAll(`[data-thumb="${id}"]`)) img.src = url;
        });
      } catch (err) {
        console.warn('Loadout showcase unavailable:', err);
        this.showcase = null;
      }
    }
    this.previewId = null;
    this.refreshLoadout();
    this.showcase?.start();
  }

  item(slot, id) { return slot === 'ability' ? ABILITIES[id] : WEAPONS[id]; }

  thumbHTML(id) {
    const src = this.thumbs[id];
    return `<img class="thumb" data-thumb="${id}" alt="" ${src ? `src="${src}"` : ''}>`;
  }

  refreshLoadout() {
    const lo = settings.loadout;
    const keyFor = { primary: settings.keys.primary, secondary: settings.keys.secondary, ability: settings.keys.ability };
    this.root.querySelector('[data-slots]').innerHTML = '<div class="locker-head">Loadout</div>' + SLOTS.map((s) => `
      <button type="button" class="slot-card${this.loadoutSlot === s.id ? ' selected' : ''}" data-slot="${s.id}">
        <span class="slot-label">${s.label}<kbd>${keyLabel(keyFor[s.id])}</kbd></span>
        <span class="slot-name">${this.itemName(s.id, lo[s.id])}</span>
        ${this.thumbHTML(lo[s.id])}
      </button>`).join('');

    const slot = SLOTS.find((s) => s.id === this.loadoutSlot);
    const items = slot.id === 'ability' ? Object.values(ABILITIES) : weaponsForSlot(slot.id);
    this.root.querySelector('[data-options-title]').innerHTML = `${slot.title}<small>${items.length}</small>`;
    this.root.querySelector('[data-options]').innerHTML = items.map((it) => {
      const equipped = lo[slot.id] === it.id;
      return `
        <button type="button" class="item-tile${equipped ? ' equipped' : ''}" data-option="${it.id}">
          ${this.thumbHTML(it.id)}
          <span class="tile-name">${it.name}</span>
          ${equipped ? '<span class="tile-tag">Equipped</span>' : ''}
        </button>`;
    }).join('');
    this.refreshStage();
  }

  refreshStage() {
    const slot = this.loadoutSlot;
    const equippedId = settings.loadout[slot];
    const id = this.previewId ?? equippedId;
    const it = this.item(slot, id);
    const stats = slot === 'ability' ? abilityStats(it) : weaponStats(it);
    const equipped = id === equippedId;
    const seg = (v) => Array.from({ length: 10 }, (_, i) => `<i class="${i < Math.round(v * 10) ? 'on' : ''}"></i>`).join('');
    this.root.querySelector('[data-stage-info]').innerHTML = `
      <div class="stage-class">${itemClass(it)}</div>
      <div class="stage-name">${it.name}</div>
      <div class="stage-desc">${it.desc}</div>
      <div class="stage-stats">${stats.map(([name, v, text]) => `
        <div class="sstat"><span class="sl">${name}</span><span class="seg">${seg(v)}</span><span class="sv">${text}</span></div>`).join('')}
      </div>
      <div class="stage-state${equipped ? ' on' : ''}">${equipped ? 'Equipped' : 'Click to equip'}</div>`;
    this.showcase?.show(id);
  }

  // ---------- pause ----------
  refreshPause() {
    const online = settings.mode === 'online';
    const q = (s) => this.root.querySelector(`[data-${s}]`);
    q('pause-mode').textContent = MODES[settings.mode]?.name ?? '';
    q('pause-title').textContent = online ? 'Menu' : 'Paused';
    q('pause-live').classList.toggle('hidden', !online);
    q('pause-key').textContent = keyLabel(settings.keys.menu);
    q('quit-label').textContent = online ? 'Leave Match' : 'Main Menu';
    const lo = settings.loadout;
    q('pause-kit').innerHTML = SLOTS.map((s) =>
      `<div class="kit"><b>${s.label}</b><span>${this.itemName(s.id, lo[s.id])}</span></div>`).join('');
    q('pause-note').textContent = 'Hold Esc to leave fullscreen';
  }

  // ---------- settings ----------
  refreshSettingsTab() {
    const sec = this.settingsSec ?? 'mouse';
    for (const el of this.root.querySelectorAll('[data-sec]')) el.classList.toggle('hidden', el.dataset.sec !== sec);
    for (const el of this.root.querySelectorAll('[data-sec-tab]')) el.classList.toggle('selected', el.dataset.secTab === sec);
  }

  refreshSettings() {
    this.refreshSettingsTab();
    this.refreshSens();
    this.refreshVolume();
    this.refreshLights();
    this.refreshBinds();
  }

  refreshLights() {
    this.root.querySelector('[data-lights]').innerHTML = Object.entries(LIGHTING).map(([id, L]) => `
      <button type="button" class="light${settings.lighting === id ? ' on' : ''}" data-light="${id}">
        <span class="swatch" style="background: linear-gradient(180deg, ${L.sky[0]}, ${L.sky[1]})"></span>
        <span class="light-name">${L.label}</span>
      </button>`).join('');
    this.root.querySelector('[data-quality]').innerHTML = Object.entries(QUALITY).map(([id, Q]) =>
      `<button type="button" class="diff${settings.quality === id ? ' on' : ''}" data-q="${id}">${Q.label}</button>`).join('');
  }

  refreshVolume() {
    this.volRange.value = settings.volume;
    this.volRange.style.setProperty('--fill', `${settings.volume * 100}%`);
    this.root.querySelector('[data-vol-num]').textContent = `${Math.round(settings.volume * 100)}%`;
  }

  refreshSens() {
    this.rawInput.checked = settings.rawMouse;
    this.sensRange.value = settings.sensitivity;
    this.sensRange.style.setProperty('--fill', `${Math.min(100, ((settings.sensitivity - 0.1) / 9.9) * 100)}%`);
    this.sensNum.value = settings.sensitivity.toFixed(2);
    this.root.querySelector('[data-sens-info]').textContent =
      `${cmPer360(800).toFixed(1)} cm/360° at 800 DPI · ${cmPer360(1600).toFixed(1)} cm/360° at 1600 DPI`;
  }

  refreshBinds() {
    const GROUPS = { forward: 'Movement', fire: 'Combat', menu: 'Other' };
    this.bindsEl.innerHTML = ACTIONS.map((a) => {
      const listening = this.listening === a.id;
      const head = GROUPS[a.id] ? `<div class="bind-group">${GROUPS[a.id]}</div>` : '';
      return `${head}<div class="bind-row">
        <span>${a.label}</span>
        <button type="button" class="key${listening ? ' listening' : ''}" data-bind="${a.id}">
          ${listening ? 'Press a key…' : keyLabel(settings.keys[a.id])}
        </button>
      </div>`;
    }).join('');
  }
}
