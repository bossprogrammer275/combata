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
  assert.equal(map.roads?.length, 21, 'expected the authored city, GRA lanes and split flyover approaches');
  assert.equal(map.roadModules?.length, 2, 'expected two imported long road-pack pieces in the residential lane');
  assert.deepEqual(map.roadModules.map(module => module.componentId), ['road-straight-long-01', 'road-straight-long-02']);
  assert.equal(map.glbAssets?.length, 93, 'unexpected GLB placement count for the first residential and market district build');
  const uniqueModelCount = new Set(map.glbAssets.map(a => a.url)).size;
  assert.equal(uniqueModelCount, 31, 'expected 31 distinct imported model assets in the district');
  assert.equal(map.glbAssets.filter(a => a.building).length, 22, 'expected the civic, commercial, school and expanded residential building set');
  assert.equal(map.districtPlots?.length, 11, 'expected six GRA compounds and five public/commercial plots');
  assert.equal(map.districtPlots.filter(plot => plot.type === 'residential-compound').length, 6,
    'all six residential buildings need their own compound plot');
  assert.ok(map.districtPlots.every(plot => plot.id && plot.width > 2 && plot.depth > 2
    && Number.isFinite(plot.x) && Number.isFinite(plot.z)),
    'district plots need stable IDs and metric dimensions');
  assert.ok(map.districtPlots.filter(plot => plot.type === 'residential-compound').every(plot =>
    plot.wallHeight >= 1.3 && plot.gateWidth >= 3.5 && plot.driveway?.width >= 3.5),
    'residential plots need compound boundaries and a vehicle gate/driveway');

  assert.equal(map.glbAssets.filter(a => a.url.includes('street_light')).length, 32, 'expected 32 streetlights');
  assert.equal(map.glbAssets.filter(a => a.tags?.includes('vegetation')).length, 27, 'expected 27 trees and landscape assets');
  for (const required of [
    'nigeria_duplex',
    'mosque.glb',
    'low_poly__school_building',
    'gas_station_5',
    'meed_grocery_store',
    'american_style_house',
    'residential_house_3',
    'brooklyn_street_twin_buildings_low_poly',
    'buildings/building/scene.gltf',
    'concrete_road_barrier_photoscanned',
  ]) {
    assert.ok(map.glbAssets.some(a => a.url.includes(required)), 'missing district asset: ' + required);
  }
  assert.equal(map.roads.filter(r => r.surface === 'modular-bridge').length, 2,
    'the two central bridge decks must use imported modular bridge geometry');
  assert.equal(map.bridgeAssemblies?.length, 2, 'both elevated crossings must assemble from the imported bridge kit');
  assert.equal(map.waterways?.length, 1, 'Fate Drainage Bridge needs its authored drainage channel and exposed bed');
  assert.equal(map.waterways[0].bankBottom, map.bridgeAssemblies.find(a => a.id === 'fate-drainage-bridge').foundationY,
    'drainage bridge supports must meet the visible channel bed datum');
  assert.ok(map.roads.filter(road => /^(Main City Flyover|Fate Drainage Bridge).*Approach/.test(road.name))
    .every(road => !road.flyover && !road.bridge && !road.guardrails),
    'bridge approaches must not add procedural bridge frames over the imported starter/deck modules');
  assert.ok(map.bridgeAssemblies.every(assembly =>
    assembly.components.every(component => component.componentId.startsWith('bridge-')),
  ), 'bridge assemblies must use only reusable components from the downloaded bridge pack');
  assert.equal(map.bridgeAssemblies.reduce((sum, assembly) => sum + assembly.sectionCount, 0), 21,
    'expected 21 bridge sections across the two elevated crossings');
  assert.equal(map.bridgeAssemblies.reduce((sum, assembly) => sum + assembly.components.length, 0), 42,
    'every bridge section must place its independent concrete and deck meshes separately');
  for (const assembly of map.bridgeAssemblies) {
    assert.equal(assembly.components.length, assembly.sectionCount * 2,
      assembly.id + ' must contain one support and one independent deck placement per section');
    assert.ok(assembly.components.every(component =>
      component.componentId && component.sectionId
      && Number.isFinite(component.deckY) && Number.isFinite(component.foundationY)
      && Number.isFinite(component.scaleX) && Number.isFinite(component.scaleZ)),
      assembly.id + ' components require metric deck/foundation datums and explicit horizontal scales');
    const sections = new Map();
    for (const component of assembly.components) {
      if (!sections.has(component.sectionId)) sections.set(component.sectionId, []);
      sections.get(component.sectionId).push(component);
    }
    assert.equal(sections.size, assembly.sectionCount, assembly.id + ' section IDs must be unique');
    for (const [sectionId, components] of sections) {
      assert.equal(components.length, 2, sectionId + ' must have two independent component placements');
      assert.equal(components.filter(component => component.componentId.endsWith('-structure')).length, 1,
        sectionId + ' must have one imported concrete support mesh');
      assert.equal(components.filter(component => component.componentId.endsWith('-deck')).length, 1,
        sectionId + ' must have one imported road/deck mesh');
      assert.equal(components[0].deckY, components[1].deckY, sectionId + ' deck datums disagree');
      assert.equal(components[0].foundationY, components[1].foundationY, sectionId + ' foundation datums disagree');
    }
    assert.equal([...sections.values()].filter(pair => pair.some(component => component.componentId.startsWith('bridge-end-ramp-'))).length, 2,
      assembly.id + ' must use the imported starter/end-ramp module at both ends');
    assert.equal([...sections.values()].filter(pair => pair.some(component => component.componentId.startsWith('bridge-pier-starter-'))).length, 1,
      assembly.id + ' must use its imported short pier-starter module');
  }
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

  assert.equal(report.roadCount, 21, 'runtime road count differs from authored map');
  assert.equal(report.bridgeKitParts.length, 10, 'all ten independent imported bridge mesh prefabs must load');
  assert.equal(report.bridgeSectionCount, 21, 'not all imported bridge sections reached the world');
  assert.equal(report.bridgeComponentCount, 42, 'each bridge section must render separate support and deck components');
  assert.equal(report.bridgeStructureCount, 21, 'every bridge section needs its own imported concrete support mesh');
  assert.equal(report.bridgeDeckComponentCount, 21, 'every bridge section needs its own independent imported deck mesh');
  assert.equal(report.bridgeImportedDeckCount, 21, 'every imported bridge deck must register its exact road physics mesh');
  assert.equal(report.bridgeImportedSupportCount, 21, 'every imported bridge support must register solid static collision');
  assert.equal(report.bridgeDeckPhysicsCount, 21,
    'all flyover approaches must use road ramps without procedural bridge deck meshes');
  assert.deepEqual(report.bridgeGroundContactFailures, [],
    'bridge pillars must meet their authored foundation plane: ' + JSON.stringify(report.bridgeGroundContactFailures));
  assert.ok(report.bridgeFootContactCount > 0,
    'imported support modules must expose individual footing contact patches');
  assert.deepEqual(report.bridgeFootContactFailures, [],
    'every measured bridge footing must meet visible ground or the drainage bed: ' + JSON.stringify(report.bridgeFootContactFailures));
  assert.deepEqual(report.bridgeDeckAlignmentFailures, [],
    'every bridge road surface must meet its authored metric deckY: ' + JSON.stringify(report.bridgeDeckAlignmentFailures));
  assert.equal(report.roadModuleCount, 2, 'both imported road-kit pieces must render');
  assert.equal(report.glbAssetCount, map.glbAssets.length, 'runtime GLB placement count differs from authored map');
  assert.equal(report.uniqueModelCount, new Set(map.glbAssets.map(a => a.url)).size, 'not all distinct imported model files loaded into cache');
  assert.equal(report.buildingCount, map.glbAssets.filter(a => a.building).length, 'some authored building GLBs did not load');
  assert.equal(report.districtPlotCount, 11, 'not all authored residential and market plots were built');
  assert.equal(report.districtCompoundCount, 6, 'all six residential lots must have boundary walls');
  assert.ok(report.districtPlotWallCount >= 36, 'compound walls and gate pillars were not generated');
  assert.equal(report.districtDrivewayCount, 6, 'each residential compound needs a driveway and pedestrian path');
  assert.equal(report.buildingInstanceCount, report.buildingCount,
    'World Kit did not register every placed building instance');
  assert.equal(report.buildingDoorCoverageCount, report.buildingCount,
    'every placed building must resolve a native or generated metric doorway');
  assert.equal(report.buildingCollisionCoverageCount, report.buildingCount,
    'every placed building must resolve native, sidecar or generated wall collision');
  assert.ok(report.generatedDoorMarkerCount > 0,
    'legacy downloaded buildings should receive hidden door_auto_* markers');
  assert.ok(report.generatedCollisionProxyMeshCount > 0,
    'legacy downloaded buildings should receive hidden col_auto_* collision proxies');
  assert.deepEqual(report.missingDoorAssets, [],
    'buildings missing doorway metadata: ' + report.missingDoorAssets.join(', '));
  assert.deepEqual(report.missingCollisionAssets, [],
    'buildings missing collision strategy: ' + report.missingCollisionAssets.join(', '));
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
    ['mainBridgeSide', 'city-a-main-flyover-side.png'],
    ['mainBridgeGround', 'city-a-main-bridge-ground-contact.png'],
    ['fateBridgeSide', 'city-a-fate-bridge-side.png'],
    ['fateBridgeGround', 'city-a-fate-bridge-ground-contact.png'],
    ['bridgeTop', 'city-a-bridge-top.png'],
    ['south', 'city-a-southern-blocks.png'],
    ['graMarket', 'city-a-first-district.png'],
    ['graResidential', 'city-a-gra-residential-closeup.png'],
    ['marketStreet', 'city-a-market-street-closeup.png'],
    ['roadKit', 'city-a-gra-road-kit.png'],
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
