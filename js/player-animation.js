// Select only clips present in npc_core_001. Physics owns the movement trajectory.
const MOVING_MODES = new Set(['walk','walk_aim','run','rifle_run','sprint','crouch_walk','crouch_walk_aim']);

export function resolvePlayerAnimation(state = {}, previous = 'idle') {
  const hasMeasuredSpeed = Number.isFinite(state.groundSpeed);
  const intent = Math.hypot(Number(state.moveX) || 0, Number(state.moveZ) || 0);
  const fallbackSpeed = Math.min(1, Math.max(0, Number(state.speed) || 0)) * 5.32;
  const groundSpeed = Math.max(0, hasMeasuredSpeed ? state.groundSpeed : (intent > 0.05 ? fallbackSpeed : 0));
  const moving = groundSpeed > (MOVING_MODES.has(previous) ? 0.14 : 0.24);
  const crouched = Number(state.crouch) > 0.5;
  const rifle = !state.weaponType || state.weaponType === 'rifle';
  const aiming = rifle && Number(state.aim) > 0.1;

  if (Number(state.reloading) > 0.5) {
    // Reloading.fbx is the only downloaded rifle reload. Other weapon classes
    // retain their current pose instead of borrowing a rifle-specific action.
    if (!rifle) return previous || 'idle';
    return !moving && !crouched && Number(state.airborne) < 0.5 ? 'reload_idle' : previous;
  }

  // Jumping.fbx is an idle-start jump only. Moving jumps keep their locomotion pose.
  if (Number(state.airborne) > 0.5) {
    if (Number(state.jumpFromIdle) > 0.5 && previous === 'idle') return 'jump_idle';
    return previous || 'idle';
  }

  if (Number(state.climbing) > 0.5 || Number(state.stairClimb) > 0.5) {
    return moving ? 'walk' : 'idle';
  }

  if (crouched) {
    if (moving) return aiming ? 'crouch_walk_aim' : 'crouch_walk';
    return aiming ? 'crouch_aim_idle' : 'crouch_idle';
  }
  if (!moving) return aiming ? 'rifle_aim_idle' : 'idle';
  if (aiming) {
    const runThreshold = previous === 'rifle_run' ? 2.82 : 3.15;
    return groundSpeed >= runThreshold ? 'rifle_run' : 'walk_aim';
  }
  if (Number(state.sprint) > 0.5) return 'sprint';
  const runThreshold = previous === 'run' ? 2.82 : 3.15;
  return groundSpeed >= runThreshold ? 'run' : 'walk';
}

export function jumpStartOffset(duration = 0) {
  const safeDuration = Number.isFinite(duration) ? Math.max(0, duration) : 0;
  return Math.min(0.18, safeDuration * 0.2);
}
