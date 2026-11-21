// Run the real vehicle loader and VehicleSystem in a disposable Playwright browser.
// Screenshots/reports are written only to artifacts/vehicle-visual-test for this run.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const OUT=path.join(ROOT,'artifacts','vehicle-visual-test');
const PORT=4175;
const BASE=`http://127.0.0.1:${PORT}/`;
const server=spawn(process.execPath,['server.js'],{
  cwd:ROOT,
  env:{...process.env,PORT:String(PORT)},
  stdio:['ignore','ignore','pipe'],
});
let browser=null;
let failures=0;
const errors=[];
const reportWheelSummary=[];
function check(name,condition,detail=''){
  if(condition)console.log(`PASS ${name}${detail?' · '+detail:''}`);
  else{failures++;console.error(`FAIL ${name}${detail?' · '+detail:''}`);}
}
async function waitForServer(){
  for(let i=0;i<150;i++){
    try{const response=await fetch(BASE+'api/scenes');if(response.ok)return;}
    catch{}
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  throw new Error('Temporary game server did not start');
}
async function capture(page,name){
  const file=path.join(OUT,name+'.png');
  await page.screenshot({path:file,fullPage:true,animations:'disabled'});
  const stat=await fs.stat(file);
  check(name+' screenshot saved',stat.size>15000,`${stat.size} bytes`);
  return {file:path.basename(file),bytes:stat.size};
}

try{
  await fs.rm(OUT,{recursive:true,force:true});
  await fs.mkdir(OUT,{recursive:true});
  await waitForServer();
  browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  const page=await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:1});
  page.on('pageerror',error=>errors.push('pageerror: '+error.message));
  page.on('console',message=>{if(message.type()==='error')errors.push('console: '+message.text());});
  page.on('requestfailed',request=>errors.push('request failed: '+request.url()+' '+request.failure()?.errorText));
  const response=await page.goto(BASE+'tools/vehicle-visual-test.html',{waitUntil:'load',timeout:60000});
  check('visual test page loaded',!!response&&response.ok(),String(response?.status()));
  await page.waitForFunction(()=>window.__vehicleVisualTest?.ready===true,{timeout:30000});

  const soundSmoke = await page.evaluate(async () => {
    const ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
    const length = ctx.sampleRate * 2;
    const noiseBuffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    const destination = ctx.createGain();
    destination.gain.value = 0;
    destination.connect(ctx.destination);
    const { SoundEngineGlobal } = await import('/js/soundEngineGlobal.js');
    const manager = new SoundEngineGlobal({ ctx, destination, noiseBuffer });
    const fixtures = [
      {
        vehicle: { kind: 'lambo' },
        telemetry: { rpm: 4200, speed: 22, gear: 3, throttle: 0.65, shiftTimer: 0, dt: 1 / 60 },
        expected: 4200,
      },
      {
        vehicle: { kind: 'bugatti' },
        telemetry: { rpm: 5100, speed: 31, gear: 4, throttle: 0.8, boost: 0.72, shiftTimer: 0, dt: 1 / 60 },
        expected: 5100,
      },
      {
        vehicle: { kind: 'cybertruck' },
        telemetry: { rpm: 6800, motorRpm: 6800, speed: 17, throttle: 0.7, driveDemand: 0.75, regenLevel: 0, dt: 1 / 60 },
        expected: 6800,
      },
      {
        vehicle: { kind: 'escalade' },
        telemetry: { rpm: 2800, speed: 15, gear: 3, throttle: 0.58, engineLoad: 0.58, shiftTimer: 0, dt: 1 / 60 },
        expected: 2800,
      },
    ];
    const results = [];
    for (const fixture of fixtures) {
      const ok = manager.update(fixture.vehicle, fixture.telemetry);
      const state = manager.getActiveState();
      results.push({
        kind: fixture.vehicle.kind,
        ok,
        stateRpm: state?.rpm ?? state?.mrpm,
        expected: fixture.expected,
        running: !!state?.on,
      });
    }

    // Exercise the same non-loop scenarios used in the live car: upshift,
    // downshift/rev-match, W16 boost/tunnel reverb, and EV lift-off regen.
    const lambo = fixtures[0].vehicle;
    manager.update(lambo, {
      rpm: 7600, speed: 40, gear: 4, throttle: 0.9,
      shiftTimer: 0.24, shiftDirection: 'up', dt: 1 / 60,
    });
    const lamboUpshift = manager.getActiveState();
    manager.update(lambo, {
      rpm: 5200, speed: 33, gear: 3, throttle: 0.15,
      shiftTimer: 0.276, shiftDirection: 'down', interior: true, dt: 1 / 60,
    });
    const lamboDownshift = manager.getActiveState();

    const chiron = fixtures[1].vehicle;
    manager.setEnvironment('bugatti', 'tunnel');
    manager.update(chiron, {
      rpm: 5900, speed: 52, gear: 5, throttle: 0.82,
      boost: 0.86, shiftTimer: 0, interior: false, dt: 1 / 60,
      environment: 'tunnel', revLimiter: false,
    });
    const chironBoost = manager.getActiveState();

    const tesla = fixtures[2].vehicle;
    manager.update(tesla, {
      rpm: 6800, motorRpm: 6800, speed: 17, throttle: 0,
      driveMode: 'awd', driveDemand: 0, regenLevel: 0.164,
      interior: true, dt: 1 / 60,
    });
    const teslaRegen = manager.getActiveState();

    const escalade = fixtures[3].vehicle;
    manager.update(escalade, {
      rpm: 4200, speed: 22, gear: 4, throttle: 0.82,
      shiftTimer: 0.34, shiftDirection: 'up', interior: false, dt: 1 / 60,
    });
    const escaladeShift = manager.getActiveState();
    const scenarios = {
      lamboUpshift: lamboUpshift?.gear === 4 && lamboUpshift?.shift > 0,
      lamboDownshift: lamboDownshift?.gear === 3 && lamboDownshift?.down === true && lamboDownshift?.cab === true,
      chironBoostTunnel: chironBoost?.boost > 0.8 && chironBoost?.env === 'tunnel',
      teslaDualMotorRegen: teslaRegen?.mode === 'awd' && teslaRegen?.ts < 0 && teslaRegen?.cab === true,
      escaladeAutomaticShift: escaladeShift?.gear === 4 && escaladeShift?.shift > 0,
    };
    manager.dispose();
    const contextClosed = await Promise.race([
      ctx.close().then(() => true, () => false),
      new Promise(resolve => setTimeout(() => resolve(false), 800)),
    ]);

    // Ultra-low keeps music and ordinary effects off, but entering a car must
    // force-create the shared context so the dedicated engine still plays.
    const { GameAudio } = await import('/js/audio.js');
    const ultraLowAudio = new GameAudio('ultra-low');
    ultraLowAudio.init();
    const normalUltraLowInitStaysDisabled = ultraLowAudio.ctx === null;
    ultraLowAudio.resume();
    const ultraLowTelemetry = {
      rpm: 3200, speed: 14, gear: 2, throttle: 0.6,
      shiftTimer: 0, dt: 1 / 60,
    };
    const ultraLowStartsVehicle = !!ultraLowAudio.ctx
      && ultraLowAudio.updateVehicleEngine({ kind: 'lambo' }, ultraLowTelemetry)
      && !!ultraLowAudio.vehicleSoundEngines?.getActiveState()?.on;
    ultraLowAudio.stopEngine();
    const ultraLowContextClosed = await Promise.race([
      ultraLowAudio.ctx?.close().then(() => true, () => false) || Promise.resolve(false),
      new Promise(resolve => setTimeout(() => resolve(false), 800)),
    ]);
    return {
      results, scenarios, contextClosed,
      ultraLow: {
        normalUltraLowInitStaysDisabled,
        startsVehicle: ultraLowStartsVehicle,
        contextClosed: ultraLowContextClosed,
      },
    };
  });
  check('all authored vehicle sound graphs build and accept live telemetry',
    soundSmoke.results.length === 4
      && soundSmoke.results.every(item => item.ok && item.running && Math.abs(item.stateRpm - item.expected) < 1),
    JSON.stringify(soundSmoke.results));
  check('authored shift, boost/tunnel and regen/cabin sound scenarios respond',
    Object.values(soundSmoke.scenarios).every(Boolean),
    JSON.stringify(soundSmoke.scenarios));
  check('vehicle sound smoke test disposes its AudioContext',
    soundSmoke.contextClosed === true);
  check('Ultra-low keeps ambient audio disabled but starts the dedicated vehicle engine',
    soundSmoke.ultraLow.normalUltraLowInitStaysDisabled
      && soundSmoke.ultraLow.startsVehicle
      && soundSmoke.ultraLow.contextClosed,
    JSON.stringify(soundSmoke.ultraLow));

  const configs=[
    {kind:'lambo',expectedHeight:0.98,expectedFov:82,prefix:'lamborghini'},
    {kind:'cybertruck',expectedHeight:1.42,expectedFov:82,prefix:'cybertruck'},
    {kind:'bugatti',expectedHeight:0.94,expectedFov:82,prefix:'bugatti-chiron'},
    {kind:'escalade',expectedHeight:1.36,expectedFov:82,prefix:'cadillac-escalade'},
  ];
  for(const spec of configs){
    const base=await page.evaluate(async kind=>await window.__vehicleVisualTest.load(kind),spec.kind);
    check(spec.kind+' loads through the actual VehicleSystem',base.meshCount>0,'meshes='+base.meshCount);
    console.log('VEHICLE MESH INVENTORY '+JSON.stringify({
      kind:spec.kind, rootDimensions:base.rootDimensions,
      namedCabinMeshes:base.cabinMeshes, meshNameSamples:base.meshNameSamples,
      interactionMeshes:base.interactionMeshes,
    }));
    const interactionInventory=await page.evaluate(()=>window.__vehicleVisualTest.showInteractionDiagnostics());
    console.log('VEHICLE SEAT/DOOR AUDIT '+JSON.stringify({kind:spec.kind,seats:interactionInventory.seats,doors:interactionInventory.doors,inventory:interactionInventory.inventory}));
    await capture(page,spec.prefix+'-seat-door-anchor-audit');
    const entryStart=await page.evaluate(async kind=>window.__vehicleVisualTest.startEntry(kind),spec.kind);
    check(spec.kind+' loads all player interaction animations',
      entryStart.actionDurations.enter>0&&entryStart.actionDurations.exit>0&&entryStart.actionDurations.punch>0,
      JSON.stringify(entryStart.actionDurations));
    check(spec.kind+' exposes a driver-seat entry target',entryStart.entryStarted,JSON.stringify(entryStart));
    await page.evaluate(()=>window.__vehicleVisualTest.advanceTransition(72));
    await capture(page,spec.prefix+'-enter-animation');
    let transition=await page.evaluate(()=>window.__vehicleVisualTest.advanceTransition(600));
    check(spec.kind+' completes the enter transition and parents the actual rig to its vehicle',
      transition.driving&&transition.playerParentIsVehicle,
      JSON.stringify(transition));
    await capture(page,spec.prefix+'-seated');
    const exit=await page.evaluate(()=>window.__vehicleVisualTest.startExit());
    check(spec.kind+' starts the real exit animation',exit.started,JSON.stringify(exit));
    await page.evaluate(()=>window.__vehicleVisualTest.advanceTransition(72));
    await capture(page,spec.prefix+'-exit-animation');
    transition=await page.evaluate(()=>window.__vehicleVisualTest.advanceTransition(600));
    const finished=await page.evaluate(()=>window.__vehicleVisualTest.finishInteractionTest());
    check(spec.kind+' completes exit and restores player world collision state',
      finished.exited&&finished.restoredToScene,
      JSON.stringify({transition,finished}));
    await capture(page,spec.prefix+'-after-exit');
    check(spec.kind+' has four road-wheel rigs',base.wheelCount===4,'wheels='+base.wheelCount);
    const wheelDiagnostics=base.wheelDiagnostics;
    const expectedQuadrants=['front-left','front-right','rear-left','rear-right'];
    check(spec.kind+' detector selects one wheel in each corner',
      wheelDiagnostics.selectedWheelCount===4
      && expectedQuadrants.every(q=>wheelDiagnostics.selectedWheels.some(w=>w.quadrant===q)),
      'candidates='+wheelDiagnostics.candidateCount+' attached meshes='+wheelDiagnostics.attachedWheelMeshCount);
    check(spec.kind+' every selected wheel has actual GLB meshes attached',
      wheelDiagnostics.selectedWheels.every(w=>w.meshCount>0),
      wheelDiagnostics.selectedWheels.map(w=>w.quadrant+':'+w.meshCount).join(', '));
    if(spec.kind==='cybertruck'){
      check('Cybertruck captures all 120 segmented tread meshes on every tyre',
        Math.abs(wheelDiagnostics.wheelMemberRadius-0.45)<1e-9
          && wheelDiagnostics.treadFragmentMeshCount===480
          && wheelDiagnostics.selectedWheels.every(w=>w.meshCount>=132&&w.treadFragmentCount===120),
        'radius='+wheelDiagnostics.wheelMemberRadius
          +' tread='+wheelDiagnostics.treadFragmentMeshCount
          +' members='+wheelDiagnostics.selectedWheels.map(w=>w.meshCount+' ('+w.treadFragmentCount+' tread)').join('/'));
    }else if(spec.kind==='lambo'){
      check('Lamborghini keeps the tighter 0.30m wheel-member grouping radius',
        Math.abs(wheelDiagnostics.wheelMemberRadius-0.30)<1e-9,
        'radius='+wheelDiagnostics.wheelMemberRadius);
    }else if(spec.kind==='bugatti'){
      check('Bugatti uses its own measured wheel-member grouping radius',
        Math.abs(wheelDiagnostics.wheelMemberRadius-0.42)<1e-9,
        'radius='+wheelDiagnostics.wheelMemberRadius);
    }else if(spec.kind==='escalade'){
      check('Escalade uses its own model-specific tyre/rim assembly grouping',
        Math.abs(wheelDiagnostics.wheelMemberRadius-0.48)<1e-9
          && Math.abs(wheelDiagnostics.wheelMemberHeightTolerance-0.55)<1e-9,
        'radius='+wheelDiagnostics.wheelMemberRadius+' height='+wheelDiagnostics.wheelMemberHeightTolerance);
    }
    console.log('WHEEL DETECTOR '+JSON.stringify({
      kind:spec.kind,
      candidateSizeLimit:wheelDiagnostics.candidateSizeLimit,
      wheelMemberMaxSize:wheelDiagnostics.wheelMemberMaxSize,
      selectedWheels:wheelDiagnostics.selectedWheels,
      rejectedBySizeOrShape:wheelDiagnostics.meshes.filter(m=>m.rejectedReasons.some(reason=>/size|diameter|round|thin-axled/.test(reason))).map(m=>({name:m.name,size:m.size,sideDiameter:m.sideDiameter,reasons:m.rejectedReasons})),
      candidatesNotAttached:wheelDiagnostics.meshes.filter(m=>m.candidate&&!m.attachedToWheel).map(m=>({name:m.name,size:m.size,center:m.center})),
      nearbyRejectedWheelParts:wheelDiagnostics.nearWheelExcludedMeshes,
    }));
    await page.evaluate(()=>window.__vehicleVisualTest.showWheelOverview());
    const wheelOverviewShot=await capture(page,spec.prefix+'-wheel-detector-overview');
    const wheelCloseupShots=[];
    for(const quadrant of expectedQuadrants){
      const detail=await page.evaluate(q=>window.__vehicleVisualTest.focusWheel(q),quadrant);
      const shot=await capture(page,spec.prefix+'-wheel-'+quadrant);
      let steeredShot=null;
      if(quadrant.startsWith('front')){
        const angle=quadrant==='front-left'?0.48:-0.48;
        const steering=await page.evaluate(value=>window.__vehicleVisualTest.setWheelSteering(value),angle);
        const frontWheels=steering.filter(w=>w.front);
        const rearWheels=steering.filter(w=>!w.front);
        check(spec.kind+' '+quadrant+' keeps complete tyre groups attached while steering',
          steering.length===4
            && frontWheels.length===2
            && rearWheels.length===2
            && frontWheels.every(w=>Math.abs(w.angle-angle)<1e-9)
            && rearWheels.every(w=>Math.abs(w.angle)<1e-9)
            && steering.every(w=>w.allMeshesStayAttached&&w.wheelMeshCount===w.spinnerMeshCount),
          steering.map(w=>({front:w.front,angle:w.angle,meshes:w.wheelMeshCount,spinner:w.spinnerMeshCount,attached:w.allMeshesStayAttached})).map(w=>JSON.stringify(w)).join(' '));
        steeredShot=await capture(page,spec.prefix+'-wheel-'+quadrant+'-steered');
        await page.evaluate(()=>window.__vehicleVisualTest.setWheelSteering(0));
      }
      wheelCloseupShots.push({detail,file:shot,steeredShot});
    }
    reportWheelSummary.push({kind:spec.kind,wheelOverviewShot,wheelCloseupShots});
    check(spec.kind+' uses its own driver eye height',Math.abs(base.height-spec.expectedHeight)<1e-6,`height=${base.height}m`);
    check(spec.kind+' camera eye point stays below the roofline',
      base.rootDimensions.y-base.height>0.12,
      `roof clearance=${(base.rootDimensions.y-base.height).toFixed(2)}m`);
    check(spec.kind+' cabin lights start disabled',base.lightsInitiallyOff);
    check(spec.kind+' cabin fill remains subtle',
      base.lightIntensities.length===2
      && base.lightIntensities[0].intensity<=2.6
      && base.lightIntensities[1].intensity<=0.5,
      JSON.stringify(base.lightIntensities));
    console.log(`DETAIL ${spec.kind} named cabin meshes: ${base.cabinMeshes.length}`);
    console.log(`DETAIL ${spec.kind} cabin mesh sample: ${JSON.stringify(base.cabinMeshes.slice(0,18))}`);

    const exterior=await page.evaluate(()=>window.__vehicleVisualTest.exterior());
    check(spec.kind+' exterior camera disables cabin lighting',!exterior.lightsVisible&&!exterior.interiorView);
    const outsideShot=await capture(page,spec.prefix+'-exterior');
    const interior=await page.evaluate(()=>window.__vehicleVisualTest.interior());
    check(spec.kind+' interior camera activates cabin lighting',interior.lightsVisible&&interior.interiorView);
    check(spec.kind+' camera uses the calibrated profile',Math.abs(interior.cameraHeight-spec.expectedHeight)<1e-6);
    check(spec.kind+' interior FOV reaches its settled profile',Math.abs(interior.fov-spec.expectedFov)<0.35,`fov=${interior.fov.toFixed(2)}°`);
    const insideShot=await capture(page,spec.prefix+'-interior');
    for(const side of [-0.38,0.38]){
      const cameraVariant=await page.evaluate(value=>window.__vehicleVisualTest.setCameraSide(value),side);
      const shot=await capture(page,spec.prefix+'-seat-side-'+(side<0?'minus':'plus'));
      console.log('SEAT SIDE '+JSON.stringify({side,...cameraVariant,...shot}));
    }
    await page.evaluate(()=>window.__vehicleVisualTest.setCameraSide(0));
    if(spec.kind==='cybertruck'){
      for(const preset of [
        {dome:2.5,dashboard:0.45,label:'2_5-0_45'},
        {dome:4.0,dashboard:0.70,label:'4_0-0_70'},
        {dome:6.0,dashboard:1.00,label:'6_0-1_00'},
      ]){
        await page.evaluate(p=>window.__vehicleVisualTest.setCabinLights(p.dome,p.dashboard),preset);
        const shot=await capture(page,'cybertruck-light-'+preset.label);
        console.log('LIGHT PRESET '+JSON.stringify({...preset,...shot}));
      }
      await page.evaluate(()=>window.__vehicleVisualTest.setCabinLights(2.5,0.45));
    }
    const report=await page.evaluate(()=>window.__vehicleVisualTest.details());
    await fs.writeFile(path.join(OUT,spec.prefix+'-report.json'),JSON.stringify({
      base,exterior,interior,wheelDiagnostics, wheelOverviewShot,wheelCloseupShots,
      cabinModelDetails:report.report.vehicles[spec.kind],
    },null,2));
    console.log('SCREENSHOTS '+JSON.stringify([outsideShot,insideShot]));
  }

  const browserErrors=await page.evaluate(()=>window.__vehicleVisualTest.report.errors);
  for(const error of [...errors,...browserErrors])console.error('BROWSER ERROR '+error);
  check('browser completed without runtime or network errors',errors.length===0&&browserErrors.length===0,
    `console/page/network errors=${errors.length+browserErrors.length}`);

  await fs.writeFile(path.join(OUT,'summary.json'),JSON.stringify({
    status:failures===0?'passed':'failed',
    failures,
    screenshots:['lamborghini-exterior.png','lamborghini-interior.png','cybertruck-exterior.png','cybertruck-interior.png','bugatti-chiron-exterior.png','bugatti-chiron-interior.png'],
    wheelScreenshots:reportWheelSummary,
    browserErrors:[...errors,...browserErrors],
  },null,2));
}catch(error){
  failures++;
  console.error('VISUAL TEST ERROR',error?.stack||error);
  await fs.writeFile(path.join(OUT,'failure.txt'),String(error?.stack||error)).catch(()=>{});
}finally{
  if(browser)await browser.close().catch(()=>{});
  server.kill('SIGTERM');
  await new Promise(resolve=>{
    if(server.exitCode!==null)return resolve();
    server.once('exit',resolve);
    setTimeout(()=>{server.kill('SIGKILL');resolve();},3000).unref();
  });
  console.log(`VISUAL TESTS ${failures===0?'PASSED':'FAILED'} · ${failures} failure(s)`);
}
if(failures>0)process.exitCode=1;
