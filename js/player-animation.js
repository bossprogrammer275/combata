// Stable local-player animation selection. Uses measured movement in metres/second,
// not key intent, so collision pushes and tiny velocity fluctuations do not flap clips.
const MOVING_MODES = new Set(["walk", "run", "sprint", "crouchWalk"]);

export function resolvePlayerAnimation(state = {}, previous = "idle") {
  // The player supplies measured metres/second. Shared enemy rigs still send
  // normalized speed plus a movement direction, so keep that legacy contract.
  const hasMeasuredSpeed = Number.isFinite(state.groundSpeed);
  const intent = Math.hypot(Number(state.moveX) || 0, Number(state.moveZ) || 0);
  const fallbackSpeed = Math.min(1, Math.max(0, Number(state.speed) || 0)) * 5.32;
  const groundSpeed = Math.max(0, hasMeasuredSpeed ? state.groundSpeed : (intent > 0.05 ? fallbackSpeed : 0));
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
