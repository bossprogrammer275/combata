import * as THREE from 'three';
import { VehicleSystem, CAR_PHYSICS } from '../js/vehicles.js';

const canvas=document.getElementById('view');
const status=document.getElementById('status');
const renderer=new THREE.WebGLRenderer({canvas,antialias:true,preserveDrawingBuffer:true});
renderer.setPixelRatio(1);
renderer.setSize(1440,900,false);
renderer.outputColorSpace=THREE.SRGBColorSpace;
renderer.toneMapping=THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure=1;

const scene=new THREE.Scene();
scene.background=new THREE.Color(0x202832);
scene.add(new THREE.HemisphereLight(0xc9d8e8,0x23252c,0.72));
const key=new THREE.DirectionalLight(0xffedda,1.5);
key.position.set(-5,9,7);
scene.add(key);
const fill=new THREE.DirectionalLight(0x9bb9df,0.34);
fill.position.set(5,4,-6);
scene.add(fill);
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
const player={pos:new THREE.Vector3(),yaw:0};
let current=null;
const report={vehicles:{},screenshots:[],errors:[]};

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
    if(/interior|cabin|dashboard|seat|steer|console|door.?panel|mirror|gauge|instrument|pedal|wheel/i.test(chain.join(' '))){
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
    wheelCount:vehicle.wheels.length,
    meshCount:0,
    cabinMeshes:[],
    lightIntensities:lights?.children?.map(l=>({name:l.name,intensity:l.intensity,range:l.distance}))||[],
    lightsInitiallyOff:lights?!lights.visible:false,
  };
  vehicle.root.traverse(n=>{if(n.isMesh)base.meshCount++;});
  base.cabinMeshes=listCabinMeshes(vehicle.root);
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
  system.updateChaseCamera(1/60,{mouseDX:0,mouseDY:0},player);
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
window.__vehicleVisualTest={
  report,
  async load(kind){return await load(kind);},
  interior(){return setInterior(true);},
  exterior(){return setExterior();},
  setCabinLights(dome,dashboard){return setCabinLights(dome,dashboard);},
  details(){return {report,headings:Object.keys(CAR_PHYSICS)};},
};
window.addEventListener('error',e=>report.errors.push(String(e.message||e.error||'window error')));
window.addEventListener('unhandledrejection',e=>report.errors.push(String(e.reason)));
status.textContent='Ready';
window.__vehicleVisualTest.ready=true;
render();
