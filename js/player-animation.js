// Stable local-player animation selection. Uses measured movement in metres/second,
// not key intent, so collision pushes and tiny velocity fluctuations do not flap clips.
const MOVING_MODES = new Set(["walk", "run", "sprint", "crouchWalk"]);

export function resolvePlayerAnimation(state = {}, previous = "idle") {
  const groundSpeed = Math.max(0, Number.isFinite(state.groundSpeed) ? state.groundSpeed : 0);
  if (Number(state.airborne) > 0.5) return "jump";

  const moving = groundSpeed > (MOVING_MODES.has(previous) ? 0.14 : 0.24);
  if (Number(state.climbing) > 0.5 || Number(state.stairClimb) > 0.5) {
    return moving ? "walk" : "idle";
  }

  if (Number(state.crouch) > 0.5) return moving ? "crouchWalk" : "crouch";
  if (!moving) return "idle";
  if (Number(state.sprint) > 0.5) return "sprint";

  // Separate enter/exit thresholds keep the run clip from flickering around
  // one speed boundary when the character is accelerating or braking.
  const runThreshold = previous === "run" ? 2.82 : 3.15;
  return groundSpeed >= runThreshold ? "run" : "walk";
}

export function jumpStartOffset(duration = 0) {
  const safeDuration = Number.isFinite(duration) ? Math.max(0, duration) : 0;
  // Skip the crouched anticipation frames in the source Mixamo jump. Start
  // on the launch instead of blending a preparatory squat into the takeoff.
  return Math.min(0.18, safeDuration * 0.2);
}
