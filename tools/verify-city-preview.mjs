// verify-city-preview.mjs — headless visual + structural check for city-a.
// Run with: node tools/verify-city-preview.mjs
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { WORLD_KIT_SECTION_LENGTH } from '../js/world-bridge-kit.js';

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
  assert.equal(map.roadModules?.length || 0, 0,
    'Road Pack geometry must be emitted by the road renderer, not manually overlaid on an existing road ribbon');
  assert.equal(map.glbAssets?.length, 294, 'unexpected GLB placement count for the expanded city and district build');
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

  assert.equal(map.glbAssets.filter(a => a.url.includes('street_light')).length, 87, 'expected 87 streetlights');
  assert.equal(map.glbAssets.filter(a => a.tags?.includes('vegetation')).length, 148, 'expected 148 trees and landscape assets');
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
  for (const assembly of map.bridgeAssemblies) {
    const entry = assembly.components.find(component =>
      component.componentId === 'bridge-end-ramp-deck' && component.sectionId.endsWith('section-01'));
    const exit = assembly.components.find(component =>
      component.componentId === 'bridge-end-ramp-deck'
      && component.sectionId.endsWith('section-' + String(assembly.sectionCount).padStart(2,'0')));
    assert.ok(entry && exit, assembly.id + ' needs an imported entry and exit ramp');
    const delta = Math.abs(Math.atan2(Math.sin(exit.yaw - entry.yaw), Math.cos(exit.yaw - entry.yaw)));
    assert.ok(Math.abs(delta - Math.PI) < 0.02,
      assembly.id + ' exit ramp must face opposite the entry ramp so the asymmetric slope is not backwards');
  }
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
    assert.equal([...sections.values()].filter(pair => pair.some(component => component.componentId.startsWith('bridge-pier-starter-'))).length, 0,
      assembly.id + ' must not use the incomplete short pier-starter module');
    const orderedSections = [...sections.values()];
    const sectionType = pair => {
      const componentId = pair.find(component => component.componentId.endsWith('-structure')).componentId;
      return componentId === 'bridge-straight-structure' ? 'bridge-straight-span' : componentId.replace(/-structure$/, '');
    };
    for (const pair of orderedSections) {
      const structureId = pair.find(component => component.componentId.endsWith('-structure'))?.componentId;
      const deckId = pair.find(component => component.componentId.endsWith('-deck'))?.componentId;
      assert.ok(structureId && deckId && structureId.replace(/-structure$/, '') === deckId.replace(/-deck$/, ''),
        'each bridge section must use a matching imported structure/deck pair');
      assert.ok(pair.every(component => Math.abs(component.x-pair[0].x)<1e-6
        && Math.abs(component.z-pair[0].z)<1e-6
        && Math.abs(component.yaw-pair[0].yaw)<1e-6
        && Math.abs(component.scaleX-pair[0].scaleX)<1e-6
        && Math.abs(component.scaleZ-pair[0].scaleZ)<1e-6),
        'the bridge deck and its side/support structure must share one placement transform');
    }
    assert.equal(orderedSections.filter(pair=>sectionType(pair)==='bridge-end-ramp').length,2,
      assembly.id+' needs two visible sloped end ramps');
    assert.equal(orderedSections.filter(pair=>sectionType(pair)==='bridge-straight-span').length,assembly.sectionCount-2,
      assembly.id+' must use complete straight spans between its ramps');
    for(let i=0;i<orderedSections.length-1;i++){
      const current=orderedSections[i][0],next=orderedSections[i+1][0];
      const currentType=sectionType(orderedSections[i]),nextType=sectionType(orderedSections[i+1]);
      const currentLength=WORLD_KIT_SECTION_LENGTH[currentType],nextLength=WORLD_KIT_SECTION_LENGTH[nextType];
      assert.ok(Number.isFinite(currentLength)&&Number.isFinite(nextLength),
        assembly.id+' contains a component without a measured longitudinal length');
      const pitch=(currentLength*current.scaleX+nextLength*next.scaleX)/2;
      // The imported end-ramp's high edge is local -X. Both end ramps are
      // rotated opposite the straight spans so this high edge faces inward.
      const travelSign=currentType==='bridge-end-ramp'?-1:1;
      const expectedX=Math.cos(current.yaw)*pitch*travelSign;
      const expectedZ=-Math.sin(current.yaw)*pitch*travelSign;
      assert.ok(Math.hypot((next.x-current.x)-expectedX,(next.z-current.z)-expectedZ)<=0.06,
        assembly.id+' has a deck gap/overlap between '+current.sectionId+' and '+next.sectionId);
      const yawDelta=Math.atan2(Math.sin(next.yaw-current.yaw),Math.cos(next.yaw-current.yaw));
      if(currentType==='bridge-end-ramp'){
        assert.ok(Math.abs(Math.abs(yawDelta)-Math.PI)<0.02,
          assembly.id+' entry ramp high edge must face inward toward the straight spans');
      }else{
        assert.ok(Math.abs(yawDelta)<0.02,
          assembly.id+' straight spans and the exit ramp must share the inward-facing high-edge orientation');
      }
    }
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
let context;
let page;
let video;
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
  await mkdir(outputDir, { recursive: true });
  context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    recordVideo: {
      dir: path.join(outputDir, 'video'),
      size: { width: 1280, height: 800 },
    },
  });
  page = await context.newPage();
  video = page.video();
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

  // Capture the bridge angles before assertions so a failed physical test
  // still leaves screenshots that can be inspected independently.
  await mkdir(outputDir, { recursive: true });
  const bridgeEvidence = [
    ['mainBridgeSide', 'city-a-main-flyover-side.png'],
    ['mainBridgeGround', 'city-a-main-bridge-ground-contact.png'],
    ['fateBridgeSide', 'city-a-fate-bridge-side.png'],
    ['fateBridgeGround', 'city-a-fate-bridge-ground-contact.png'],
    ['mainBridgeExit', 'city-a-main-bridge-exit.png'],
    ['fateBridgeExit', 'city-a-fate-bridge-exit.png'],
    ['mainBridgeDrive', 'city-a-main-bridge-driving-view.png'],
    ['fateBridgeDrive', 'city-a-fate-bridge-driving-view.png'],
  ];
  for (const [view, filename] of bridgeEvidence) {
    await page.evaluate(viewName => window.__CITY_PREVIEW__.setView(viewName), view);
    await page.waitForTimeout(450);
    await page.screenshot({ path: path.join(outputDir, filename), animations: 'disabled', timeout: 120000 });
  }

  const bridgeDriveability = await page.evaluate(async () => {
    const { Physics } = await import('/js/physics.js');
    const world = window.__CITY_PREVIEW__?.world;
    if (!world) throw new Error('City preview did not expose the constructed world');

    // Use the same imported deck triangles and Rapier ray query as the vehicle
    // suspension. Detect the real usable carriageway strips across each deck;
    // the middle of a divided bridge may be a concrete median, not a tyre path.
    await Physics.init();
    const physics = new Physics();
    physics.createWorld();
    const decks = (world.roadPhysicsMeshes || []).filter(surface =>
      surface.kind === 'bridge_deck'
      && surface.source === 'imported-bridge-component'
    );
    const registeredDeckColliders = physics.registerStaticRoadMeshes(decks);
    physics.step(1 / 60);

    const wheelHalfTrack = 0.82;
    const gridStep = 0.25;
    const minimumLaneWidth = wheelHalfTrack * 2 + 0.2;
    const failures = [];
    const laneSamples = [];
    const laneCountsByRoad = {};
    let probeCount = 0;
    let maxProfileError = 0;

    for (const chain of (world._roadChains || []).filter(item => item.surface === 'modular-bridge')) {
      const points = chain.pts || [];
      const total = points.slice(0, -1).reduce((sum, point, index) =>
        sum + Math.hypot(points[index + 1].x - point.x, points[index + 1].z - point.z), 0);
      const halfWidth = Math.max(2, (chain.W || 8) * 0.5 - 0.25);
      let travelled = 0;
      let laneCount = 0;

      for (let segment = 0; segment < points.length - 1; segment++) {
        const a = points[segment], b = points[segment + 1];
        const dx = b.x - a.x, dz = b.z - a.z;
        const length = Math.hypot(dx, dz);
        if (length < 1) continue;
        const samples = Math.max(2, Math.ceil(length / 10));
        const nx = -dz / length, nz = dx / length;

        for (let step = 0; step <= samples; step++) {
          const t = step / samples;
          const chainDistance = travelled + length * t;
          if (chainDistance < 2 || total - chainDistance < 2) continue;

          const centerX = a.x + dx * t, centerZ = a.z + dz * t;
          const expectedY = (Number(a.y) || 0)
            + ((Number(b.y) || 0) - (Number(a.y) || 0)) * t
            + (Number.isFinite(chain.roadY) ? chain.roadY : 0.06);
          const crossSection = [];

          for (let offset = -halfWidth; offset <= halfWidth + 1e-6; offset += gridStep) {
            const x = centerX + nx * offset, z = centerZ + nz * offset;
            const hit = physics.castRayDown(x, expectedY + 1.35, z, 1.8);
            const error = hit ? hit.point.y - expectedY : null;
            if (Number.isFinite(error)) maxProfileError = Math.max(maxProfileError, Math.abs(error));
            const surface = world.vehicleSurfaceAt(x, z, expectedY);
            const valid = !!hit && hit.normal.y >= 0.45
              && Math.abs(error) <= 0.24
              && surface && surface.surface !== 'offroad'
              && surface.distance <= halfWidth + 0.05;
            crossSection.push({ offset, valid });
            probeCount++;
          }

          const strips = [];
          let current = [];
          for (const sample of crossSection) {
            if (sample.valid) current.push(sample);
            else if (current.length) { strips.push(current); current = []; }
          }
          if (current.length) strips.push(current);

          const usableStrips = [];
          for (const strip of strips) {
            const first = strip[0].offset;
            const last = strip[strip.length - 1].offset;
            if (last - first < minimumLaneWidth) continue;

            const laneCenter = (first + last) * 0.5;
            const tyres = [-wheelHalfTrack, wheelHalfTrack].map(relative => {
              const offset = laneCenter + relative;
              const x = centerX + nx * offset, z = centerZ + nz * offset;
              const hit = physics.castRayDown(x, expectedY + 1.35, z, 1.8);
              const surface = world.vehicleSurfaceAt(x, z, expectedY);
              const error = hit ? hit.point.y - expectedY : null;
              return {
                offset, x, z,
                supported: !!hit && hit.normal.y >= 0.45 && Math.abs(error) <= 0.24,
                deckY: hit?.point?.y ?? null,
                normalY: hit?.normal?.y ?? null,
                routeDeckError: error,
                surface: surface?.surface ?? null,
                surfaceDistance: surface?.distance ?? null,
              };
            });

            if (tyres.every(tyre => tyre.supported
              && tyre.surface !== 'offroad'
              && tyre.surfaceDistance <= halfWidth + 0.05)) {
              usableStrips.push({ first, last, laneCenter, tyres });
            }
          }

          laneCount += usableStrips.length;
          if (!usableStrips.length) {
            failures.push({
              road: chain.name,
              center: [centerX, centerZ],
              routeY: expectedY,
              supportedOffsets: crossSection.filter(sample => sample.valid).map(sample => sample.offset),
              stripWidths: strips.map(strip => strip[strip.length - 1].offset - strip[0].offset),
            });
          } else if (laneSamples.length < 16) {
            laneSamples.push({
              road: chain.name,
              center: [centerX, centerZ],
              strips: usableStrips,
            });
          }
        }
        travelled += length;
      }
      laneCountsByRoad[chain.name] = laneCount;
    }

    physics.destroy();
    return {
      probeCount,
      importedDeckMeshCount: decks.length,
      registeredDeckColliders,
      maxProfileError,
      laneCountsByRoad,
      laneSamples,
      failures: failures.slice(0, 80),
    };
  });

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
  assert.equal(bridgeDriveability.importedDeckMeshCount, 21,
    'each imported bridge deck must be available to Rapier');
  assert.equal(bridgeDriveability.registeredDeckColliders, 21,
    'all imported bridge decks must become real Rapier static triangle colliders');
  assert.ok(bridgeDriveability.probeCount > 500,
    'the full width of both crossings must be sampled at regular intervals');
  assert.ok(bridgeDriveability.maxProfileError <= 0.24,
    'route heights must stay within suspension travel of the actual ramp/deck mesh: '+bridgeDriveability.maxProfileError);
  assert.ok(Object.values(bridgeDriveability.laneCountsByRoad).every(count => count > 0),
    'each bridge must provide a carriageway wide enough for a car and two tyres: '+JSON.stringify(bridgeDriveability.laneCountsByRoad));
  assert.deepEqual(bridgeDriveability.failures, [],
    'each bridge cross-section must contain at least one continuous car-width strip with two Rapier-supported tyres: '+JSON.stringify(bridgeDriveability.failures));
  assert.deepEqual(report.bridgeGroundContactFailures, [],
    'bridge support footing patches must meet terrain or channel-bed elevation: ' + JSON.stringify(report.bridgeGroundContactFailures));
  assert.ok(report.bridgeFootContactCount > 0,
    'imported support modules must expose individual footing contact patches');
  assert.deepEqual(report.bridgeFootContactFailures, [],
    'every measured bridge footing must meet visible ground or the drainage bed: ' + JSON.stringify(report.bridgeFootContactFailures));
  assert.deepEqual(report.bridgeDeckAlignmentFailures, [],
    'every bridge road surface must meet its authored metric deckY: ' + JSON.stringify(report.bridgeDeckAlignmentFailures));
  assert.ok(report.roadPackPrefabCount === 6,
    'the road renderer must load all six imported Road Pack surface components');
  assert.equal(report.roadPackRoadCount + report.roadPackRoadSkippedNames.length, 19,
    'every non-bridge authored street must render or be intentionally absorbed into a same-level junction');
  assert.equal(report.roadPackRoadCount, 18,
    '18 standalone road chains should render; the short access connector is consumed by its junction');
  assert.deepEqual(report.roadPackRoadSkippedNames, ['Innovation Hub Access'],
    'only the short Revenue House access connector may be fully absorbed into a nearby junction');
  assert.ok(report.roadModuleCount > 100,
    'Road Pack surfaces must be tiled along the city roads rather than stretched over an entire street');
  assert.ok(report.roadPackSurfaceMeshCount >= 2,
    'imported Road Pack material variants should be merged into visible road meshes');
  assert.ok(report.roadPackJunctionCount > 0,
    'road tiles must stop at intersections and be replaced by clean asphalt junction aprons');
  assert.equal(report.legacyRoadSurfaceCount, 0,
    'City A must not render the previous procedural asphalt road texture');
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
    ['roadPackBoulevard', 'city-a-road-pack-boulevard.png'],
    ['roadPackResidential', 'city-a-road-pack-residential.png'],
    ['mainBridgeExit', 'city-a-main-bridge-exit.png'],
    ['fateBridgeExit', 'city-a-fate-bridge-exit.png'],
    ['mainBridgeDrive', 'city-a-main-bridge-driving-view.png'],
    ['fateBridgeDrive', 'city-a-fate-bridge-driving-view.png'],
  ];
  for (const [view, filename] of shots) {
    await page.evaluate(viewName => window.__CITY_PREVIEW__.setView(viewName), view);
    await page.waitForTimeout(900);
    await page.screenshot({ path: path.join(outputDir, filename), animations: 'disabled', timeout: 120000 });
  }
  const finalReport = {
    ...report,
    bridgeDriveability,
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
  if (page && !page.isClosed()) await page.close().catch(() => {});
  if (video) {
    await video.saveAs(path.join(outputDir, 'bridge-assembly-inspection.webm')).catch(error =>
      console.error('[city preview] bridge video save failed:', String(error)));
  }
  if (context) await context.close().catch(() => {});
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
