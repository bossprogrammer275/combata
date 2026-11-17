// verify-city-preview.mjs — headless visual + structural check for city-a.
// Run with: node tools/verify-city-preview.mjs
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const root = process.cwd();
const port = Number(process.env.CITY_PREVIEW_PORT || 4177);
const baseUrl = `http://127.0.0.1:${port}`;
const outputDir = path.join(root, 'artifacts', 'city-a-preview');
const mapPath = path.join(root, 'data', 'worlds', 'city-a.json');
const map = JSON.parse(await readFile(mapPath, 'utf8'));

function checkMapContract() {
  assert.equal(map.id, 'city-a', 'wrong map id');
  assert.equal(map.disableAutoSpawns, true, 'compact exploration map must disable all automatic spawns');
  assert.equal(map.roads?.length, 16, 'expected the compact authored 16-road network');
  assert.equal(map.glbAssets?.length, 88, 'unexpected GLB placement count for the Ilorin district block');
  const uniqueModelCount = new Set(map.glbAssets.map(a => a.url)).size;
  assert.equal(uniqueModelCount, 26, 'expected 26 distinct imported model assets in the district');
  assert.equal(map.glbAssets.filter(a => a.building).length, 18, 'expected the civic, commercial, school and residential building set');
  assert.equal(map.glbAssets.filter(a => a.url.includes('street_light')).length, 32, 'expected 32 streetlights');
  assert.equal(map.glbAssets.filter(a => a.tags?.includes('vegetation')).length, 27, 'expected 27 trees and landscape assets');
  for (const required of ['nigeria_duplex', 'mosque.glb', 'low_poly__school_building', 'gas_station_5', 'meed_grocery_store']) {
    assert.ok(map.glbAssets.some(a => a.url.includes(required)), 'missing district asset: ' + required);
  }
  assert.equal(map.roads.filter(r => r.flyover || r.bridge).length, 2, 'expected two rideable elevated crossings');
  assert.equal(map.spawns?.length || 0, 0, 'enemy/pedestrian spawn list must be empty');
  assert.equal(map.cover?.length || 0, 0, 'no combat cover points should be authored');
  assert.equal(map.loot?.length || 0, 0, 'loot box list must be empty');
  assert.equal(map.vehicles?.length, 4, 'four vehicle physics test cars should be available');
  assert.ok(map.vehicles.some(vehicle => vehicle.kind === 'escalade'), 'Cadillac Escalade should be in the starter garage');
  for (const asset of map.glbAssets) {
    const local = path.join(root, asset.url.replace(/^\.\//, ''));
    assert.ok(existsSync(local), `missing GLB: ${asset.url}`);
  }
}
checkMapContract();

let server;
let browser;
let page;
const pageErrors = [];
const failedResponses = [];
const failedRequests = [];
try {
  server = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverOutput = '';
  server.stdout.on('data', b => { serverOutput += b.toString(); });
  server.stderr.on('data', b => { serverOutput += b.toString(); });
  let ready = false;
  for (let i = 0; i < 80; i++) {
    if (server.exitCode != null) throw new Error('Preview server exited early:\n' + serverOutput);
    try {
      const response = await fetch(baseUrl + '/tools/city-preview.html');
      if (response.ok) { ready = true; break; }
    } catch {}
    await delay(250);
  }
  assert.ok(ready, 'local preview server did not become ready:\n' + serverOutput);

  browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--disable-gpu-sandbox'] });
  page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
  });
  page.on('pageerror', e => pageErrors.push(String(e.stack || e)));
  page.on('console', msg => {
    if (msg.type() !== 'error') return;
    const message = msg.text();
    // The generic 404 console line omits its URL. Capture it from responses
    // and let the world finish loading before deciding the resource is fatal.
    if (!/Failed to load resource: the server responded with a status of 404/i.test(message)) pageErrors.push(message);
  });
  page.on('response', response => {
    if (response.status() >= 400) failedResponses.push({ status: response.status(), url: response.url() });
  });
  page.on('requestfailed', req => failedRequests.push({ url: req.url(), error: req.failure()?.errorText || 'unknown' }));

  await page.goto(baseUrl + '/tools/city-preview.html', { waitUntil: 'domcontentloaded', timeout: 30000 });
  let preview = null;
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    if (pageErrors.length) throw new Error('Browser failed before preview booted:\\n' + pageErrors.join('\\n'));
    preview = await page.evaluate(() => {
      const value = window.__CITY_PREVIEW__;
      return value ? { ready: value.ready, error: value.error, report: value.report } : null;
    });
    if (preview?.ready === true) break;
    if (preview?.ready === false) throw new Error('Preview initialization failed: ' + preview.error);
    await page.waitForTimeout(500);
  }
  if (!preview?.ready) throw new Error('Timed out waiting for the real GLB scene; status=' + await page.locator('#status').textContent());
  const report = preview.report;

  assert.equal(report.roadCount, 16, 'runtime road count differs from authored map');
  assert.equal(report.glbAssetCount, map.glbAssets.length, 'runtime GLB placement count differs from authored map');
  assert.equal(report.uniqueModelCount, new Set(map.glbAssets.map(a => a.url)).size, 'not all distinct imported model files loaded into cache');
  assert.equal(report.buildingCount, map.glbAssets.filter(a => a.building).length, 'some authored building GLBs did not load');
  assert.equal(report.spawnPointCount, 0, 'runtime generated enemy/pedestrian spawn points');
  assert.equal(report.lootPointCount, 0, 'runtime generated loot crates');
  assert.equal(report.errors.length, 0, 'preview logged a model/runtime error: ' + report.errors.join('\n'));
  assert.equal(pageErrors.length, 0, 'browser emitted errors:\n' + pageErrors.join('\n'));
  const optionalCollisionSidecars = failedResponses.filter(response =>
    response.status === 404 && /_col\.json(?:$|[?#])/i.test(response.url)
  );
  const unexpectedHttpFailures = failedResponses.filter(response => !optionalCollisionSidecars.includes(response));
  assert.equal(unexpectedHttpFailures.length, 0,
    'Required city resources failed to load: ' + JSON.stringify(unexpectedHttpFailures, null, 2));
  assert.equal(failedRequests.length, 0, 'network requests failed while loading the city: ' + JSON.stringify(failedRequests, null, 2));

  await mkdir(outputDir, { recursive: true });
  const shots = [
    ['overview', 'city-a-overview.png'],
    ['civic', 'city-a-civic-landmarks.png'],
    ['boulevard', 'city-a-street-level.png'],
    ['flyover', 'city-a-flyovers.png'],
    ['south', 'city-a-southern-blocks.png'],
  ];
  for (const [view, filename] of shots) {
    await page.evaluate(viewName => window.__CITY_PREVIEW__.setView(viewName), view);
    await page.waitForTimeout(900);
    await page.screenshot({ path: path.join(outputDir, filename), animations: 'disabled', timeout: 120000 });
  }
  const finalReport = {
    ...report,
    assetWarnings: report.warningCount,
    collisionSidecarFallbacks: optionalCollisionSidecars.length,
    screenshotFiles: shots.map(([, filename]) => filename),
    noPeople: report.spawnPointCount === 0,
    noLoot: report.lootPointCount === 0,
    validation: 'passed',
  };
  await writeFile(path.join(outputDir, 'report.json'), JSON.stringify(finalReport, null, 2) + '\n');
  console.log('[city preview] ' + JSON.stringify(finalReport));
  console.log('[city preview] ALL CHECKS PASSED');
} catch (error) {
  console.error('[city preview] FAILED', error?.stack || error);
  if (page) {
    try {
      await mkdir(outputDir, { recursive: true });
      await page.screenshot({ path: path.join(outputDir, 'city-a-debug-failure.png'), animations: 'disabled', timeout: 60000 });
      const diagnostics = await page.evaluate(() => ({
        status: document.querySelector('#status')?.textContent || '',
        preview: window.__CITY_PREVIEW__ ? { ready: window.__CITY_PREVIEW__.ready, error: window.__CITY_PREVIEW__.error, report: window.__CITY_PREVIEW__.report } : null,
      })).catch(() => null);
      await writeFile(path.join(outputDir, 'debug.json'), JSON.stringify({ diagnostics, pageErrors, failedResponses, failedRequests }, null, 2) + '\\n');
    } catch (diagnosticError) { console.error('[city preview] diagnostic capture failed', String(diagnosticError)); }
  }
  process.exitCode = 1;
} finally {
  if (browser) await browser.close().catch(() => {});
  if (server && server.exitCode == null) {
    server.kill('SIGTERM');
    await Promise.race([
      new Promise(resolve => server.once('exit', resolve)),
      delay(3000),
    ]);
    if (server.exitCode == null) server.kill('SIGKILL');
  }
}
