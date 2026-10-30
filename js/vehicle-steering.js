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
