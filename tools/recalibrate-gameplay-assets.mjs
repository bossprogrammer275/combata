#!/usr/bin/env node
/**
 * Reset/rebuild gameplay profiles. Old sidecars are archived outside Git.
 * Decorative vegetation is excluded; source GLB/glTF files are never changed.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { glob } from 'glob';
import { calibrateOne, isDecorativeAssetPath } from './asset-calibrator.mjs';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOTS = [path.join(ROOT,'data','models','assets'),path.join(ROOT,'data','models','cars')];
const relative = file => path.relative(ROOT,file).split(path.sep).join('/');
async function listFiles() {
  const models=[],sidecars=[];
  for(const root of ROOTS){
    for(const file of await glob('**/*',{cwd:root,nodir:true})){
      const full=path.join(root,file),lower=file.toLowerCase();
      if(lower.endsWith('_calibration.json')||lower.endsWith('_col.json')) sidecars.push(full);
      else if((lower.endsWith('.glb')||(lower.endsWith('.gltf')&&path.basename(lower)==='scene.gltf'))&&!isDecorativeAssetPath(file))models.push(full);
    }
  }
  return {models:[...new Set(models)].sort(),sidecars:[...new Set(sidecars)].sort()};
}
async function run(){
  const stamp=new Date().toISOString().replace(/[:.]/g,'-');
  const backupRoot=path.join(ROOT,'.asset-calibration-backups',stamp);
  const {models,sidecars}=await listFiles();
  if(!models.length)throw new Error('No physical gameplay GLB/glTF models found.');
  for(const source of sidecars){
    const target=path.join(backupRoot,relative(source));
    fs.mkdirSync(path.dirname(target),{recursive:true});
    fs.copyFileSync(source,target);fs.rmSync(source,{force:true});
  }
  console.log(`[Recalibrate] ${models.length} physical models; ${sidecars.length} old sidecars archived at ${relative(backupRoot)}.`);
  console.log('[Recalibrate] Visual-only shrubs, bushes, hedges, grasses, foliage, flowers and weeds excluded.');
  const results=[],failures=[];
  for(const file of models){
    try{results.push(await calibrateOne(file));}
    catch(error){failures.push({asset:relative(file),error:String(error?.stack||error)});console.error(`[Recalibrate] FAILED ${relative(file)}: ${error?.stack||error}`);}
  }
  // The speed bump previously exceeded the triangle grid's safety cap and
  // silently produced an empty collision sidecar. Keep a real asset regression
  // check in the generation job so the fix is verified after every rebuild.
  const speedBumpSource = path.join(ROOT, 'data', 'models', 'assets', 'roads', 'speed_bump.glb');
  if (fs.existsSync(speedBumpSource)) {
    const speedBumpSidecar = path.join(ROOT, 'data', 'models', 'assets', 'roads', 'speed_bump_col.json');
    try {
      const manifest = JSON.parse(fs.readFileSync(speedBumpSidecar, 'utf8'));
      if (!Array.isArray(manifest.boxes) || manifest.boxes.length === 0
        || !(manifest.collisionStats?.adaptiveSubdividedMeshes > 0)) {
        throw new Error('speed_bump_col.json must contain adaptive triangle-derived collision boxes');
      }
      console.log(`[Recalibrate] Speed bump collision verified: ${manifest.boxes.length} boxes · adaptive grid ${manifest.collisionStats.largestAdaptiveCellSize}m`);
    } catch (error) {
      failures.push({ asset: 'data/models/assets/roads/speed_bump.glb', error: String(error?.stack || error) });
      console.error('[Recalibrate] SPEED BUMP COLLISION CHECK FAILED:', error?.stack || error);
    }
  }

  const summary={
    selectedModels:models.length,archivedSidecars:sidecars.length,
    calibrationProfiles:results.filter(item=>!item.skipped).length,
    collisionSidecars:results.filter(item=>!!item.collisionOutputPath).length,
    vehicleSeatCandidates:results.reduce((sum,item)=>sum+(item.vehicleSeatCandidates||0),0),
    vehicleDoorCandidates:results.reduce((sum,item)=>sum+(item.vehicleDoorCandidates||0),0),
    failures:failures.length,backupDirectory:relative(backupRoot),results,errors:failures,
  };
  console.log('[Recalibrate] SUMMARY\n'+JSON.stringify(summary,null,2));
  if(failures.length)process.exitCode=1;
}
const invoked=process.argv[1]?path.resolve(process.argv[1]):'';
if(invoked&&import.meta.url===pathToFileURL(invoked).href)run().catch(error=>{console.error('[Recalibrate] Fatal:',error?.stack||error);process.exitCode=1;});
export {run,listFiles};
