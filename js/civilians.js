import * as THREE from "./lib/three.module.js";
import { NpcCharacter, preloadNpcBase } from "./npc-character.js";
import { NPC_GLOBAL_CONFIG as C, NPC_DEFAULT_ROUTES } from "./npc-config.js";
const P=C.physics, POP=C.population;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const angleDelta=(a,b)=>Math.atan2(Math.sin(b-a),Math.cos(b-a));

function routePoints(road,side){
  const src=(road.points||[]).map(p=>({x:+p[0],z:+p[1],y:Number.isFinite(p[2])?+p[2]:0}));
  if(src.length<2)return[];
  const off=(Number(road.w)||12)/2+1.2,out=[];
  for(let i=0;i<src.length-1;i++){
    const a=src[i],b=src[i+1],dx=b.x-a.x,dz=b.z-a.z,len=Math.hypot(dx,dz);
    if(len<.1)continue;
    const nx=-dz/len,nz=dx/len,n=Math.max(1,Math.ceil(len/7));
    for(let j=0;j<n;j++){const t=j/n;out.push({x:a.x+dx*t+nx*off*side,y:Math.max(0,a.y+(b.y-a.y)*t)+.12,z:a.z+dz*t+nz*off*side});}
  }
  const a=src[src.length-2],b=src[src.length-1],dx=b.x-a.x,dz=b.z-a.z,len=Math.hypot(dx,dz)||1;
  out.push({x:b.x-dz/len*off*side,y:Math.max(0,b.y)+.12,z:b.z+dx/len*off*side});
  return out;
}

export class Civilian{
  constructor(manager,route,index,point){
    this.manager=manager;this.scene=manager.scene;this.world=manager.world;
    this.route=route;this.routeIndex=index;this.pos=new THREE.Vector3(point.x,point.y,point.z);
    this.velocity=new THREE.Vector3();this.desired=new THREE.Vector3();this.yaw=0;
    this.alive=true;this.civilian=true;this.hp=55;this.deathT=0;this.state="idle";this.idleT=1+Math.random()*2;
    this.fleeT=0;this.fleeFromPos=null;this.interactionT=0;this.interactionPhase="";this.interactionLine="";
    this.ch=new NpcCharacter(C.modelId);this.root=this.ch.root;
    this.root.position.copy(this.pos);this.root.rotation.y=Math.PI;this.scene.add(this.root);
    this.headOffset=new THREE.Vector3(0,P.headHeight,0);this.chestOffset=new THREE.Vector3(0,P.chestHeight,0);
    this.body=manager.physics?.createNpcController(this.pos.x,this.pos.y,this.pos.z,{radius:P.radius,height:P.height,stepHeight:P.stepHeight})||null;
    this.ready=this.ch.ready.then(()=>this.ch.play("idle"));
  }
  fleeFrom(source,radius=P.fleeRadius){
    if(!this.alive||this.pos.distanceTo(source)>radius)return;
    if(this.fleeT<=0)this.fleeFromPos=source.clone();
    this.fleeT=Math.max(this.fleeT,P.fleeSeconds);this.interactionT=0;this.state="flee";
    if(this.ch.currentAnimation!=="run")this.ch.play("run",{loop:true});
  }
  greet(player){
    if(!this.alive||this.fleeT>0)return null;
    this.interactionT=C.interaction.duration;this.interactionPhase="wave";
    this.interactionLine=C.interaction.lines[(Math.random()*C.interaction.lines.length)|0];
    this.face(player.pos);this.ch.play("wave",{loop:false});return this.interactionLine;
  }
  face(p){
    const dx=p.x-this.pos.x,dz=p.z-this.pos.z;if(dx*dx+dz*dz<.001)return;
    this.yaw+=angleDelta(this.yaw,Math.atan2(dx,dz))*.25;
  }
  raycastHit(origin,dir,maxDist){
    const parts=[{p:this.pos.clone().add(this.headOffset),r:.21,head:true},{p:this.pos.clone().add(this.chestOffset),r:.38,head:false},{p:this.pos.clone().add(new THREE.Vector3(0,.48,0)),r:.31,head:false}];
    let best=null;
    for(const q of parts){const oc=q.p.clone().sub(origin),t=oc.dot(dir);if(t<0||t>maxDist)continue;const d2=oc.lengthSq()-t*t;if(d2>q.r*q.r)continue;const dist=Math.max(0,t-Math.sqrt(q.r*q.r-d2));if(!best||dist<best.dist)best={dist,head:q.head};}
    return best;
  }
  takeDamage(amount){
    if(!this.alive)return false;this.hp-=Math.max(0,Number(amount)||0);
    if(this.hp<=0){this.alive=false;this.deathT=0;this.state="dead";this.velocity.set(0,0,0);this.ch.play("fall_death",{loop:false});this.manager.onCasualty?.(this);return true;}
    this.fleeFrom(this.manager.lastDamageSource||this.manager.playerPosition(),22);return false;
  }
  avoidVehicles(){
    let panic=false;this.vehicleSource=null;
    for(const v of this.manager.vehicles?.vehicles||[]){
      if(!v?.pos)continue;const dx=this.pos.x-v.pos.x,dz=this.pos.z-v.pos.z,d=Math.hypot(dx,dz);if(d<.01)continue;
      const half=v.bodyBox?Math.max(v.bodyBox.max.x-v.bodyBox.min.x,v.bodyBox.max.z-v.bodyBox.min.z)/2:2.5;
      const moving=Math.abs(v.speed||0)>P.vehiclePanicSpeed,edge=half+P.radius+.7;
      if(d<edge+3)this.desired.add(new THREE.Vector3(dx/d,0,dz/d).multiplyScalar(clamp((edge+3-d)/3,0,1)*(moving?2.2:1)));
      if(moving&&d<P.vehiclePanicDistance+half){panic=true;this.vehicleSource=v.pos;}
    }
    return panic;
  }
  update(dt,ctx={}){
    const d=Math.min(Math.max(dt,0),.05);
    if(!this.alive){this.deathT+=d;this.ch.update(d);return this.deathT>=POP.keepDeadSeconds;}
    const player=ctx.player,pd=player?this.pos.distanceTo(player.pos):Infinity;
    let aimed=false;
    if(ctx.aiming&&player&&ctx.camera&&pd<P.aimPanicRadius){
      const view=ctx.camera.getWorldDirection(new THREE.Vector3());view.y=0;
      const to=new THREE.Vector3(this.pos.x-player.pos.x,0,this.pos.z-player.pos.z);
      if(view.lengthSq()>.001&&to.lengthSq()>.001)aimed=view.normalize().dot(to.normalize())>.82;
    }
    if((aimed||(ctx.gunshot&&pd<P.gunshotPanicRadius))&&this.fleeT<=0)this.fleeFrom(player.pos,aimed?P.aimPanicRadius:P.gunshotPanicRadius);
    this.desired.set(0,0,0);
    if(this.avoidVehicles()&&this.fleeT<=0)this.fleeFrom(this.vehicleSource||player?.pos||this.pos,P.vehiclePanicDistance+5);
    if(this.interactionT>0&&this.fleeT<=0&&player){
      this.interactionT-=d;this.face(player.pos);
      if(this.interactionPhase==="wave"&&this.interactionT<C.interaction.duration-C.interaction.waveSeconds){this.interactionPhase="talk";this.ch.play("talk",{loop:true});}
      if(this.interactionT<=0){this.interactionPhase="";this.ch.play("idle",{loop:true});}
      this.root.position.copy(this.pos);this.root.rotation.y=this.yaw+Math.PI;this.ch.update(d);return false;
    }
    if(this.fleeT>0){
      this.fleeT=Math.max(0,this.fleeT-d);
      const away=this.fleeFromPos?this.pos.clone().sub(this.fleeFromPos):new THREE.Vector3(Math.sin(this.yaw),0,Math.cos(this.yaw));
      away.y=0;if(away.lengthSq()<.001)away.set(Math.sin(this.yaw),0,Math.cos(this.yaw));
      this.desired.copy(away.normalize()).multiplyScalar(P.fleeSpeed);this.state="flee";
      if(this.ch.currentAnimation!=="run")this.ch.play("run",{loop:true});
    }else{
      this.idleT-=d;const target=this.route?.[this.routeIndex%this.route.length];
      if(this.idleT<=0&&target){
        let dx=target.x-this.pos.x,dz=target.z-this.pos.z,len=Math.hypot(dx,dz);
        if(len<C.behaviour.routeArrivalDistance){this.routeIndex=(this.routeIndex+1)%this.route.length;}
        const next=this.route[this.routeIndex%this.route.length];dx=next.x-this.pos.x;dz=next.z-this.pos.z;len=Math.hypot(dx,dz);
        if(len>.1){this.desired.set(dx/len,0,dz/len).multiplyScalar(P.walkSpeed);this.state="walk";}else this.state="idle";
      }else this.state="idle";
    }
    for(const other of this.manager.list){if(other===this||!other.alive)continue;const dx=this.pos.x-other.pos.x,dz=this.pos.z-other.pos.z,dist=Math.hypot(dx,dz);if(dist>.01&&dist<P.personalSpace){const k=(P.personalSpace-dist)/P.personalSpace;this.desired.x+=dx/dist*k;this.desired.z+=dz/dist*k;}}
    if(player&&pd<P.playerAvoidanceRadius&&pd>.05&&this.fleeT<=0)this.desired.add(new THREE.Vector3(this.pos.x-player.pos.x,0,this.pos.z-player.pos.z).normalize().multiplyScalar((P.playerAvoidanceRadius-pd)*1.5));
    const cap=this.fleeT>0?P.fleeSpeed:(this.state==="walk"?P.walkSpeed:0);
    if(this.desired.lengthSq()>cap*cap)this.desired.setLength(cap);
    const response=this.desired.lengthSq()>this.velocity.lengthSq()?P.acceleration:P.braking;
    this.velocity.lerp(this.desired,1-Math.exp(-response*d));
    if(this.desired.lengthSq()<.001)this.velocity.multiplyScalar(Math.exp(-P.groundFriction*d));
    const targetY=this.route?.[this.routeIndex]?.y??this.pos.y,dx=this.velocity.x*d,dz=this.velocity.z*d,dy=clamp(targetY-this.pos.y,-P.stepHeight,P.stepHeight);
    const moved=this.body?this.manager.physics.moveNpcController(this.body,dx,dy,dz):null;
    if(moved?.position)this.pos.copy(moved.position);
    else{
      const steps=Math.max(1,Math.ceil(Math.hypot(dx,dz)/P.collisionSubstep));
      for(let i=0;i<steps;i++){const x=this.pos.x+dx/steps,z=this.pos.z+dz/steps;if(this.world.colliderAt(x,z,P.radius)){this.velocity.multiplyScalar(.15);break;}this.pos.x=x;this.pos.z=z;}
      this.pos.y+=(targetY-this.pos.y)*(1-Math.exp(-8*d));
    }
    const speed=Math.hypot(this.velocity.x,this.velocity.z);
    if(speed>.12)this.yaw+=angleDelta(this.yaw,Math.atan2(this.velocity.x,this.velocity.z))*(1-Math.exp(-P.turnResponse*d));
    else if(player&&pd<C.behaviour.lookAtPlayerDistance)this.face(player.pos);
    this.root.position.copy(this.pos);this.root.rotation.y=this.yaw+Math.PI;
    const anim=speed>=P.sprintSpeed*.92?"sprint":speed>P.runSpeed?"run":speed>.25?(this.fleeT>0?"run":"walk"):"idle";
    if(anim!==this.ch.currentAnimation&&!["wave","talk","fall_death"].includes(this.ch.currentAnimation))this.ch.play(anim,{loop:true});
    if(speed>.1){const reference=anim==="sprint"?P.sprintSpeed:anim==="run"?P.runSpeed:P.walkSpeed;this.ch.setTimeScale(speed/reference);}
    this.ch.update(d);return false;
  }
  dispose(){this.manager.physics?.removeNpcController(this.body);this.body=null;this.ch.dispose();}
}

export class Civilians{
  constructor(scene,world,options={}){
    this.scene=scene;this.world=world;this.physics=options.physics||null;this.vehicles=options.vehicles||null;
    this.player=options.player||null;this.quality=options.quality||"medium";this.hud=options.hud||null;
    this.list=[];this.routes=[];this.onCasualty=null;this.spawnTimer=0;this.lastDamageSource=null;this.ui=null;
    this.ready=this.initialize().catch(error=>{this.loadError=error;console.error("[NPC] civilian_002 failed; legacy fallback disabled.",error);this.setUi("",false);return this;});
  }
  async initialize(){
    await preloadNpcBase(C.modelId);this.buildRoutes();this.createUi();this.populateInitial();
    console.info("[NPC] civilian_002 population ready: "+this.list.length);return this;
  }
  buildRoutes(){
    const defs=Array.isArray(this.world.sceneData?.pedestrianRoutes)?this.world.sceneData.pedestrianRoutes:NPC_DEFAULT_ROUTES;
    const roads=this.world.sceneData?.roads||[];this.routes=[];
    for(const def of defs){const road=roads.find(r=>r.name===def.road);if(!road?.sidewalk)continue;
      for(const side of def.sides||[1]){const points=routePoints(road,Number(side)<0?-1:1);if(points.length>1)this.routes.push({id:def.road+":"+side,points});}
    }
    if(!this.routes.length)console.warn("[NPC] No authored sidewalk routes found.");
  }
  createUi(){
    if(typeof document==="undefined"||this.ui)return;
    const el=document.createElement("div");el.id="npc-interaction-ui";
    el.style.cssText="position:fixed;left:50%;bottom:12%;transform:translateX(-50%);z-index:45;display:none;max-width:min(90vw,420px);padding:10px 16px;border:1px solid rgba(255,255,255,.22);border-radius:8px;background:rgba(9,13,16,.82);backdrop-filter:blur(10px);color:#f2f4f5;font:600 13px/1.45 system-ui,sans-serif;text-align:center;pointer-events:none;";
    document.body.appendChild(el);this.ui=el;
  }
  setUi(text,visible=true){if(this.ui){this.ui.textContent=text;this.ui.style.display=visible?"block":"none";}}
  limit(){return POP.maxActive[this.quality]||POP.maxActive.medium;}
  locations(){const a=[];for(const route of this.routes)for(let i=0;i<route.points.length;i+=2)a.push({route,index:i,point:route.points[i]});return a;}
  populateInitial(){
    const origin=this.world.startPoint||{x:0,z:0},items=this.locations().sort((a,b)=>Math.hypot(a.point.x-origin.x,a.point.z-origin.z)-Math.hypot(b.point.x-origin.x,b.point.z-origin.z)),selected=[];
    for(const item of items){if(selected.length>=this.limit())break;if(Math.hypot(item.point.x-origin.x,item.point.z-origin.z)>POP.spawnRadius)continue;
      if(selected.some(p=>Math.hypot(p.point.x-item.point.x,p.point.z-item.point.z)<POP.minSpawnSeparation))continue;
      if(!this.world.colliderAt(item.point.x,item.point.z,P.radius))selected.push(item);
    }
    for(const item of selected)this.spawnAt(item);
  }
  spawnAt(item){const npc=new Civilian(this,item.route,item.index,item.point);npc.ready.catch(e=>console.error("[NPC] Instance load failed.",e));this.list.push(npc);return npc;}
  trySpawnNearPlayer(){
    if(!this.player||!this.routes.length)return;const x=this.player.pos.x,z=this.player.pos.z;
    const nearby=this.locations().filter(i=>Math.hypot(i.point.x-x,i.point.z-z)<POP.spawnRadius);
    for(let i=0;i<Math.min(POP.maxSpawnAttempts,nearby.length);i++){const item=nearby[(Math.random()*nearby.length)|0];
      if(this.world.colliderAt(item.point.x,item.point.z,P.radius))continue;
      if(this.list.some(n=>n.alive&&Math.hypot(n.pos.x-item.point.x,n.pos.z-item.point.z)<POP.minSpawnSeparation))continue;
      this.spawnAt(item);return;
    }
  }
  playerPosition(){return this.player?.pos||new THREE.Vector3();}
  nearest(pos=this.playerPosition(),max=P.interactionLookRadius){
    let best=null,dist=max;for(const npc of this.list){if(!npc.alive||npc.fleeT>0)continue;const d=Math.hypot(npc.pos.x-pos.x,npc.pos.z-pos.z);if(d<dist){best=npc;dist=d;}}
    return best?{civilian:best,distance:dist}:null;
  }
  tryInteract(player=this.player){
    if(!player)return false;const active=this.list.find(n=>n.alive&&n.interactionT>0);
    if(active){active.interactionT=0;active.ch.play("idle",{loop:true});this.setUi("",false);return true;}
    const near=this.nearest(player.pos,P.interactionRadius);if(!near)return false;const line=near.civilian.greet(player);if(line)this.setUi(line,true);return !!line;
  }
  fleeFrom(pos,radius=P.fleeRadius){this.lastDamageSource=pos.clone?pos.clone():new THREE.Vector3(pos.x,0,pos.z);for(const npc of this.list)npc.fleeFrom(pos,radius);}
  resetPopulation(){for(const npc of this.list)npc.dispose();this.list.length=0;this.populateInitial();}
  update(dt,ctx={}){
    if(!this.routes.length)return;this.player=ctx.player||this.player;this.vehicles=ctx.vehicles||this.vehicles;
    const player=this.player,pos=player?.pos||new THREE.Vector3(),keep=[];let ui=null;
    for(const npc of this.list){const d=player?npc.pos.distanceTo(pos):Infinity;
      if(npc.alive&&d>POP.despawnRadius){npc.dispose();continue;}
      if(npc.alive&&d<=POP.activeRadius)npc.update(dt,{player,aiming:!!ctx.aiming,gunshot:!!ctx.gunshot,camera:ctx.camera});
      else if(!npc.alive&&npc.update(dt,{})){npc.dispose();continue;}
      if(npc.alive&&d<P.interactionLookRadius&&(!ui||d<ui.distance))ui={civilian:npc,distance:d};
      keep.push(npc);
    }
    this.list=keep;this.spawnTimer-=dt;
    if(this.spawnTimer<=0&&this.list.filter(n=>n.alive).length<this.limit()){this.spawnTimer=POP.spawnInterval;this.trySpawnNearPlayer();}
    if(ui&&ui.distance<P.interactionRadius)this.setUi(ui.civilian.interactionT>0?ui.civilian.interactionLine:C.interaction.prompt,true);
    else if(!this.list.some(n=>n.interactionT>0))this.setUi("",false);
  }
  alive(){return this.list.filter(n=>n.alive);}
  dispose(){for(const npc of this.list)npc.dispose();this.list.length=0;this.ui?.remove();this.ui=null;}
}
