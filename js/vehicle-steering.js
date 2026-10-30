// Shared steering geometry and chase-camera look behaviour for all vehicles.
export function ackermannSteerAngle(centerAngle, wheelX, wheels = [], wheelbase = 2.7, lateralSign = 1) {
  const angle = Number.isFinite(centerAngle) ? centerAngle : 0;
  if (Math.abs(angle) < 1e-4 || !Array.isArray(wheels) || wheels.length < 2) return angle;
  const xs = wheels.map(w => Number(w?.x)).filter(Number.isFinite);
  if (xs.length < 2) return angle;
  const trackWidth = Math.max(...xs) - Math.min(...xs);
  if (trackWidth < 0.25 || !Number.isFinite(wheelbase) || wheelbase <= 0.25) return angle;

  // Positive steering means a right turn in this game's local XZ convention.
  // The wheel on the inside of the turn steers farther than the outside wheel.
  const turnRadius = wheelbase / Math.max(1e-4, Math.tan(Math.abs(angle)));
  const vehicleRightX = wheelX * (lateralSign < 0 ? -1 : 1);
  const isInside = angle > 0 ? vehicleRightX > 0 : vehicleRightX < 0;
  const wheelRadius = Math.max(0.25, turnRadius + (isInside ? -trackWidth : trackWidth) * 0.5);
  return Math.sign(angle) * Math.atan(wheelbase / wheelRadius);
}

// Rear steering uses opposite-phase at parking/urban speeds for a tighter
// turning circle, then eases toward same-phase stability as speed increases.
// A missing low-speed ratio keeps conventional front-steer vehicles unchanged.
export function resolveRearSteerRatio(speed, tuning = {}) {
  const low = Number.isFinite(tuning.rearSteerLowSpeedRatio)
    ? tuning.rearSteerLowSpeedRatio : 0;
  const high = Number.isFinite(tuning.rearSteerHighSpeedRatio)
    ? tuning.rearSteerHighSpeedRatio : low;
  const start = Number.isFinite(tuning.rearSteerBlendStart) ? tuning.rearSteerBlendStart : 8;
  const end = Math.max(start + 0.1, Number.isFinite(tuning.rearSteerBlendEnd) ? tuning.rearSteerBlendEnd : 28);
  const t = Math.max(0, Math.min(1, (Math.abs(Number(speed) || 0) - start) / (end - start)));
  const smooth = t * t * (3 - 2 * t);
  return low + (high - low) * smooth;
}

export function resolveDriveAxes(pressedKeys) {
  const has = (code) => !!pressedKeys?.has?.(code);
  return {
    forward: Number(has('KeyW') || has('ArrowUp')) - Number(has('KeyS') || has('ArrowDown')),
    right: Number(has('KeyD') || has('ArrowRight')) - Number(has('KeyA') || has('ArrowLeft')),
  };
}

// Follow actual travel direction, not merely the requested reverse input.
// Hysteresis prevents the camera flipping while speed passes through zero.
export function updateReverseCameraBlend(current, signedForwardSpeed, dt) {
  const blend = Math.max(0, Math.min(1, Number(current) || 0));
  const speed = Number(signedForwardSpeed) || 0;
  let target = blend;
  if (speed < -0.8) target = 1;
  else if (speed > 0.45) target = 0;
  const step = Math.min(Math.max(Number(dt) || 0, 0), 0.05);
  return blend + (target - blend) * (1 - Math.exp(-5.5 * step));
}

export function chaseCameraYaw(vehicleYaw, lookYaw = 0, reverseBlend = 0) {
  const yaw = Number.isFinite(vehicleYaw) ? vehicleYaw : 0;
  const look = Number.isFinite(lookYaw) ? lookYaw : 0;
  const reverse = Math.max(0, Math.min(1, Number(reverseBlend) || 0));
  return yaw + look + Math.PI * reverse;
}

export function updateChaseLook(state, input = {}) {
  const dt = Math.min(Math.max(Number(input.dt) || 0, 0), 0.05);
  const mouseDX = Number(input.mouseDX) || 0;
  const mouseDY = Number(input.mouseDY) || 0;
  let yaw = Number(state.yaw) || 0;
  let pitch = Number.isFinite(state.pitch) ? state.pitch : 0.2;
  let idleTime = Math.max(0, Number(state.idleTime) || 0);

  if (Math.abs(mouseDX) > 0.1 || Math.abs(mouseDY) > 0.1) {
    yaw -= mouseDX * 0.003;
    pitch = Math.max(-0.9, Math.min(1.1, pitch - mouseDY * 0.003));
    idleTime = 0;
  } else {
    idleTime += dt;
    const moving = Math.abs(Number(input.throttle) || 0) > 0.05
      || Math.abs(Number(input.speed) || 0) > 3.5;
    // Preserve free look while parked. Once driving resumes, wait briefly,
    // then ease the camera back toward the car's forward heading.
    if (moving && idleTime > 0.45) {
      const speedBlend = Math.max(0, Math.min(1, Math.abs(Number(input.speed) || 0) / 22));
      const returnRate = 1.15 + speedBlend * 1.85;
      yaw *= Math.exp(-returnRate * dt);
      pitch += (0.2 - pitch) * (1 - Math.exp(-returnRate * 0.55 * dt));
      if (Math.abs(yaw) < 0.001) yaw = 0;
      if (Math.abs(pitch - 0.2) < 0.001) pitch = 0.2;
    }
  }
  return { yaw, pitch, idleTime };
}

// Keep the chase camera in the same vertical space as the vehicle when it
// climbs ramps, bridges, flyovers, or stacked roads. A sampled support surface
// may raise the camera, but a lower road beneath a bridge must never pull it down.
export function getBridgeAwareChaseHeights(vehicleY, sampledSurfaceY, cameraOffset, lookOffset = 1.0) {
  const baseY = Number.isFinite(vehicleY) ? vehicleY : 0;
  const supportY = Number.isFinite(sampledSurfaceY)
    ? Math.max(baseY, sampledSurfaceY)
    : baseY;
  const heightOffset = Number.isFinite(cameraOffset) ? Math.max(0.65, cameraOffset) : 2.8;
  const targetOffset = Number.isFinite(lookOffset) ? lookOffset : 1.0;
  return {
    cameraY: supportY + heightOffset,
    lookY: baseY + targetOffset,
    supportY,
  };
}
