import * as THREE from 'three';
import { GLTFLoader } from '../js/lib/GLTFLoader.js';
import { OrbitControls } from '../js/lib/OrbitControls.js';
const $=id=>document.getElementById(id), rad=v=>v*Math.PI/180,deg=v=>v*180/Math.PI,num=(v,d=0)=>Number.isFinite(Number(v))?Number(v):d;
const assets={
'/data/models/assets/ilorin_innovation_hub.glb':{name:'Ilorin Innovation Hub',kind:'building'},
'/data/models/assets/kwara_revenue_house.glb':{name:'Kwara Revenue House',kind:'building'},
'/data/models/assets/low_poly_skyscraper.glb':{name:'Low-poly skyscraper',kind:'building'},
'/data/models/cars/CAR Model by Ignition Labs - 5zUWP5UsLg-.glb':{name:'Lamborghini model',kind:'vehicle',targetLen:4.7,camera:{height:.98,forward:.16,side:0,lookAhead:18,pitch:0,fov:82}},
'/data/models/cars/tesla_cybertruk_low_poly/scene.gltf':{name:'Tesla Cybertruck',kind:'vehicle',targetLen:5.7,camera:{height:1.42,forward:.3,side:0,lookAhead:20,pitch:0,fov:82}}};
const scene=new THREE.Scene();scene.background=new THREE.Color(0x111914);scene.add(new THREE.HemisphereLight(0xdcebe0,0x26352a,2.1));
const key=new THREE.DirectionalLight(0xfff1d9,3.2);key.position.set(8,12,9);scene.add(key);const fill=new THREE.DirectionalLight(0x9ab9d6,1);fill.position.set(-8,6,-7);scene.add(fill);scene.add(new THREE.GridHelper(80,80,0x49604e,0x26352a));
const camera=new THREE.PerspectiveCamera(45,1,.05,2000),renderer=new THREE.WebGLRenderer({canvas:$('view'),antialias:true,preserveDrawingBuffer:true});
renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.75));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.12;
const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.target.set(0,1,0);const loader=new GLTFLoader();
let currentRoot=null,currentUrl='',currentConfig={},overrideData={version:1,assets:{}},selectedMesh=null,meshNodes=[],baseline=[],wire=false,cabinMode=false,steeringPreview=null;
const baseCfg={root:{position:{x:0,y:0,z:0},rotation:{x:0,y:0,z:0},scale:{x:1,y:1,z:1}},meshes:{},interiorCamera:{height:1.08,forward:.2,side:0,lookAhead:18,pitch:0,fov:82},steeringWheel:{meshKeys:[],axis:'auto',maxAngleDeg:450,sign:1,response:10}};
function clone(v){return JSON.parse(JSON.stringify(v||baseCfg));}
async function loadOverrides(){try{const r=await fetch('/api/asset-overrides',{cache:'no-store'});if(r.ok)overrideData=await r.json();}catch{}if(!overrideData.assets)overrideData={version:1,assets:{}};}
function applySaved(root,cfg){const p=cfg.root.position,r=cfg.root.rotation,s=cfg.root.scale,b=root.userData.assetLabBaseTransform||{position:new THREE.Vector3(),scale:new THREE.Vector3(1,1,1)};root.position.set(b.position.x+num(p.x),b.position.y+num(p.y),b.position.z+num(p.z));root.rotation.set(num(r.x),num(r.y),num(r.z));root.scale.set(b.scale.x*num(s.x,1),b.scale.y*num(s.y,1),b.scale.z*num(s.z,1));}
function fitVehicleModel(root,targetLen=4.6){root.updateMatrixWorld(true);const before=new THREE.Box3().setFromObject(root),size=before.getSize(new THREE.Vector3()),horizontal=Math.max(size.x,size.z,.001),factor=THREE.MathUtils.clamp(num(targetLen,4.6)/horizontal,.01,100);root.scale.multiplyScalar(factor);root.updateMatrixWorld(true);const fitted=new THREE.Box3().setFromObject(root),center=fitted.getCenter(new THREE.Vector3());root.position.x-=center.x;root.position.y-=fitted.min.y;root.position.z-=center.z;root.updateMatrixWorld(true);root.userData.assetLabBaseTransform={position:root.position.clone(),scale:root.scale.clone()};}
function resetView(){if(!currentRoot)return;const b=new THREE.Box3().setFromObject(currentRoot),size=b.getSize(new THREE.Vector3()),center=b.getCenter(new THREE.Vector3()),span=Math.max(size.x,size.y,size.z,1);controls.target.copy(center);camera.position.copy(center).add(new THREE.Vector3(span*1.25,span*.8,span*1.5));camera.near=Math.max(.03,span/2000);camera.far=Math.max(1000,span*30);camera.updateProjectionMatrix();controls.update();$('asset-meta').textContent=assets[currentUrl].name+' · '+size.x.toFixed(2)+'m × '+size.y.toFixed(2)+'m × '+size.z.toFixed(2)+'m · '+meshNodes.length+' meshes';}
function addControls(parent,fields){parent.innerHTML='';fields.forEach(f=>{const wrap=document.createElement('div');wrap.className='field';const head=document.createElement('div');head.className='field-head';const label=document.createElement('span');label.textContent=f.label;const out=document.createElement('output');out.textContent=f.value.toFixed(f.step<.01?3:2);head.append(label,out);const input=document.createElement('input');input.type='range';input.min=f.min;input.max=f.max;input.step=f.step;input.value=f.value;input.addEventListener('input',()=>{const v=Number(input.value);out.textContent=v.toFixed(f.step<.01?3:2);f.apply(v);});wrap.append(head,input);parent.append(wrap);});}
function buildRootControls(){const p=currentConfig.root.position,r=currentConfig.root.rotation,s=currentConfig.root.scale,b=currentRoot.userData.assetLabBaseTransform||{position:new THREE.Vector3(),scale:new THREE.Vector3(1,1,1)},fields=[];['x','y','z'].forEach(a=>fields.push({label:'Position '+a.toUpperCase()+' (m)',value:num(p[a]),min:-30,max:30,step:.01,apply:v=>{p[a]=v;currentRoot.position[a]=b.position[a]+v;currentRoot.updateMatrixWorld(true);}}));['x','y','z'].forEach(a=>fields.push({label:'Rotation '+a.toUpperCase()+' (°)',value:deg(num(r[a])),min:-180,max:180,step:.5,apply:v=>{r[a]=rad(v);currentRoot.rotation[a]=r[a];currentRoot.updateMatrixWorld(true);}}));['x','y','z'].forEach(a=>fields.push({label:'Scale '+a.toUpperCase(),value:num(s[a],1),min:.1,max:4,step:.01,apply:v=>{s[a]=v;currentRoot.scale[a]=b.scale[a]*v;currentRoot.updateMatrixWorld(true);}}));addControls($('root-controls'),fields);}
function setMeshDelta(key,type,axis,value){const base=baseline.find(n=>n.key===key),node=meshNodes.find(n=>n.userData.assetLabKey===key);if(!base||!node)return;if(type==='position')node.position[axis]=base.position[axis]+value;if(type==='rotation')node.rotation[axis]=base.rotation[axis]+value;node.updateMatrixWorld(true);}
function setMeshScale(key,axis,value){const base=baseline.find(n=>n.key===key),node=meshNodes.find(n=>n.userData.assetLabKey===key);if(base&&node){node.scale[axis]=base.scale[axis]*value;node.updateMatrixWorld(true);}}
function buildMeshControls(){const host=$('mesh-controls');host.innerHTML='';if(!selectedMesh){$('mesh-empty').hidden=false;return;}$('mesh-empty').hidden=true;const name=selectedMesh.userData.assetLabKey,edit=currentConfig.meshes[name]||(currentConfig.meshes[name]={position:{x:0,y:0,z:0},rotation:{x:0,y:0,z:0},scale:{x:1,y:1,z:1}}),p=edit.position,r=edit.rotation,s=edit.scale,fields=[];['x','y','z'].forEach(a=>fields.push({label:'Mesh offset '+a.toUpperCase()+' (m)',value:num(p[a]),min:-8,max:8,step:.01,apply:v=>{p[a]=v;setMeshDelta(name,'position',a,v);}}));['x','y','z'].forEach(a=>fields.push({label:'Mesh rotation '+a.toUpperCase()+' (°)',value:deg(num(r[a])),min:-180,max:180,step:.5,apply:v=>{r[a]=rad(v);setMeshDelta(name,'rotation',a,r[a]);}}));['x','y','z'].forEach(a=>fields.push({label:'Mesh scale '+a.toUpperCase(),value:num(s[a],1),min:.1,max:4,step:.01,apply:v=>{s[a]=v;setMeshScale(name,a,v);}}));addControls(host,fields);}
function buildCameraControls(){const cfg=currentConfig.interiorCamera,fields=[['height','Camera height above ground (m)',.5,2.2,.01],['forward','Seat forward offset (m)',-1.2,1.2,.01],['side','Seat lateral offset (m)',-.8,.8,.01],['lookAhead','Look-ahead distance (m)',2,50,.1],['pitch','Camera pitch (°)',-35,35,.5],['fov','Field of view (°)',55,105,1]];addControls($('camera-controls'),fields.map(f=>({label:f[1],value:num(cfg[f[0]],baseCfg.interiorCamera[f[0]]),min:f[2],max:f[3],step:f[4],apply:v=>{cfg[f[0]]=v;if(cabinMode)showCabin();}})));}

function steeringCfg(){currentConfig.steeringWheel ||= {meshKeys:[],axis:'auto',maxAngleDeg:450,sign:1,response:10};currentConfig.steeringWheel.meshKeys ||= [];return currentConfig.steeringWheel;}
function nodeNamePath(node){const names=[];let n=node;while(n&&n!==currentRoot){names.push(n.name||n.type||'node');n=n.parent;}return names.reverse().join(' / ');}
function detectSteeringCandidates(){
 const named=meshNodes.filter(n=>/(steering[\s_-]*wheel|wheel[\s_-]*steering|steer[\s_-]*wheel|volant|lenkrad)/i.test(nodeNamePath(n)));
 if(named.length)return named;
 // Geometry-only fallback: suggest a central, elevated, thin circular mesh;
 // the user must confirm it, since dashboard gauges can have similar bounds.
 const rootBox=new THREE.Box3().setFromObject(currentRoot),rootSize=rootBox.getSize(new THREE.Vector3()),rootCenter=rootBox.getCenter(new THREE.Vector3());
 const possible=meshNodes.map(node=>{const b=new THREE.Box3().setFromObject(node),s=b.getSize(new THREE.Vector3()),c=b.getCenter(new THREE.Vector3()),dims=[s.x,s.y,s.z].sort((a,b)=>b-a),roundness=dims[2]/Math.max(.001,dims[0]),centrality=Math.abs(c.x-rootCenter.x)/Math.max(.001,rootSize.x*.5),height=(c.y-rootBox.min.y)/Math.max(.001,rootSize.y);return {node,score:roundness+centrality*.5+Math.abs(height-.62),dims,roundness,centrality,height};})
 .filter(v=>v.dims[0]>.18&&v.dims[0]<.85&&v.roundness<.34&&v.centrality<.42&&v.height>.32&&v.height<.9)
 .sort((a,b)=>a.score-b.score);
 return possible.length?[possible[0].node]:[];
}
function clearSteeringPreview(){
 if(!steeringPreview)return;
 const {pivot,originals}=steeringPreview;
 currentRoot?.updateWorldMatrix(true,true);
 for(const item of originals){if(item.parent&&item.mesh.parent===pivot)item.parent.attach(item.mesh);}
 pivot.parent?.remove(pivot);
 steeringPreview=null;
}
function updateSteeringPreview(){
 clearSteeringPreview();
 const cfg=steeringCfg(),keys=new Set(cfg.meshKeys),selected=meshNodes.filter(n=>keys.has(n.userData.assetLabKey));
 if(!selected.length){$('steering-preview').value='0';$('steering-preview-value').textContent='0%';refreshSteeringStatus();return;}
 currentRoot.updateWorldMatrix(true,true);
 const bounds=new THREE.Box3();selected.forEach(n=>bounds.expandByObject(n));
 const center=currentRoot.worldToLocal(bounds.getCenter(new THREE.Vector3()));
 const pivot=new THREE.Group();pivot.name='asset-lab-steering-preview-pivot';pivot.position.copy(center);currentRoot.add(pivot);pivot.updateWorldMatrix(true,false);
 const originals=selected.map(mesh=>({mesh,parent:mesh.parent}));
 selected.forEach(mesh=>pivot.attach(mesh));
 steeringPreview={pivot,originals};
 const axis=['x','y','z'].includes(cfg.axis)?cfg.axis:(()=>{const s=bounds.getSize(new THREE.Vector3());return s.x<=s.y&&s.x<=s.z?'x':s.y<=s.z?'y':'z';})();
 const pct=num($('steering-preview').value)/100,lock=rad(num(cfg.maxAngleDeg,450)*.5)* (Number(cfg.sign)<0?-1:1);
 pivot.rotation[axis]=pct*lock;
 refreshSteeringStatus();
}
function refreshSteeringStatus(){
 const cfg=steeringCfg(),names=cfg.meshKeys.map(key=>meshNodes.find(n=>n.userData.assetLabKey===key)?.name||key.split('/').pop()).filter(Boolean);
 $('steering-status').textContent=names.length?'Rig parts: '+names.join(', ')+' · axis '+cfg.axis+' · '+num(cfg.maxAngleDeg,450)+'° lock-to-lock': 'No steering wheel assigned. Detect a named candidate or select its mesh and assign it manually.';
 $('steering-axis').value=cfg.axis||'auto';$('steering-sign').value=Number(cfg.sign)<0?'-1':'1';$('steering-limit').value=num(cfg.maxAngleDeg,450);$('steering-limit-value').textContent=num(cfg.maxAngleDeg,450)+'°';
 $('steering-preview-value').textContent=$('steering-preview').value+'%';
}
function buildSteeringControls(){if(!currentRoot||assets[currentUrl]?.kind!=='vehicle')return;refreshSteeringStatus();updateSteeringPreview();}
function updateMeshList(){meshNodes=[];baseline=[];currentRoot.traverse(n=>{if(n.isMesh){const path=[];let cur=n;while(cur&&cur!==currentRoot){const par=cur.parent,index=par?par.children.indexOf(cur):0;path.push((cur.name||cur.type||'node')+'['+index+']');cur=par;}const key=path.reverse().join('/');n.userData.assetLabKey=key;meshNodes.push(n);baseline.push({key,name:n.name,position:n.position.clone(),rotation:n.rotation.clone(),scale:n.scale.clone()});}});meshNodes.forEach(n=>{const e=currentConfig.meshes?.[n.userData.assetLabKey];if(!e)return;const p=e.position||{},r=e.rotation||{},s=e.scale||{};n.position.add(new THREE.Vector3(num(p.x),num(p.y),num(p.z)));n.rotation.x+=num(r.x);n.rotation.y+=num(r.y);n.rotation.z+=num(r.z);n.scale.multiply(new THREE.Vector3(num(s.x,1),num(s.y,1),num(s.z,1)));});const select=$('mesh-select');select.innerHTML='';meshNodes.forEach((n,i)=>{const o=document.createElement('option');o.value=String(i);o.textContent=(n.name||('Mesh '+(i+1)))+' · '+(n.geometry?.attributes?.position?.count||0)+' verts';select.append(o);});selectedMesh=meshNodes[0]||null;select.value=meshNodes.length?'0':'';select.onchange=()=>{selectedMesh=meshNodes[Number(select.value)]||null;buildMeshControls();refreshSteeringStatus();};const inside=meshNodes.filter(n=>/interior|cabin|dashboard|seat|steer|console|door.?panel|mirror|gauge/i.test(n.name));$('interior-status').textContent=inside.length?'Detected '+inside.length+' likely cabin meshes: '+inside.slice(0,8).map(n=>n.name).join(', '):'No clearly named cabin meshes found. Cabin view is still available to inspect the actual model; it will not invent cabin geometry.';$('mesh-label').textContent=meshNodes.length+' meshes · '+inside.length+' likely interior nodes';buildMeshControls();if(assets[currentUrl]?.kind==='vehicle')buildSteeringControls();}
async function loadAsset(url){$('status').textContent='Loading GLB…';cabinMode=false;if(currentRoot){clearSteeringPreview();scene.remove(currentRoot);currentRoot=null;}currentUrl=url;currentConfig=clone(overrideData.assets[url]||{...baseCfg,interiorCamera:assets[url].camera||baseCfg.interiorCamera});const gltf=await new Promise((resolve,reject)=>loader.load(url,resolve,undefined,reject));currentRoot=gltf.scene;currentRoot.name=assets[url].name;if(assets[url].kind==='vehicle')fitVehicleModel(currentRoot,assets[url].targetLen||4.6);else currentRoot.userData.assetLabBaseTransform={position:currentRoot.position.clone(),scale:currentRoot.scale.clone()};applySaved(currentRoot,currentConfig);scene.add(currentRoot);$('new-vehicle-length').value=assets[url].targetLen||4.6;updateMeshList();buildRootControls();buildCameraControls();$('new-car-setup').style.display=assets[url].kind==='vehicle'?'':'none';if(assets[url].kind==='vehicle')buildSteeringControls();resetView();$('hub-reference').style.display=url.includes('innovation_hub')?'':'none';$('interior-view').disabled=assets[url].kind!=='vehicle';$('show-interior-only').checked=false;$('status').textContent='Loaded. Drag to orbit, scroll to zoom, edit transforms and capture screenshots.';}
function showCabin(){if(!currentRoot)return;const cfg=currentConfig.interiorCamera,b=new THREE.Box3().setFromObject(currentRoot),center=b.getCenter(new THREE.Vector3()),height=num(cfg.height,(b.max.y-b.min.y)*.62),origin=new THREE.Vector3(center.x+num(cfg.side),b.min.y+height,center.z+num(cfg.forward)),look=new THREE.Vector3(origin.x,b.min.y+height+Math.tan(rad(num(cfg.pitch)))*4,origin.z+num(cfg.lookAhead,18));camera.position.copy(origin);camera.lookAt(look);camera.fov=num(cfg.fov,82);camera.updateProjectionMatrix();controls.target.copy(look);controls.update();cabinMode=true;}
async function save(){overrideData.version=1;overrideData.assets[currentUrl]=currentConfig;$('status').textContent='Saving asset overrides…';try{const r=await fetch('/api/asset-overrides',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({data:JSON.stringify(overrideData,null,2)})});if(!r.ok)throw new Error((await r.text())||('HTTP '+r.status));$('status').textContent='Saved. Runtime GLB loaders will apply these node transforms on the next model load.';}catch(e){$('status').textContent='Save failed: '+e.message+'. Run the local project server to persist edits.';}}
function capture(){renderer.render(scene,camera);renderer.domElement.toBlob(blob=>{if(!blob)return;const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='strike-'+assets[currentUrl].name.toLowerCase().replace(/[^a-z0-9]+/g,'-')+'-preview.png';a.click();URL.revokeObjectURL(a.href);},'image/png');}
function addCustomVehicle(){
 let url=$('new-vehicle-url').value.trim().replace(/\\/g,'/');
 if(url.startsWith('./'))url=url.slice(1);
 if(!url.startsWith('/'))url='/'+url.replace(/^\/+/, '');
 if(!/^\/data\/models\/cars\/.+\.(glb|gltf)$/i.test(url)){$('status').textContent='Use a GLB/GLTF stored inside /data/models/cars/.';return;}
 const name=url.split('/').pop().replace(/\.(glb|gltf)$/i,'').replace(/[_-]+/g,' ');
 const targetLen=THREE.MathUtils.clamp(num($('new-vehicle-length').value,4.6),3,8);
 assets[url]={name,kind:'vehicle',targetLen,camera:{height:1.08,forward:.2,side:0,lookAhead:18,pitch:0,fov:82}};
 let option=[...$('asset-select').options].find(o=>o.value===url);
 if(!option){option=document.createElement('option');option.value=url;option.textContent='NEW VEHICLE · '+name;$('asset-select').append(option);}
 $('asset-select').value=url;loadAsset(url).catch(err=>$('status').textContent=err.message);
}
$('asset-select').addEventListener('change',e=>loadAsset(e.target.value).catch(err=>$('status').textContent=err.message));$('load-new-vehicle').onclick=addCustomVehicle;$('new-vehicle-url').addEventListener('keydown',e=>{if(e.key==='Enter')addCustomVehicle();});
$('detect-steering').onclick=()=>{const candidates=detectSteeringCandidates();if(!candidates.length){$('steering-status').textContent='No likely wheel found. Select its mesh in the mesh list and assign it manually.';return;}const cfg=steeringCfg();cfg.meshKeys=candidates.map(n=>n.userData.assetLabKey);const select=$('mesh-select'),index=meshNodes.indexOf(candidates[0]);select.value=String(index);selectedMesh=candidates[0];buildMeshControls();updateSteeringPreview();$('steering-status').textContent='Candidate assigned. Check the preview, then save; use manual selection if this is not the actual steering wheel.';};
$('use-selected-steering').onclick=()=>{if(!selectedMesh)return;steeringCfg().meshKeys=[selectedMesh.userData.assetLabKey];$('steering-preview').value='0';updateSteeringPreview();};
$('add-selected-steering').onclick=()=>{if(!selectedMesh)return;const keys=steeringCfg().meshKeys;if(!keys.includes(selectedMesh.userData.assetLabKey))keys.push(selectedMesh.userData.assetLabKey);updateSteeringPreview();};
$('clear-steering').onclick=()=>{steeringCfg().meshKeys=[];$('steering-preview').value='0';updateSteeringPreview();};
$('steering-axis').onchange=e=>{steeringCfg().axis=e.target.value;updateSteeringPreview();};$('steering-sign').onchange=e=>{steeringCfg().sign=Number(e.target.value)<0?-1:1;updateSteeringPreview();};
$('steering-limit').oninput=e=>{steeringCfg().maxAngleDeg=Number(e.target.value);refreshSteeringStatus();updateSteeringPreview();};
$('steering-preview').oninput=()=>updateSteeringPreview();
$('reset-camera').onclick=resetView;$('interior-view').onclick=showCabin;$('screenshot').onclick=capture;$('save').onclick=save;
$('wireframe').onclick=()=>{wire=!wire;currentRoot?.traverse(n=>{if(n.isMesh){const mats=Array.isArray(n.material)?n.material:[n.material];mats.forEach(m=>{if(m)m.wireframe=wire;});}});};
$('reset-asset').onclick=()=>{delete overrideData.assets[currentUrl];currentConfig=clone(baseCfg);loadAsset(currentUrl);};
$('show-interior-only').onchange=e=>{if(!currentRoot)return;currentRoot.traverse(n=>{if(n.isMesh)n.visible=!e.target.checked||/interior|cabin|dashboard|seat|steer|console|door.?panel|mirror|gauge/i.test(n.name);});};
document.querySelectorAll('[data-nudge]').forEach(btn=>btn.onclick=()=>{const parts=btn.dataset.nudge.split(',').map(Number),p=currentConfig.root.position,b=currentRoot.userData.assetLabBaseTransform?.position||new THREE.Vector3();p.x+=parts[0];p.z+=parts[1];currentRoot.position.x=b.x+p.x;currentRoot.position.z=b.z+p.z;buildRootControls();});
window.addEventListener('resize',resize);function resize(){const w=$('view').clientWidth,h=$('view').clientHeight;renderer.setSize(w,h,false);camera.aspect=w/Math.max(1,h);camera.updateProjectionMatrix();}
function animate(){requestAnimationFrame(animate);controls.update();renderer.render(scene,camera);}
await loadOverrides();await loadAsset($('asset-select').value);resize();animate();
