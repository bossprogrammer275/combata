// Visual and structural review of every imported model under data/models/assets.
// Run with: node tools/verify-asset-review.mjs
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { glob } from 'glob';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const root = process.cwd();
const port = Number(process.env.ASSET_REVIEW_PORT || 4180);
const baseUrl = `http://127.0.0.1:${port}`;
const modelRoots = [
  {
    absolute: path.join(root, 'data', 'models', 'assets'),
    relative: 'data/models/assets',
    label: 'world assets',
  },
  {
    absolute: path.join(root, 'data', 'models', 'cars'),
    relative: 'data/models/cars',
    label: 'vehicle assets',
  },
];
const manifestPath = path.join(root, 'tools', 'asset-review-manifest.json');
const outputDir = path.join(root, 'artifacts', 'asset-review');
const previewDir = path.join(outputDir, 'previews');

const modelFiles = [];
for (const modelRoot of modelRoots) {
  assert.ok(existsSync(modelRoot.absolute), modelRoot.relative + ' does not exist');
  const candidates = await glob('**/*.{glb,gltf}', {
    cwd: modelRoot.absolute,
    nodir: true,
  });
  for (const relative of candidates) {
    const normalized = relative.replace(/\\/g, '/').toLowerCase();
    const isEntryPoint = normalized.endsWith('.glb') || path.basename(normalized) === 'scene.gltf';
    if (!isEntryPoint) continue;
    // Keep the intentionally excluded standalone road source out of the asset gallery.
    if (modelRoot.relative === 'data/models/assets' && normalized === 'road.glb') continue;
    modelFiles.push({ relative, modelRoot });
  }
}
modelFiles.sort((a, b) => {
  const pathA = a.modelRoot.relative + '/' + a.relative.replace(/\\/g, '/');
  const pathB = b.modelRoot.relative + '/' + b.relative.replace(/\\/g, '/');
  return pathA.localeCompare(pathB);
});

assert.ok(modelFiles.length > 0, 'No GLB or scene.gltf model entry points found');

const manifest = modelFiles.map(({ relative, modelRoot }, index) => {
  const normalizedRelative = relative.split(path.sep).join('/');
  const filePath = modelRoot.relative + '/' + normalizedRelative;
  const parent = path.basename(path.dirname(relative));
  const base = path.basename(relative, path.extname(relative));
  const rawName = base.toLowerCase() === 'scene' ? parent : base;
  const name = rawName.split(/[+_-]+/).filter(Boolean).join(' ').trim();
  const slug = filePath.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return {
    index,
    name: name || filePath,
    path: filePath,
    url: '/' + filePath,
    format: relative.toLowerCase().endsWith('.glb') ? 'glb' : 'gltf',
    slug,
    category: modelRoot.label,
  };
});

await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + String.fromCharCode(10), 'utf8');
await mkdir(previewDir, { recursive: true });

let server;
let browser;
let page;
const globalErrors = [];
const failedRequests = [];

try {
  server = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverOutput = '';
  server.stdout.on('data', (b) => { serverOutput += b.toString(); });
  server.stderr.on('data', (b) => { serverOutput += b.toString(); });

  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (server.exitCode != null) throw new Error('Preview server exited early:' + String.fromCharCode(10) + serverOutput);
    try {
      const response = await fetch(baseUrl + '/tools/asset-review.html');
      if (response.ok) { ready = true; break; }
    } catch {}
    await delay(250);
  }
  assert.ok(ready, 'Asset review server did not become ready:' + String.fromCharCode(10) + serverOutput);

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
  page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
  });

  page.on('pageerror', (error) => globalErrors.push(String(error.stack || error)));
  page.on('requestfailed', (request) => failedRequests.push({
    url: request.url(),
    error: request.failure()?.errorText || 'unknown',
  }));
  page.on('console', (message) => {
    if (message.type() === 'error') globalErrors.push(message.text());
  });

  await page.goto(baseUrl + '/tools/asset-review.html', {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });
  await page.waitForFunction(() => window.__ASSET_REVIEW__?.manifest?.length > 0, { timeout: 30000 });

  const reports = [];
  for (let index = 0; index < manifest.length; index++) {
    const entry = manifest[index];
    const beforeErrors = globalErrors.length;
    const beforeFailed = failedRequests.length;
    const screenshots = [];
    const componentScreenshots = [];
    const componentTopScreenshots = [];
    let report = null;
    let error = null;

    try {
      report = await page.evaluate(async (i) => {
        if (!window.__ASSET_REVIEW__?.loadAsset) throw new Error(window.__ASSET_REVIEW__?.error || 'Asset viewer not initialized');
        return await window.__ASSET_REVIEW__.loadAsset(i);
      }, index);

      await page.waitForTimeout(350);
      for (const view of ['iso']) {
        await page.evaluate(async (v) => window.__ASSET_REVIEW__.setView(v), view);
        await page.waitForTimeout(80);
        const filename = `${String(index + 1).padStart(2, '0')}-${entry.slug}-${view}.png`;
        const canvasBox = await page.locator('#asset-canvas').boundingBox();
        if (!canvasBox) throw new Error('Asset canvas is not visible for screenshot capture');
        await page.screenshot({
          path: path.join(previewDir, filename),
          clip: {
            x: Math.max(0, canvasBox.x),
            y: Math.max(0, canvasBox.y),
            width: canvasBox.width,
            height: canvasBox.height,
          },
          timeout: 10000,
          animations: 'disabled',
        });
        screenshots.push('previews/' + filename);
      }
      if (report.emptyBounds) error = 'Loaded but has empty or degenerate bounds';

      // Road Pack and Sidewalks are compound kits. Capture each imported child
      // mesh independently so its actual shape and scale can be reviewed.
      if (/data\/models\/assets\/(roads\/(road_pack|sidewalks|street_road)|others\/modular_bridge__low_poly__game_ready_)\/scene\.gltf$/i.test(entry.path)) {
        const meshCount = await page.evaluate(() => window.__ASSET_REVIEW__?.getMeshList?.().length || 0);
        for (let meshIndex = 0; meshIndex < meshCount; meshIndex++) {
          await page.evaluate((i) => {
            window.__ASSET_REVIEW__?.showAllMeshes?.();
            window.__ASSET_REVIEW__?.isolateMesh?.(i);
          }, meshIndex);
          await page.waitForTimeout(60);
          const suffix = String(meshIndex + 1).padStart(2, '0');
          const partFilename = String(index + 1).padStart(2, '0') + '-' + entry.slug + '-part-' + suffix + '.png';
          const partBox = await page.locator('#asset-canvas').boundingBox();
          if (!partBox) throw new Error('Asset canvas disappeared while capturing component ' + (meshIndex + 1));
          await page.screenshot({
            path: path.join(previewDir, partFilename),
            clip: {
              x: Math.max(0, partBox.x),
              y: Math.max(0, partBox.y),
              width: partBox.width,
              height: partBox.height,
            },
            timeout: 10000,
            animations: 'disabled',
          });
          componentScreenshots.push('previews/' + partFilename);
          if (/road_pack|modular_bridge/i.test(entry.path)) {
            await page.evaluate(async () => window.__ASSET_REVIEW__?.setView('top'));
            await page.waitForTimeout(70);
            const topFilename = String(index + 1).padStart(2, '0') + '-' + entry.slug + '-part-' + suffix + '-top.png';
            await page.screenshot({
              path: path.join(previewDir, topFilename),
              clip: {
                x: Math.max(0, partBox.x),
                y: Math.max(0, partBox.y),
                width: partBox.width,
                height: partBox.height,
              },
              timeout: 10000,
              animations: 'disabled',
            });
            componentTopScreenshots.push('previews/' + topFilename);
          }
        }
        await page.evaluate(() => window.__ASSET_REVIEW__?.showAllMeshes?.());
      }
    } catch (e) {
      error = String(e?.stack || e);
      await writeFile(
        path.join(previewDir, `${String(index + 1).padStart(2, '0')}-${entry.slug}-FAILED.txt`),
        error + String.fromCharCode(10),
        'utf8',
      );
    }

    reports.push({
      ...entry,
      ...(report || {}),
      error,
      screenshots,
      consoleErrors: globalErrors.slice(beforeErrors),
      failedRequests: failedRequests.slice(beforeFailed),
      componentScreenshots,
      componentTopScreenshots,
      loadStatus: error ? 'failed-or-invalid' : 'rendered',
    });

    console.log(
      `[${index + 1}/${manifest.length}] ${entry.path} · ` +
      (error ? 'FAILED: ' + error.split(String.fromCharCode(10))[0] : `${report.meshNodeCount} meshes · ${report.triangleCount} triangles`)
    );
  }

  const rendered = reports.filter((r) => r.loadStatus === 'rendered').length;
  const failed = reports.length - rendered;
  const totals = reports.reduce((acc, r) => {
    if (r.loadStatus !== 'rendered') return acc;
    acc.meshNodes += r.meshNodeCount || 0;
    acc.triangles += r.triangleCount || 0;
    acc.vertices += r.vertexCount || 0;
    acc.materials += r.materialCount || 0;
    acc.textures += r.textureCount || 0;
    return acc;
  }, { meshNodes: 0, triangles: 0, vertices: 0, materials: 0, textures: 0 });

  const report = {
    generatedAt: new Date().toISOString(),
    sourceRoots: modelRoots.map(modelRoot => modelRoot.relative),
    entryPointCount: manifest.length,
    renderedCount: rendered,
    failedCount: failed,
    totals,
    globalErrors,
    failedRequests,
    models: reports,
  };

  await writeFile(path.join(outputDir, 'report.json'), JSON.stringify(report, null, 2) + String.fromCharCode(10), 'utf8');

  const cards = reports.map((r) => {
    const image = r.screenshots[0] || '';
    const details = r.loadStatus === 'rendered'
      ? `${r.meshNodeCount} mesh nodes · ${(r.triangleCount || 0).toLocaleString()} triangles · ${r.dimensions?.join(' × ') || 'unknown'} m`
      : 'FAILED: ' + String(r.error || 'unknown').split('\\n')[0];
    const partLinks = (r.componentScreenshots || []).map((src, i) => '<a href="' + src + '">Part ' + (i + 1) + '</a>').join(' · ');
    const topLinks = (r.componentTopScreenshots || []).map((src, i) => '<a href="' + src + '">Top ' + (i + 1) + '</a>').join(' · ');
    return `<article><h2>${r.index + 1}. ${r.name}</h2><p>${r.path}</p>${image ? `<a href="${image}"><img src="${image}" loading="lazy"></a>` : ''}<p>${details}</p><p class="tiny">Meshes: ${(r.meshNames || []).slice(0, 16).join(' · ')}</p>${partLinks ? `<p class="tiny">SUBCOMPONENTS: ${partLinks}</p>` : ''}${topLinks ? `<p class="tiny">TOP VIEWS: ${topLinks}</p>` : ''}${r.screenshots?.[1] ? `<a href="${r.screenshots[1]}">Side view</a>` : ''}</article>`;
  }).join('\\n');

  const gallery = `<!doctype html><html><head><meta charset="utf-8"><title>Open World Asset Review</title><style>
  body{margin:0;padding:24px;background:#111713;color:#edf4ee;font:13px/1.5 system-ui}header{margin-bottom:20px}header strong{font-size:22px}main{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px}article{background:#1a241d;border:1px solid #34443a;border-radius:10px;padding:12px;min-width:0}h2{font-size:15px;margin:0 0 5px}p{color:#b8c8bd;overflow-wrap:anywhere;font-size:11px}img{width:100%;height:190px;object-fit:contain;background:#dfe5e8;border-radius:7px}.tiny{max-height:80px;overflow:auto}</style></head><body><header><strong>Open World · Asset Library Review</strong><p>${rendered}/${reports.length} models rendered · ${failed} failed · ${totals.meshNodes} mesh nodes · ${totals.triangles.toLocaleString()} triangles</p><a href="report.json">Full JSON report</a></header><main>${cards}</main></body></html>`;
  await writeFile(path.join(outputDir, 'index.html'), gallery, 'utf8');

  console.log('[asset review] ' + JSON.stringify({
    entryPoints: manifest.length,
    rendered,
    failed,
    totals,
    outputDir,
  }));

  // Asset issues are recorded for review, but do not fail all repository CI.
  if (globalErrors.length) console.warn('[asset review] browser errors: ' + globalErrors.length);
} catch (error) {
  console.error('[asset review] FAILED', error?.stack || error);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close().catch(() => {});
  if (server && server.exitCode == null) {
    server.kill('SIGTERM');
    await Promise.race([
      new Promise((resolve) => server.once('exit', resolve)),
      delay(3000),
    ]);
    if (server.exitCode == null) server.kill('SIGKILL');
  }
}
