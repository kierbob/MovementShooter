import { settings, radiansPerCount } from './settings.js';

// Collects raw keyboard/mouse input and timing info for the debug panel.
// Everything is read through the player's bindings in settings.keys. Mouse buttons are
// treated like keys with codes 'Mouse0'..'Mouse4' so they can be bound to anything.
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.enabled = false;       // only true while actually playing (not in menus)
    this.held = new Set();
    this.pressed = new Set();   // codes pressed since the last sim tick
    this.cycle = 0;             // mouse wheel weapon cycling
    this.yaw = 0;
    this.pitch = 0;
    this.respawnPressed = false;
    this.locked = false;
    this.keyboardLocked = false;
    this.rawMouse = false;

    this.lastEvent = null;      // { type, code, t }
    this.unconsumed = [];       // timestamps of inputs the sim hasn't seen yet
    this.lastDelayMs = 0;       // input event -> first sim tick that used it
    this.mouseEvents = 0;
    this.mouseRate = 0;         // mousemove events per second (≈ polling rate while moving)
    this._mouseWindow = performance.now();

    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
    window.addEventListener('blur', () => this.held.clear());
    document.addEventListener('mousemove', (e) => this.onMouse(e));
    document.addEventListener('mousedown', (e) => this.onButton(e, true));
    document.addEventListener('mouseup', (e) => this.onButton(e, false));
    document.addEventListener('wheel', (e) => {
      if (!this.locked || !this.enabled) return;
      e.preventDefault();
      this.cycle = Math.sign(e.deltaY);
    }, { passive: false });
    document.addEventListener('contextmenu', (e) => { if (this.locked) e.preventDefault(); });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (!this.locked) this.held.clear();
      this.onLockChange?.(this.locked);
    });
    document.addEventListener('fullscreenchange', () => {
      // Keyboard lock only lives while fullscreen; the browser drops it on exit.
      if (!document.fullscreenElement) this.keyboardLocked = false;
    });
    // Safety net for when keyboard lock isn't active: Ctrl+W / closing the tab mid-game
    // shows a "Leave site?" prompt instead of killing the game instantly.
    window.addEventListener('beforeunload', (e) => {
      if (!this.locked && !document.fullscreenElement) return;
      e.preventDefault();
      e.returnValue = '';
    });
  }

  // Fullscreen + keyboard lock + pointer lock. Must be called from a click or key press.
  // Browsers only let a page swallow Ctrl+W / Ctrl+T / Ctrl+N etc. while it's fullscreen
  // with the Keyboard Lock API (Chrome/Edge). In that mode Esc must be HELD to leave fullscreen.
  // Resolves true if the mouse was captured.
  async enterGame() {
    if (!document.fullscreenElement) {
      try {
        await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
      } catch { /* fullscreen refused — beforeunload guard still protects Ctrl+W */ }
    }
    if (document.fullscreenElement && navigator.keyboard?.lock && !this.keyboardLocked) {
      try {
        await navigator.keyboard.lock(); // no args = capture every key the browser allows
        this.keyboardLocked = true;
      } catch { /* unsupported */ }
    }
    if (settings.rawMouse) {
      try {
        await this.canvas.requestPointerLock({ unadjustedMovement: true });
        this.rawMouse = true;
        return true;
      } catch { /* raw input unsupported, or lock refused */ }
    }
    try {
      await this.canvas.requestPointerLock();
      this.rawMouse = false;
      return true;
    } catch {
      // Browsers refuse a re-lock for ~1 s after the user pressed Esc.
      return false;
    }
  }

  onKey(e, down) {
    if (this.locked) {
      // In-game: swallow everything we can (Ctrl+S/F/D/P, F5, Alt menus, etc.).
      // F12 stays usable for dev tools.
      if (e.code !== 'F12') e.preventDefault();
      // Esc (reaches us under keyboard lock) or the Open Menu key releases the mouse → pause.
      if (down && (e.code === 'Escape' || e.code === settings.keys.menu)) {
        document.exitPointerLock();
        return;
      }
    }
    if (e.repeat) return;
    this.handle(e.code, down, e.type, e.timeStamp);
  }

  onButton(e, down) {
    if (!this.locked) return;
    const code = 'Mouse' + e.button;
    if (down && code === settings.keys.menu) { document.exitPointerLock(); return; }
    this.handle(code, down, e.type, e.timeStamp);
  }

  handle(code, down, type, t) {
    if (!this.enabled) return;
    if (down) {
      this.held.add(code);
      this.pressed.add(code);
      if (code === settings.keys.respawn) this.respawnPressed = true;
    } else {
      this.held.delete(code);
    }
    this.lastEvent = { type, code, t };
    this.unconsumed.push(t);
  }

  onMouse(e) {
    if (!this.locked || !this.enabled) return;
    // Without raw input, Chrome on Windows sometimes reports one bogus, huge movement (the camera
    // "snaps"). Drop any single event far bigger than the recent ones.
    const mag = Math.abs(e.movementX) + Math.abs(e.movementY);
    if (!this.rawMouse) {
      const typical = this.typicalMove ?? 20;
      if (mag > 300 && mag > typical * 10) return;
      this.typicalMove = typical * 0.9 + mag * 0.1;
    }
    const sens = radiansPerCount();
    this.yaw -= e.movementX * sens;
    this.pitch -= e.movementY * sens;
    const lim = Math.PI / 2 - 0.001;
    this.pitch = Math.max(-lim, Math.min(lim, this.pitch));
    this.mouseEvents++;
    const now = performance.now();
    if (now - this._mouseWindow >= 500) {
      this.mouseRate = Math.round((this.mouseEvents * 1000) / (now - this._mouseWindow));
      this.mouseEvents = 0;
      this._mouseWindow = now;
    }
  }

  isDown(action) {
    return this.held.has(settings.keys[action]);
  }

  wasPressed(action) {
    return this.pressed.has(settings.keys[action]);
  }

  axis(pos, neg) {
    return (this.isDown(pos) ? 1 : 0) - (this.isDown(neg) ? 1 : 0);
  }

  // Snapshot for one sim tick. Plain data so a server could receive the same thing.
  sample(now) {
    if (this.unconsumed.length) {
      this.lastDelayMs = now - this.unconsumed[this.unconsumed.length - 1];
      this.unconsumed.length = 0;
    }
    const cmd = {
      forward: this.axis('forward', 'back'),
      right: this.axis('right', 'left'),
      jump: this.wasPressed('jump'),
      jumpHeld: this.isDown('jump'),
      sprint: this.isDown('sprint'),
      crouch: this.isDown('crouch'),
      slide: this.isDown('slide'),
      slidePressed: this.wasPressed('slide'),
      fire: this.isDown('fire'),
      firePressed: this.wasPressed('fire'),
      reload: this.wasPressed('reload'),
      ability: this.wasPressed('ability'),
      slot: this.wasPressed('primary') ? 'primary' : this.wasPressed('secondary') ? 'secondary' : null,
      cycle: this.cycle,
      yaw: this.yaw,
      pitch: this.pitch,
    };
    this.pressed.clear();
    this.cycle = 0;
    return cmd;
  }
}
