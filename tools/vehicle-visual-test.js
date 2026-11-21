import * as THREE from 'three';
import { VehicleSystem, CAR_PHYSICS, diagnoseCarWheelMeshes } from '../js/vehicles.js';
import { Player } from '../js/player.js';

const canvas=document.getElementById('view');
const status=document.getElementById('status');
const renderer=new THREE.WebGLRenderer({canvas,antialias:true,preserveDrawingBuffer:true});
renderer.setPixelRatio(1);
renderer.setSize(1440,900,false);
renderer.outputColorSpace=THREE.SRGBColorSpace;
renderer.toneMapping=THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure=1.2;

const scene=new THREE.Scene();
scene.background=new THREE.Color(0x202832);
scene.add(new THREE.HemisphereLight(0xcfe3ff,0x5a5c50,0.9));
const key=new THREE.DirectionalLight(0xfff1dd,1.8);
key.position.set(-5,9,7);
scene.add(key);
const ground=new THREE.Mesh(
  new THREE.PlaneGeometry(100,100),
  new THREE.MeshStandardMaterial({color:0x292d32,roughness:0.94,metalness:0.02})
);
ground.rotation.x=-Math.PI/2;
ground.position.y=-0.025;
ground.receiveShadow=true;
scene.add(ground);

const camera=new THREE.PerspectiveCamera(62,1440/900,0.025,1500);
const world={
  bounds:1600,
  colliders:[],
  bvhWorld:null,
  addCollider(x,y,z,w,h,d){
    const c={min:{x:x-w/2,y:y-h/2,z:z-d/2},max:{x:x+w/2,y:y+h/2,z:z+d/2}};
    this.colliders.push(c);return c;
  },
};
const system=new VehicleSystem(scene,world,camera,null,null);
const player=new Player(camera,world,null,null);
let current=null;
let interactionHelpers=[];
const report={vehicles:{},vehicleTransitions:{},screenshots:[],errors:[]};
let wheelHelpers=[];
let wheelMarkerMeshes=[];

function clearWheelDiagnostics(){
  for(const helper of wheelHelpers)scene.remove(helper);
  for(const marker of wheelMarkerMeshes)scene.remove(marker);
  wheelHelpers=[];wheelMarkerMeshes=[];
}

function showWheelDiagnostics(diagnostics){
  clearWheelDiagnostics();
  const byUuid=new Map();
  current.root.traverse(node=>{if(node.isMesh)byUuid.set(node.uuid,node);});
  const colors={
    'front-left':0x26d9ff,
    'front-right':0x79ff65,
    'rear-left':0xffd34d,
    'rear-right':0xff62d5,
  };
  for(const wheel of diagnostics.selectedWheels){
    const color=colors[wheel.quadrant]||0xffffff;
    for(const uuid of wheel.meshUUIDs||[]){
      const node=byUuid.get(uuid);
      if(!node)continue;
      const box=new THREE.Box3().setFromObject(node);
      if(box.isEmpty())continue;
      const helper=new THREE.Box3Helper(box,color);
      helper.material.depthTest=false;
      helper.material.transparent=true;
      helper.material.opacity=0.98;
      scene.add(helper);wheelHelpers.push(helper);
    }
    const marker=new THREE.Mesh(
      new THREE.SphereGeometry(0.075,12,8),
      new THREE.MeshBasicMaterial({color,depthTest:false}),
    );
    marker.position.fromArray(wheel.center);
    scene.add(marker);wheelMarkerMeshes.push(marker);
  }
  // Red boxes are tyre-adjacent GLB parts rejected by the current member limits.
  // They make oversized/split Tesla tyre pieces visible for tuning decisions.
  for(const rejected of diagnostics.nearWheelExcludedMeshes||[]){
    const node=byUuid.get(rejected.uuid);
    if(!node)continue;
    const box=new THREE.Box3().setFromObject(node);
    if(box.isEmpty())continue;
    const helper=new THREE.Box3Helper(box,0xff463f);
    helper.material.depthTest=false;
    helper.material.transparent=true;
    helper.material.opacity=0.95;
    scene.add(helper);wheelHelpers.push(helper);
  }
  return diagnostics.selectedWheels.map(wheel=>({
    quadrant:wheel.quadrant,
    center:wheel.center,
    size:wheel.size,
    selectedMesh:wheel.name,
    attachedMeshCount:wheel.meshCount,
    treadFragmentCount:wheel.treadFragmentCount,
    attachedMeshNames:wheel.meshNames,
  }));
}

function render(){
  scene.updateMatrixWorld(true);
  renderer.render(scene,camera);
}
function listCabinMeshes(root){
  const found=[];
  root.traverse(n=>{
    if(!n.isMesh)return;
    const chain=[];let p=n;
    while(p){if(p.name)chain.push(p.name);p=p.parent;}
    if(/interior|cabin|dashboard|seat|steer|console|door.?panel|mirror|gauge|instrument|pedal/i.test(chain.join(' '))){
      found.push({name:n.name||'(unnamed)',hierarchy:chain.slice(0,5).reverse().join('/')});
    }
  });
  return found.slice(0,60);
}
async function load(kind){
  if(current){
    system._setInteriorLights(false);
    system._removeParkedCollider(current);
    scene.remove(current.root);
    system.vehicles=system.vehicles.filter(v=>v!==current);
    system.driver=null;system.interiorView=false;
  }
  status.textContent='Loading '+kind+'…';
  const vehicle=await system.spawn({kind,x:0,z:0,ry:0,elevation:0});
  if(!vehicle)throw new Error('VehicleSystem.spawn failed: '+kind);
  current=vehicle;
  system.driver=vehicle;
  const lights=vehicle.cabinLights;
  const base={
    height:vehicle.interiorCamera.height,
    modelName:vehicle.kind,
    rootDimensions:(()=>{const b=new THREE.Box3().setFromObject(vehicle.root),s=b.getSize(new THREE.Vector3());return {x:s.x,y:s.y,z:s.z};})(),
    wheelCount:vehicle.wheels.length,
    meshCount:0,
    cabinMeshes:[],
    lightIntensities:lights?.children?.map(l=>({name:l.name,intensity:l.intensity,range:l.distance}))||[],
    lightsInitiallyOff:lights?!lights.visible:false,
  };
  vehicle.root.traverse(n=>{if(n.isMesh)base.meshCount++;});
  base.cabinMeshes=listCabinMeshes(vehicle.root);
  base.wheelDiagnostics=diagnoseCarWheelMeshes(vehicle.root,kind);
  base.wheelDetectionSummary=showWheelDiagnostics(base.wheelDiagnostics);
  base.meshNameSamples=[];vehicle.root.traverse(n=>{if(n.isMesh&&base.meshNameSamples.length<80)base.meshNameSamples.push(n.name||'(unnamed)');});
  report.vehicles[kind]=base;
  system._setInteriorLights(false);
  system.interiorView=false;
  camera.fov=62;camera.updateProjectionMatrix();
  camera.position.set(-7,4,-8);camera.lookAt(0,0.85,0);
  status.textContent='Loaded '+kind+' · '+base.meshCount+' meshes · '+base.wheelCount+' wheels';
  render();
  return base;
}
function setInterior(enabled){
  if(!current)throw new Error('Load a vehicle first');
  if(system.interiorView!==enabled)system.toggleInteriorView();
  // Let the real runtime camera interpolation settle before any screenshot.
  for(let frame=0;frame<36;frame++){
    system.updateChaseCamera(1/60,{mouseDX:0,mouseDY:0},player);
  }
  status.textContent=enabled?'Interior view · '+current.kind:'Exterior view · '+current.kind;
  render();
  const lights=current.cabinLights;
  return {
    interiorView:system.interiorView,
    lightsVisible:!!lights?.visible,
    cameraHeight:current.interiorCamera.height,
    cameraPosition:camera.position.toArray(),
    fov:camera.fov,
  };
}
function setExterior(){
  return setInterior(false);
}
function setCabinLights(dome,dashboard){
  if(!current?.cabinLights)throw new Error('No current vehicle lights');
  const [domeLight,dashboardLight]=current.cabinLights.children;
  if(domeLight)domeLight.intensity=Math.max(0,Number(dome)||0);
  if(dashboardLight)dashboardLight.intensity=Math.max(0,Number(dashboard)||0);
  render();
  return {dome:domeLight?.intensity,dashboard:dashboardLight?.intensity};
}
function setCameraSide(side){
  if(!current)throw new Error('No current vehicle');
  current.interiorCamera.side=Number(side)||0;
  let result=null;
  for(let frame=0;frame<36;frame++)result=system.updateChaseCamera(1/60,{mouseDX:0,mouseDY:0},player);
  render();
  return {side:current.interiorCamera.side,cameraPosition:camera.position.toArray(),fov:camera.fov};
}

function setWheelSteering(angle){
  if(!current)throw new Error('No current vehicle');
  const target=THREE.MathUtils.clamp(Number(angle)||0,-0.8,0.8);
  clearWheelDiagnostics();
  for(const wheel of current.wheels){
    wheel.pivot.rotation.y=wheel.front?target:0;
  }
  scene.updateMatrixWorld(true);
  render();
  return current.wheels.map(wheel=>({
    front:wheel.front,
    angle:wheel.pivot.rotation.y,
    wheelMeshCount:wheel.meshes.length,
    spinnerMeshCount:wheel.spinner.children.filter(child=>child.isMesh).length,
    allMeshesStayAttached:wheel.meshes.every(mesh=>mesh.parent===wheel.spinner),
  }));
}

function focusWheel(quadrant){
  if(!current)throw new Error('No current vehicle');
  const diagnostics=diagnoseCarWheelMeshes(current.root,current.kind);
  const wheel=diagnostics.selectedWheels.find(item=>item.quadrant===quadrant);
  if(!wheel)throw new Error('Wheel candidate was not detected: '+quadrant);
  const center=new THREE.Vector3(...wheel.center);
  const side=quadrant.endsWith('right')?1:-1;
  const front=quadrant.startsWith('front')?1:-1;
  camera.fov=48;camera.updateProjectionMatrix();
  camera.position.copy(center).add(new THREE.Vector3(side*2.7,0.85,front*0.38));
  camera.lookAt(center);
  status.textContent=current.kind.toUpperCase()+' · '+quadrant.toUpperCase()
    +' · '+wheel.meshCount+' MESHES IN WHEEL RIG · BOUNDS '
    +wheel.size.map(v=>v.toFixed(2)).join(' × ')+' m';
  render();
  return {quadrant,wheel,selectedWheelCount:diagnostics.selectedWheelCount,
    candidateCount:diagnostics.candidateCount,attachedWheelMeshCount:diagnostics.attachedWheelMeshCount,
    nearbyRejectedMeshes:(diagnostics.nearWheelExcludedMeshes||[]).filter(m=>m.nearestWheel===quadrant)};
}

function showWheelOverview(){
  if(!current)throw new Error('No current vehicle');
  const diagnostics=diagnoseCarWheelMeshes(current.root,current.kind);
  showWheelDiagnostics(diagnostics);
  camera.fov=62;camera.updateProjectionMatrix();
  camera.position.set(-6.4,4.1,-7.6);
  camera.lookAt(0,0.75,0);
  status.textContent=current.kind.toUpperCase()+' · WHEEL MESHES OUTLINED · '
    +diagnostics.selectedWheelCount+'/4 WHEELS · '+diagnostics.attachedWheelMeshCount
    +' ATTACHED · RED = NEARBY PARTS REJECTED BY CURRENT LIMITS: '
    +(diagnostics.nearWheelExcludedMeshes||[]).length;
  render();
  return diagnostics;
}
window.__vehicleVisualTest={
  report,
  async load(kind){return await load(kind);},
  interior(){return setInterior(true);},
  exterior(){return setExterior();},
  setCabinLights(dome,dashboard){return setCabinLights(dome,dashboard);},
  setCameraSide(side){return setCameraSide(side);},
  showInteractionDiagnostics() {
    for (const helper of interactionHelpers) scene.remove(helper);
    interactionHelpers=[];
    const anchors=current?.interactionAnchors;
    if(!current||!anchors)return {seats:[],doors:[]};
    const makeMarker=(local,color,radius)=>{
      const worldPoint=current.root.localToWorld(local.clone());
      const marker=new THREE.Mesh(
        new THREE.SphereGeometry(radius,12,8),
        new THREE.MeshBasicMaterial({color,depthTest:false})
      );
      marker.position.copy(worldPoint);marker.renderOrder=20;
      scene.add(marker);interactionHelpers.push(marker);
    };
    const seats=(anchors.seats||[]).map(seat=>{
      makeMarker(seat.anchors.occupant,seat.accepted?0x40ed8a:0xffbf47,0.13);
      makeMarker(seat.anchors.entry,0x35a7ff,0.095);
      return {name:seat.name,role:seat.role,accepted:seat.accepted,estimated:seat.estimated,
        occupant:seat.anchors.occupant.toArray(),entry:seat.anchors.entry.toArray()};
    });
    const doors=(anchors.doorCandidates||[]).map(item=>({
      name:item.name,accepted:item.accepted,reason:item.reason,
      center:item.bounds.center.toArray(),size:item.bounds.size.toArray(),
    }));
    render();
    return {seats,doors,inventory:anchors.meshInventory||[]};
  },
  async startEntry(kind) {
    await load(kind);
    system.driver=null;
    if(!player.char._isBuilt){
      const began=performance.now();
      while(!player.char._isBuilt&&performance.now()-began<25000){
        await new Promise(resolve=>setTimeout(resolve,40));
      }
    }
    if(!player.char._isBuilt)throw new Error('npc_core_001 player rig did not finish loading');
    const vehicle=current;
    player.char.setFirstPerson(false);
    player.pos.set(vehicle.pos.x+vehicle.half.x+0.7,vehicle.pos.y,vehicle.pos.z+0.1);
    player.vel.set(0,0,0);player.yaw=0;player.bodyYaw=0;
    player.onGround=true;player.firstPerson=false;player.actionAnimation=null;
    if(player.char.root.parent!==scene)scene.add(player.char.root);
    player.char.root.visible=true;
    player.char.setState(player.getState(),0);
    const result={
      model:kind,
      actionDurations:{
        punch:player.char.getActionDuration('punch'),
        enter:player.char.getActionDuration('enter_vehicle'),
        exit:player.char.getActionDuration('exit_vehicle'),
        driving:player.char.getActionDuration('vehicle_driver_idle'),
      },
      seats:vehicle.interactionAnchors?.seats?.map(s=>({name:s.name,role:s.role,accepted:s.accepted,estimated:s.estimated}))||[],
      doors:vehicle.interactionAnchors?.doorCandidates?.map(d=>d.name)||[],
    };
    const ok=system.enter(vehicle,player);
    report.vehicleTransitions[kind]={...result,entryStarted:ok};
    if(!ok)throw new Error(kind+' entry refused: '+JSON.stringify(result));
    render();
    return report.vehicleTransitions[kind];
  },
  advanceTransition(frames=60) {
    let count=0;
    for(;count<frames&&(system._enterState||system.driver);count++){
      system.update(1/60,{},player);
      scene.updateMatrixWorld(true);
    }
    render();
    return {
      transition:system._enterState?.mode||null,
      phase:system._enterState?.phase||null,
      t:system._enterState?.t||0,
      duration:system._enterState?.duration||0,
      driving:!!system.driver,
      playerParent:player.char.root.parent?.name||'',
      playerParentIsVehicle:player.char.root.parent===current?.root,
      playerWorldPosition:player.char.root.getWorldPosition(new THREE.Vector3()).toArray(),
      pose:player.char._poseMode,
      frames:count,
    };
  },
  startExit() {
    const started=system.exit(player);
    render();
    return {started,driver:!!system.driver,phase:system._enterState?.phase||null};
  },
  finishInteractionTest() {
    const result={
      exited:!system.driver&&!system._enterState,
      restoredToScene:player.char.root.parent===scene,
      finalPose:player.char._poseMode,
      finalPosition:player.pos.toArray(),
      interaction:report.vehicleTransitions[current?.kind]||null,
    };
    if(player.char.root.parent)player.char.root.parent.remove(player.char.root);
    for(const helper of interactionHelpers)scene.remove(helper);
    interactionHelpers=[];
    return result;
  },
  setWheelSteering(angle){return setWheelSteering(angle);},
  showWheelOverview(){return showWheelOverview();},
  focusWheel(quadrant){return focusWheel(quadrant);},
  details(){return {report,headings:Object.keys(CAR_PHYSICS)};},
};
window.addEventListener('error',e=>report.errors.push(String(e.message||e.error||'window error')));
window.addEventListener('unhandledrejection',e=>report.errors.push(String(e.reason)));
status.textContent='Ready';
window.__vehicleVisualTest.ready=true;
render();
