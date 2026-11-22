#!/usr/bin/env node
/**
 * Compare a newly generated unified calibration sidecar against an existing
 * legacy *_col.json file. This is diagnostic only: it never rewrites either.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ALLOWED_ROOTS = [
  path.join(ROOT, 'data', 'models', 'assets'),
  path.join(ROOT, 'data', 'models', 'cars'),
];

function insideRoot(file, root) {
  const relative = path.relative(root, file);
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
}

function boxToBounds(box) {
  if (Array.isArray(box) && box.length >= 6) {
    const [x, y, z, w, h, d] = box.map(Number);
    if (![x, y, z, w, h, d].every(Number.isFinite)) return null;
    return { min: [x - w / 2, y - h / 2, z - d / 2], max: [x + w / 2, y + h / 2, z + d / 2] };
  }
  if (box?.center && box?.size) {
    return boxToBounds([...box.center, ...box.size]);
  }
  if (box?.min && box?.max
    && [...box.min.slice(0, 3), ...box.max.slice(0, 3)].every(value => Number.isFinite(Number(value)))) {
    return { min: box.min.slice(0, 3).map(Number), max: box.max.slice(0, 3).map(Number) };
  }
  return null;
}

export function unionBoxBounds(boxes = []) {
  let min = [Infinity, Infinity, Infinity];
  let max = [-Infinity, -Infinity, -Infinity];
  let count = 0;
  for (const box of boxes) {
    const bounds = boxToBounds(box);
    if (!bounds) continue;
    for (let axis = 0; axis < 3; axis++) {
      min[axis] = Math.min(min[axis], bounds.min[axis]);
      max[axis] = Math.max(max[axis], bounds.max[axis]);
    }
    count++;
  }
  if (!count) return null;
  return {
    min,
    max,
    size: max.map((value, axis) => value - min[axis]),
    boxCount: count,
  };
}

export function compareCollisionSidecars(legacy, calibration, tolerance = 0.001) {
  const legacyBoxes = Array.isArray(legacy?.boxes) ? legacy.boxes : [];
  const calibratedBoxes = Array.isArray(calibration?.collision?.boxes) ? calibration.collision.boxes : [];
  const legacyBounds = unionBoxBounds(legacyBoxes);
  const calibratedBounds = unionBoxBounds(calibratedBoxes);
  const currentHash = calibration?.source?.sha256 || null;
  const legacySourceMatches = !!currentHash && legacy?.sourceSha256 === currentHash;
  const unifiedSourceMatches = !!currentHash && calibration?.collision?.sourceSha256 === currentHash;
  let maxBoundsDelta = null;
  if (legacyBounds && calibratedBounds) {
    maxBoundsDelta = Math.max(
      ...legacyBounds.min.map((value, axis) => Math.abs(value - calibratedBounds.min[axis])),
      ...legacyBounds.max.map((value, axis) => Math.abs(value - calibratedBounds.max[axis])),
    );
  } else if (legacyBounds || calibratedBounds) {
    maxBoundsDelta = Infinity;
  }
  const countsMatch = legacyBoxes.length === calibratedBoxes.length;
  // Road/bridge kits may be intentionally surface-only: both sidecars then
  // contain zero solid boxes, while calibrated triangle surfaces carry the
  // driveable/walkable geometry. Two empty box sets are an exact box match.
  const bothEmpty = legacyBoxes.length === 0 && calibratedBoxes.length === 0;
  const boundsMatch = bothEmpty || (maxBoundsDelta !== null && maxBoundsDelta <= tolerance);
  const sameSource = legacySourceMatches && unifiedSourceMatches;
  return {
    status: !sameSource ? 'source-hash-mismatch'
      : countsMatch && boundsMatch ? 'matches'
        : 'collision-differs',
    sameSource,
    sourceSha256: currentHash,
    legacy: { boxCount: legacyBoxes.length, bounds: legacyBounds },
    calibrated: {
      boxCount: calibratedBoxes.length,
      nativeProxyCount: Number(calibration?.collision?.nativeProxyCount) || 0,
      bounds: calibratedBounds,
    },
    difference: {
      boxCount: calibratedBoxes.length - legacyBoxes.length,
      maxBoundsDelta,
      tolerance,
    },
  };
}

export function compareAssetFiles(sourceFile) {
  const absolute = path.resolve(ROOT, sourceFile);
  if (!ALLOWED_ROOTS.some(root => insideRoot(absolute, root))) {
    throw new Error('Asset path must be inside data/models/assets or data/models/cars: ' + sourceFile);
  }
  if (!fs.existsSync(absolute)) throw new Error('Source asset not found: ' + sourceFile);
  const parsed = path.parse(absolute);
  const legacyPath = path.join(parsed.dir, parsed.name + '_col.json');
  const calibrationPath = path.join(parsed.dir, parsed.name + '_calibration.json');
  if (!fs.existsSync(calibrationPath)) throw new Error('Unified calibration sidecar is missing: ' + calibrationPath);
  const calibration = JSON.parse(fs.readFileSync(calibrationPath, 'utf8'));
  if (!fs.existsSync(legacyPath)) {
    return {
      source: path.relative(ROOT, absolute),
      legacySidecar: null,
      status: 'legacy-sidecar-missing',
      calibrated: {
        boxCount: calibration.collision?.boxes?.length || 0,
        nativeProxyCount: calibration.collision?.nativeProxyCount || 0,
      },
    };
  }
  const legacy = JSON.parse(fs.readFileSync(legacyPath, 'utf8'));
  return {
    source: path.relative(ROOT, absolute),
    legacySidecar: path.relative(ROOT, legacyPath),
    ...compareCollisionSidecars(legacy, calibration),
  };
}

function main() {
  const inputs = process.argv.slice(2);
  if (!inputs.length) {
    console.error('Usage: node tools/compare-asset-calibrations.mjs -- <asset.glb|scene.gltf> [...]');
    process.exitCode = 1;
    return;
  }
  const results = [];
  let failed = false;
  for (const file of inputs) {
    try {
      const result = compareAssetFiles(file);
      results.push(result);
      console.log(JSON.stringify(result));
    } catch (error) {
      failed = true;
      console.error('[CollisionCompare] ' + file + ': ' + (error?.stack || error));
    }
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    const lines = [
      '## Legacy collision sidecar comparison',
      '',
      '| Asset | Legacy boxes | Unified boxes | Native proxies | Bounds delta | Status |',
      '|---|---:|---:|---:|---:|---|',
      ...results.map(result => {
        const oldCount = result.legacy?.boxCount ?? '—';
        const newCount = result.calibrated?.boxCount ?? '—';
        const proxyCount = result.calibrated?.nativeProxyCount ?? '—';
        const delta = Number.isFinite(result.difference?.maxBoundsDelta)
          ? result.difference.maxBoundsDelta.toFixed(4) : '—';
        return `| ${result.source} | ${oldCount} | ${newCount} | ${proxyCount} | ${delta} | ${result.status} |`;
      }),
      '',
      'A differing or stale legacy sidecar is a review item, not an automatic overwrite.',
    ];
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n');
  }
  if (failed) process.exitCode = 1;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) main();

