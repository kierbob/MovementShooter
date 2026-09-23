// Player settings (keybinds, mouse, loadout). Saved to localStorage so they persist between visits.
import { WEAPONS, ABILITIES, DEFAULT_LOADOUT } from './items.js';

export const ACTIONS = [
  { id: 'forward', label: 'Move Forward', def: 'KeyW' },
  { id: 'back', label: 'Move Back', def: 'KeyS' },
  { id: 'left', label: 'Move Left', def: 'KeyA' },
  { id: 'right', label: 'Move Right', def: 'KeyD' },
  { id: 'sprint', label: 'Sprint', def: 'ShiftLeft' },
  { id: 'jump', label: 'Jump', def: 'Space' },
  { id: 'crouch', label: 'Crouch', def: 'ControlLeft' },
  { id: 'slide', label: 'Slide', def: 'KeyC' },
  { id: 'fire', label: 'Fire', def: 'Mouse0' },
  { id: 'reload', label: 'Reload', def: 'KeyR' },
  { id: 'primary', label: 'Primary Weapon', def: 'Digit1' },
  { id: 'secondary', label: 'Secondary Weapon', def: 'Digit2' },
  { id: 'ability', label: 'Ability', def: 'KeyQ' },
  { id: 'menu', label: 'Open Menu', def: 'KeyL' },
  { id: 'respawn', label: 'Respawn', def: 'KeyK' },
  { id: 'scoreboard', label: 'Scoreboard (hold)', def: 'Tab' },
  { id: 'stats', label: 'Stats Panel', def: 'F4' },
];

// 0.022° per mouse count at sensitivity 1.0 — same scale as CS2 / Apex / Source games,
// so players can type in the sens they already use.
export const BASE_SENSITIVITY = (0.022 * Math.PI) / 180;
const STORAGE_KEY = 'movement-shooter.settings.v1';

function defaults() {
  return {
    keys: Object.fromEntries(ACTIONS.map((a) => [a.id, a.def])),
    sensitivity: 2.0,
    volume: 0.6,
    loadout: { ...DEFAULT_LOADOUT },
    lighting: 'pastel',   // key of LIGHTING in render.js
    quality: 'balanced',  // key of QUALITY in render.js
    statsPanel: 'compact', // 'full' | 'compact' | 'off' (toggle in game with F4)
    mode: 'dev',          // 'dev' | 'arena' | 'online'
    playerName: '',
    serverUrl: 'localhost:8080',
    difficulty: 'normal', // bot arena: 'easy' | 'normal' | 'hard'
  };
}

function load() {
  const s = defaults();
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved?.keys) {
      // Older saves had respawn on R, which is reload now.
      if (saved.keys.respawn === 'KeyR' && !saved.keys.reload) delete saved.keys.respawn;
      for (const a of ACTIONS) if (typeof saved.keys[a.id] === 'string') s.keys[a.id] = saved.keys[a.id];
    }
    if (typeof saved?.sensitivity === 'number') s.sensitivity = saved.sensitivity;
    if (typeof saved?.volume === 'number') s.volume = saved.volume;
    if (['dev', 'arena', 'online'].includes(saved?.mode)) s.mode = saved.mode;
    if (typeof saved?.playerName === 'string') s.playerName = saved.playerName.slice(0, 16);
    if (typeof saved?.serverUrl === 'string' && saved.serverUrl) s.serverUrl = saved.serverUrl;
    if (typeof saved?.lighting === 'string') s.lighting = saved.lighting;
    if (['high', 'balanced', 'performance'].includes(saved?.quality)) s.quality = saved.quality;
    if (['full', 'compact', 'off'].includes(saved?.statsPanel)) s.statsPanel = saved.statsPanel;
    if (['easy', 'normal', 'hard'].includes(saved?.difficulty)) s.difficulty = saved.difficulty;
    const lo = saved?.loadout;
    if (WEAPONS[lo?.primary]?.slot === 'primary') s.loadout.primary = lo.primary;
    if (WEAPONS[lo?.secondary]?.slot === 'secondary') s.loadout.secondary = lo.secondary;
    if (ABILITIES[lo?.ability]) s.loadout.ability = lo.ability;
  } catch { /* storage blocked or corrupt — use defaults */ }
  return s;
}

export const settings = load();

// Join links: ?server=abc.trycloudflare.com opens straight into Multiplayer on that server.
try {
  const server = new URLSearchParams(location.search).get('server');
  if (server) { settings.serverUrl = server; settings.mode = 'online'; }
} catch { /* not in a browser */ }

export function saveSettings() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch { /* ignore */ }
}

// Resets controls and mouse; the loadout is left alone.
export function resetSettings() {
  const d = defaults();
  settings.keys = d.keys;
  settings.sensitivity = d.sensitivity;
  settings.volume = d.volume;
  saveSettings();
}

// Binding a key already used elsewhere swaps the two, so nothing ends up unbound.
export function bindKey(action, code) {
  const other = Object.keys(settings.keys).find((k) => k !== action && settings.keys[k] === code);
  if (other) settings.keys[other] = settings.keys[action];
  settings.keys[action] = code;
  saveSettings();
}

export function setLoadout(slot, id) {
  settings.loadout[slot] = id;
  saveSettings();
}

export function radiansPerCount() {
  return BASE_SENSITIVITY * settings.sensitivity;
}

// Distance the mouse travels for a full 360° turn at a given DPI — the number FPS players compare.
export function cmPer360(dpi = 800) {
  return ((2 * Math.PI) / radiansPerCount() / dpi) * 2.54;
}

const NAMED = {
  Space: 'Space', ControlLeft: 'L Ctrl', ControlRight: 'R Ctrl', ShiftLeft: 'L Shift', ShiftRight: 'R Shift',
  AltLeft: 'L Alt', AltRight: 'R Alt', Tab: 'Tab', CapsLock: 'Caps', Enter: 'Enter', Backspace: 'Backspace',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Backquote: '`', Minus: '-', Equal: '=',
  BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backslash: '\\',
  Mouse0: 'LMB', Mouse1: 'MMB', Mouse2: 'RMB', Mouse3: 'Mouse 4', Mouse4: 'Mouse 5',
};

export function keyLabel(code) {
  if (NAMED[code]) return NAMED[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'Num ' + code.slice(6);
  return code;
}
