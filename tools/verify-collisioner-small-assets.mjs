#!/usr/bin/env node
// Regression tests for thin/small model collision generation.
// Run with: node tools/verify-collisioner-small-assets.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const converter = path.join(root, 'js/utils/make-collision.js');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'open-world-collisioner-'));

function boxVertices(min, max) {
  const [x0, y0, z0] = min, [x1, y1, z1] = max;
  const faces = [
    [[x1,y0,z0],[x1,y1,z0],[x1,y1,z1],[x1,y0,z1]],
    [[x0,y0,z1],[x0,y1,z1],[x0,y1,z0],[x0,y0,z0]],
    [[x0,y1,z0],[x0,y1,z1],[x1,y1,z1],[x1,y1,z0]],
    [[x0,y0,z1],[x0,y0,z0],[x1,y0,z0],[x1,y0,z1]],
    [[x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1]],
    [[x1,y0,z0],[x0,y0,z0],[x0,y1,z0],[x1,y1,z0]],
  ];
  const out = [];
  for (const q of faces) {
    for (const index of [0,1,2,0,2,3]) out.push(...q[index]);
  }
  return out;
}

function writeGlb(file, objects) {
  const chunks = [];
  const json = {
    asset: { version: '2.0', generator: 'collisioner-small-asset-test' },
    buffers: [{ byteLength: 0 }],
    bufferViews: [],
    accessors: [],
    meshes: [],
    nodes: [],
    scenes: [{ nodes: [] }],
    scene: 0,
  };
  let offset = 0;
  for (const object of objects) {
    const values = boxVertices(object.min, object.max);
    const bytes = Buffer.alloc(values.length * 4);
    values.forEach((v, i) => bytes.writeFloatLE(v, i * 4));
    const accessor = json.accessors.length;
    json.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length });
    json.accessors.push({
      bufferView: json.bufferViews.length - 1,
      componentType: 5126,
      count: values.length / 3,
      type: 'VEC3',
      min: object.min,
      max: object.max,
    });
    json.meshes.push({ name: object.name, primitives: [{ attributes: { POSITION: accessor }, mode: 4 }] });
    json.nodes.push({ name: object.name, mesh: json.meshes.length - 1 });
    json.scenes[0].nodes.push(json.nodes.length - 1);
    chunks.push(bytes);
    offset += bytes.length;
  }
  const bin = Buffer.concat(chunks);
  json.buffers[0].byteLength = bin.length;
  let jsonChunk = Buffer.from(JSON.stringify(json), 'utf8');
  const jsonPad = (4 - (jsonChunk.length % 4)) % 4;
  if (jsonPad) jsonChunk = Buffer.concat([jsonChunk, Buffer.alloc(jsonPad, 0x20)]);
  const binPad = (4 - (bin.length % 4)) % 4;
  const paddedBin = binPad ? Buffer.concat([bin, Buffer.alloc(binPad)]) : bin;
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonChunk.length + 8 + paddedBin.length, 8);
  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(jsonChunk.length, 0);
  jsonHeader.writeUInt32LE(0x4e4f534a, 4);
  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(paddedBin.length, 0);
  binHeader.writeUInt32LE(0x004e4942, 4);
  fs.writeFileSync(file, Buffer.concat([header, jsonHeader, jsonChunk, binHeader, paddedBin]));
}

function readGlbJson(file) {
  const bytes = fs.readFileSync(file);
  assert.equal(bytes.readUInt32LE(0), 0x46546c67, 'output must be a valid GLB');
  assert.equal(bytes.readUInt32LE(4), 2, 'output GLB version must be 2');
  const length = bytes.readUInt32LE(12);
  return JSON.parse(bytes.toString('utf8', 20, 20 + length));
}

function run(input, output, report, args) {
  execFileSync(process.execPath, [converter, input, ...args, '--out', output, '--report', report], {
    cwd: root,
    stdio: 'pipe',
  });
  assert.ok(fs.statSync(output).size > 0, 'converter output was not written');
  return JSON.parse(fs.readFileSync(report, 'utf8'));
}

try {
  const fenceInput = path.join(temp, 'thin-fence.glb');
  const fenceOutput = path.join(temp, 'thin-fence-collision.glb');
  const fenceReport = path.join(temp, 'thin-fence-report.json');
  writeGlb(fenceInput, [
    { name: 'post_left', min: [-4, 0, -0.05], max: [-3.92, 1.8, 0.05] },
    { name: 'post_right', min: [3.92, 0, -0.05], max: [4, 1.8, 0.05] },
    { name: 'rail_top', min: [-4, 1.55, -0.04], max: [4, 1.65, 0.04] },
    { name: 'rail_bottom', min: [-4, 0.25, -0.04], max: [4, 0.35, 0.04] },
  ]);
  const fence = run(fenceInput, fenceOutput, fenceReport, ['--profile', 'fence', '--target-height', '1.8', '--replace']);
  assert.equal(fence.profile, 'fence');
  assert.equal(fence.mode, 'shell', 'fence profile should default to shell collision');
  assert.ok(fence.boxes.length > 0, 'thin fence should produce collision proxies');
  assert.ok(fence.voxelSizeByAxisUnits[2] < fence.voxelSizeUnits * 0.25,
    'thin Z axis should receive finer voxels instead of collapsing to the longest-axis cell size');
  assert.ok(fence.boxes.every(box => box.min.every(Number.isFinite) && box.max.every(Number.isFinite)),
    'fence proxy bounds must be finite');
  assert.ok(readGlbJson(fenceOutput).nodes.some(node => /^col_/.test(node.name || '')),
    'fence output must contain embedded col_* nodes');
  console.log('  PASS thin fence uses high-detail surface proxies on its narrow axis');

  const poleInput = path.join(temp, 'streetlight.glb');
  const poleOutput = path.join(temp, 'streetlight-collision.glb');
  const poleReport = path.join(temp, 'streetlight-report.json');
  writeGlb(poleInput, [
    { name: 'base', min: [0.36, 0, -0.04], max: [0.44, 0.2, 0.04] },
    { name: 'shaft', min: [0.37, 0.1, -0.03], max: [0.43, 7.8, 0.03] },
    { name: 'lamp_arm_and_head', min: [0.4, 7.6, -0.3], max: [1.3, 8, 0.3] },
  ]);
  const pole = run(poleInput, poleOutput, poleReport, ['--profile', 'pole', '--target-height', '8', '--replace']);
  assert.equal(pole.profile, 'pole');
  assert.equal(pole.boxes.length, 1, 'streetlight should use one upright proxy');
  const [proxy] = pole.boxes;
  assert.ok(Math.abs((proxy.max[0] - proxy.min[0]) - 0.35) < 1e-4, 'pole proxy should be 0.35 m wide');
  assert.ok(Math.abs((proxy.max[2] - proxy.min[2]) - 0.35) < 1e-4, 'pole proxy should be 0.35 m deep');
  assert.ok(Math.abs(proxy.min[0] - 0.225) < 1e-4 && Math.abs(proxy.max[0] - 0.575) < 1e-4,
    'upright proxy should follow the shaft base, not the offset lamp arm');
  assert.ok(Math.abs((proxy.max[1] - proxy.min[1]) - 8) < 1e-4, 'pole proxy should span the model height');
  assert.ok(readGlbJson(poleOutput).nodes.some(node => /^col_/.test(node.name || '')),
    'pole output must contain embedded col_* nodes');
  console.log('  PASS streetlight profile creates one correctly-sized upright proxy at the pole base');

  const derivedOutput = path.join(temp, 'streetlight-derived-collision.glb');
  const derivedReport = path.join(temp, 'streetlight-derived-report.json');
  const derived = run(poleInput, derivedOutput, derivedReport, ['--profile', 'pole', '--replace']);
  assert.equal(derived.scaleVerified, false, 'raw source dimensions must not be labelled as verified metres');
  assert.equal(derived.metresPerUnit, null, 'unverified source scale must remain unset');
  assert.equal(derived.boxes.length, 1, 'derived pole profile should still create one upright proxy');
  const derivedBox = derived.boxes[0];
  assert.ok(Math.abs((derivedBox.max[0] - derivedBox.min[0]) - 0.096) < 1e-4,
    'without a known scale, pole width should derive from the model base footprint and safe minimum');
  assert.ok(Math.abs(derivedBox.min[0] - 0.352) < 1e-4 && Math.abs(derivedBox.max[0] - 0.448) < 1e-4,
    'derived pole proxy should remain centred on the actual base rather than the offset lamp arm');
  console.log('  PASS unscaled pole profile derives a narrow base footprint without inventing metre scale');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
