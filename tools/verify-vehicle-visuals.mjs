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

  const configs=[
    {kind:'lambo',expectedHeight:1.02,expectedFov:82,prefix:'lamborghini'},
    {kind:'cybertruck',expectedHeight:1.42,expectedFov:82,prefix:'cybertruck'},
  ];
  for(const spec of configs){
    const base=await page.evaluate(async kind=>await window.__vehicleVisualTest.load(kind),spec.kind);
    check(spec.kind+' loads through the actual VehicleSystem',base.meshCount>0,'meshes='+base.meshCount);
    check(spec.kind+' has four road-wheel rigs',base.wheelCount===4,'wheels='+base.wheelCount);
    check(spec.kind+' uses its own driver eye height',Math.abs(base.height-spec.expectedHeight)<1e-6,`height=${base.height}m`);
    check(spec.kind+' camera eye point stays below the roofline',
      base.rootDimensions.y-base.height>0.08,
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
      base,exterior,interior,cabinModelDetails:report.report.vehicles[spec.kind],
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
    screenshots:['lamborghini-exterior.png','lamborghini-interior.png','cybertruck-exterior.png','cybertruck-interior.png'],
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
