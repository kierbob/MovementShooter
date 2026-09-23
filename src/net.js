// Client side of multiplayer: talks to server/server.js over a WebSocket.
// - Every sim tick, the local input command is queued (with a sequence number) and sent once
//   per frame in a small batch.
// - Snapshots from the server are buffered so other players can be drawn slightly in the past,
//   smoothly interpolated between two known positions (no jitter).
const INTERP_DELAY = 100; // ms other players are shown in the past (must exceed the snapshot gap)

// Accept "localhost:8080", "ws://…", "wss://…", "http(s)://…" (e.g. a Cloudflare tunnel URL).
// Without a scheme: your own PC (localhost) is always plain ws:// — the local server has no
// certificate, and browsers allow ws://localhost even from an https page (e.g. GitHub Pages).
// Anything else gets wss:// on an https page (browsers block plain ws:// there).
export function normalizeServerUrl(raw) {
  let u = String(raw ?? '').trim();
  if (!u) return '';
  if (u.startsWith('https://')) u = 'wss://' + u.slice(8);
  else if (u.startsWith('http://')) u = 'ws://' + u.slice(7);
  else if (!/^wss?:\/\//.test(u)) {
    const isLocal = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i.test(u);
    u = (isLocal || location.protocol !== 'https:' ? 'ws://' : 'wss://') + u;
  }
  return u.replace(/\/+$/, '');
}

export class Net {
  constructor() {
    this.ws = null;
    this.id = null;
    this.connected = false;
    this.seq = 0;
    this.outbox = [];
    this.remotes = new Map(); // id -> { name, color, buf: [{ at, s }] }
    this.self = null;         // our own latest entry in the players list (kills, deaths…)
    this.me = null;           // our full authoritative movement state + respawn timer
    this.meFresh = false;     // a new `me` arrived that hasn't been reconciled yet
    this.events = [];         // gameplay events from the server not yet handled
    this.proj = [];           // every live projectile on the server
    this.timeline = [];       // [{ at, tick }] of received snapshots, for lag compensation
    this.ping = 0;
    this.onDisconnect = null;
  }

  connect(rawUrl, name, loadout) {
    const url = normalizeServerUrl(rawUrl);
    return new Promise((resolve, reject) => {
      if (!url) { reject(new Error('No server address')); return; }
      let ws;
      try { ws = new WebSocket(url); } catch (err) { reject(err); return; }
      this.ws = ws;
      const timeout = setTimeout(() => { ws.close(); reject(new Error(`Couldn't reach ${url}`)); }, 6000);
      ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', name, loadout }));
      ws.onerror = () => { clearTimeout(timeout); reject(new Error(`Couldn't connect to ${url}`)); };
      ws.onclose = () => {
        clearTimeout(timeout);
        const was = this.connected;
        this.connected = false;
        clearInterval(this.pingTimer);
        if (was) this.onDisconnect?.();
      };
      ws.onmessage = (ev) => {
        let msg;
        try { msg = JSON.parse(ev.data); } catch { return; }
        if (msg.t === 'welcome') {
          clearTimeout(timeout);
          this.id = msg.id;
          this.connected = true;
          this.seq = 0;
          this.outbox = [];
          this.remotes.clear();
          this.me = null;
          this.meFresh = false;
          this.events = [];
          this.proj = [];
          this.timeline = [];
          this.pingTimer = setInterval(() => this.send({ t: 'ping', ts: performance.now() }), 1000);
          resolve(msg);
        } else if (msg.t === 'full') {
          clearTimeout(timeout);
          reject(new Error('That server is full'));
        } else if (msg.t === 'snap') {
          this.onSnapshot(msg);
        } else if (msg.t === 'pong') {
          this.ping = performance.now() - msg.ts;
        }
      };
    });
  }

  close() {
    this.connected = false;
    clearInterval(this.pingTimer);
    this.ws?.close();
    this.ws = null;
    this.remotes.clear();
  }

  send(msg) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  // Called once per sim tick with the command the local player just used. Returns its seq.
  queueCmd(cmd) {
    this.seq++;
    const c = {
      seq: this.seq, vt: this.viewTick(),
      forward: cmd.forward, right: cmd.right, jump: cmd.jump, jumpHeld: cmd.jumpHeld,
      sprint: cmd.sprint, crouch: cmd.crouch, slide: cmd.slide, slidePressed: cmd.slidePressed,
      yaw: +cmd.yaw.toFixed(4), pitch: +cmd.pitch.toFixed(4),
    };
    // Combat inputs only when set (keeps messages small).
    if (cmd.fire) c.fire = 1;
    if (cmd.firePressed) c.firePressed = 1;
    if (cmd.reload) c.reload = 1;
    if (cmd.ability) c.ability = 1;
    if (cmd.slot) c.slot = cmd.slot;
    if (cmd.cycle) c.cycle = cmd.cycle;
    this.outbox.push(c);
    return this.seq;
  }

  // The server tick other players are currently being drawn at (they're shown INTERP_DELAY ms
  // in the past). Sent with every input so the server can rewind hitboxes to match your screen.
  viewTick(now = performance.now()) {
    const t = now - INTERP_DELAY, tl = this.timeline;
    if (tl.length === 0) return 0;
    if (t <= tl[0].at) return tl[0].tick;
    for (let i = tl.length - 1; i > 0; i--) {
      const a = tl[i - 1], b = tl[i];
      if (t >= a.at && t <= b.at) return Math.round(a.tick + (b.tick - a.tick) * ((t - a.at) / Math.max(1, b.at - a.at)));
    }
    return tl[tl.length - 1].tick;
  }

  takeEvents() {
    const e = this.events;
    this.events = [];
    return e;
  }

  // Called once per frame: send everything queued this frame in one message.
  flush() {
    if (!this.connected || this.outbox.length === 0) return;
    this.send({ t: 'input', cmds: this.outbox });
    this.outbox = [];
  }

  onSnapshot(msg) {
    const at = performance.now();
    this.timeline.push({ at, tick: msg.tick });
    if (this.timeline.length > 20) this.timeline.shift();
    if (msg.me) { this.me = msg.me; this.meFresh = true; }
    if (msg.ev?.length) this.events.push(...msg.ev);
    this.proj = msg.proj ?? [];
    this.players = msg.players; // for the scoreboard
    const seen = new Set();
    for (const s of msg.players) {
      if (s.id === this.id) { this.self = s; continue; }
      seen.add(s.id);
      let r = this.remotes.get(s.id);
      if (!r) { r = { id: s.id, name: s.name, color: s.color, buf: [] }; this.remotes.set(s.id, r); }
      r.buf.push({ at, s });
      if (r.buf.length > 20) r.buf.shift();
    }
    for (const id of [...this.remotes.keys()]) if (!seen.has(id)) this.remotes.delete(id);
  }

  // Where to draw a remote player right now: INTERP_DELAY ms in the past, blended between
  // the two snapshots around that moment.
  sample(r, now = performance.now()) {
    const t = now - INTERP_DELAY;
    const b = r.buf;
    if (b.length === 0) return null;
    if (t <= b[0].at) return b[0].s;
    for (let i = b.length - 1; i > 0; i--) {
      const a = b[i - 1], c = b[i];
      if (t >= a.at && t <= c.at) {
        const k = (t - a.at) / Math.max(1, c.at - a.at);
        const lerp = (x, y) => x + (y - x) * k;
        let dy = c.s.yaw - a.s.yaw;
        dy = Math.atan2(Math.sin(dy), Math.cos(dy)); // shortest way round
        // Don't blend across a respawn (it would slide the bean across the map).
        if (Math.hypot(c.s.x - a.s.x, c.s.z - a.s.z) > 8) return c.s;
        return {
          ...c.s,
          x: lerp(a.s.x, c.s.x), y: lerp(a.s.y, c.s.y), z: lerp(a.s.z, c.s.z),
          yaw: a.s.yaw + dy * k,
        };
      }
    }
    return b[b.length - 1].s; // no newer data yet: hold the latest
  }
}
