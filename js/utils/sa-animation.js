// SA Animation — State machine with crossfade for procedural poses.
//
// PS2-era games feel snappy because animations don't use heavy physics blending.
// They use distinct states (Idle, Walk, Run, Combat, Crouch) with very short
// crossfade transitions (0.15-0.25s). This creates that snappy "GTA feel" where
// the character snaps between poses instead of blending mushily.
//
// This utility wraps the existing procedural applyPose() system with a state
// machine that:
//   1. Maintains named pose states (idle, walk, run, crouch, combat, skydive)
//   2. Smoothly interpolates between current and target state over a short duration
//   3. Feeds the blended state to Character.applyPose()
//
// Usage:
//   import { SAAnimator } from './sa-animation.js';
//   const animator = new SAAnimator(character);
//   animator.setState('run', { moveX, moveZ, sprint: 1 });
//   animator.update(dt); // call each frame — blends and applies pose

// ---- State definitions: default parameter values for each animation state ----
const STATE_DEFAULTS = {
  idle: {
    crouch: 0, aim: 0, moveX: 0, moveZ: 0, sprint: 0, lean: 0,
    speed: 0, phase: 0, airborne: 0, landDip: 0, skydive: 0, canopy: 0,
  },
  walk: {
    crouch: 0, aim: 0, sprint: 0, lean: 0,
    speed: 0.5, airborne: 0, landDip: 0, skydive: 0, canopy: 0,
  },
  run: {
    crouch: 0, aim: 0, lean: 0,
    speed: 1.0, sprint: 1, airborne: 0, landDip: 0, skydive: 0, canopy: 0,
  },
  crouch: {
    crouch: 1, aim: 0, moveX: 0, moveZ: 0, sprint: 0, lean: 0,
    speed: 0, airborne: 0, landDip: 0, skydive: 0, canopy: 0,
  },
  crouchWalk: {
    crouch: 1, aim: 0, sprint: 0, lean: 0,
    speed: 0.35, airborne: 0, landDip: 0, skydive: 0, canopy: 0,
  },
  combat: {
    crouch: 0, aim: 1, sprint: 0, lean: 0,
    speed: 0, airborne: 0, landDip: 0, skydive: 0, canopy: 0,
  },
  combatWalk: {
    crouch: 0, aim: 1, sprint: 0, lean: 0,
    speed: 0.4, airborne: 0, landDip: 0, skydive: 0, canopy: 0,
  },
  skydive: {
    crouch: 0, aim: 0, moveX: 0, moveZ: 0, sprint: 0, lean: 0,
    speed: 0, airborne: 1, landDip: 0, skydive: 1, canopy: 0,
  },
  parachute: {
    crouch: 0, aim: 0, sprint: 0, lean: 0,
    speed: 0, airborne: 1, landDip: 0, skydive: 1, canopy: 1,
  },
};

// Crossfade duration in seconds — snappy PSA feel
const CROSSFADE_DURATION = 0.18;

// Keys that should NOT be interpolated (they snap instantly)
const SNAP_KEYS = ['weaponType', 'airborne', 'skydive', 'canopy'];

export class SAAnimator {
  constructor(character) {
    this.char = character;

    // Current blended state (what gets applied each frame)
    this._current = { ...STATE_DEFAULTS.idle, weaponType: 'rifle' };

    // Target state (what we're blending toward)
    this._target = { ...STATE_DEFAULTS.idle, weaponType: 'rifle' };

    // Previous state values for interpolation start point
    this._from = { ...this._current };

    // State name for debugging / logic checks
    this.stateName = 'idle';

    // Crossfade timer (counts down from CROSSFADE_DURATION to 0)
    this._blendT = 0;
    this._blending = false;

    // Phase accumulator for walk/run cycles (drives leg swing)
    this._phase = 0;

    // External overrides: these values always win over the state machine
    this._overrides = {};
  }

  // Set a new animation state. If different from current, triggers crossfade.
  // params: partial state overrides (moveX, moveZ, pitch, aimYaw, etc.)
  setState(name, params = {}) {
    const defaults = STATE_DEFAULTS[name] || STATE_DEFAULTS.idle;

    if (name === this.stateName && !this._needsTransition(params)) {
      // Same state — just update dynamic params without re-blending
      Object.assign(this._target, params);
      return;
    }

    // Snapshot current state as blend start point
    this._from = { ...this._current };

    // Set new target
    this._target = { ...defaults, ...params };
    this.stateName = name;
    this._blendT = CROSSFADE_DURATION;
    this._blending = true;
  }

  // Check if the incoming params require a state transition
  _needsTransition(params) {
    return this._blending || Object.keys(params).some(k => {
      if (SNAP_KEYS.includes(k)) return params[k] !== this._target[k];
      return false;
    });
  }

  // Force-set state instantly (no crossfade) — for death, teleport, respawn
  forceState(name, params = {}) {
    const defaults = STATE_DEFAULTS[name] || STATE_DEFAULTS.idle;
    this._current = { ...defaults, ...params };
    this._target = { ...this._current };
    this._from = { ...this._current };
    this.stateName = name;
    this._blendT = 0;
    this._blending = false;
  }

  // Set an external override that bypasses the state machine (e.g., skydive pose)
  setOverride(key, value) {
    this._overrides[key] = value;
  }

  clearOverride(key) {
    delete this._overrides[key];
  }

  clearAllOverrides() {
    this._overrides = {};
  }

  // Main update — call each frame with dt. Blends states and applies pose.
  update(dt) {
    // Advance crossfade timer
    if (this._blending) {
      this._blendT -= dt;
      if (this._blendT <= 0) {
        this._blendT = 0;
        this._blending = false;
        this._from = { ...this._target };
      }
    }

    // Compute blend factor: 0 = fully "from", 1 = fully "target"
    const t = this._blending
      ? Math.min(1, 1 - (this._blendT / CROSSFADE_DURATION))
      : 1;

    // Smoothstep for snappier transitions (accelerates through the middle)
    const blend = t * t * (3 - 2 * t);

    // Interpolate all numeric keys
    for (const key of Object.keys(this._target)) {
      if (SNAP_KEYS.includes(key)) {
        // Snap instantly at the midpoint of the crossfade
        this._current[key] = blend > 0.5 ? this._target[key] : this._from[key];
      } else if (typeof this._target[key] === 'number') {
        this._current[key] = this._from[key] + (this._target[key] - this._from[key]) * blend;
      } else {
        this._current[key] = this._target[key];
      }
    }

    // Apply external overrides (highest priority)
    for (const [key, value] of Object.entries(this._overrides)) {
      this._current[key] = value;
    }

    // Advance walk/run phase if moving
    const speed = this._current.speed || 0;
    if (speed > 0.05) {
      const sprintMult = (this._current.sprint || 0) > 0.5 ? 11 : 7.5;
      this._phase += dt * sprintMult * Math.min(1, speed + 0.2);
    }
    this._current.phase = this._phase;

    // Push the blended state onto the character rig
    this.char.setState(this._current);
  }

  // Get current state name (for AI decisions, UI display, etc.)
  getStateName() {
    return this.stateName;
  }

  // Get the current blended state (for network sync, debugging)
  getCurrentState() {
    return { ...this._current };
  }

  // Is the animator currently crossfading between states?
  isBlending() {
    return this._blending;
  }

  // Get the current walk phase (for syncing footstep sounds)
  getPhase() {
    return this._phase;
  }

  // Reset phase counter (for teleport / respawn)
  resetPhase() {
    this._phase = 0;
  }
}

// ---- Auto-detect state from player input ----
// Utility that reads a raw input state and determines the best SA state name.
// Use this to replace ad-hoc state logic in Player.update() / Enemy.update().

export function detectState(input) {
  const { crouch, aim, moveX, moveZ, sprint, airborne, skydive, canopy } = input;
  const moving = Math.hypot(moveX || 0, moveZ || 0) > 0.05;

  if (skydive) return canopy > 0.5 ? 'parachute' : 'skydive';
  if (airborne) return 'idle'; // airborne but not skydiving — fall pose
  if (aim > 0.5) return moving ? 'combatWalk' : 'combat';
  if (crouch > 0.5) return moving ? 'crouchWalk' : 'crouch';
  if (sprint > 0.5 && moving) return 'run';
  if (moving) return 'walk';
  return 'idle';
}
