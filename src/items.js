// Weapon and ability definitions. Pure data — add a new gun by adding an entry here
// (and a viewmodel in fx.js). The loadout screen lists everything in these tables.
//
// Weapon fields:
//   slot        'primary' | 'secondary'
//   type        'hitscan' | 'projectile'
//   auto        hold to fire (true) or one shot per click (false)
//   damage      per bullet/pellet; headMult multiplies it on headshots
//   fireRate    shots per second
//   mag, reload magazine size, reload seconds (reserve ammo is infinite)
//   spread      cone half-angle in degrees; pellets = bullets per shot
//   knockback   m/s pushed opposite to where you aim when firing (mobility)
//   crosshair   'ring' | 'cross' | 'dot' | 'rocket' | 'bracket' (drawn by hud.js)
//   fx          cartoon muzzle effects: star size, action lines, comic words (+ chance), shell color
//   projectile  for type 'projectile' — see PROJECTILE fields below
//
// Projectile fields:
//   speed, up (extra upward throw speed), gravity, radius
//   impact      'explode' | 'bounce' | 'stick'
//   fuse        seconds until it explodes by itself (bounce grenades)
//   explode     { radius, damage, knockback } — knockback also launches YOU (rocket/grenade jumps)
//   damage, headMult for 'stick' projectiles (knives)
//   hitPad      extra radius added to dummy hitboxes for this projectile (aim forgiveness)
//   inherit     false = don't add the thrower's velocity (default true)

export const WEAPONS = {
  shotgun: {
    id: 'shotgun', slot: 'primary', name: 'Boomstick',
    desc: 'Close-range blast. Shoot the floor to launch yourself.',
    type: 'hitscan', auto: false, damage: 9, headMult: 1.25, pellets: 10, spread: 5,
    fireRate: 1.3, mag: 4, reload: 1.5, range: 60, knockback: 16, kick: 1, crosshair: 'ring',
    fx: { star: 0.34, lines: true, words: ['BLAM!', 'KA-BLAM!', 'POW!'], wordChance: 1, shell: 0xe0483a },
  },
  rifle: {
    id: 'rifle', slot: 'primary', name: 'Pulse Rifle',
    desc: 'Full-auto all-rounder. Accurate at range.',
    type: 'hitscan', auto: true, damage: 14, headMult: 1.5, pellets: 1, spread: 0.6,
    fireRate: 10, mag: 30, reload: 1.1, range: 200, knockback: 0, kick: 0.25, crosshair: 'cross',
    fx: { star: 0.13, words: ['RAT-TAT!', 'PEW!'], wordChance: 0.12, shell: 0xffc23d },
  },
  rocket: {
    id: 'rocket', slot: 'primary', name: 'Rocket Launcher',
    desc: 'Splash damage. Aim at your feet and jump for a rocket jump.',
    type: 'projectile', auto: false, fireRate: 1.1, mag: 2, reload: 1.8, knockback: 0, kick: 0.8, crosshair: 'rocket',
    fx: { star: 0.4, lines: true, words: ['FWOOSH!', 'THOOMP!'], wordChance: 1, shell: null },
    projectile: {
      speed: 38, up: 0, gravity: 0, radius: 0.15, impact: 'explode',
      explode: { radius: 4.5, damage: 85, knockback: 13 },
    },
  },
  sniper: {
    id: 'sniper', slot: 'primary', name: 'Long Shot',
    desc: 'Two heavy rounds. Headshots kill, and each shot shoves you back hard.',
    type: 'hitscan', auto: false, damage: 75, headMult: 2, pellets: 1, spread: 0,
    fireRate: 1.25, mag: 2, reload: 1.8, range: 400, knockback: 13, kick: 1.2, crosshair: 'scope',
    fx: { star: 0.36, lines: true, words: ['KRAK!', 'BOOM!', 'KA-CHOW!'], wordChance: 1, shell: 0xe0b03a },
  },
  pistol: {
    id: 'pistol', slot: 'secondary', name: 'Sidearm',
    desc: 'Reliable semi-auto. Rewards headshots.',
    type: 'hitscan', auto: false, damage: 20, headMult: 2, pellets: 1, spread: 0.3,
    fireRate: 6, mag: 12, reload: 1.1, range: 150, knockback: 0, kick: 0.35, crosshair: 'dot',
    fx: { star: 0.18, words: ['BANG!', 'PEW!'], wordChance: 0.35, shell: 0xffc23d },
  },
  smg: {
    id: 'smg', slot: 'secondary', name: 'Buzz SMG',
    desc: 'Sprays fast. Great for finishing people mid-air.',
    type: 'hitscan', auto: true, damage: 8, headMult: 1.4, pellets: 1, spread: 1.6,
    fireRate: 16, mag: 32, reload: 1.4, range: 80, knockback: 0, kick: 0.18, crosshair: 'cross',
    fx: { star: 0.11, words: ['BRRT!', 'PEW!'], wordChance: 0.08, shell: 0xffc23d },
  },
  kickpistol: {
    id: 'kickpistol', slot: 'secondary', name: 'Kick Pistol',
    desc: 'Heavy hand cannon. Every shot shoves you backwards — a mini boost.',
    type: 'hitscan', auto: false, damage: 30, headMult: 1.5, pellets: 1, spread: 0.2,
    fireRate: 2.5, mag: 6, reload: 1.3, range: 120, knockback: 6.5, kick: 0.8, crosshair: 'bracket',
    fx: { star: 0.3, lines: true, words: ['KA-POW!', 'BLAM!'], wordChance: 0.8, shell: 0xffc23d },
  },
  deagle: {
    id: 'deagle', slot: 'secondary', name: 'Deagle',
    desc: 'No push, all punch. One tap to the head.',
    type: 'hitscan', auto: false, damage: 50, headMult: 2, pellets: 1, spread: 0.1,
    fireRate: 2.8, mag: 7, reload: 1.4, range: 180, knockback: 0, kick: 0.9, crosshair: 'dot',
    fx: { star: 0.28, lines: true, words: ['BANG!', 'KA-BLAM!'], wordChance: 0.7, shell: 0xffc23d },
  },
};

// Abilities are thrown on the ability key and recharge on a cooldown.
export const ABILITIES = {
  frag: {
    id: 'frag', name: 'Impact Grenade',
    desc: 'Explodes the instant it touches anything. Hurts targets and launches you.',
    cooldown: 7,
    projectile: {
      speed: 24, up: 2.5, gravity: 22, radius: 0.12, impact: 'explode',
      explode: { radius: 5, damage: 70, knockback: 14 },
    },
  },
  knife: {
    id: 'knife', name: 'Throwing Knife',
    desc: 'Fast and precise. Headshots nearly one-shot.',
    cooldown: 4,
    // hitPad fattens every hitbox for this projectile (forgiving, arcade-style);
    // inherit: false = flies exactly where you aim, no matter how fast you're moving.
    projectile: {
      speed: 95, up: 0, gravity: 2, radius: 0.05, impact: 'stick', damage: 200, headMult: 1.8,
      hitPad: 0.14, inherit: false,
    },
  },
  impulse: {
    id: 'impulse', name: 'Impulse Charge',
    desc: 'Pops on impact. Barely scratches, but throws you (and everything) hard.',
    cooldown: 6,
    projectile: {
      speed: 24, up: 2, gravity: 22, radius: 0.15, impact: 'explode',
      explode: { radius: 4.5, damage: 15, knockback: 17 },
    },
  },
};

export const DEFAULT_LOADOUT = { primary: 'shotgun', secondary: 'pistol', ability: 'frag' };

export function weaponsForSlot(slot) {
  return Object.values(WEAPONS).filter((w) => w.slot === slot);
}

// Loadout screen stats: [label, 0..1 bar, value text].
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const num = (v) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

export function weaponStats(w) {
  const p = w.projectile?.explode;
  const dmg = p ? `${p.damage} splash`
    : w.pellets > 1 ? `${w.damage}×${w.pellets}` : `${w.damage} · ${num(w.damage * w.headMult)} head`;
  const mob = w.knockback || p?.knockback || 0;
  return [
    ['Damage', clamp01((p ? p.damage : w.damage * w.pellets) / 100), dmg],
    ['Fire rate', clamp01(w.fireRate / 16), `${Math.round(w.fireRate * 60)} rpm`],
    ['Magazine', clamp01(w.mag / 32), `${w.mag}`],
    ['Reload', clamp01(1 - (w.reload - 0.8) / 1.4), `${num(w.reload)}s`],
    ['Mobility', clamp01(mob / 16), mob ? `${num(mob)} m/s` : 'none'],
  ];
}

export function abilityStats(a) {
  const p = a.projectile;
  const dmg = p.explode?.damage ?? p.damage;
  const mob = p.explode?.knockback ?? 0;
  return [
    ['Damage', clamp01(dmg / 100), p.explode ? `${dmg} splash` : `${dmg}`],
    ['Recharge', clamp01(3 / a.cooldown), `${a.cooldown}s`],
    ['Mobility', clamp01(mob / 17), mob ? `${mob} m/s` : 'none'],
  ];
}

// Short class line shown above the item name.
export function itemClass(it) {
  if (!it.slot) return it.projectile.impact === 'stick' ? 'Throwable · Precision' : 'Throwable · Explosive';
  if (it.type === 'projectile') return 'Launcher · Explosive';
  if (it.pellets > 1) return 'Shotgun · Mobility';
  const kind = it.id === 'sniper' ? 'Sniper' : it.slot === 'secondary' ? (it.auto ? 'SMG' : 'Pistol') : 'Rifle';
  return `${kind} · ${it.auto ? 'Full-auto' : 'Semi-auto'}`;
}
