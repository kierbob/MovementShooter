// All movement tuning lives here. Units: meters, seconds.
export const TICK_RATE = 120;
export const TICK_DT = 1 / TICK_RATE;

export const PLAYER = {
  halfWidth: 0.35,
  height: 1.8,
  eyeHeight: 1.6,
  crouchHeight: 1.0,
  crouchEyeHeight: 0.8,
  crouchSpeed: 4.5,
  stepHeight: 0.45, // ledges this low are walked up automatically
};

// Apex-style air control: hold a direction and your momentum swings toward it.
export const AIR = {
  turnRate: 3.5,       // radians/sec momentum can turn toward your aim (~200°/s)
  accel: 3,            // gain up to walk speed if you jumped slow (no gain above it)
  brakeAngle: 2.4,     // steering more than ~137° away from travel = brake instead of turn
  brake: 8,            // m/s lost per second while braking in the air
};

// Octane-style jump pads. Individual pads in world.js can override these.
export const JUMP_PAD = {
  launch: 17,        // upward speed (~6.5 m high)
  forwardBoost: 2,   // extra speed added in the direction you were already moving
  cooldown: 0.5,
};

// Wall jump: touch a wall in the air and press jump to kick off it.
export const WALL = {
  reach: 0.12,         // how close counts as touching a wall
  coyoteTime: 0.15,    // can still wall jump this long after leaving the wall
  jumpUp: 8,           // upward speed from a wall jump
  jumpPush: 7.5,       // speed pushed away from the wall
  keepAlong: 1,        // fraction of along-the-wall momentum kept
  speedBump: 1.5,      // extra speed added on every wall jump
  maxJumps: 4,         // wall jumps before you have to touch the ground
  sameWallDelay: 0.35, // min time between two jumps off the same wall face
};

export const SLIDE = {
  minSpeed: 6,         // need at least this much speed to start a slide
  boost: 4,            // speed added when a slide starts (if off cooldown)
  boostMaxSpeed: 18,   // boost won't push you past this (you keep speed you already had)
  boostCooldown: 1.2,  // seconds between boosted slides
  friction: 5,         // m/s lost per second while sliding
  endSpeed: 5,         // slide ends below this, you drop to a crouch walk
  steerRate: 1.6,      // radians/sec you can curve a slide with the mouse
  landMinAirTime: 0.3, // airtime needed for a boosted landing slide (small drops don't count)
};

export const MOVE = {
  walkSpeed: 9,       // top ground speed from input alone
  sprintSpeed: 12.5,  // top ground speed while holding sprint (moving forward-ish)
  groundAccel: 70,
  friction: 9,
  stopSpeed: 3,       // friction acts as if at least this fast, so you stop crisply
  // Momentum: above your run speed, if you keep holding roughly the way you're going,
  // the extra speed fades slowly instead of friction wiping it out.
  overspeedDecay: 2.5, // m/s lost per second while carrying extra speed on the ground
  landGrace: 0.1,      // no friction this long after landing, so jump chains keep speed
  maxSpeed: 25,       // HARD cap on horizontal speed from any source
  maxFallSpeed: 45,
  maxRiseSpeed: 24,
  // After a knockback, ground friction and air braking pause for a moment so gun boosts carry.
  // Grace = knockbackGrace + knockbackGracePer * push speed (16 m/s Boomstick ≈ 0.4 s).
  knockbackGrace: 0.15,
  knockbackGracePer: 0.015,
  gravity: 22,
  jumpVelocity: 7,    // ~1.1 m jump height
  coyoteTime: 0.1,    // can still jump this long after walking off a ledge
  jumpBuffer: 0.12,   // jump pressed this early before landing still counts
};
