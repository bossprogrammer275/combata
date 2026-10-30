// Per-vehicle cockpit camera settings shared by the pause menu and runtime camera.
export const COCKPIT_CAMERA_LIMITS = Object.freeze({
  forward: Object.freeze({ min: -1.2, max: 1.2 }),
  height: Object.freeze({ min: 0.5, max: 2.2 }),
  side: Object.freeze({ min: -0.8, max: 0.8 }),
  lookPitch: Object.freeze({ min: -25, max: 25 }),
  lookYaw: Object.freeze({ min: -25, max: 25 }),
});

export const COCKPIT_CAMERA_SETTING_KEYS = Object.freeze(
  Object.keys(COCKPIT_CAMERA_LIMITS),
);

const CAMERA_DEFAULTS = Object.freeze({
  height: 1.05,
  forward: 0.18,
  side: 0,
  lookAhead: 18,
  pitch: 0,
  fov: 82,
  lookPitch: 0,
  lookYaw: 0,
});

export function clampCockpitCameraValue(key, value) {
  const limit = COCKPIT_CAMERA_LIMITS[key];
  const number = Number(value);
  if (!limit || !Number.isFinite(number)) return null;
  return Math.min(limit.max, Math.max(limit.min, number));
}

export function resolveCockpitCameraProfile(base = {}, saved = {}) {
  const profile = { ...CAMERA_DEFAULTS, ...(base && typeof base === 'object' ? base : {}) };
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return profile;

  for (const key of COCKPIT_CAMERA_SETTING_KEYS) {
    if (Object.prototype.hasOwnProperty.call(saved, key)) {
      const value = clampCockpitCameraValue(key, saved[key]);
      if (value !== null) profile[key] = value;
    }
  }
  return profile;
}

export function getCockpitLookAngles(profile = {}, mouseYaw = 0, mousePitch = 0.2) {
  const toRadians = Math.PI / 180;
  return {
    yaw: mouseYaw + (Number(profile.lookYaw) || 0) * toRadians,
    pitch: mousePitch - 0.2 + (Number(profile.lookPitch) || 0) * toRadians,
  };
}
