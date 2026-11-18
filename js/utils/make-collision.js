#!/usr/bin/env node
/*
 * make-collision.js  —  automatic col_* collision proxies for any GLB / GLTF
 * ---------------------------------------------------------------------------
 * No AI, no npm packages. Needs only Node 14+.
 *
 *   node make-collision.js model.glb
 *   node make-collision.js scene.gltf --rename --target-height 9
 *   node make-collision.js model.glb --mode shell --resolution 96 -o out.glb
 *
 * What it does
 *   1. Reads .glb or .gltf (+ .bin, data-URIs, external textures).
 *   2. Voxelises the visible geometry (world space, node transforms applied).
 *   3. mode "solid" (default): flood-fills from outside, so sealed buildings
 *      become solid masses while real openings stay open.
 *      mode "shell": keeps only the surface (thin walls).
 *   4. Greedily merges voxels into a small set of axis-aligned boxes, each no
 *      larger than --max-span metres, and writes them as hidden-by-engine
 *      meshes named col_wall_NN / col_floor_NN / col_roof_NN / col_column_NN /
 *      col_block_NN under a "collision_proxies" node.
 *   5. Optional --rename: lowercase_underscore names, generic "Cube_12_Mat_0"
 *      style names become window_/floor_/roof_/column_/wall_/shell_/trim_/part_NN.
 *
 * Visual geometry, materials and textures are never modified.
 */
'use strict';
import fs from 'node:fs';
import path from 'node:path';

// ───────────────────────────── CLI ─────────────────────────────
const HELP = `
Usage: node make-collision.js <input.glb|input.gltf> [options]

  -o, --out <file>        Output file (default: <name>_collision.<glb|gltf>)
      --glb / --gltf      Force output format (default: same as input;
                          --glb embeds buffers and textures into one file)
      --mode <solid|shell>  solid (default) fills sealed volumes; shell = thin walls
      --resolution <n>    Voxel cells along the longest axis (default 64)
      --min-axis-resolution <n>
                           Minimum cells on every non-zero axis (default 16)
      --max-boxes <n>     Auto-coarsen until at most n proxies (default 300)
      --max-span <m>      Largest proxy size in metres (default 5)
      --profile <name>    auto | building | small-prop | fence | pole | trunk
                           fence = thin surface collision; pole/trunk = one
                           narrow upright box; small-prop = higher detail
      --pole-width <m>    Diameter for pole/trunk profiles (default 0.35 m)
      --scale <m/unit>    Metres per model unit (default 1)
      --target-height <m> Derive --scale so the model is this tall in metres
      --rename            Clean up / classify mesh names (window_, roof_, ...)
      --seal-doors        Treat door_* meshes as solid (default: leave open)
      --keep-decor        Include trim_/sign_/awning_/roof_detail_ in collision
      --replace           Remove existing col_* proxies first
      --no-proxies        Only rename, do not generate collision
      --report <file>     Write a JSON report (boxes, names, stats)
  -h, --help
`;
function parseArgs(argv) {
  const o = { mode: 'solid', modeExplicit: false, profile: 'auto', resolution: 64, minAxisResolution: 16,
    maxBoxes: 300, maxSpan: 5, poleWidth: 0.35, poleWidthExplicit: false, scale: null, targetHeight: null,
    rename: false, sealDoors: false, keepDecor: false, replace: false, noProxies: false,
    format: null, out: null, report: null, input: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], next = () => { if (i + 1 >= argv.length) die(`Missing value for ${a}`); return argv[++i]; };
    switch (a) {
      case '-h': case '--help': console.log(HELP); process.exit(0); break;
      case '-o': case '--out': o.out = next(); break;
      case '--glb': o.format = 'glb'; break;
      case '--gltf': o.format = 'gltf'; break;
      case '--mode': o.mode = next(); o.modeExplicit = true; if (!['solid', 'shell'].includes(o.mode)) die('--mode must be solid or shell'); break;
      case '--profile': o.profile = next(); if (!['auto', 'building', 'small-prop', 'fence', 'pole', 'trunk'].includes(o.profile)) die('--profile must be auto, small-prop, fence, pole or trunk'); break;
      case '--resolution': o.resolution = parseInt(next(), 10); break;
      case '--min-axis-resolution': o.minAxisResolution = parseInt(next(), 10); break;
      case '--max-boxes': o.maxBoxes = parseInt(next(), 10); break;
      case '--max-span': o.maxSpan = parseFloat(next()); break;
      case '--pole-width': o.poleWidth = parseFloat(next()); o.poleWidthExplicit = true; break;
      case '--scale': o.scale = parseFloat(next()); break;
      case '--target-height': o.targetHeight = parseFloat(next()); break;
      case '--rename': o.rename = true; break;
      case '--seal-doors': o.sealDoors = true; break;
      case '--keep-decor': o.keepDecor = true; break;
      case '--replace': o.replace = true; break;
      case '--no-proxies': o.noProxies = true; break;
      case '--report': o.report = next(); break;
      default:
        if (a.startsWith('-')) die(`Unknown option ${a}\n${HELP}`);
        if (o.input) die('Only one input file is supported'); o.input = a;
    }
  }
  if (o.profile === 'fence' && !o.modeExplicit) o.mode = 'shell';
  if (o.profile === 'small-prop' || o.profile === 'fence') {
    o.resolution = Math.max(o.resolution, 96);
    o.minAxisResolution = Math.max(o.minAxisResolution, 24);
    o.maxBoxes = Math.max(o.maxBoxes, 600);
  }
  if (!Number.isInteger(o.resolution) || o.resolution < 8 || o.resolution > 512) die('--resolution must be an integer from 8 to 512');
  if (!Number.isInteger(o.minAxisResolution) || o.minAxisResolution < 2 || o.minAxisResolution > 256) die('--min-axis-resolution must be an integer from 2 to 256');
  if (!Number.isInteger(o.maxBoxes) || o.maxBoxes < 1) die('--max-boxes must be a positive integer');
  if (!(o.maxSpan > 0) || !Number.isFinite(o.maxSpan)) die('--max-span must be greater than zero');
  if (!(o.poleWidth > 0) || !Number.isFinite(o.poleWidth)) die('--pole-width must be greater than zero');
  if (!o.input) { console.log(HELP); process.exit(1); }
  return o;
}
function die(msg) { console.error('Error: ' + msg); process.exit(1); }
const warn = (m) => console.warn('Warning: ' + m);

// ───────────────────────────── math ─────────────────────────────
const I4 = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function mul(a, b) { // column-major a*b
  const o = new Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s;
  }
  return o;
}
function localMatrix(n) {
  if (n.matrix) return n.matrix.slice();
  const t = n.translation || [0, 0, 0], q = n.rotation || [0, 0, 0, 1], s = n.scale || [1, 1, 1];
  const [x, y, z, w] = q;
  const xx = x * x, yy = y * y, zz = z * z, xy = x * y, xz = x * z, yz = y * z, wx = w * x, wy = w * y, wz = w * z;
  return [
    (1 - 2 * (yy + zz)) * s[0], (2 * (xy + wz)) * s[0], (2 * (xz - wy)) * s[0], 0,
    (2 * (xy - wz)) * s[1], (1 - 2 * (xx + zz)) * s[1], (2 * (yz + wx)) * s[1], 0,
    (2 * (xz + wy)) * s[2], (2 * (yz - wx)) * s[2], (1 - 2 * (xx + yy)) * s[2], 0,
    t[0], t[1], t[2], 1];
}

// ───────────────────────────── glTF I/O ─────────────────────────────
function load(file) {
  const raw = fs.readFileSync(file), dir = path.dirname(file);
  let json, glbBin = null;
  if (raw.length > 12 && raw.readUInt32LE(0) === 0x46546C67) {
    let off = 12;
    while (off + 8 <= raw.length) {
      const len = raw.readUInt32LE(off), type = raw.readUInt32LE(off + 4), data = raw.subarray(off + 8, off + 8 + len);
      if (type === 0x4E4F534A) json = JSON.parse(data.toString('utf8'));
      else if (type === 0x004E4942 && !glbBin) glbBin = Buffer.from(data);
      off += 8 + len;
    }
  } else json = JSON.parse(raw.toString('utf8'));
  if (!json || !json.asset) die('Not a valid glTF/GLB file');
  const req = (json.extensionsRequired || []);
  for (const e of req) if (/draco|meshopt|basis/i.test(e) && !/texture_basisu/i.test(e))
    die(`Model uses ${e} compression. Decompress it first (e.g. "npx gltf-pipeline -i in.glb -o out.glb -d" or "npx gltfpack -noq").`);
  const bufs = (json.buffers || []).map((b, i) => {
    if (b.uri === undefined) { if (i === 0 && glbBin) return glbBin.subarray(0, b.byteLength); die('Buffer without data'); }
    if (b.uri.startsWith('data:')) return Buffer.from(b.uri.slice(b.uri.indexOf(',') + 1), 'base64');
    const p = path.join(dir, decodeURIComponent(b.uri));
    if (!fs.existsSync(p)) die(`Missing buffer file: ${p}  (keep the .bin next to the .gltf)`);
    return fs.readFileSync(p);
  });
  return { json, dir, bin: mergeBuffers(json, bufs) };
}
function mergeBuffers(json, bufs) {
  const parts = []; let total = 0; const base = [];
  for (const b of bufs) { base.push(total); parts.push(b); total += b.length; const pad = (4 - (total % 4)) % 4; if (pad) { parts.push(Buffer.alloc(pad)); total += pad; } }
  for (const bv of json.bufferViews || []) { bv.byteOffset = (bv.byteOffset || 0) + base[bv.buffer]; bv.buffer = 0; }
  json.buffers = [{ byteLength: total }];
  return Buffer.concat(parts);
}
const CSIZE = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const NCOMP = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };
function readAccessor(json, bin, idx) {
  const a = json.accessors[idx], nc = NCOMP[a.type], csz = CSIZE[a.componentType];
  const out = new Float64Array(a.count * nc);
  if (a.bufferView !== undefined) {
    const bv = json.bufferViews[a.bufferView];
    const stride = bv.byteStride || csz * nc, base = (bv.byteOffset || 0) + (a.byteOffset || 0);
    const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
    for (let i = 0; i < a.count; i++) for (let j = 0; j < nc; j++) {
      const off = base + i * stride + j * csz; let v;
      switch (a.componentType) {
        case 5126: v = dv.getFloat32(off, true); break;
        case 5120: v = dv.getInt8(off); if (a.normalized) v = Math.max(v / 127, -1); break;
        case 5121: v = dv.getUint8(off); if (a.normalized) v /= 255; break;
        case 5122: v = dv.getInt16(off, true); if (a.normalized) v = Math.max(v / 32767, -1); break;
        case 5123: v = dv.getUint16(off, true); if (a.normalized) v /= 65535; break;
        case 5125: v = dv.getUint32(off, true); break;
      }
      out[i * nc + j] = v;
    }
  }
  if (a.sparse) warn('Sparse accessor ignored');
  return out;
}

// ───────────────────────────── scene walk ─────────────────────────────
function collectInstances(json) {
  const inst = [];
  const sc = json.scenes && json.scenes[json.scene || 0];
  let roots = sc ? sc.nodes : null;
  if (!roots) { const kids = new Set(); json.nodes.forEach(n => (n.children || []).forEach(c => kids.add(c))); roots = json.nodes.map((_, i) => i).filter(i => !kids.has(i)); }
  const rec = (ni, pm, anc) => {
    const n = json.nodes[ni], M = mul(pm, localMatrix(n));
    if (n.mesh !== undefined) inst.push({ node: ni, mesh: n.mesh, M, anc });
    (n.children || []).forEach(c => rec(c, M, anc.concat(ni)));
  };
  roots.forEach(r => rec(r, I4(), []));
  return inst;
}
const meshCache = new Map();
function meshData(json, bin, mi) {
  if (meshCache.has(mi)) return meshCache.get(mi);
  const prims = [];
  for (const p of json.meshes[mi].primitives) {
    if (p.extensions && p.extensions.KHR_draco_mesh_compression) die('Draco-compressed mesh found');
    const mode = p.mode === undefined ? 4 : p.mode;
    if (mode < 4 || p.attributes.POSITION === undefined) continue;
    const pos = readAccessor(json, bin, p.attributes.POSITION);
    let idx;
    if (p.indices !== undefined) idx = Array.from(readAccessor(json, bin, p.indices));
    else idx = Array.from({ length: pos.length / 3 }, (_, i) => i);
    let tri = [];
    if (mode === 4) tri = idx;
    else if (mode === 5) for (let i = 0; i + 2 < idx.length; i++) tri.push(...(i % 2 ? [idx[i + 1], idx[i], idx[i + 2]] : [idx[i], idx[i + 1], idx[i + 2]]));
    else if (mode === 6) for (let i = 1; i + 1 < idx.length; i++) tri.push(idx[0], idx[i], idx[i + 1]);
    prims.push({ pos, tri, material: p.material });
  }
  meshCache.set(mi, prims); return prims;
}
function worldBounds(prims, M) {
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity]; let n = 0;
  for (const p of prims) for (let i = 0; i < p.pos.length; i += 3) {
    const x = p.pos[i], y = p.pos[i + 1], z = p.pos[i + 2];
    const wx = M[0] * x + M[4] * y + M[8] * z + M[12], wy = M[1] * x + M[5] * y + M[9] * z + M[13], wz = M[2] * x + M[6] * y + M[10] * z + M[14];
    if (wx < mn[0]) mn[0] = wx; if (wy < mn[1]) mn[1] = wy; if (wz < mn[2]) mn[2] = wz;
    if (wx > mx[0]) mx[0] = wx; if (wy > mx[1]) mx[1] = wy; if (wz > mx[2]) mx[2] = wz; n++;
  }
  return n ? { min: mn, max: mx } : null;
}

// ───────────────────────────── naming ─────────────────────────────
function sanitize(s) { return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, ''); }
const GENERIC = /^(cube|cylinder|sphere|plane|cone|torus|object|mesh|node|pyramid|null|boole|geometry|polysurface|pcube|pcylinder|pplane|shape|group|empty|unnamed|default|rootnode|sketchfab|model|scene|group|box|capsule)(?![a-z])/;
function classifyMeshes(json, inst, VB, matBlend, matDark) {
  const H = VB.max[1] - VB.min[1], ext = VB.max.map((v, i) => v - VB.min[i]);
  const maxH = Math.max(ext[0], ext[2]);
  const names = new Map(), counters = {};
  const next = (k) => (counters[k] = (counters[k] || 0) + 1, `${k}_${String(counters[k]).padStart(2, '0')}`);
  for (const it of inst) {
    const orig = sanitize(json.nodes[it.node].name || json.meshes[it.mesh].name);
    if (orig && !GENERIC.test(orig)) { names.set(it.node, orig); continue; }
    const prims = it.prims, b = it.bounds;
    const d = b.max.map((v, i) => v - b.min[i]), hz = Math.max(d[0], d[2]), mz = Math.min(d[0], d[2]);
    const yr0 = (b.min[1] - VB.min[1]) / H, yr1 = (b.max[1] - VB.min[1]) / H;
    const glass = prims.some(p => matBlend.has(p.material));
    const dark = prims.every(p => matDark.has(p.material)) && Math.min(...d) < 0.03 * Math.max(...ext) && hz > 0.02 * maxH;
    const vol = (d[0] * d[1] * d[2]) / (ext[0] * ext[1] * ext[2] || 1), big = Math.max(...d) / Math.max(...ext);
    let k;
    if (glass || dark) k = 'window';
    else if (d[1] < 0.08 * H && d[1] < 0.35 * hz && hz > 0.3 * maxH) k = yr0 > 0.6 ? 'roof' : (yr1 < 0.25 ? 'floor' : 'floor');
    else if (yr0 > 0.72 && big > 0.15) k = 'roof';
    else if (d[1] > 0.25 * H && hz < 0.06 * maxH && d[1] > 2.5 * hz) k = 'column';
    else if (vol > 0.2) k = 'shell';
    else if (d[1] > 0.25 * H && mz < 0.12 * hz && hz > 0.2 * maxH) k = 'wall';
    else if (big < 0.25) k = 'trim';
    else k = 'part';
    names.set(it.node, next(k));
  }
  return names;
}
function applyRename(json, inst, names) {
  const used = new Set(), uniq = (n) => { let c = n, i = 2; while (used.has(c)) c = `${n}_${i++}`; used.add(c); return c; };
  const meshNodes = new Set(inst.map(i => i.node));
  json.nodes.forEach((n, i) => {
    let nm;
    if (meshNodes.has(i)) nm = names.get(i);
    else { nm = sanitize(n.name); if (!nm || GENERIC.test(nm)) nm = `grp_${nm || i}`; }
    n.name = uniq(nm);
    if (n.mesh !== undefined) json.meshes[n.mesh].name = n.name;
  });
}

// ───────────────────────────── voxelisation ─────────────────────────────
function triBox(cx, cy, cz, hx, hy, hz, a, b, c) {
  const v0 = [a[0] - cx, a[1] - cy, a[2] - cz], v1 = [b[0] - cx, b[1] - cy, b[2] - cz], v2 = [c[0] - cx, c[1] - cy, c[2] - cz];
  const e = [[v1[0] - v0[0], v1[1] - v0[1], v1[2] - v0[2]], [v2[0] - v1[0], v2[1] - v1[1], v2[2] - v1[2]], [v0[0] - v2[0], v0[1] - v2[1], v0[2] - v2[2]]];
  const h = [hx, hy, hz], V = [v0, v1, v2];
  for (let i = 0; i < 3; i++) {
    const ex = e[i][0], ey = e[i][1], ez = e[i][2];
    const axes = [[0, -ez, ey], [ez, 0, -ex], [-ey, ex, 0]];
    for (const ax of axes) {
      const p0 = ax[0] * v0[0] + ax[1] * v0[1] + ax[2] * v0[2], p1 = ax[0] * v1[0] + ax[1] * v1[1] + ax[2] * v1[2], p2 = ax[0] * v2[0] + ax[1] * v2[1] + ax[2] * v2[2];
      const r = h[0] * Math.abs(ax[0]) + h[1] * Math.abs(ax[1]) + h[2] * Math.abs(ax[2]);
      if (Math.min(p0, p1, p2) > r || Math.max(p0, p1, p2) < -r) return false;
    }
  }
  for (let k = 0; k < 3; k++) { const mn = Math.min(v0[k], v1[k], v2[k]), mx = Math.max(v0[k], v1[k], v2[k]); if (mn > h[k] || mx < -h[k]) return false; }
  const n = [e[0][1] * e[1][2] - e[0][2] * e[1][1], e[0][2] * e[1][0] - e[0][0] * e[1][2], e[0][0] * e[1][1] - e[0][1] * e[1][0]];
  const d = n[0] * v0[0] + n[1] * v0[1] + n[2] * v0[2], r = h[0] * Math.abs(n[0]) + h[1] * Math.abs(n[1]) + h[2] * Math.abs(n[2]);
  return Math.abs(d) <= r;
}
function voxelise(solidInst, B, res, minAxisResolution) {
  const ext = B.max.map((v, i) => v - B.min[i]);
  const longest = Math.max(...ext);
  const baseCell = longest / res;
  // Keep the requested resolution on the longest axis, but never let a narrow
  // axis collapse to one or two cells. This is the key for poles, rails,
  // fence slats and other thin geometry.
  const axisCells = ext.map(e => e > 1e-9
    ? Math.min(res, Math.max(Math.min(minAxisResolution, res), Math.ceil(e / baseCell)))
    : 1);
  const cell = ext.map((e, k) => axisCells[k] > 1 ? e / axisCells[k] : baseCell);
  const dims = axisCells.map(n => n + 3), org = B.min.map((v, k) => v - cell[k]);
  const [dx, dy, dz] = dims, occ = new Uint8Array(dx * dy * dz), id = (x, y, z) => x + dx * (y + dy * z);
  const ha = cell.map(v => v * 0.5 * 1.001), a = [0, 0, 0], b = [0, 0, 0], c = [0, 0, 0];
  for (const it of solidInst) {
    const M = it.M;
    for (const p of it.prims) {
      const P = p.pos, T = p.tri, tw = (i, o) => {
        const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
        o[0] = M[0] * x + M[4] * y + M[8] * z + M[12]; o[1] = M[1] * x + M[5] * y + M[9] * z + M[13]; o[2] = M[2] * x + M[6] * y + M[10] * z + M[14];
      };
      for (let t = 0; t + 2 < T.length; t += 3) {
        tw(T[t], a); tw(T[t + 1], b); tw(T[t + 2], c);
        const lo = [0, 0, 0], hi = [0, 0, 0];
        for (let k = 0; k < 3; k++) {
          lo[k] = Math.max(0, Math.floor((Math.min(a[k], b[k], c[k]) - org[k]) / cell[k]));
          hi[k] = Math.min(dims[k] - 1, Math.floor((Math.max(a[k], b[k], c[k]) - org[k]) / cell[k]));
        }
        const single = lo[0] === hi[0] && lo[1] === hi[1] && lo[2] === hi[2];
        for (let z = lo[2]; z <= hi[2]; z++) for (let y = lo[1]; y <= hi[1]; y++) for (let x = lo[0]; x <= hi[0]; x++) {
          const i = id(x, y, z); if (occ[i]) continue;
          if (single || triBox(
            org[0] + (x + 0.5) * cell[0],
            org[1] + (y + 0.5) * cell[1],
            org[2] + (z + 0.5) * cell[2],
            ha[0], ha[1], ha[2], a, b, c
          )) occ[i] = 1;
        }
      }
    }
  }
  return { occ, dims, org, cell, id };
}
function floodSolid(g) {
  const [dx, dy, dz] = g.dims, N = dx * dy * dz, st = new Uint8Array(N), q = new Int32Array(N); let h = 0, t = 0;
  for (let i = 0; i < N; i++) st[i] = g.occ[i] ? 1 : 0;
  const push = (x, y, z) => { const i = g.id(x, y, z); if (st[i] === 0) { st[i] = 2; q[t++] = i; } };
  for (let z = 0; z < dz; z++) for (let y = 0; y < dy; y++) for (let x = 0; x < dx; x++) if (x === 0 || y === 0 || z === 0 || x === dx - 1 || y === dy - 1 || z === dz - 1) push(x, y, z);
  while (h < t) {
    const i = q[h++], x = i % dx, y = ((i / dx) | 0) % dy, z = (i / (dx * dy)) | 0;
    if (x > 0) push(x - 1, y, z); if (x < dx - 1) push(x + 1, y, z);
    if (y > 0) push(x, y - 1, z); if (y < dy - 1) push(x, y + 1, z);
    if (z > 0) push(x, y, z - 1); if (z < dz - 1) push(x, y, z + 1);
  }
  const s = new Uint8Array(N); for (let i = 0; i < N; i++) s[i] = st[i] !== 2 ? 1 : 0; return s;
}
function greedy(s, g, maxCells) {
  const [dx, dy, dz] = g.dims, id = g.id, boxes = [];
  for (let y = 0; y < dy; y++) for (let z = 0; z < dz; z++) for (let x = 0; x < dx; x++) {
    if (!s[id(x, y, z)]) continue;
    let ex = 1; while (ex < maxCells[0] && x + ex < dx && s[id(x + ex, y, z)]) ex++;
    let ez = 1; o1: while (ez < maxCells[2] && z + ez < dz) { for (let k = 0; k < ex; k++) if (!s[id(x + k, y, z + ez)]) break o1; ez++; }
    let ey = 1; o2: while (ey < maxCells[1] && y + ey < dy) { for (let kz = 0; kz < ez; kz++) for (let kx = 0; kx < ex; kx++) if (!s[id(x + kx, y + ey, z + kz)]) break o2; ey++; }
    for (let kz = 0; kz < ez; kz++) for (let ky = 0; ky < ey; ky++) for (let kx = 0; kx < ex; kx++) s[id(x + kx, y + ky, z + kz)] = 0;
    boxes.push([x, y, z, ex, ey, ez]);
  }
  return boxes;
}
function buildBoxes(solidInst, B, o, scale, scaleKnown, height) {
  let res = o.resolution, last = null;
  for (;;) {
    const g = voxelise(solidInst, B, res, o.minAxisResolution);
    const s = o.mode === 'solid' ? floodSolid(g) : g.occ;
    // Cap each axis independently so narrow rails and posts keep their detail.
    const maxCells = (scaleKnown || height <= 40)
      ? g.cell.map(c => Math.max(1, Math.floor((o.maxSpan / scale) / c)))
      : g.cell.map(() => Math.max(1, Math.round(res / 3)));
    const raw = greedy(s, g, maxCells);
    last = { g, raw, res };
    if (raw.length <= o.maxBoxes || res <= 10) break;
    res = Math.max(10, Math.floor(res * 0.8));
  }
  const { g, raw } = last;
  const eps = g.cell.map(c => c * 0.04);
  const boxes = raw.map(([x, y, z, ex, ey, ez]) => ({
    min: [g.org[0] + x * g.cell[0] - eps[0], g.org[1] + y * g.cell[1] - eps[1], g.org[2] + z * g.cell[2] - eps[2]],
    max: [g.org[0] + (x + ex) * g.cell[0] + eps[0], g.org[1] + (y + ey) * g.cell[1] + eps[1], g.org[2] + (z + ez) * g.cell[2] + eps[2]]
  }));
  return { boxes, cell: g.cell, res: last.res };
}
function nameBoxes(boxes, VB) {
  const H = VB.max[1] - VB.min[1], ext = VB.max.map((v, i) => v - VB.min[i]), mh = Math.max(ext[0], ext[2]), cnt = {};
  const order = boxes.map((b, i) => i).sort((a, b) => boxes[a].min[1] - boxes[b].min[1] || boxes[a].min[0] - boxes[b].min[0] || boxes[a].min[2] - boxes[b].min[2]);
  order.forEach(i => {
    const b = boxes[i], d = b.max.map((v, k) => v - b.min[k]), hz = Math.max(d[0], d[2]), mz = Math.min(d[0], d[2]);
    const yTop = (b.max[1] - VB.min[1]) / H, yc = ((b.min[1] + b.max[1]) / 2 - VB.min[1]) / H;
    let k;
    if (yTop < 0.2 && d[1] < 0.6 * hz) k = 'floor';
    else if (yc > 0.72) k = 'roof';
    else if (d[1] > 2 * hz && hz < 0.12 * mh) k = 'column';
    else if (mz < 0.4 * hz && d[1] > 0.5 * mz) k = 'wall';
    else k = 'block';
    cnt[k] = (cnt[k] || 0) + 1; b.name = `col_${k}_${String(cnt[k]).padStart(2, '0')}`;
  });
  boxes.sort((a, b) => a.name.localeCompare(b.name));
}

// ───────────────────────────── write boxes into glTF ─────────────────────────────
const FACES = [[[1, 0, 0], [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]]], [[-1, 0, 0], [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]]],
  [[0, 1, 0], [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]]], [[0, -1, 0], [[0, 0, 1], [0, 0, 0], [1, 0, 0], [1, 0, 1]]],
  [[0, 0, 1], [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]]], [[0, 0, -1], [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]]]];
function addBoxes(json, bin, boxes) {
  const parts = [bin], pad = (b) => (4 - (b.length % 4)) % 4;
  let total = bin.length; if (pad(bin)) { parts.push(Buffer.alloc(pad(bin))); total += pad(bin); }
  const vbuf = Buffer.alloc(boxes.length * 24 * 24), ibuf = Buffer.alloc(boxes.length * 36 * 2); let vo = 0, io = 0;
  const meta = [];
  for (const b of boxes) {
    meta.push([vo, io]);
    for (const [nrm, quad] of FACES) for (const [a, bb, c] of quad) {
      [a ? b.max[0] : b.min[0], bb ? b.max[1] : b.min[1], c ? b.max[2] : b.min[2], ...nrm].forEach(v => { vbuf.writeFloatLE(v, vo); vo += 4; });
    }
    for (let f = 0; f < 6; f++) [0, 1, 2, 0, 2, 3].forEach(k => { ibuf.writeUInt16LE(f * 4 + k, io); io += 2; });
  }
  const vStart = total; parts.push(vbuf); total += vbuf.length;
  const iStart = total; parts.push(ibuf); total += ibuf.length;
  json.bufferViews = json.bufferViews || []; json.accessors = json.accessors || []; json.meshes = json.meshes || []; json.materials = json.materials || [];
  json.bufferViews.push({ buffer: 0, byteOffset: vStart, byteLength: vbuf.length, byteStride: 24, target: 34962, name: 'col_proxy_vertices' });
  json.bufferViews.push({ buffer: 0, byteOffset: iStart, byteLength: ibuf.length, target: 34963, name: 'col_proxy_indices' });
  const bvV = json.bufferViews.length - 2, bvI = json.bufferViews.length - 1;
  json.materials.push({ name: 'col_proxy', alphaMode: 'BLEND', doubleSided: true, pbrMetallicRoughness: { baseColorFactor: [1, 0, 0.8, 0.25], metallicFactor: 0, roughnessFactor: 1 } });
  const mat = json.materials.length - 1;
  const group = json.nodes.length; json.nodes.push({ name: 'collision_proxies', children: [] });
  boxes.forEach((b, k) => {
    const ap = json.accessors.length;
    json.accessors.push({ bufferView: bvV, byteOffset: meta[k][0], componentType: 5126, count: 24, type: 'VEC3', min: b.min, max: b.max });
    json.accessors.push({ bufferView: bvV, byteOffset: meta[k][0] + 12, componentType: 5126, count: 24, type: 'VEC3', min: [-1, -1, -1], max: [1, 1, 1] });
    json.accessors.push({ bufferView: bvI, byteOffset: meta[k][1], componentType: 5123, count: 36, type: 'SCALAR' });
    const mi = json.meshes.length; json.meshes.push({ name: b.name, primitives: [{ attributes: { POSITION: ap, NORMAL: ap + 1 }, indices: ap + 2, material: mat, mode: 4 }] });
    json.nodes.push({ name: b.name, mesh: mi }); json.nodes[group].children.push(json.nodes.length - 1);
  });
  if (!json.scenes || !json.scenes.length) json.scenes = [{ nodes: [] }];
  json.scenes[json.scene || 0].nodes.push(group);
  return Buffer.concat(parts);
}
function removeExisting(json) {
  const dead = new Set();
  json.nodes.forEach((n, i) => { if (/^col_/.test(n.name || '') || n.name === 'collision_proxies') dead.add(i); });
  if (!dead.size) return 0;
  json.nodes.forEach(n => { if (n.children) { n.children = n.children.filter(c => !dead.has(c)); if (!n.children.length) delete n.children; } });
  json.scenes.forEach(s => { s.nodes = (s.nodes || []).filter(c => !dead.has(c)); });
  return dead.size;
}

// ───────────────────────────── output ─────────────────────────────
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ktx2': 'image/ktx2' };
function embedImages(json, bin, dir) {
  const parts = [bin]; let total = bin.length;
  const pad = () => { const p = (4 - (total % 4)) % 4; if (p) { parts.push(Buffer.alloc(p)); total += p; } };
  for (const im of json.images || []) {
    if (im.uri === undefined) continue;
    let data, mime = im.mimeType;
    if (im.uri.startsWith('data:')) { const m = /^data:([^;,]+)/.exec(im.uri); mime = mime || (m && m[1]); data = Buffer.from(im.uri.slice(im.uri.indexOf(',') + 1), 'base64'); }
    else { const p = path.join(dir, decodeURIComponent(im.uri)); if (!fs.existsSync(p)) { warn(`Texture not found, left as external reference: ${im.uri}`); continue; } data = fs.readFileSync(p); mime = mime || MIME[path.extname(p).toLowerCase()] || 'image/png'; }
    pad(); json.bufferViews.push({ buffer: 0, byteOffset: total, byteLength: data.length }); parts.push(data); total += data.length;
    im.bufferView = json.bufferViews.length - 1; im.mimeType = mime; delete im.uri;
  }
  pad(); return Buffer.concat(parts);
}
function writeGLB(file, json, bin) {
  json.buffers = [{ byteLength: bin.length }];
  let js = Buffer.from(JSON.stringify(json), 'utf8'); const jp = (4 - (js.length % 4)) % 4; if (jp) js = Buffer.concat([js, Buffer.alloc(jp, 0x20)]);
  let bp = (4 - (bin.length % 4)) % 4; const b = bp ? Buffer.concat([bin, Buffer.alloc(bp)]) : bin;
  const hdr = Buffer.alloc(12); hdr.writeUInt32LE(0x46546C67, 0); hdr.writeUInt32LE(2, 4); hdr.writeUInt32LE(12 + 8 + js.length + 8 + b.length, 8);
  const c1 = Buffer.alloc(8); c1.writeUInt32LE(js.length, 0); c1.writeUInt32LE(0x4E4F534A, 4);
  const c2 = Buffer.alloc(8); c2.writeUInt32LE(b.length, 0); c2.writeUInt32LE(0x004E4942, 4);
  fs.writeFileSync(file, Buffer.concat([hdr, c1, js, c2, b]));
}
function writeGLTF(file, json, bin, srcDir) {
  const outDir = path.dirname(file), base = path.basename(file, path.extname(file));
  json.buffers = [{ byteLength: bin.length, uri: base + '.bin' }];
  fs.writeFileSync(path.join(outDir, base + '.bin'), bin);
  fs.writeFileSync(file, JSON.stringify(json));
  if (path.resolve(outDir) !== path.resolve(srcDir))
    for (const im of json.images || []) if (im.uri && !im.uri.startsWith('data:')) {
      const s = path.join(srcDir, decodeURIComponent(im.uri)), d = path.join(outDir, decodeURIComponent(im.uri));
      if (fs.existsSync(s)) { fs.mkdirSync(path.dirname(d), { recursive: true }); fs.copyFileSync(s, d); }
    }
}

// ───────────────────────────── main ─────────────────────────────
function main() {
  const o = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(o.input)) die(`File not found: ${o.input}`);
  const t0 = Date.now();
  let { json, dir, bin } = load(o.input);
  json.nodes = json.nodes || []; json.meshes = json.meshes || [];
  if (o.replace) { const n = removeExisting(json); if (n) console.log(`Removed ${n} existing col_* nodes`); }
  else if (!o.noProxies && json.nodes.some(n => n.mesh !== undefined && /^col_/.test(n.name || ''))) die('Model already contains col_* proxies. Use --replace to regenerate them.');

  const inst = collectInstances(json);
  if (!inst.length) die('No meshes found in the default scene');
  let tris = 0;
  for (const it of inst) { it.prims = meshData(json, bin, it.mesh); it.bounds = worldBounds(it.prims, it.M); it.prims.forEach(p => tris += p.tri.length / 3); }
  const vis = inst.filter(i => i.bounds);
  const VB = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  vis.forEach(i => { for (let k = 0; k < 3; k++) { VB.min[k] = Math.min(VB.min[k], i.bounds.min[k]); VB.max[k] = Math.max(VB.max[k], i.bounds.max[k]); } });
  const height = VB.max[1] - VB.min[1];

  // names
  const matBlend = new Set((json.materials || []).map((m, i) => (m.alphaMode === 'BLEND' || /glass|window|transparent/i.test(m.name || '')) ? i : -1).filter(i => i >= 0));
  const matDark = new Set((json.materials || []).map((m, i) => { const pb = m.pbrMetallicRoughness || {}, c = pb.baseColorFactor || [1, 1, 1, 1]; return (!pb.baseColorTexture && c[0] + c[1] + c[2] < 0.15) ? i : -1; }).filter(i => i >= 0));
  let nameOf;
  if (o.rename) {
    const names = classifyMeshes(json, vis, VB, matBlend, matDark);
    applyRename(json, vis, names);
    console.log('Renamed nodes/meshes to lowercase_underscore convention');
  }
  nameOf = (ni) => (json.nodes[ni].name || '').toLowerCase();

  // scale
  let scale = o.scale || 1;
  if (o.targetHeight) scale = o.targetHeight / height;
  const report = { input: o.input, triangles: tris, meshInstances: vis.length, modelSize: VB.max.map((v, i) => +(v - VB.min[i]).toFixed(4)), metresPerUnit: scale, boxes: [] };

  if (!o.noProxies) {
    const excluded = [], solid = [];
    for (const it of vis) {
      const own = nameOf(it.node), chain = it.anc.map(nameOf).concat(own);
      let why = null;
      if (chain.some(n => /^col_/.test(n))) why = 'col';
      else if (!o.sealDoors && chain.some(n => /^door_/.test(n))) why = 'door';
      else if (!o.keepDecor && /^(trim|sign|awning|roof_detail)_/.test(own)) why = 'decor';
      (why ? excluded : solid).push(it); if (why) it.why = why;
    }
    if (!solid.length) die('Nothing left to build collision from (everything was excluded).');
    const B = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
    solid.forEach(i => { for (let k = 0; k < 3; k++) { B.min[k] = Math.min(B.min[k], i.bounds.min[k]); B.max[k] = Math.max(B.max[k], i.bounds.max[k]); } });
    let r;
    if (o.profile === 'pole' || o.profile === 'trunk') {
      // Poles and trunks need one narrow, full-height collider, not boxes around
      // the lamp head, wires or foliage. Find the base footprint to retain an
      // authored offset instead of assuming the model origin is centred.
      const cutoff = VB.min[1] + height * 0.2;
      const baseParts = solid.filter(i => i.bounds.min[1] <= cutoff);
      const footprint = baseParts.length ? baseParts : solid;
      // Prefer actual lowest vertices so a single combined lamp mesh with a
      // long top arm does not shift the upright collider away from its shaft.
      let xMin = Infinity, xMax = -Infinity, zMin = Infinity, zMax = -Infinity;
      const baseVertexCutoff = VB.min[1] + Math.max(height * 0.08, 1e-5);
      for (const it of solid) for (const p of it.prims) {
        for (let i = 0; i < p.pos.length; i += 3) {
          const x = p.pos[i], y = p.pos[i + 1], z = p.pos[i + 2], M = it.M;
          const wx = M[0] * x + M[4] * y + M[8] * z + M[12];
          const wy = M[1] * x + M[5] * y + M[9] * z + M[13];
          if (wy > baseVertexCutoff) continue;
          const wz = M[2] * x + M[6] * y + M[10] * z + M[14];
          xMin = Math.min(xMin, wx); xMax = Math.max(xMax, wx);
          zMin = Math.min(zMin, wz); zMax = Math.max(zMax, wz);
        }
      }
      if (!Number.isFinite(xMin)) {
        xMin = Math.min(...footprint.map(i => i.bounds.min[0]));
        xMax = Math.max(...footprint.map(i => i.bounds.max[0]));
        zMin = Math.min(...footprint.map(i => i.bounds.min[2]));
        zMax = Math.max(...footprint.map(i => i.bounds.max[2]));
      }
      const cx = (xMin + xMax) * 0.5, cz = (zMin + zMax) * 0.5;
      const widthMetres = o.poleWidthExplicit ? o.poleWidth : (o.profile === 'trunk' ? 0.5 : 0.35);
      const widthUnits = widthMetres / scale;
      r = { boxes: [{
        min: [cx - widthUnits * 0.5, VB.min[1], cz - widthUnits * 0.5],
        max: [cx + widthUnits * 0.5, VB.max[1], cz + widthUnits * 0.5],
      }], cell: [0, 0, 0], res: 0 };
    } else {
      r = buildBoxes(solid, B, o, scale, !!(o.scale || o.targetHeight), height);
    }
    if (!r.boxes.length) die('No collision boxes were produced.');
    nameBoxes(r.boxes, VB);
    bin = addBoxes(json, bin, r.boxes);
    const cnt = {}; r.boxes.forEach(b => { const k = b.name.split('_')[1]; cnt[k] = (cnt[k] || 0) + 1; });
    const bigD = Math.max(...r.boxes.map(b => Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]))) * scale;
    const cellMax = Math.max(...r.cell);
    const cellByAxis = r.cell.map(c => +(c * scale).toFixed(5));
    Object.assign(report, {
      profile: o.profile, mode: o.profile === 'pole' || o.profile === 'trunk' ? o.profile : o.mode,
      resolutionUsed: r.res, voxelSizeUnits: cellMax,
      voxelSizeByAxisUnits: r.cell, voxelSizeMetres: cellMax * scale,
      voxelSizeByAxisMetres: cellByAxis,
      excludedMeshes: excluded.map(i => ({ name: json.nodes[i.node].name, reason: i.why })),
      boxes: r.boxes.map(b => ({ name: b.name, min: b.min, max: b.max })),
    });
    console.log(`Collision: ${r.boxes.length} proxies  ${JSON.stringify(cnt)}`);
    const u = (o.scale || o.targetHeight || height <= 40) ? 'm' : 'units';
    const voxelLabel = r.res ? cellByAxis.map(v => v.toFixed(3)).join(' × ') : 'direct profile';
    console.log(`  profile=${o.profile}  mode=${o.profile === 'pole' || o.profile === 'trunk' ? o.profile : o.mode}  grid=${r.res || '—'}  voxel=${voxelLabel} ${u}  largest proxy=${bigD.toFixed(2)} ${u}`);
    if (excluded.length) console.log(`  excluded from collision: ${excluded.length} mesh(es) (door_/decor/col_)`);
    if (r.res && r.res < o.resolution) console.log(`  (resolution auto-reduced from ${o.resolution} to keep <= ${o.maxBoxes} proxies; raise --max-boxes for more detail)`);
  }
  if (!o.scale && !o.targetHeight) console.log(height > 40 ? 'Note: model is not obviously in metres; proxies are limited to about 1/3 of the model size. Pass --target-height <m> (or --scale) for an exact --max-span.' : 'Note: assuming 1 unit = 1 metre.');
  console.log(`Model height: ${height.toFixed(3)} units${o.targetHeight || o.scale ? `  (= ${(height * scale).toFixed(2)} m)` : ''}`);

  // write
  const inGLB = /\.glb$/i.test(o.input), fmt = o.format || (inGLB ? 'glb' : 'gltf');
  const base = path.join(path.dirname(o.input), path.basename(o.input, path.extname(o.input)) + '_collision');
  const out = o.out || `${base}.${fmt}`;
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  if (fmt === 'glb') { bin = embedImages(json, bin, dir); writeGLB(out, json, bin); }
  else writeGLTF(out, json, bin, dir);
  console.log(`Wrote ${out}${fmt === 'gltf' ? ` (+ ${path.basename(out, path.extname(out))}.bin)` : ''}  in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  if (o.report) { fs.writeFileSync(o.report, JSON.stringify(report, null, 2)); console.log(`Report: ${o.report}`); }
}
main();
