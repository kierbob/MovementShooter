// Bean bots for the Bot Arena. Each bot is a full player body (same movement code as you:
// sprint, jump, slide, jump pads) with a combat target for its hitboxes. The AI is simple:
// wander when it can't see you; when it can, strafe around at its preferred range and
// fire slow, dodgeable shots with some lead and some error.
// Pure logic (no three.js) — runs in the fixed sim tick.
import { createPlayer, stepPlayer, eyePosition, horizontalSpeed } from './player.js';
import { ARENA } from './world.js';

export const DIFFICULTY = {
  easy: {
    label: 'Easy', count: 4, hp: 120, fireRate: 1.1, aimError: 3.5, lead: 0.25, reaction: 0.65,
    shot: { speed: 24, radius: 0.2, damage: 8 }, range: [12, 20], jumpiness: 0.3, sprint: false,
  },
  normal: {
    label: 'Normal', count: 6, hp: 150, fireRate: 1.7, aimError: 2, lead: 0.6, reaction: 0.45,
    shot: { speed: 30, radius: 0.2, damage: 10 }, range: [10, 18], jumpiness: 0.6, sprint: true,
  },
  hard: {
    label: 'Hard', count: 8, hp: 150, fireRate: 2.4, aimError: 1.1, lead: 0.9, reaction: 0.25,
    shot: { speed: 38, radius: 0.2, damage: 11 }, range: [8, 16], jumpiness: 1, sprint: true,
  },
};

const NAMES = ['Beanie', 'Sir Legume', 'Pinto', 'Kidney Kid', 'Jellybean', 'Chickpea', 'Edamame', 'Lima Lad', 'Mung', 'Fava'];
const RESPAWN = 3;
const SIGHT = 70;

const rand = (a, b) => a + Math.random() * (b - a);
const yawTo = (dx, dz) => Math.atan2(-dx, -dz); // yaw that faces direction (dx, dz)

export class Bots {
  constructor(combat, boxes) {
    this.combat = combat;
    this.boxes = boxes;
    this.list = [];
    this.diff = DIFFICULTY.normal;
  }

  start(difficulty, player) {
    this.stop();
    this.diff = DIFFICULTY[difficulty] ?? DIFFICULTY.normal;
    const names = [...NAMES].sort(() => Math.random() - 0.5);
    for (let i = 0; i < this.diff.count; i++) {
      const body = createPlayer(ARENA.spawns[0]);
      const target = this.combat.addTarget({
        kind: 'bot', name: names[i % names.length], pos: body.pos, body, hp: this.diff.hp, maxHp: this.diff.hp,
      });
      const bot = { body, target, goal: null, goalT: 0, strafe: 1, strafeT: 0, seenT: 0, fireCd: rand(0.5, 1.5), stuckT: 0, jumpT: rand(1, 3), yaw: 0, pitch: 0, respawnT: 0 };
      this.list.push(bot);
      this.respawn(bot, player, true);
    }
  }

  stop() {
    for (const b of this.list) this.combat.removeTarget(b.target);
    this.list = [];
  }

  // Farthest spawn from `from` (so nobody spawns in your face).
  farSpawn(from, exclude = []) {
    let best = ARENA.spawns[0], bestD = -1;
    for (const s of ARENA.spawns) {
      if (exclude.includes(s)) continue;
      const d = Math.hypot(s.x - from.x, s.z - from.z) + rand(0, 6);
      if (d > bestD) { bestD = d; best = s; }
    }
    return best;
  }

  respawn(bot, player, initial = false) {
    const s = initial ? ARENA.spawns[(this.list.indexOf(bot) + 1) % ARENA.spawns.length] : this.farSpawn(player.pos);
    const b = bot.body;
    b.pos = { x: s.x + rand(-1.5, 1.5), y: s.y, z: s.z + rand(-1.5, 1.5) };
    b.vel = { x: 0, y: 0, z: 0 };
    b.sliding = false;
    bot.target.pos = b.pos;
    bot.target.hp = bot.target.maxHp;
    bot.target.dead = false;
    bot.yaw = s.yaw;
    bot.goal = null;
    bot.seenT = 0;
    bot.fireCd = rand(0.8, 1.6);
  }

  canSee(from, to) {
    const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
    const d = Math.hypot(dx, dy, dz);
    if (d > SIGHT) return false;
    const hit = this.combat.raycast(from, { x: dx / d, y: dy / d, z: dz / d }, d, 0, false);
    return !hit;
  }

  tick(player, dt) {
    const D = this.diff;
    const playerEye = eyePosition(player);
    const playerChest = { x: player.pos.x, y: player.pos.y + player.height * 0.55, z: player.pos.z };

    for (const bot of this.list) {
      const b = bot.body, t = bot.target;
      if (t.dead) {
        bot.respawnT = bot.respawnT > 0 ? bot.respawnT - dt : RESPAWN;
        if (bot.respawnT <= dt) { bot.respawnT = 0; this.respawn(bot, player); }
        continue;
      }

      const eye = eyePosition(b);
      const sees = !player.dead && this.canSee(eye, playerEye);
      bot.seenT = sees ? bot.seenT + dt : 0;
      const dx = player.pos.x - b.pos.x, dz = player.pos.z - b.pos.z;
      const dist = Math.hypot(dx, dz);

      const cmd = { forward: 0, right: 0, jump: false, sprint: false, crouch: false, slide: false, slidePressed: false, yaw: bot.yaw, pitch: 0 };

      if (sees) {
        // Fight: face you, keep preferred range, strafe side to side, hop around.
        bot.yaw = yawTo(dx, dz);
        const [near, far] = D.range;
        cmd.forward = dist > far ? 1 : dist < near ? -1 : 0;
        cmd.sprint = D.sprint && dist > far + 6;
        bot.strafeT -= dt;
        if (bot.strafeT <= 0) { bot.strafe = Math.random() < 0.5 ? -1 : 1; bot.strafeT = rand(0.5, 1.4); }
        cmd.right = bot.strafe;
        bot.goal = { x: player.pos.x, z: player.pos.z }; // remember where you were
        bot.goalT = 4;
      } else {
        // Roam: head for the last place it saw you, or a random spot in the arena.
        bot.goalT -= dt;
        if (!bot.goal || bot.goalT <= 0 || Math.hypot(bot.goal.x - b.pos.x, bot.goal.z - b.pos.z) < 2) {
          const r = ARENA.roam[Math.floor(Math.random() * ARENA.roam.length)];
          bot.goal = { x: r.x + rand(-3, 3), z: r.z + rand(-3, 3) };
          bot.goalT = rand(4, 8);
        }
        bot.yaw = yawTo(bot.goal.x - b.pos.x, bot.goal.z - b.pos.z);
        cmd.forward = 1;
        cmd.sprint = D.sprint;
      }
      cmd.yaw = bot.yaw;

      // Stuck on something? Hop, and pick somewhere else to go.
      const moving = cmd.forward !== 0 || cmd.right !== 0;
      bot.stuckT = moving && b.grounded && horizontalSpeed(b) < 1.5 ? bot.stuckT + dt : 0;
      if (bot.stuckT > 0.35) {
        cmd.jump = true;
        bot.stuckT = 0;
        if (!sees) bot.goalT = 0;
      }
      // Random hops and the odd slide, more often on higher difficulty.
      bot.jumpT -= dt;
      if (bot.jumpT <= 0 && b.grounded) {
        if (sees && Math.random() < D.jumpiness) cmd.jump = true;
        else if (horizontalSpeed(b) > 10 && Math.random() < D.jumpiness * 0.5) { cmd.slide = true; cmd.slidePressed = true; }
        bot.jumpT = rand(0.8, 2.5);
      }

      stepPlayer(b, cmd, this.boxes, dt);
      t.pos = b.pos;
      // Hitbox/model facing: toward you when fighting, else the way it's walking.
      t.yaw = sees ? Math.atan2(dx, dz) : Math.atan2(-Math.sin(bot.yaw), -Math.cos(bot.yaw));
      if (b.pos.y < -20) this.respawn(bot, player);

      // Shoot: needs to have seen you for its reaction time, then fires with lead + error.
      bot.fireCd -= dt;
      if (sees && bot.seenT > D.reaction && bot.fireCd <= 0) {
        bot.fireCd = 1 / D.fireRate * rand(0.8, 1.25);
        const travel = Math.hypot(playerChest.x - eye.x, playerChest.y - eye.y, playerChest.z - eye.z) / D.shot.speed;
        const aim = {
          x: playerChest.x + player.vel.x * travel * D.lead - eye.x,
          y: playerChest.y + Math.max(0, player.vel.y) * travel * D.lead * 0.5 - eye.y,
          z: playerChest.z + player.vel.z * travel * D.lead - eye.z,
        };
        const l = Math.hypot(aim.x, aim.y, aim.z);
        const err = (D.aimError * Math.PI) / 180;
        const dir = {
          x: aim.x / l + rand(-err, err), y: aim.y / l + rand(-err, err) * 0.6, z: aim.z / l + rand(-err, err),
        };
        const dl = Math.hypot(dir.x, dir.y, dir.z);
        this.combat.botShoot(t, eye, { x: dir.x / dl, y: dir.y / dl, z: dir.z / dl }, D.shot);
      }
    }
  }
}
