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
  assert.equal(map.roads?.length, 28, 'expected the complete authored 28-road network');
  assert.equal(map.glbAssets?.length, 82, 'unexpected GLB placement count');
  assert.equal(new Set(map.glbAssets.map(a => a.url)).size, 6, 'all placements should reuse the six bundled GLB models');
  assert.equal(map.glbAssets.filter(a => a.building).length, 22, 'expected 22 building models');
  assert.equal(map.glbAssets.filter(a => a.url.includes('street_light')).length, 32, 'expected 32 streetlights');
  assert.equal(map.glbAssets.filter(a => a.tags?.includes('vegetation')).length, 28, 'expected 28 tree instances');
  assert.equal(map.roads.filter(r => r.flyover || r.bridge).length, 2, 'expected two rideable elevated crossings');
  assert.equal(map.spawns?.length || 0, 0, 'enemy/pedestrian spawn list must be empty');
  assert.equal(map.cover?.length || 0, 0, 'no combat cover points should be authored');
  assert.equal(map.loot?.length || 0, 0, 'loot box list must be empty');
  assert.equal(map.vehicles?.length, 3, 'three vehicle physics test cars should be available');
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
  page.on('console', msg => { if (msg.type() === 'error') pageErrors.push(msg.text()); });
  page.on('requestfailed', req => pageErrors.push('Request failed: ' + req.url() + ' — ' + (req.failure()?.errorText || 'unknown')));

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

  assert.equal(report.roadCount, 28, 'runtime road count differs from authored map');
  assert.equal(report.glbAssetCount, 82, 'runtime GLB placement count differs from authored map');
  assert.equal(report.uniqueModelCount, 6, 'not all unique GLB files loaded into cache');
  assert.equal(report.buildingCount, 22, 'some building GLBs did not load');
  assert.equal(report.spawnPointCount, 0, 'runtime generated enemy/pedestrian spawn points');
  assert.equal(report.lootPointCount, 0, 'runtime generated loot crates');
  assert.equal(report.errors.length, 0, 'preview logged a model/runtime error: ' + report.errors.join('\n'));
  assert.equal(pageErrors.length, 0, 'browser emitted errors:\n' + pageErrors.join('\n'));

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
      await writeFile(path.join(outputDir, 'debug.json'), JSON.stringify({ diagnostics, pageErrors }, null, 2) + '\\n');
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
