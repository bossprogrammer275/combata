#!/usr/bin/env node
/**
 * Internal asset-registration evidence capture.
 *
 * Full library:
 *   node tools/capture-asset-calibration.mjs
 *
 * One incoming model:
 *   node tools/capture-asset-calibration.mjs data/models/assets/<folder>/scene.gltf
 *
 * Outputs live in artifacts/asset-calibration. No model is rescaled or rewritten.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { glob } from 'glob';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'artifacts', 'asset-calibration');
const PREVIEW = path.join(OUT, 'previews');
const PORT = Number(process.env.ASSET_CALIBRATION_PORT || 4186);
const BASE = `http://127.0.0.1:${PORT}/`;
const VIEWS = ['iso', 'front', 'side', 'top', 'collision', 'scale'];
const ALLOWED_ROOTS = [
  path.join(ROOT, 'data', 'models', 'assets'),
  path.join(ROOT, 'data', 'models', 'cars'),
];
const COMPONENT_KITS = [
  { pattern: /others\/modular_bridge__low_poly__game_ready_/i, top: true },
  { pattern: /roads\/road_pack/i, top: true },
  { pattern: /roads\/sidewalks/i, top: true },
  { pattern: /roads\/street_road/i, top: false },
];

function insideAllowedRoot(file) {
  return ALLOWED_ROOTS.some(root => file === root || file.startsWith(root + path.sep));
}

function toRelative(file) {
  return path.relative(ROOT, file).split(path.sep).join('/');
}

function slug(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\\/g, '/')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(-100) || 'asset';
}

async function expandInput(input) {
  const absolute = path.resolve(ROOT, input);
  if (!insideAllowedRoot(absolute)) {
    throw new Error(`Asset path must be inside data/models/assets or data/models/cars: ${input}`);
  }
  const stat = await fs.stat(absolute);
  if (stat.isDirectory()) {
    const files = await glob('**/*.{glb,gltf}', { cwd: absolute, nodir: true });
    return files
      .filter(file => file.toLowerCase().endsWith('.glb') || path.basename(file).toLowerCase() === 'scene.gltf')
      .map(file => path.join(absolute, file));
  }
  if (!/\.(glb|gltf)$/i.test(absolute)) throw new Error(`Not a GLB/glTF file: ${input}`);
  return [absolute];
}

async function discoverAssets(inputs) {
  let files;
  if (inputs.length) {
    files = (await Promise.all(inputs.map(expandInput))).flat();
  } else {
    const candidates = [];
    for (const root of ALLOWED_ROOTS) {
      const found = await glob('**/*.{glb,gltf}', { cwd: root, nodir: true });
      candidates.push(...found
        .filter(file => file.toLowerCase().endsWith('.glb') || path.basename(file).toLowerCase() === 'scene.gltf')
        .map(file => path.join(root, file)));
    }
    files = candidates;
  }
  return [...new Set(files)].sort((a, b) => a.localeCompare(b));
}

function makeCard(item) {
  const images = (item.screenshots || []).map(s =>
    `<a href="${s.path}"><img src="${s.path}" alt="${s.view} view" loading="lazy"><small>${s.view}</small></a>`
  ).join('');
  const d = item.dimensionsSourceUnits || {};
  const dimensions = [d.width, d.height, d.depth]
    .map(v => Number.isFinite(v) ? v.toFixed(3) : '—')
    .join(' × ');
  const components = (item.componentScreenshots || []).map(component =>
    `<a href="${component.screenshots[0]?.path || '#'}">${component.index + 1}. ${component.name}</a>`
  ).join(' · ');
  const warning = item.error
    ? item.error.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').split('\n')[0]
    : (item.calibrationFlags || []).join(' · ') || 'Raw bounds only. Physical scale remains unverified.';
  return `<article>
    <h2>${item.name}</h2>
    <p class="path">${item.path}</p>
    <p>${item.status} · ${dimensions} source units · ${item.meshCount ?? '—'} meshes · ${item.collisionProxyCount ?? 0} collision meshes</p>
    <section>${images}</section>
    ${components ? `<p class="components">COMPONENTS: ${components}</p>` : ''}
    <p class="warning">${warning}</p>
  </article>`;
}

async function waitForServer(server) {
  for (let i = 0; i < 160; i++) {
    if (server.exitCode != null) throw new Error('Preview server exited before becoming ready');
    try {
      const response = await fetch(BASE + 'tools/asset-calibration-preview.html');
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Internal calibration preview server did not become ready');
}

async function captureScreenshot(page, outputPath) {
  await page.evaluate(() => window.__ASSET_CALIBRATION__?.render?.());
  await page.screenshot({
    path: outputPath,
    timeout: 30000,
    animations: 'disabled',
  });
  const stat = await fs.stat(outputPath);
  if (stat.size < 5000) {
    throw new Error(`Screenshot is unexpectedly small: ${outputPath} (${stat.size} bytes)`);
  }
  return stat.size;
}

const inputPaths = process.argv.slice(2);
const files = await discoverAssets(inputPaths);
if (!files.length) throw new Error('No GLB or glTF model entry points found.');

await fs.rm(OUT, { recursive: true, force: true });
await fs.mkdir(PREVIEW, { recursive: true });

const server = spawn(process.execPath, ['server.js'], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(PORT) },
  stdio: ['ignore', 'ignore', 'pipe'],
});
let browser = null;
const records = [];
const browserErrors = [];
const failedRequests = [];

try {
  await waitForServer(server);
  browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-webgl',
      '--ignore-gpu-blocklist',
      '--disable-gpu-sandbox',
    ],
  });

  for (let index = 0; index < files.length; index++) {
    const file = files[index];
    const relative = toRelative(file);
    const displayName = path.basename(file, path.extname(file));
    const prefix = `${String(index + 1).padStart(3, '0')}-${slug(relative)}`;
    const url = '/' + relative;
    const beforeErrors = browserErrors.length;
    const beforeFailed = failedRequests.length;
    let page = null;
    let report = null;
    let error = null;
    const screenshots = [];
    const componentScreenshots = [];

    console.log(`[${index + 1}/${files.length}] Loading ${relative}`);
    try {
      // A fresh page per asset releases GLTF textures, GPU buffers and renderer
      // state before the next model. This prevents large packs/vehicles from
      // poisoning later navigations with accumulated WebGL memory.
      page = await browser.newPage({
        viewport: { width: 1120, height: 820 },
        deviceScaleFactor: 1,
      });
      page.setDefaultTimeout(90000);
      page.on('pageerror', e => browserErrors.push(String(e.stack || e)));
      page.on('console', message => {
        if (message.type() === 'error') browserErrors.push(message.text());
      });
      page.on('requestfailed', request => failedRequests.push({
        url: request.url(),
        error: request.failure()?.errorText || 'unknown',
      }));

      const query = new URLSearchParams({ asset: url });
      const response = await page.goto(
        BASE + 'tools/asset-calibration-preview.html?' + query.toString(),
        { waitUntil: 'domcontentloaded', timeout: 90000 },
      );
      if (!response?.ok()) throw new Error(`Preview page returned HTTP ${response?.status()}`);
      await page.waitForFunction(
        () => window.__ASSET_CALIBRATION__?.ready === true || !!window.__ASSET_CALIBRATION__?.error,
        { timeout: 120000 },
      );
      const state = await page.evaluate(() => window.__ASSET_CALIBRATION__);
      if (!state?.ready) throw new Error(state?.error || 'Model did not become ready');
      report = state.report;

      for (const view of VIEWS) {
        await page.evaluate(name => window.__ASSET_CALIBRATION__.setView(name), view);
        await page.waitForTimeout(70);
        const filename = `${prefix}-${view}.png`;
        const outputPath = path.join(PREVIEW, filename);
        const bytes = await captureScreenshot(page, outputPath);
        screenshots.push({ view, path: 'previews/' + filename, bytes });
      }

      const kit = COMPONENT_KITS.find(item => item.pattern.test(relative));
      if (kit) {
        const candidates = report.meshDetails.filter(mesh => !mesh.collisionProxy && mesh.visibleAtLoad);
        for (const mesh of candidates) {
          const name = mesh.name || ('mesh-' + mesh.index);
          const componentPrefix = `${prefix}-part-${String(mesh.index + 1).padStart(2, '0')}-${slug(name).slice(-45)}`;
          const component = {
            index: mesh.index,
            name,
            nodePath: mesh.nodePath,
            dimensionsSourceUnits: mesh.dimensions,
            screenshots: [],
          };

          await page.evaluate(i => window.__ASSET_CALIBRATION__.setMeshIsolation(i), mesh.index);
          for (const view of kit.top ? ['iso', 'top'] : ['iso']) {
            await page.evaluate(name => window.__ASSET_CALIBRATION__.setView(name), view);
            await page.waitForTimeout(50);
            const filename = componentPrefix + '-' + view + '.png';
            const outputPath = path.join(PREVIEW, filename);
            const bytes = await captureScreenshot(page, outputPath);
            component.screenshots.push({ view, path: 'previews/' + filename, bytes });
          }
          componentScreenshots.push(component);
        }
        await page.evaluate(() => window.__ASSET_CALIBRATION__.restoreAllMeshes());
      }
    } catch (e) {
      error = String(e?.stack || e);
      console.error(`  FAILED: ${error.split('\n')[0]}`);
    } finally {
      if (page) await page.close().catch(() => {});
    }

    const sourceBytes = await fs.readFile(file);
    const d = report?.dimensions || null;
    const maximum = d ? Math.max(d.width, d.height, d.depth) : null;
    const minimum = d ? Math.min(d.width, d.height, d.depth) : null;
    const calibrationFlags = [];
    if (maximum !== null && maximum >= 1000) {
      calibrationFlags.push('Extent ≥ 1000 source units: verify unit conversion or model bounds');
    }
    if (minimum !== null && minimum > 0 && minimum < 0.05) {
      calibrationFlags.push('Smallest axis < 0.05 source units: inspect for export-scale or degenerate-geometry issues');
    }
    if (maximum !== null && maximum > 0 && minimum !== null && minimum > 0 && maximum / minimum > 100) {
      calibrationFlags.push('Aspect ratio > 100:1: confirm whether this is intentional geometry or stray outlier nodes');
    }

    const entry = {
      index,
      name: displayName,
      path: relative,
      url,
      sha256: createHash('sha256').update(sourceBytes).digest('hex'),
      fileBytes: sourceBytes.length,
      status: error ? (screenshots.length ? 'partial' : 'failed') : 'captured',
      error,
      ...(report || {}),
      dimensionsSourceUnits: d,
      screenshots,
      componentScreenshots,
      calibrationFlags,
      browserErrors: browserErrors.slice(beforeErrors),
      failedRequests: failedRequests.slice(beforeFailed),
      calibrationStatus: 'unverified',
      calibrationNote: 'Measured source bounds are not proof of metres. Do not change unitScale, targetH or targetLen without a trusted physical reference or confirmed source-unit evidence.',
    };
    records.push(entry);
    if (!error) {
      console.log(
        `  OK ${d.width.toFixed(3)} × ${d.height.toFixed(3)} × ${d.depth.toFixed(3)} source units`
        + ` | meshes=${report.meshCount} | col=${report.collisionProxyCount}`
        + ` | views=${screenshots.length} | isolated parts=${componentScreenshots.length}`,
      );
    }
  }

  const successful = records.filter(r => r.status === 'captured').length;
  const partial = records.filter(r => r.status === 'partial').length;
  const failed = records.filter(r => r.status === 'failed').length;
  const total = records.reduce((s, r) => s + (r.fileBytes || 0), 0);
  const output = {
    generatedAt: new Date().toISOString(),
    worldUnitConvention: '1 Three.js world unit = 1 metre, subject to source-unit verification',
    assetCount: records.length,
    capturedCount: successful,
    partialCount: partial,
    failedCount: failed,
    totalSourceBytes: total,
    screenshotViews: VIEWS,
    referenceObjects: [
      { id: 'human', heightMetres: 1.8 },
      { id: 'doorway', widthMetres: 1, heightMetres: 2.1 },
      { id: 'cube', widthMetres: 1, heightMetres: 1, depthMetres: 1 },
      { id: 'pole', heightMetres: 10, view: 'scale' },
    ],
    calibrationPolicy: 'No automatic scale correction. Capture, inspect, compare with a trusted real-world dimension, then register verified values.',
    browserErrors,
    failedRequests,
    assets: records,
  };
  await fs.writeFile(path.join(OUT, 'report.json'), JSON.stringify(output, null, 2) + '\n', 'utf8');
  const cards = records.map(makeCard).join('\n');
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Open World · Asset Calibration Captures</title><style>
    *{box-sizing:border-box}body{margin:0;padding:22px;background:#e5eae7;color:#18231d;font:13px/1.5 system-ui}header{margin:0 0 18px}h1{font-size:20px;margin:0}header p{color:#55665b}main{display:grid;grid-template-columns:repeat(auto-fill,minmax(330px,1fr));gap:13px}article{padding:12px;border:1px solid #c3cec5;border-radius:9px;background:#f8faf8;min-width:0}h2{font-size:14px;margin:0 0 4px;overflow-wrap:anywhere}.path{color:#617166;font-size:11px;overflow-wrap:anywhere}article p{font-size:11px}section{display:grid;grid-template-columns:repeat(2,1fr);gap:6px}a{color:#245b42}img{display:block;width:100%;aspect-ratio:16/10;object-fit:contain;background:#dfe5e8;border:1px solid #d1d9d3;border-radius:5px}small{display:block;text-align:center;color:#4c5d52}.warning{color:#7a5724}.components{line-height:1.7;overflow-wrap:anywhere}
  </style></head><body><header><h1>OPEN WORLD · Internal Asset Calibration</h1><p>${successful} complete · ${partial} partial · ${failed} failed from ${records.length} models · References: 1.8 m human / 2.1 m doorway / 1 m cube / 10 m pole in Scale view · <a href="report.json">JSON report</a></p></header><main>${cards}</main></body></html>`;
  await fs.writeFile(path.join(OUT, 'gallery.html'), html, 'utf8');

  console.log(JSON.stringify({
    output: OUT,
    total: records.length,
    captured: successful,
    partial,
    failed,
    screenshotCount: records.reduce((n, r) => n + r.screenshots.length
      + r.componentScreenshots.reduce((sum, part) => sum + part.screenshots.length, 0), 0),
  }, null, 2));
  if (failed || partial) process.exitCode = 1;
} finally {
  if (browser) await browser.close().catch(() => {});
  server.kill('SIGTERM');
  await new Promise(resolve => {
    if (server.exitCode !== null) return resolve();
    server.once('exit', resolve);
    setTimeout(() => {
      server.kill('SIGKILL');
      resolve();
    }, 3000).unref();
  });
}
