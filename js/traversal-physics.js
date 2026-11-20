// Physics-first traversal path construction and validation.
// All positions are player-feet coordinates in world space.
export const OBSTACLE_CLIMB_ANIMATION = 'obstacle_climb';
export const LADDER_CLIMB_ANIMATION = 'ladder_climb_up';
export const OBSTACLE_CLIMB_DURATION = 3.833;
export const LADDER_CYCLE_DURATION = 0.767;

export function point3(value) {
  if (Array.isArray(value) && value.length >= 3) {
    const point = value.slice(0, 3).map(Number);
    return point.every(Number.isFinite) ? { x: point[0], y: point[1], z: point[2] } : null;
  }
  if (value?.position) return point3(value.position);
  if (value && ['x', 'y', 'z'].every(key => Number.isFinite(Number(value[key])))) {
    return { x: Number(value.x), y: Number(value.y), z: Number(value.z) };
  }
  return null;
}

export function distance3(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function lerpPoint(a, b, t) {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
  };
}

function tangent(points, index) {
  if (index === 0) {
    const dt = points[1].t - points[0].t;
    return {
      x: (points[1].position.x - points[0].position.x) / dt,
      y: (points[1].position.y - points[0].position.y) / dt,
      z: (points[1].position.z - points[0].position.z) / dt,
    };
  }
  if (index === points.length - 1) {
    const a = points[index - 1], b = points[index];
    const dt = b.t - a.t;
    return {
      x: (b.position.x - a.position.x) / dt,
      y: (b.position.y - a.position.y) / dt,
      z: (b.position.z - a.position.z) / dt,
    };
  }
  const a = points[index - 1], b = points[index + 1];
  const dt = b.t - a.t;
  return {
    x: (b.position.x - a.position.x) / dt,
    y: (b.position.y - a.position.y) / dt,
    z: (b.position.z - a.position.z) / dt,
  };
}

export function normalizeTimedPath(input, options = {}) {
  if (!Array.isArray(input) || input.length < (options.minPoints || 2)) return null;
  const points = [];
  for (const item of input) {
    const position = point3(item?.position || item);
    if (!position) return null;
    const t = Number.isFinite(Number(item?.t)) ? Number(item.t) : null;
    if (t === null) return null;
    points.push({ t, position });
  }
  if (Math.abs(points[0].t) > 1e-5 || Math.abs(points.at(-1).t - 1) > 1e-5) return null;
  for (let i = 1; i < points.length; i++) {
    if (!(points[i].t > points[i - 1].t)) return null;
  }
  return points;
}

// Cubic Hermite interpolation preserves the authored waypoint timings while
// keeping velocity continuous through contact, pull-up and landing anchors.
export function sampleTimedPath(path, progress) {
  if (!Array.isArray(path) || path.length < 2) return null;
  const t = Math.max(0, Math.min(1, Number(progress) || 0));
  let index = path.length - 2;
  for (let i = 0; i < path.length - 1; i++) {
    if (t <= path[i + 1].t) { index = i; break; }
  }
  const a = path[index], b = path[index + 1];
  const span = b.t - a.t;
  if (!(span > 0)) return { ...b.position };
  const u = Math.max(0, Math.min(1, (t - a.t) / span));
  const u2 = u * u, u3 = u2 * u;
  const h00 = 2 * u3 - 3 * u2 + 1;
  const h10 = u3 - 2 * u2 + u;
  const h01 = -2 * u3 + 3 * u2;
  const h11 = u3 - u2;
  const m0 = tangent(path, index), m1 = tangent(path, index + 1);
  const value = axis => h00 * a.position[axis] + h10 * span * m0[axis]
    + h01 * b.position[axis] + h11 * span * m1[axis];
  const result = { x: value('x'), y: value('y'), z: value('z') };
  // Hermite curves must not overshoot far beyond an authored safety waypoint.
  for (const axis of ['x', 'y', 'z']) {
    const lo = Math.min(a.position[axis], b.position[axis]) - 0.12;
    const hi = Math.max(a.position[axis], b.position[axis]) + 0.12;
    result[axis] = Math.max(lo, Math.min(hi, result[axis]));
  }
  return result;
}

export function validateTraversalPath(path, isCapsuleClear, options = {}) {
  if (!Array.isArray(path) || path.length < 2 || typeof isCapsuleClear !== 'function') return false;
  const spacing = Math.max(0.025, Number(options.sampleSpacing) || 0.1);
  for (let segment = 0; segment < path.length - 1; segment++) {
    const a = path[segment], b = path[segment + 1];
    const length = distance3(a.position, b.position);
    const steps = Math.max(1, Math.ceil(length / spacing));
    for (let i = 0; i <= steps; i++) {
      const progress = a.t + (b.t - a.t) * (i / steps);
      const position = sampleTimedPath(path, progress);
      if (!position || isCapsuleClear(position) !== true) return false;
    }
  }
  return true;
}

export function buildObstacleClimbPath(options = {}) {
  const start = point3(options.start);
  const min = point3(options.bounds?.min);
  const max = point3(options.bounds?.max);
  if (!start || !min || !max) return null;
  const radius = Math.max(0.12, Number(options.radius) || 0.42);
  const height = Math.max(radius * 2 + 0.1, Number(options.height) || 1.8);
  const boxX = max.x - min.x, boxZ = max.z - min.z, rise = max.y - min.y;
  const maxRise = Number(options.maxRise) || 2.25;
  if (boxX <= 0 || boxZ <= 0 || rise < 0.45 || rise > maxRise) return null;
  // A narrow fence top is not a landing platform. Do not fake a vault with the
  // obstacle-climb clip; the user has not downloaded a dedicated vault clip.
  if (boxX < radius * 2 + 0.14 || boxZ < radius * 2 + 0.14) return null;

  const normal = point3(options.normal) || { x: 0, y: 0, z: 1 };
  const nx = Math.abs(normal.x) >= Math.abs(normal.z) ? Math.sign(normal.x) : 0;
  const nz = Math.abs(normal.z) > Math.abs(normal.x) ? Math.sign(normal.z) : 0;
  if (!nx && !nz) return null;
  const margin = radius + 0.1;
  const centerX = (min.x + max.x) * 0.5;
  const centerZ = (min.z + max.z) * 0.5;
  let contact = { ...start };
  if (nx > 0) contact.x = max.x + margin;
  else if (nx < 0) contact.x = min.x - margin;
  else if (nz > 0) contact.z = max.z + margin;
  else contact.z = min.z - margin;
  if (nx) contact.z = Math.max(min.z + radius + 0.07, Math.min(max.z - radius - 0.07, start.z));
  else contact.x = Math.max(min.x + radius + 0.07, Math.min(max.x - radius - 0.07, start.x));

  const lift = { ...contact, y: max.y + 0.12 };
  const topOut = { x: centerX, y: max.y + 0.12, z: centerZ };
  const landing = { x: centerX, y: max.y, z: centerZ };
  const authored = normalizeTimedPath(options.rootPath, { minPoints: 4 });
  let path;
  if (authored) {
    if (distance3(authored[0].position, start) > 0.9) return null;
    path = authored.map(point => ({ t: point.t, position: { ...point.position } }));
    path[0].position = { ...start };
  } else {
    path = [
      { t: 0, position: { ...start } },
      { t: 0.14, position: contact },
      { t: 0.66, position: lift },
      { t: 0.86, position: topOut },
      { t: 1, position: landing },
    ];
  }
  const duration = Math.max(1.2, Number(options.duration) || OBSTACLE_CLIMB_DURATION);
  return {
    type: 'obstacle-climb',
    animation: OBSTACLE_CLIMB_ANIMATION,
    duration,
    path,
    handContact: point3(options.handContact),
    boneContacts: Array.isArray(options.boneContacts) ? options.boneContacts : [],
    landing: point3(options.landing) || { ...path.at(-1).position },
    topBounds: { min, max },
    radius,
    height,
  };
}

export function buildLadderTraversalPath(options = {}) {
  const start = point3(options.start);
  const climbPoints = Array.isArray(options.climbPath) ? options.climbPath.map(point3) : [];
  if (!start || climbPoints.length < 2 || climbPoints.some(point => !point)) return null;
  const rungSpacing = Number(options.rungSpacing);
  if (!Number.isFinite(rungSpacing) || rungSpacing < 0.12 || rungSpacing > 0.6) return null;
  const pathPoints = [start, ...climbPoints];
  const topOut = point3(options.topOut);
  if (topOut) pathPoints.push(topOut);
  const distances = [0];
  for (let i = 1; i < pathPoints.length; i++) {
    distances.push(distances[i - 1] + distance3(pathPoints[i - 1], pathPoints[i]));
  }
  const totalDistance = distances.at(-1);
  if (!(totalDistance > 0.4)) return null;
  const path = pathPoints.map((position, index) => ({
    t: distances[index] / totalDistance,
    position: { ...position },
  }));
  const cycles = Math.max(1, totalDistance / rungSpacing);
  const cycleDuration = Math.max(0.35, Number(options.cycleDuration) || LADDER_CYCLE_DURATION);
  return {
    type: 'ladder-climb',
    animation: LADDER_CLIMB_ANIMATION,
    duration: cycles * cycleDuration,
    path,
    landing: topOut || pathPoints.at(-1),
    rungSpacing,
    cycles,
  };
}
