// World — GLB-only city with authored roads.
import * as THREE from 'three';

function yieldStreamingWork() {
  return new Promise(resolve => {
    if (typeof requestIdleCallback === 'function') requestIdleCallback(resolve, { timeout: 90 });
    else setTimeout(resolve, 24);
  });
}
import * as TEX from './textures.js';
import { createGroundRendererMaterial } from './ground-renderer.js';
import { GLTFLoader } from './lib/GLTFLoader.js';
import { BVHWorld } from './bvh-collision.js';
import { Atmosphere } from './atmosphere.js';
import { loadAssetOverrides, applyAssetOverrides } from './asset-overrides.js';
import { annotateWorldKitInstance, classifyWorldKitMesh, getWorldKitPlacementOffset, getWorldKitScalePlan, getWorldKitDoorMarkers, getWorldKitDoorGroups, getWorldKitCollisionManifest, getWorldKitDefinition, WORLD_KIT_ROAD_PACK_PARTS, WORLD_KIT_ROAD_PACK_SCALE, WORLD_KIT_SIDEWALK_COMPONENTS } from './world-kit.js';
import { extractWorldBridgeKit, WORLD_BRIDGE_KIT_URL } from './world-bridge-kit.js';

function rng(a, b) { return a + Math.random() * (b - a); }

// Deterministic PRNG so per-building details are stable across rebuilds.
function mulberry(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function lerp(a, b, t) { return a + (b - a) * t; }

// Sample a quadratic Bezier: P0, C (control), P1
function bezier2(p0, p1, c, t) {
  const mt = 1 - t;
  return {
    x: mt * mt * p0.x + 2 * mt * t * c.x + t * t * p1.x,
    z: mt * mt * p0.z + 2 * mt * t * c.z + t * t * p1.z,
  };
}

export class World {
  constructor(scene, quality = 'high', sceneData = null, renderCapabilities = {}) {
    this.scene = scene;
    this.sceneData = sceneData;
    this.mapId = sceneData ? (sceneData.id || 'authored') : 'desert';
    this.colliders = [];     // {min:Vector3, max:Vector3} solid AABBs
    this.climbables = [];    // {min,max} climbable objects
    this.interiors = [];     // {min,max} enterable volumes
    this.portals = [];       // {pos:Vector3, dir:Vector3, target:Vector3, type:'enter'|'exit', buildingIdx:number}
    this.coverPoints = [];   // positions bots can fight from
    this.spawnPoints = [];   // where waves spawn
    this.lootPoints = [];    // {x,z} lootable crates
    this.namedLocations = []; // {x,z,name,color} labelled landmarks
    this.transitPoints = [];  // {x,z,name} fast-travel destinations
    this.roofAccess = [];     // {x,z,y,rx,rz} walkable rooftops
    this.reactiveObjects = []; // {mesh, kind, base, sway, ...}
    this.npcInteractables = []; // semantic seats, phones, counters and other civilian-use nodes
    this.vehicleSpawns = [];  // {x,z,ry,kind} parked/drivable vehicles
    this._buildingData = [];  // {url,min,max,x,z,doors[],interior} — auto-detected from GLB
    this.worldKitComponents = []; // imported component instances with semantic role metadata
    this.roadModuleInstances = []; // imported Road Pack surface tiles used by the authored-road renderer
    this.roadPackSurfaceMeshes = []; // merged visible meshes using the six downloaded Road Pack materials
    this.roadPackJunctionMeshes = [];
    this.roadPackJunctionCount = 0;
    this.roadPackRoadCount = 0;
    this.roadPackCornerCount = 0;
    this.roadJunctionTypeCounts = { tJunction: 0, crossroads: 0, bends: 0, complex: 0 };
    this.streetBaseMeshes = [];
    this.streetBaseCount = 0;
    this.streetBaseSegmentCount = 0;
    this.streetBaseJunctionCount = 0;
    this.roadStopLineCount = 0;
    this.roadPackRoadSkippedNames = [];
    this.legacyRoadSurfaceCount = 0;
    this._roadPackGeometryBuckets = new Map();
    this.sidewalkModuleInstances = []; // authored driveway, corner and damaged-pavement pieces
    this.bridgeComponentInstances = []; // ten independent reusable bridge structure/deck prefabs placed in the world
    this.bridgeSectionInstances = []; // measured structure/deck pairs with ground and deck alignment diagnostics
    this.districtPlotInstances = []; // authored lawns, compounds, driveways and market forecourts
    this._bridgeKit = null;
    this._bridgeKitPromise = null;
    this._roadPackPrefabs = null;
    this._roadPackPromise = null;
    this.bounds = sceneData && sceneData.bounds ? sceneData.bounds : (quality === 'ultra-low' ? 1000 : 2000);
    this._quality = quality;
    const streamSpec = sceneData?.streaming || {};
    const streamNumber = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
    const chunkSize = THREE.MathUtils.clamp(streamNumber(streamSpec.chunkSize, 96), 48, 256);
    const loadRadius = THREE.MathUtils.clamp(streamNumber(streamSpec.loadRadius, 160), 80, 512);
    this._streamingConfig = {
      enabled: streamSpec.enabled !== false,
      chunkSize,
      initialRadius: THREE.MathUtils.clamp(streamNumber(streamSpec.initialRadius, 112), 64, loadRadius),
      loadRadius,
      unloadRadius: Math.max(loadRadius + chunkSize * 0.5, streamNumber(streamSpec.unloadRadius, loadRadius + chunkSize * 1.25)),
      updateInterval: THREE.MathUtils.clamp(streamNumber(streamSpec.updateInterval, 0.4), 0.15, 1.5),
      loadMoveThreshold: THREE.MathUtils.clamp(streamNumber(streamSpec.loadMoveThreshold, 6), 3, 24),
      assetConcurrency: Math.round(THREE.MathUtils.clamp(streamNumber(streamSpec.assetConcurrency, 2), 1, 4)),
    };
    this._streamingChunks = new Map();
    this._streamingQueue = [];
    this._streamingLoading = false;
    this._streamingElapsed = 0;
    this._streamingLive = false;
    this._streamingLastLoadPosition = null;
    this._streamingDeferredChunks = 0;
    this._activeStreamingChunk = null;
    this._glbUrlRefCounts = new Map();
    const requestedAnisotropy = quality === 'ultra' ? 16 : quality === 'high' ? 8 : quality === 'medium' ? 4 : quality === 'low' ? 2 : 1;
    this._maxAnisotropy = Math.min(requestedAnisotropy, Number(renderCapabilities.maxAnisotropy) || 4);
    this._deviceMemoryGB = Math.max(1, Number(renderCapabilities.deviceMemory) || 4);
    TEX.configureTextureAnisotropy(this._maxAnisotropy);
    this.group = new THREE.Group();
    scene.add(this.group);
    this._boxBatch = [];     // {x,y,z,w,h,d,ry,mat,shadow} — static boxes to batch
    this._planeBatch = [];   // {x,y,z,rw,rh,rz,mat,w,h,shadow} — static planes to batch
    this._ribbonBatch = [];  // {left[], right[], y, mat, closed} — mitered road/sidewalk ribbons
    this.roadPhysicsMeshes = []; // exact visible road/sidewalk/curb ribbon meshes
    this._trimBatch = [];    // {x,y,z,w,h,d,ry,mat} — AO base skirts + roofline lips

    // Create collision indexes before assets load; initializing BVHWorld after
    // loading discards model BVHs registered during _loadGLBAsset.
    this._physics = null; // set by main.js after Physics.init()
    this.bvhWorld = new BVHWorld();
    this.grid = this.bvhWorld;
    this.buildLighting(quality);
    // buildSky() has a low-cost ultra-low fallback. Always call it so low-end
    // devices receive a real sky background instead of the renderer's black clear.
    this.buildSky();
    this.buildGround(sceneData && sceneData.ground, sceneData && sceneData.waterways);
    this.startPoint = { x: 0, z: 40, yaw: Math.PI };
    this.assetsReady = Promise.resolve();
    if (sceneData) {
      this.assetsReady = this.buildFromScene(sceneData).then(() => {
        this._flushGeometry();
        this._rebuildGrid();
        this.grid = this.bvhWorld; // alias for backward compat
      });
    } else {
      this._flushGeometry();
      this._rebuildGrid();
      this.grid = this.bvhWorld;
    }
    this._finishSpawnPoints();
  }

  setTextureAnisotropy(value) {
    this._maxAnisotropy = Math.max(1, Math.min(16, Number(value) || 1));
    TEX.configureTextureAnisotropy(this._maxAnisotropy);
    this.group.traverse(object => {
      if (!object.isMesh) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        if (!material) continue;
        for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'bumpMap', 'alphaMap']) {
          const texture = material[key];
          if (texture) {
            texture.anisotropy = this._maxAnisotropy;
            texture.needsUpdate = true;
          }
        }
      }
    });
    return this._maxAnisotropy;
  }

  // ===== MATERIALS =====
  _mat(key, make) {
    if (!this._mats) this._mats = {};
    if (!this._mats[key]) this._mats[key] = this._quality === 'ultra-low' ? new THREE.MeshBasicMaterial({ color: 0x888888 }) : make();
    return this._mats[key];
  }
  mConcrete(tint) { return this._mat('concrete' + (tint || ''), () => new THREE.MeshStandardMaterial({ map: TEX.makeConcreteTexture(512, tint || [150, 148, 145]), roughness: .95, metalness: 0 })); }
  mBrick(tint) { return this._mat('brick' + (tint || ''), () => new THREE.MeshStandardMaterial({ map: TEX.makeBrickTexture(256, tint), roughness: .95, metalness: 0 })); }
  mMetal() { return this._mat('metal', () => new THREE.MeshStandardMaterial({ map: TEX.makeMetalTexture(), roughness: .5, metalness: .65 })); }
  mCrate() { return this._mat('crate', () => new THREE.MeshStandardMaterial({ map: TEX.makeCrateTexture(512), roughness: .9, metalness: 0 })); }
  mWood() { return this._mat('wood', () => new THREE.MeshStandardMaterial({ map: TEX.makePlankTexture(512, [128, 100, 72]), roughness: .85, metalness: 0 })); }
  mBarrel() { return this._mat('barrel', () => new THREE.MeshStandardMaterial({ map: TEX.makeMetalTexture(512, [110, 60, 40]), roughness: .55, metalness: .6 })); }
  mFoliage() { return this._mat('foliage', () => new THREE.MeshStandardMaterial({ color: 0x3f6b34, roughness: 1, metalness: 0, side: THREE.DoubleSide })); }
  mTrunk() { return this._mat('trunk', () => new THREE.MeshStandardMaterial({ map: TEX.makeConcreteTexture(256, [92, 78, 60]), roughness: 1, metalness: 0 })); }
  mRoof() { return this._mat('roof', () => new THREE.MeshStandardMaterial({ map: TEX.makeRoofTexture(), roughness: .95, metalness: 0 })); }
  mShingle() { return this._mat('shingle', () => new THREE.MeshStandardMaterial({ map: TEX.makeShingleTexture(), roughness: .9, metalness: 0 })); }
  mTile() { return this._mat('tile', () => new THREE.MeshStandardMaterial({ map: TEX.makeTileTexture(), roughness: .85, metalness: .1 })); }
  mPanel(tint) { return this._mat('panel' + (tint || ''), () => new THREE.MeshStandardMaterial({ map: TEX.makeConcreteTexture(512, tint || [168, 166, 160]), roughness: .9, metalness: 0 })); }
  mGlass() { return this._mat('glass', () => new THREE.MeshPhysicalMaterial({ map: TEX.makeGlassTexture(), color: 0xbfd4e4, roughness: .1, metalness: .1, transparent: true, opacity: .45, envMapIntensity: 1.5, clearcoat: .5, clearcoatRoughness: .15 })); }
  mDoor(color) { return this._mat('door' + (color || ''), () => new THREE.MeshStandardMaterial({ map: TEX.makeDoorTexture(256, color), roughness: .65, metalness: .2 })); }
  mRoller() { return this._mat('roller', () => new THREE.MeshStandardMaterial({ map: TEX.makeRollerTexture(), roughness: .6, metalness: .55 })); }
  mCorrugated(tint) { return this._mat('corr' + (tint || ''), () => new THREE.MeshStandardMaterial({ map: TEX.makeCorrugatedTexture(512, tint || [126, 128, 124]), roughness: .55, metalness: .7 })); }
  mSidewalk() { return this._mat('walk', () => new THREE.MeshStandardMaterial({ map: TEX.makeSidewalkTexture(), roughness: .95, metalness: 0 })); }
  mRoad() { return this._mat('road', () => {
    // Keep paint out of the asphalt bitmap. Lane markings are generated as
    // separate geometry from the authored road polylines so they stop at junctions.
    const tex = TEX.makeRoadTexture(1024, false);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    // Several authored road ribbons overlap at intersections. Disable depth
    // writes for asphalt so equal-height road meshes do not z-fight or leave
    // raised 2–6cm strips; later paint geometry is drawn above this surface.
    return new THREE.MeshStandardMaterial({
      map: tex, roughness: .94, metalness: 0, side: THREE.DoubleSide, depthWrite: false,
    });
  }); }
  mCurb() { return this._mat('curb', () => new THREE.MeshStandardMaterial({ map: TEX.makeConcreteTexture(256, [142, 142, 140]), roughness: .9, metalness: 0 })); }
  mSand() { return this._mat('sand', () => new THREE.MeshStandardMaterial({ map: TEX.makeSandTexture(), roughness: .98, metalness: 0 })); }
  mOcean() { return this._mat('ocean', () => new THREE.MeshStandardMaterial({ map: TEX.makeWaterTexture(), color: 0x2ae6f0, roughness: .1, metalness: .6, transparent: true, opacity: .82, envMapIntensity: 2.0 })); }
  mModernGlass() { return this._mat('modernglass', () => new THREE.MeshPhysicalMaterial({ map: TEX.makeModernGlassTexture(), color: 0x90c4e8, roughness: .05, metalness: .25, transparent: true, opacity: .75, envMapIntensity: 2.5, clearcoat: 1.0, clearcoatRoughness: .1 })); }
  mArtDeco(pastel = 'pink') { return this._mat('artdeco' + pastel, () => new THREE.MeshStandardMaterial({ map: TEX.makeArtDecoTexture(512, pastel), roughness: .85, metalness: .05 })); }
  mWoodDeck() { return this._mat('wooddeck', () => new THREE.MeshStandardMaterial({ map: TEX.makeWoodDeckTexture(), roughness: .88, metalness: 0 })); }
  mNeon(color = '#ff2a85', text = 'VICE') { return this._mat('neon' + color + text, () => new THREE.MeshStandardMaterial({ map: TEX.makeNeonSignTexture(text, color), emissive: new THREE.Color(color), emissiveIntensity: 1.2, roughness: .2, metalness: .5 })); }
  mPalmTrunk() { return this._mat('palmtrunk', () => new THREE.MeshStandardMaterial({ map: TEX.makePalmTrunkTexture(), roughness: .92, metalness: 0 })); }
  mPalmFrond() { return this._mat('palmfrond', () => new THREE.MeshStandardMaterial({ map: TEX.makePalmFrondTexture(), roughness: .8, metalness: .05, side: THREE.DoubleSide })); }
  mTrimAO() { return this._mat('trimao', () => new THREE.MeshStandardMaterial({ color: 0x04060a, transparent: true, opacity: .35, roughness: 1, metalness: 0, depthWrite: false })); }
  mTrimLip() { return this._mat('trimlip', () => new THREE.MeshStandardMaterial({ color: 0x26282c, roughness: .75, metalness: .15 })); }

  // Color palettes for visual variety across zones
  _pal(tag, tints) {
    return tints[Math.floor(Math.random() * tints.length)];
  }
  get _coreConcrete() { return [[150, 150, 152], [162, 158, 148], [140, 144, 156], [170, 166, 158], [138, 142, 148], [154, 148, 138], [146, 152, 150], [160, 154, 146], [142, 138, 144], [168, 162, 152]]; }
  get _coreBrick()    { return [[180, 100, 70], [160, 90, 60], [190, 110, 80], [140, 80, 55], [170, 115, 75], [150, 96, 66], [196, 118, 84], [132, 84, 58], [178, 106, 72], [158, 102, 68]]; }
  get _coreRoof()     { return [[96, 92, 86], [112, 82, 62], [82, 88, 100], [108, 96, 72], [130, 105, 80], [92, 100, 94], [118, 90, 70], [86, 92, 84]]; }
  get _docksConcrete(){ return [[120, 116, 108], [130, 124, 114], [112, 118, 120], [140, 130, 118], [108, 104, 100], [126, 120, 110], [116, 124, 118], [134, 126, 116]]; }
  get _docksMetal()   { return [[60, 90, 110], [150, 60, 45], [95, 100, 70], [80, 85, 82], [115, 80, 65], [70, 96, 86], [140, 72, 52], [88, 92, 78]]; }
  get _perimConcrete(){ return [[128, 122, 110], [120, 118, 112], [135, 126, 115], [140, 132, 118], [118, 114, 106], [130, 126, 114], [122, 116, 108]]; }
  get _perimRoof()    { return [[90, 86, 80], [105, 95, 82], [78, 82, 88], [95, 88, 78], [84, 90, 82]]; }

  // ===== COLLIDERS =====
  addCollider(x, y, z, w, h, d, climb = false, type = null) {
    const c = { min: new THREE.Vector3(x - w / 2, y, z - d / 2), max: new THREE.Vector3(x + w / 2, y + h, z + d / 2) };
    if (type) c.type = type;
    if (this._activeStreamingChunk) c._streamChunkKey = this._activeStreamingChunk.key;
    // Climbables remain solid while approaching them; the separate climbable
    // registry only adds vault/climb interaction. Previously they were excluded
    // from movement AABBs and Rapier, so fences were physically ghostlike.
    this.colliders.push(c);
    if (climb) this.climbables.push(c);
    if (this.bvhWorld) {
      this.bvhWorld.aabbColliders.push(c);
      this.bvhWorld.indexAABB(c);
      if (climb) this.bvhWorld._climbables.push(c);
    }
    return c;
  }

  box(x, y, z, w, h, d, mat, collide = true, ry = 0, climb = false, reactive = null) {
    let col = null;
    if (collide) {
      if (ry) {
        const c = Math.abs(Math.cos(ry)), s = Math.abs(Math.sin(ry));
        const ex = (w / 2) * c + (d / 2) * s, ez = (w / 2) * s + (d / 2) * c;
        col = this.addCollider(x, y, z, ex * 2, h, ez * 2, climb);
      } else {
        col = this.addCollider(x, y, z, w, h, d, climb);
      }
    }
    // Reactive objects need individual meshes (runtime state changes)
    if (reactive) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, y + h / 2, z); m.rotation.y = ry || 0;
      m.castShadow = true; m.receiveShadow = true;
      this.group.add(m);
      this._registerReactive(m, reactive, col);
      return m;
    }
    // Static boxes: batch into InstancedMesh for performance
    this._boxBatch.push({ x, y: y + h / 2, z, w, h, d, ry: ry || 0, mat, shadow: true });
    return null;
  }

  addInterior(min, max, transform = null) {
    this.interiors.push({ min, max, transform });
  }

  addPortal(pos, dir, target, type = 'enter', buildingIdx = -1) {
    const p = { pos: pos.clone(), dir: dir.clone(), target: target.clone(), type, buildingIdx };
    this.portals.push(p);
    return p;
  }

  // Hollow box: 4 walls with a door gap in the front face. Interior is walkable.
  // This replaces box() for buildings the player should be able to enter.
  hollowBox(x, y, z, w, h, d, mat, ry = 0, doorW = 1.4, doorH = 2.6) {
    const t = 0.3; // wall thickness
    const cs = Math.cos(ry || 0), sn = Math.sin(ry || 0);
    const l2w = (lx, lz) => ({ x: x + lx * cs + lz * sn, z: z - lx * sn + lz * cs });

    // Back wall (full width)
    const b = l2w(0, -d / 2);
    this.box(b.x, y, b.z, w, h, t, mat, true, ry);
    // Left wall (full depth)
    const l = l2w(-w / 2, 0);
    this.box(l.x, y, l.z, t, h, d, mat, true, ry);
    // Right wall (full depth)
    const r = l2w(w / 2, 0);
    this.box(r.x, y, r.z, t, h, d, mat, true, ry);
    // Front wall: split into two panels with door gap
    const sideW = (w - doorW) / 2;
    const fl = l2w(-w / 2 + sideW / 2, d / 2);
    const fr = l2w(w / 2 - sideW / 2, d / 2);
    this.box(fl.x, y, fl.z, sideW, h, t, mat, true, ry);
    this.box(fr.x, y, fr.z, sideW, h, t, mat, true, ry);
    // Lintle above door (non-collidable visual)
    const lintelH = h - doorH;
    if (lintelH > 0.1) {
      const lc = l2w(0, d / 2);
      this.box(lc.x, y + doorH + lintelH / 2, lc.z, doorW + 0.4, lintelH, t, mat, false, ry);
    }
  }

  // Universal building entry: add enter/exit portals for ANY procedural building.
  // Finds the front face (+Z in local frame), places entrance outside, exit inside.
  addBuildingEntry(x, z, w, d, ry, h, buildingIdx = -1) {
    const cs = Math.cos(ry || 0), sn = Math.sin(ry || 0);
    // Front face center in world space (local +Z direction)
    const frontX = x + sn * (d / 2);
    const frontZ = z + cs * (d / 2);
    // Entrance: 1.5m in front of the building
    const entranceX = frontX + sn * 1.5;
    const entranceZ = frontZ + cs * 1.5;
    // Exit: 1.5m inside the building center
    const exitX = x - sn * 0.5;
    const exitZ = z - cs * 0.5;
    const entrance = new THREE.Vector3(entranceX, 0, entranceZ);
    const exit = new THREE.Vector3(exitX, 0, exitZ);
    const dir = new THREE.Vector3(-sn, 0, -cs); // pointing into building
    this.addPortal(entrance, dir.clone().negate(), exit, 'enter', buildingIdx);
    this.addPortal(exit, dir, entrance, 'exit', buildingIdx);
    // Register interior so world bounds don't clamp the player inside
    const margin = 1.0;
    this.addInterior(
      new THREE.Vector3(x - w / 2 + margin, 0, z - d / 2 + margin),
      new THREE.Vector3(x + w / 2 - margin, h || 4, z + d / 2 - margin)
    );
  }

  nearestPortal(pos, range = 1.8) {
    let best = null, bestD = range;
    for (const p of this.portals) {
      const d = pos.distanceTo(p.pos);
      if (d < bestD) { bestD = d; best = p; }
    }
    return best;
  }
  // Point `dist` in front of a building's +Z face (local frame aware).
  frontPoint(x, z, ry, dist) {
    const cs = Math.cos(ry), sn = Math.sin(ry);
    return new THREE.Vector3(x + sn * dist, 0, z + cs * dist);
  }
  addRoof(x, z, roofY, rx, rz) {
    this.roofAccess.push({ x, z, y: roofY, rx: rx || 6, rz: rz || 6 });
  }
  insideInterior(p) {
    for (const v of this.interiors) {
      let x = p.x, z = p.z;
      if (v.transform) {
        const dx = p.x - v.transform.x, dz = p.z - v.transform.z;
        const c = Math.cos(v.transform.yaw || 0), sn = Math.sin(v.transform.yaw || 0);
        x = dx * c - dz * sn;
        z = dx * sn + dz * c;
      }
      if (x > v.min.x && x < v.max.x && z > v.min.z && z < v.max.z) return true;
    }
    return false;
  }

  // ===== REACTIVE =====
  _registerReactive(mesh, kind, col) {
    this.reactiveObjects.push({
      mesh, kind, col,
      base: mesh.position.clone(),
      sway: 0, swayV: 0,
      burning: false, burnT: 0, burnFuse: 0,
      dead: false,
    });
  }


  registerNpcInteractable(mesh, metadata = {}) {
    if (!mesh || !mesh.getWorldPosition) return null;
    const existing = this.npcInteractables.find(item => item.mesh === mesh);
    if (existing) return existing;
    const kind = String(metadata.kind || "prop").toLowerCase();
    const position = new THREE.Vector3();
    mesh.updateWorldMatrix(true, false);
    mesh.getWorldPosition(position);
    const record = {
      mesh,
      kind,
      label: metadata.label || kind.replace(/_/g, " ").toUpperCase(),
      position,
      useRadius: Number(metadata.useRadius) || 1.2,
      approachOffset: metadata.approachOffset || null,
      approachPosition: position.clone(),
      sitPosition: position.clone(),
      reservedBy: null,
      onPlayerInteract: typeof metadata.onPlayerInteract === "function" ? metadata.onPlayerInteract : null,
    };
    if (record.approachOffset) {
      const offset = record.approachOffset;
      const local = new THREE.Vector3(Number(offset.x) || 0, Number(offset.y) || 0, Number(offset.z) || 0);
      mesh.localToWorld(local);
      record.approachPosition.copy(local);
    }
    if (metadata.sitOffset) {
      const offset = metadata.sitOffset;
      const local = new THREE.Vector3(Number(offset.x) || 0, Number(offset.y) || 0, Number(offset.z) || 0);
      mesh.localToWorld(local);
      record.sitPosition.copy(local);
    } else {
      record.sitPosition.copy(record.approachPosition);
    }
    this.npcInteractables.push(record);
    return record;
  }

  _registerAssetNpcInteractables(model) {
    const registered = [];
    const classify = (node) => {
      const meta = node.userData?.npcInteractable;
      if (meta === false) return null;
      if (meta && typeof meta === "object" && meta.kind) return meta;
      if (typeof meta === "string") return { kind: meta };
      if (meta === true) return { kind: node.userData?.npcInteractionType || "prop", label: node.userData?.npcInteractionLabel };
      const name = String(node.name || "").toLowerCase().replace(/[\s-]+/g, "_");
      const match = (pattern, kind) => pattern.test(name) ? { kind } : null;
      return match(/(^|_)(seat|bench|chair|sofa|stool|couch)(_|$)|^(seat|bench|chair|sofa|stool|couch)/, "seat")
        || match(/(^|_)(phone|telephone|payphone)(_|$)|^(phone|telephone|payphone)/, "phone")
        || match(/(^|_)(atm|cash_machine|cashmachine)(_|$)|^(atm|cashmachine)/, "atm")
        || match(/(^|_)(vending|vending_machine)(_|$)|^(vending)/, "vending")
        || match(/(^|_)(counter|cashier|shop_counter|vendor_stall)(_|$)|^(counter|cashier)/, "counter")
        || match(/(^|_)(workstation|work_bench|workbench)(_|$)|^(workstation|workbench)/, "workstation")
        || match(/(^|_)(shop|storefront|kiosk)(_|$)|^(shop|kiosk)/, "shop")
        || match(/(^|_)(shelter|bus_stop)(_|$)|^(shelter|bus_stop)/, "shelter");
    };
    model.traverse(node => {
      if (node === model) return;
      let ancestor = node.parent;
      while (ancestor && ancestor !== model) {
        if (registered.includes(ancestor)) return;
        ancestor = ancestor.parent;
      }
      const metadata = classify(node);
      if (!metadata) return;
      const record = this.registerNpcInteractable(node, metadata);
      if (record) registered.push(node);
    });
  }

  nearestNpcInteractable(position, radius = 2.5) {
    let best = null, bestDistance = radius;
    for (const object of this.npcInteractables) {
      if (!object.mesh || !object.mesh.visible || !object.mesh.parent) continue;
      object.mesh.updateWorldMatrix(true, false);
      object.mesh.getWorldPosition(object.position);
      const distance = Math.hypot(object.position.x - position.x, object.position.z - position.z);
      if (distance < bestDistance) {
        best = object;
        bestDistance = distance;
      }
    }
    if (!best) return null;
    return Object.assign(best, { distance: bestDistance });
  }

  // Turn all batched geometry into InstancedMeshes (one per material).
  // This collapses thousands of individual meshes into ~10-15 draw calls.
  _flushGeometry() {
    const dummy = new THREE.Object3D();
    // --- Box batches ---
    if (this._boxBatch.length) {
      const groups = new Map();
      for (const b of this._boxBatch) {
        const k = b.mat;
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(b);
      }
      const unitBox = new THREE.BoxGeometry(1, 1, 1);
      for (const [mat, items] of groups) {
        const im = new THREE.InstancedMesh(unitBox, mat, items.length);
        im.castShadow = true; im.receiveShadow = true; im.frustumCulled = true;
        for (let i = 0; i < items.length; i++) {
          const b = items[i];
          dummy.position.set(b.x, b.y, b.z);
          dummy.rotation.set(0, b.ry, 0);
          dummy.scale.set(b.w, b.h, b.d);
          dummy.updateMatrix();
          im.setMatrixAt(i, dummy.matrix);
        }
        im.instanceMatrix.needsUpdate = true;
        this.group.add(im);
      }
    }
    // --- Plane batches (roads, sidewalks, etc.) ---
    if (this._planeBatch.length) {
      const groups = new Map();
      for (const b of this._planeBatch) {
        const k = b.mat;
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(b);
      }
      const unitPlane = new THREE.PlaneGeometry(1, 1);
      for (const [mat, items] of groups) {
        const im = new THREE.InstancedMesh(unitPlane, mat, items.length);
        im.castShadow = false; im.receiveShadow = true; im.frustumCulled = true;
        for (let i = 0; i < items.length; i++) {
          const b = items[i];
          dummy.position.set(b.x, b.y, b.z);
          dummy.rotation.set(b.rx, 0, b.rz);
          dummy.scale.set(b.w, b.h, 1);
          dummy.updateMatrix();
          im.setMatrixAt(i, dummy.matrix);
        }
        im.instanceMatrix.needsUpdate = true;
        this.group.add(im);
      }
    }
    // --- Ribbon batches (mitered road / sidewalk strokes with UVs) ---
    if (this._ribbonBatch.length) {
      const groups = new Map();
      for (const r of this._ribbonBatch) {
        const k = r.mat;
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(r);
      }
      for (const [mat, items] of groups) {
        const positions = [], uvs = [], indices = [];
        let vi = 0;
        for (const r of items) {
          const L = r.left.length;
          if (L < 2) continue;
          // compute cumulative distance for U coordinate
          let totalLen = 0;
          const segLens = [];
          for (let i = 0; i < L - 1; i++) {
            const dx = r.left[i + 1].x - r.left[i].x, dz = r.left[i + 1].z - r.left[i].z;
            const s = Math.hypot(dx, dz);
            segLens.push(s);
            totalLen += s;
          }
          if (totalLen < 0.1) continue;
          let acc = 0;
          for (let i = 0; i < L; i++) {
            const u = i === 0 ? 0 : acc / totalLen;
            positions.push(r.left[i].x, r.y + (r.left[i].y || 0), r.left[i].z);
            uvs.push(0, u * (totalLen / 6));
            positions.push(r.right[i].x, r.y + (r.right[i].y || 0), r.right[i].z);
            uvs.push(1, u * (totalLen / 6));
            if (i < L - 1) {
              const a = vi, b = vi + 1, c = vi + 2, d = vi + 3;
              indices.push(a, c, b, b, c, d);
            }
            vi += 2;
            if (i < L - 1) acc += segLens[i];
          }
        }
        if (!positions.length) continue;
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
        geo.setIndex(indices);
        geo.computeVertexNormals();
        // Reuse the exact visible ribbon triangles for road physics. A triangle
        // surface has no artificial cuboid sidewalls at the road edges.
        const roadKind = mat === this._mats?.road ? 'road'
          : mat === this._mats?.walk ? 'sidewalk'
          : mat === this._mats?.curb ? 'curb' : null;
        if (roadKind) this.roadPhysicsMeshes.push({ kind: roadKind, geometry: geo });
        // Road polylines can be authored in either direction. Double-sided
        // surfaces prevent reversed winding from making whole road sections vanish.
        mat.side = THREE.DoubleSide;
        mat.needsUpdate = true;
        const mesh = new THREE.Mesh(geo, mat);
        mesh.receiveShadow = true;
        mesh.frustumCulled = true;
        this.group.add(mesh);
      }
    }
    // --- Trim batches (AO base skirts + roofline lips) ---
    if (this._trimBatch.length) {
      const groups = new Map();
      for (const b of this._trimBatch) {
        const k = b.mat;
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(b);
      }
      const unitBox = new THREE.BoxGeometry(1, 1, 1);
      for (const [mat, items] of groups) {
        const im = new THREE.InstancedMesh(unitBox, mat, items.length);
        im.castShadow = false; im.receiveShadow = false; im.frustumCulled = true;
        for (let i = 0; i < items.length; i++) {
          const b = items[i];
          dummy.position.set(b.x, b.y, b.z);
          dummy.rotation.set(0, b.ry, 0);
          dummy.scale.set(b.w, b.h, b.d);
          dummy.updateMatrix();
          im.setMatrixAt(i, dummy.matrix);
        }
        im.instanceMatrix.needsUpdate = true;
        this.group.add(im);
      }
    }
    this._boxBatch = null;
    this._planeBatch = null;
    this._ribbonBatch = null;
    this._trimBatch = null;
  }

  hitReactive(point, ignite) {
    for (const o of this.reactiveObjects) {
      if (o.dead) continue;
      const p = o.mesh.position;
      if (Math.hypot(p.x - point.x, p.z - point.z) < 2.2 && Math.abs(p.y - point.y) < 3) {
        if (o.kind === 'flex') o.swayV += (Math.random() < .5 ? 1 : -1) * 6;
        else if (ignite && !o.burning) this._ignite(o, o.kind === 'firex' ? 3.2 : 5);
      }
    }
  }

  _ignite(o, dur) {
    o.burning = true; o.burnT = dur; o.burnFuse = dur;
    if (o.mesh.material && o.mesh.material.emissive) o.mesh.material.emissive.setHex(0x551500);
  }

  updateReactive(dt, fx, audio, player, enemies, game) {
    for (const o of this.reactiveObjects) {
      if (o.dead) continue;
      if (o.kind === 'flex' && (o.sway !== 0 || o.swayV !== 0)) {
        o.swayV += (-26 * o.sway - 7 * o.swayV) * dt;
        o.sway += o.swayV * dt;
        o.mesh.rotation.z = o.sway * 0.12;
        if (Math.abs(o.sway) < 0.001 && Math.abs(o.swayV) < 0.001) { o.sway = 0; o.swayV = 0; o.mesh.rotation.z = 0; }
      }
      if (!o.burning) continue;
      o.burnT -= dt;
      const top = o.mesh.position.clone().add(new THREE.Vector3(0, 1.0 + Math.random() * 0.6, 0));
      fx.burst(top, 2, new THREE.Color(1, .5 + Math.random() * .3, .15), 2.2, .5, .5, 1.2);
      if (Math.random() < .5) fx.smoke(top, .6, .6, 1.4);
      if (Math.random() < dt * 0.6) {
        for (const q of this.reactiveObjects) {
          if (q.dead || q.burning || q.kind === 'flex') continue;
          if (o.mesh.position.distanceTo(q.mesh.position) < 4) this._ignite(q, q.kind === 'firex' ? 3.2 : 5);
        }
      }
      const pp = player.pos.distanceTo(o.mesh.position);
      if (pp < 3) game.damagePlayer(18 * dt, null);
      for (const e of enemies) if (e.alive && e.ignite && e.pos.distanceTo(o.mesh.position) < 3) e.ignite(2.5, 14);
      if (o.burnT <= 0) {
        if (o.kind === 'firex') {
          const at = o.mesh.position.clone();
          fx.explosion(at, 1.4);
          audio.explosion(0);
          if (game.civilians) game.civilians.fleeFrom(at, 24);
          for (const e of enemies) {
            if (!e.alive) continue;
            const dist = e.pos.distanceTo(at);
            if (dist < 9) { if (e.takeDamage(160 * (1 - dist / 9) + 30, false)) game.registerKill && game.registerKill(e, false, { name: 'EXPLOSION', headMult: 1 }); }
          }
          const pd = player.pos.distanceTo(at);
          if (pd < 9) game.damagePlayer(Math.min(160 * (1 - pd / 9) * 0.5, 80), null);
        }
        o.dead = true;
        o.mesh.visible = false;
        if (o.col) {
          const i = this.colliders.indexOf(o.col);
          if (i >= 0) this.colliders.splice(i, 1);
          if (this.bvhWorld) this.bvhWorld.removeAABB(o.col);
          const j = this.climbables.indexOf(o.col);
          if (j >= 0) this.climbables.splice(j, 1);
        }
      }
    }
  }

  // ===== LIGHTING & SKY =====
  buildLighting(quality) {
    if (quality === 'ultra-low') {
      const sun = new THREE.DirectionalLight(0xfff1dd, 1.8);
      sun.position.set(200, 180, 80);
      this.scene.add(sun);
      this.scene.add(new THREE.HemisphereLight(0xcfe3ff, 0x5a5c50, 0.9));
      this.scene.fog = new THREE.FogExp2(0x9aa3ac, 0.006);
      this.sun = sun;
      return;
    }
    this.atmosphere = new Atmosphere(this.scene, quality);
    this.sun = this.atmosphere.sun;
  }

  buildSky() {
    if (this._quality === 'ultra-low') {
      // Lightweight daytime horizon for constrained GPUs: no sky dome, shader,
      // or environment texture, but never leave the scene with a black void.
      this.scene.background = new THREE.Color(0x83b8d4);
      return;
    }
    // Atmosphere handles the sky dome; just set env map for PBR reflections
    const sky = TEX.makeSkyTexture();
    this.scene.environment = sky;
    this.scene.environmentIntensity = this._quality === 'ultra' ? 0.68 : this._quality === 'high' ? 0.55 : 0.45;
    // Don't set background — atmosphere sky dome renders over it
  }

  buildGround(spec = null, waterways = []) {
    const ultra = this._quality === 'ultra-low';
    const gSize = spec && spec.size ? spec.size : (ultra ? 3000 : 5000);
    let groundMat;
    if (ultra) {
      groundMat = new THREE.MeshBasicMaterial({ color: 0x5a6048 });
    } else {
      groundMat = createGroundRendererMaterial(THREE, {
        color: spec && spec.color ? spec.color : '#767c64',
        quality: this._quality,
      });
    }
    const groundShape = new THREE.Shape();
    const halfGround = gSize * 0.5;
    groundShape.moveTo(-halfGround, -halfGround);
    groundShape.lineTo(halfGround, -halfGround);
    groundShape.lineTo(halfGround, halfGround);
    groundShape.lineTo(-halfGround, halfGround);
    groundShape.lineTo(-halfGround, -halfGround);

    const signedArea = points => {
      let area = 0;
      for (let i = 0; i < points.length; i++) {
        const a = points[i], b = points[(i + 1) % points.length];
        area += a.x * b.y - b.x * a.y;
      }
      return area * 0.5;
    };
    for (const channel of waterways || []) {
      const start = channel.start || [];
      const end = channel.end || [];
      const dx = Number(end[0]) - Number(start[0]);
      const dz = Number(end[1]) - Number(start[1]);
      const length = Math.hypot(dx, dz);
      if (length < 2) continue;
      const ux = dx / length, uz = dz / length;
      const nx = -uz, nz = ux;
      const bankWidth = Number(channel.bankWidth) || 0.7;
      const halfOpening = (Number(channel.width) || 6) * 0.5 + bankWidth + 0.06;
      const cap = Number.isFinite(channel.groundCutoutCap) ? channel.groundCutoutCap : 1.5;
      const a = { x: Number(start[0]), z: Number(start[1]) };
      const b = { x: Number(end[0]), z: Number(end[1]) };
      const worldPoints = [
        { x: a.x - ux * cap + nx * halfOpening, z: a.z - uz * cap + nz * halfOpening },
        { x: b.x + ux * cap + nx * halfOpening, z: b.z + uz * cap + nz * halfOpening },
        { x: b.x + ux * cap - nx * halfOpening, z: b.z + uz * cap - nz * halfOpening },
        { x: a.x - ux * cap - nx * halfOpening, z: a.z - uz * cap - nz * halfOpening },
      ];
      let localPoints = worldPoints.map(point => ({ x: point.x, y: -point.z }));
      // ShapeGeometry expects the outer contour and holes to have opposite winding.
      if (signedArea(localPoints) > 0) localPoints = localPoints.reverse();
      const hole = new THREE.Path();
      hole.moveTo(localPoints[0].x, localPoints[0].y);
      for (let i = 1; i < localPoints.length; i++) hole.lineTo(localPoints[i].x, localPoints[i].y);
      hole.lineTo(localPoints[0].x, localPoints[0].y);
      groundShape.holes.push(hole);
    }

    const groundGeometry = waterways?.length
      ? new THREE.ShapeGeometry(groundShape, 1)
      : new THREE.PlaneGeometry(gSize, gSize);
    const ground = new THREE.Mesh(groundGeometry, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    ground.name = 'world_ground_with_drainage_cutouts';
    this.group.add(ground);
    if (ultra) return;
    // distant low hills for horizon depth
    const hillMat = new THREE.MeshStandardMaterial({ color: 0x6a7258, roughness: 1 });
    for (let i = 0; i < 40; i++) {
      const a = i / 40 * Math.PI * 2;
      const d = 1800 + Math.random() * 400;
      const h = new THREE.Mesh(new THREE.SphereGeometry(60 + Math.random() * 80, 10, 6), hillMat);
      h.position.set(Math.cos(a) * d, -32 - Math.random() * 18, Math.sin(a) * d);
      h.scale.y = .35; this.group.add(h);
    }
  }

  // ===== ORGANIC CITY GENERATION =====
  // Generates a curved road network using Bezier splines, then places buildings
  // organically along roads with random rotation. Three zones:
  //   Zone 1: Mega-City Core (dense, highrises, downtown)
  //   Zone 2: Abandoned Docks & Refinery (industrial, containers, angled)
  //   Zone 3: Overgrown Perimeter (sparse, ruins, foliage)

  buildCity() {
    this._generateRoadNetwork();
    this._buildRoadMeshes();
    for (const node of this._roadNodes) {
      if (Math.hypot(node.x, node.z) < this.bounds - 30) {
        this.spawnPoints.push(new THREE.Vector3(node.x, 0, node.z));
      }
    }
    for (const seg of this._roadSegments) {
      const n1 = this._roadNodes[seg.n1], n2 = this._roadNodes[seg.n2];
      for (let t = 0.25; t < 1; t += 0.25) {
        const p = bezier2(n1, n2, { x: seg.cx, z: seg.cz }, t);
        if (Math.hypot(p.x, p.z) < this.bounds - 20) {
          this.spawnPoints.push(new THREE.Vector3(p.x, 0, p.z));
        }
      }
    }
    this._spawnGLBAssets();
  }

  _buildDistrictPlots(plots = []) {
    if (!Array.isArray(plots) || !plots.length) return;

    const grassMaterial = this._mat('district-plot-grass', () => {
      const texture = TEX.makeGroundTexture(512, [108, 119, 82]);
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.repeat.set(4, 4);
      return new THREE.MeshStandardMaterial({ map: texture, roughness: 0.98, metalness: 0 });
    });
    const lateriteMaterial = this._mat('district-plot-laterite', () => {
      const texture = TEX.makeGroundTexture(512, [142, 112, 82]);
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.repeat.set(4, 4);
      return new THREE.MeshStandardMaterial({ map: texture, roughness: 0.98, metalness: 0 });
    });
    const pavingMaterial = this.mConcrete([161, 157, 147]);
    const wallMaterial = this.mConcrete([174, 169, 157]);
    const gatePostMaterial = this.mConcrete([135, 132, 125]);

    const surfaceMaterial = surface => {
      if (surface === 'lawn' || surface === 'grass') return grassMaterial;
      if (surface === 'laterite' || surface === 'soil') return lateriteMaterial;
      return pavingMaterial;
    };

    for (const plot of plots) {
      const width = Number(plot.width), depth = Number(plot.depth);
      if (!(width > 2 && depth > 2)) continue;

      const x = Number(plot.x) || 0;
      const z = Number(plot.z) || 0;
      const yaw = Number(plot.yaw) || 0;
      const baseY = Number.isFinite(plot.y) ? plot.y : 0.012;
      const group = new THREE.Group();
      group.name = 'district_plot_' + String(plot.id || this.districtPlotInstances.length).replace(/[^a-z0-9_-]/gi, '_');
      group.position.set(x, baseY, z);
      group.rotation.y = yaw;

      const addSurface = (w, d, lx, lz, material, yOffset = 0.008, name = 'surface') => {
        if (!(w > 0.2 && d > 0.2)) return;
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d), material);
        mesh.name = 'district_plot_' + name;
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.set(lx, yOffset, lz);
        mesh.receiveShadow = true;
        mesh.castShadow = false;
        mesh.frustumCulled = false;
        group.add(mesh);
      };

      addSurface(width, depth, 0, 0, surfaceMaterial(plot.surface || 'lawn'), 0.008, plot.surface || 'lawn');

      const driveway = plot.driveway;
      if (driveway && typeof driveway === 'object') {
        const drivewayWidth = Number(driveway.width) || 3.6;
        const drivewayDepth = Number(driveway.depth) || 4.5;
        const front = plot.front === 'north' ? -1 : 1;
        const drivewayX = Number(driveway.offsetX) || 0;
        const drivewayZ = Number.isFinite(driveway.offsetZ)
          ? driveway.offsetZ
          : front * (depth / 2 - drivewayDepth / 2);
        addSurface(drivewayWidth, drivewayDepth, drivewayX, drivewayZ, pavingMaterial, 0.018, 'driveway');

        // A narrow path links the vehicle gate/driveway to the building entrance.
        if (driveway.pathWidth > 0 && driveway.pathDepth > 0) {
          const pathWidth = Number(driveway.pathWidth);
          const pathDepth = Number(driveway.pathDepth);
          const pathZ = front * (depth / 2 - drivewayDepth - pathDepth / 2);
          addSurface(pathWidth, pathDepth, drivewayX, pathZ, pavingMaterial, 0.02, 'front-walk');
        }
      }

      let wallCount = 0;
      const wallHeight = Number(plot.wallHeight) || 0;
      if (wallHeight > 0.35) {
        const thickness = THREE.MathUtils.clamp(Number(plot.wallThickness) || 0.18, 0.12, 0.35);
        const gateWidth = THREE.MathUtils.clamp(Number(plot.gateWidth) || 3.8, 2.4, width * 0.65);
        const front = plot.front === 'north' ? 'north' : 'south';
        const frontSign = front === 'south' ? 1 : -1;
        const wallBase = -baseY + 0.006;
        const addWall = (lx, lz, w, d, name = 'compound-wall') => {
          if (!(w > 0.12 && d > 0.12)) return;
          const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, wallHeight, d), wallMaterial);
          mesh.name = 'district_' + name;
          mesh.position.set(lx, wallBase + wallHeight / 2, lz);
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          group.add(mesh);

          const c = Math.cos(yaw), sn = Math.sin(yaw);
          const worldX = x + lx * c + lz * sn;
          const worldZ = z - lx * sn + lz * c;
          const worldW = Math.abs(c) * w + Math.abs(sn) * d;
          const worldD = Math.abs(sn) * w + Math.abs(c) * d;
          this.addCollider(worldX, baseY, worldZ, worldW, wallHeight, worldD);
          wallCount++;
        };

        // Rear and side walls remain continuous. The street-facing wall is
        // split around a proper car gate so the plot stays accessible.
        addWall(0, -frontSign * (depth / 2 - thickness / 2), width, thickness, 'compound-rear-wall');
        addWall(-width / 2 + thickness / 2, 0, thickness, depth, 'compound-side-wall');
        addWall(width / 2 - thickness / 2, 0, thickness, depth, 'compound-side-wall');

        const frontZ = frontSign * (depth / 2 - thickness / 2);
        const sideLength = Math.max(0, (width - gateWidth) / 2);
        addWall(-gateWidth / 2 - sideLength / 2, frontZ, sideLength, thickness, 'compound-front-wall');
        addWall(gateWidth / 2 + sideLength / 2, frontZ, sideLength, thickness, 'compound-front-wall');

        // The gate has substantial concrete piers, while the vehicle opening
        // remains clear. The gate posts are also real movement colliders.
        const postSize = 0.34;
        for (const side of [-1, 1]) {
          const lx = side * gateWidth / 2;
          const mesh = new THREE.Mesh(
            new THREE.BoxGeometry(postSize, wallHeight + 0.16, postSize),
            gatePostMaterial,
          );
          mesh.name = 'district_compound_gate_pillar';
          mesh.position.set(lx, wallBase + (wallHeight + 0.16) / 2, frontZ);
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          group.add(mesh);
          const c = Math.cos(yaw), sn = Math.sin(yaw);
          const worldX = x + lx * c + frontZ * sn;
          const worldZ = z - lx * sn + frontZ * c;
          this.addCollider(worldX, baseY, worldZ, postSize, wallHeight + 0.16, postSize);
          wallCount++;
        }
      }

      this.group.add(group);
      this.districtPlotInstances.push({
        id: plot.id || 'district-plot-' + this.districtPlotInstances.length,
        type: plot.type || plot.surface || 'plot',
        x, z, width, depth, yaw,
        wallCount,
        wallHeight,
        driveway: !!driveway,
      });
    }
  }

  // ===== AUTHORED SCENE (map JSON) =====
  async buildFromScene(sd) {
    if (sd.startPoint) {
      this.startPoint = {
        x: sd.startPoint.x || 0,
        z: sd.startPoint.z || 40,
        yaw: sd.startPoint.yaw != null ? sd.startPoint.yaw : Math.PI,
      };
    }
    if (sd.roads) await this._buildAuthoredRoads(sd.roads);
    if (sd.districtPlots?.length) this._buildDistrictPlots(sd.districtPlots);
    if (sd.roadModules?.length) await this._spawnRoadModules(sd.roadModules);
    if (sd.sidewalkModules?.length) await this._spawnSidewalkModules(sd.sidewalkModules);
    if (sd.bridgeAssemblies?.length) await this._spawnBridgeAssemblies(sd.bridgeAssemblies);
    if (sd.waterways?.length) this._buildWaterways(sd.waterways);
    if (sd.spawns) for (const sp of sd.spawns) this.spawnPoints.push(new THREE.Vector3(sp[0], 0, sp[1]));
    if (sd.cover) for (const c of sd.cover) this.coverPoints.push(new THREE.Vector3(c[0], 0, c[1]));
    if (sd.transit) for (const t of sd.transit) this.transitPoints.push({ x: t.x, z: t.z, name: t.name });
    if (sd.named) for (const n of sd.named) this.namedLocations.push({ x: n.x, z: n.z, name: n.name, color: n.color || '#ffd24a' });
    if (sd.vehicles) for (const v of sd.vehicles) this.vehicleSpawns.push({ x: v.x, z: v.z, ry: v.ry || 0, kind: v.kind || 'car', elevation: v.elevation || 0 });
    if (sd.loot) {
      const crateMat = this.mCrate();
      for (const lp of sd.loot) {
        const lx = lp[0], lz = lp[1];
        const m = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.9, 0.9), crateMat);
        m.position.set(lx, 0.45, lz);
        m.castShadow = true;
        m.receiveShadow = true;
        this.group.add(m);
        const col = this.addCollider(lx, 0, lz, 0.9, 0.9, 0.9);
        this.lootPoints.push({ x: lx, z: lz, mesh: m, col, looted: false });
      }
    }
    await this._spawnGLBAssets(sd);
    this._dedupeNamed();
    const tSeen = new Map();
    for (const t of this.transitPoints) tSeen.set(t.name, t);
    this.transitPoints = [...tSeen.values()];
  }

  _dedupeNamed() {
    const seen = new Map();
    for (const n of this.namedLocations) seen.set(n.name, n);
    this.namedLocations = [...seen.values()];
  }

  async _spawnGLBAssets(sd) {
    const assets = (sd && sd.glbAssets) || [];
    if (!assets.length) {
      this._rebuildGrid();
      return;
    }

    // A map can opt out for a small test scene, but normal authored worlds
    // stream GLB placements by spatial cell instead of decoding the whole city.
    if (!this._streamingConfig.enabled) {
      const qualityConcurrency = this._quality === 'ultra' ? 8
        : this._quality === 'high' ? 6
        : this._quality === 'medium' ? 4
        : this._quality === 'low' ? 2 : 1;
      const memoryConcurrency = this._deviceMemoryGB <= 4 ? 2
        : this._deviceMemoryGB <= 8 ? 3 : 4;
      const concurrency = Math.min(qualityConcurrency, memoryConcurrency);
      for (let i = 0; i < assets.length; i += concurrency) {
        await Promise.allSettled(assets.slice(i, i + concurrency).map(asset => this._loadGLBAsset(asset)));
      }
      this._rebuildGrid();
      return;
    }

    const size = this._streamingConfig.chunkSize;
    for (const asset of assets) {
      const x = Number(asset.x) || 0;
      const z = Number(asset.z) || 0;
      const gx = Math.floor(x / size);
      const gz = Math.floor(z / size);
      const key = gx + ',' + gz;
      let chunk = this._streamingChunks.get(key);
      if (!chunk) {
        const minX = gx * size, minZ = gz * size;
        chunk = {
          key, gx, gz, minX, minZ, maxX: minX + size, maxZ: minZ + size,
          assets: [], state: 'unloaded', roots: [], assetUrls: new Map(),
          items: null, physicsBatch: null,
        };
        this._streamingChunks.set(key, chunk);
      }
      chunk.assets.push(asset);
    }

    const start = this.startPoint || { x: 0, z: 0 };
    const initial = [...this._streamingChunks.values()]
      .map(chunk => ({ chunk, distance: this._streamChunkDistance(chunk, start) }))
      .filter(item => item.distance <= this._streamingConfig.initialRadius)
      .sort((a, b) => a.distance - b.distance);

    // Load the spawn neighbourhood before gameplay starts. All remaining
    // chunks are queued by updateStreaming as the player/vehicle approaches.
    for (const item of initial) await this._loadStreamingChunk(item.chunk);
    this._streamingLastLoadPosition = { x: start.x, z: start.z };
    this._rebuildGrid();
    console.info('[WorldStreaming] Initial neighbourhood ready:', this.getStreamingStats());
  }

  _streamChunkDistance(chunk, position) {
    const centerX = (chunk.minX + chunk.maxX) * 0.5;
    const centerZ = (chunk.minZ + chunk.maxZ) * 0.5;
    return Math.hypot(centerX - position.x, centerZ - position.z);
  }

  async _loadStreamingChunk(chunk) {
    if (!chunk || chunk.state === 'loaded' || chunk.state === 'loading') return;
    chunk.state = 'loading';
    chunk.roots = [];
    chunk.assetUrls = new Map();
    chunk.items = null;

    const trackedArrays = [
      'colliders', 'climbables', 'interiors', 'portals', 'roofAccess',
      'npcInteractables', 'reactiveObjects', 'coverPoints', 'worldKitComponents',
      '_buildingData', 'vehicleSpawns', 'roadPhysicsMeshes',
    ];
    const before = Object.create(null);
    for (const name of trackedArrays) before[name] = this[name].length;

    const previousChunk = this._activeStreamingChunk;
    this._activeStreamingChunk = chunk;
    try {
      if (this._streamingLive) {
        // Spread GLTF decode/parsing across idle windows during live gameplay.
        for (const asset of chunk.assets) {
          await yieldStreamingWork();
          await Promise.allSettled([this._loadGLBAsset(asset)]);
        }
      } else {
        // The initial spawn neighbourhood loads behind the loading screen.
        const concurrency = this._streamingConfig.assetConcurrency;
        for (let i = 0; i < chunk.assets.length; i += concurrency) {
          const batch = chunk.assets.slice(i, i + concurrency);
          await Promise.allSettled(batch.map(asset => this._loadGLBAsset(asset)));
        }
      }
    } finally {
      this._activeStreamingChunk = previousChunk;
    }

    const items = Object.create(null);
    for (const name of trackedArrays) items[name] = this[name].slice(before[name]);
    for (const surface of items.roadPhysicsMeshes) surface._streamChunkKey = chunk.key;
    chunk.items = items;
    chunk.state = 'loaded';

    if (this._physics?.world) {
      try {
        chunk.physicsBatch = this._physics.registerStreamingChunk(
          items.colliders, items.roadPhysicsMeshes,
        );
      } catch (error) {
        // The streamed scene remains usable through the world's AABB fallback
        // if Rapier rejects a malformed optional chunk surface.
        console.warn('[WorldStreaming] Physics registration failed for ' + chunk.key, error);
        chunk.physicsBatch = null;
      }
    }

    console.info(
      '[WorldStreaming] Loaded ' + chunk.key + ' · ' + chunk.assets.length
      + ' placements · ' + items.colliders.length + ' colliders',
    );
  }

  _removeArrayItems(target, entries) {
    if (!Array.isArray(target) || !entries?.length) return;
    const remove = new Set(entries);
    let write = 0;
    for (let read = 0; read < target.length; read++) {
      const item = target[read];
      if (!remove.has(item)) target[write++] = item;
    }
    target.length = write;
  }

  _disposeGLBScene(scene) {
    if (!scene) return;
    const geometries = new Set();
    const materials = new Set();
    const textures = new Set();
    scene.traverse(node => {
      if (node.geometry) geometries.add(node.geometry);
      const list = Array.isArray(node.material) ? node.material : [node.material];
      for (const material of list) {
        if (!material) continue;
        materials.add(material);
        for (const value of Object.values(material)) {
          if (value?.isTexture) textures.add(value);
        }
      }
    });
    for (const geometry of geometries) {
      try { geometry.disposeBoundsTree?.(); } catch {}
      geometry.dispose();
    }
    for (const material of materials) material.dispose();
    for (const texture of textures) texture.dispose();
  }

  _releaseStreamingAssetRefs(chunk) {
    for (const [url, count] of chunk.assetUrls || []) {
      const remaining = Math.max(0, (this._glbUrlRefCounts.get(url) || 0) - count);
      if (remaining > 0) {
        this._glbUrlRefCounts.set(url, remaining);
        continue;
      }
      this._glbUrlRefCounts.delete(url);
      const baseScene = this._glbModelCache?.get(url);
      if (baseScene) this._disposeGLBScene(baseScene);
      this._glbModelCache?.delete(url);
    }
  }

  _unloadStreamingChunk(chunk) {
    if (!chunk || chunk.state !== 'loaded') return false;
    const items = chunk.items || {};

    // A streamed physics batch owns one Rapier fixed body, so removing the body
    // drops every collider for this cell without leaving empty bodies behind.
    if (chunk.physicsBatch && this._physics) {
      this._physics.unregisterStreamingChunk(chunk.physicsBatch);
      chunk.physicsBatch = null;
    } else {
      for (const collider of items.colliders || []) {
        if (collider.physicsCollider && this._physics) this._physics.removeCollider(collider.physicsCollider);
        collider.physicsCollider = null;
      }
    }

    for (const root of chunk.roots || []) {
      this.bvhWorld?.removeModel(root);
      if (root.parent) root.parent.remove(root);
    }
    for (const collider of items.colliders || []) this.bvhWorld?.removeAABB(collider);

    const removedBuildings = new Set(items._buildingData || []);
    const removedBuildingIndices = [];
    this._buildingData.forEach((entry, index) => {
      if (removedBuildings.has(entry)) removedBuildingIndices.push(index);
    });

    const arrays = [
      'colliders', 'climbables', 'interiors', 'portals', 'roofAccess',
      'npcInteractables', 'reactiveObjects', 'coverPoints', 'worldKitComponents',
      '_buildingData', 'vehicleSpawns', 'roadPhysicsMeshes',
    ];
    for (const name of arrays) this._removeArrayItems(this[name], items[name]);

    if (removedBuildingIndices.length) {
      for (const portal of this.portals) {
        if (!Number.isInteger(portal.buildingIdx) || portal.buildingIdx < 0) continue;
        let shift = 0;
        for (const index of removedBuildingIndices) if (index < portal.buildingIdx) shift++;
        portal.buildingIdx -= shift;
      }
    }

    // Road geometry is copied from the source GLB for Rapier, so release those
    // copies separately. GLB source geometry/materials are released by refcount.
    for (const surface of items.roadPhysicsMeshes || []) surface.geometry?.dispose();
    this._releaseStreamingAssetRefs(chunk);

    chunk.roots = [];
    chunk.assetUrls = new Map();
    chunk.items = null;
    chunk.state = 'unloaded';
    console.info('[WorldStreaming] Unloaded ' + chunk.key);
    return true;
  }

  registerStreamingPhysics(physics) {
    if (!physics?.world) return false;
    this._physics = physics;

    const staticColliders = this.colliders.filter(c => !c._streamChunkKey);
    const staticRoads = this.roadPhysicsMeshes.filter(s => !s._streamChunkKey);
    physics.registerStaticBatch(staticColliders);
    physics.registerStaticRoadMeshes(staticRoads);

    for (const chunk of this._streamingChunks.values()) {
      if (chunk.state !== 'loaded' || !chunk.items || chunk.physicsBatch) continue;
      chunk.physicsBatch = physics.registerStreamingChunk(
        chunk.items.colliders, chunk.items.roadPhysicsMeshes,
      );
    }
    return true;
  }

  updateStreaming(position, dt = 1 / 60) {
    if (!this._streamingConfig.enabled || !position || !this._streamingChunks.size) {
      return this.getStreamingStats();
    }

    this._streamingElapsed += Math.max(0, Number(dt) || 0);
    if (this._streamingElapsed < this._streamingConfig.updateInterval) return null;
    this._streamingElapsed = 0;
    const wanted = [];
    for (const chunk of this._streamingChunks.values()) {
      const distance = this._streamChunkDistance(chunk, position);
      if (chunk.state === 'loaded' && distance > this._streamingConfig.unloadRadius) {
        this._unloadStreamingChunk(chunk);
      } else if (chunk.state === 'unloaded' && distance <= this._streamingConfig.loadRadius) {
        wanted.push({ chunk, distance });
      }
    }
    wanted.sort((a, b) => a.distance - b.distance);
    this._streamingDeferredChunks = wanted.length;
    this._streamingQueue.length = 0;
    // No background GLB decoding while stationary; trigger one cell after travel.
    const lastLoad = this._streamingLastLoadPosition;
    const moved = lastLoad ? Math.hypot(position.x - lastLoad.x, position.z - lastLoad.z) : Infinity;
    if (!this._streamingLoading && wanted.length && moved >= this._streamingConfig.loadMoveThreshold) {
      const next = wanted[0].chunk;
      this._streamingLive = true;
      this._streamingLastLoadPosition = { x: position.x, z: position.z };
      this._streamingQueue.push(next);
      this._streamingLoading = true;
      this._loadStreamingChunk(next)
        .catch(error => {
          next.state = 'unloaded';
          this._streamingLastLoadPosition = null;
          console.error('[WorldStreaming] Chunk load failed:', next.key, error);
        })
        .finally(() => {
          this._streamingLoading = false;
          this._streamingQueue.length = 0;
        });
    }
    return this.getStreamingStats();
  }

  getStreamingStats() {
    const loaded = [...this._streamingChunks.values()].filter(chunk => chunk.state === 'loaded');
    const chunks = [...this._streamingChunks.values()];
    return {
      enabled: !!this._streamingConfig.enabled,
      loadedChunks: loaded.length,
      totalChunks: this._streamingChunks.size,
      loadedPlacements: loaded.reduce((sum, chunk) => sum + chunk.assets.length, 0),
      totalPlacements: chunks.reduce((sum, chunk) => sum + chunk.assets.length, 0),
      loading: this._streamingLoading,
      queued: this._streamingQueue.length,
      deferredChunks: this._streamingDeferredChunks || 0,
    };
  }

  async _loadCollisionManifest(a) {
    if (!a?.url || a.noCollision) return null;
    const url = a.collisionManifest || a.url.replace(/\.(glb|gltf)(?:[?#].*)?$/i, '_col.json');
    if (!url || url === a.url) return null;
    if (!this._collisionManifestPromises) this._collisionManifestPromises = new Map();
    let pending = this._collisionManifestPromises.get(url);
    if (!pending) {
      pending = fetch(url, { cache: 'force-cache' })
        .then(response => response.ok ? response.json() : null)
        .then(data => Array.isArray(data?.boxes) ? data : null)
        .catch(() => null);
      this._collisionManifestPromises.set(url, pending);
    }
    return pending;
  }

  _injectManifestColliders(manifest, a, scaleFactor, yOffset, doorMeshes = [], buildingBBox = null) {
    const boxes = Array.isArray(manifest?.boxes) ? manifest.boxes : [];
    if (!boxes.length) return 0;
    const yaw = a.ry || 0;
    const c = Math.cos(yaw), sn = Math.sin(yaw);
    let count = 0;
    for (const entry of boxes) {
      let x, y, z, w, h, d;
      if (Array.isArray(entry) && entry.length >= 6) {
        [x, y, z, w, h, d] = entry;
      } else if (entry && Array.isArray(entry.center) && Array.isArray(entry.size)) {
        [x, y, z] = entry.center;
        [w, h, d] = entry.size;
      } else if (entry && Array.isArray(entry.min) && Array.isArray(entry.max)) {
        x = (entry.min[0] + entry.max[0]) / 2;
        y = (entry.min[1] + entry.max[1]) / 2;
        z = (entry.min[2] + entry.max[2]) / 2;
        w = entry.max[0] - entry.min[0];
        h = entry.max[1] - entry.min[1];
        d = entry.max[2] - entry.min[2];
      } else continue;

      if (![x, y, z, w, h, d].every(Number.isFinite) || w <= 0 || h <= 0 || d <= 0) continue;
      const lx = x * scaleFactor, ly = y * scaleFactor, lz = z * scaleFactor;
      const worldX = (a.x || 0) + lx * c + lz * sn;
      const worldZ = (a.z || 0) - lx * sn + lz * c;
      const worldH = h * scaleFactor;
      const worldBottom = yOffset + ly - worldH / 2;
      // Rotate each local box's footprint into a conservative world AABB.
      const worldW = (Math.abs(c) * w + Math.abs(sn) * d) * scaleFactor;
      const worldD = (Math.abs(sn) * w + Math.abs(c) * d) * scaleFactor;

      // Manifests built from triangle grids can fill a doorway with a few
      // conservative cells even though the door_* marker was excluded. Keep
      // the entrance clear of small cell colliders while retaining the lintel
      // and large wall segments.
      const overlapsDoor = a.building && doorMeshes.some(door => {
        const apertureMinX = door.min.x - 0.45;
        const apertureMaxX = door.max.x + 0.45;
        const apertureMinZ = door.min.z - 0.45;
        const apertureMaxZ = door.max.z + 0.45;
        const floorY = buildingBBox ? buildingBBox.min.y : 0;
        const apertureTopY = Math.min(
          buildingBBox ? buildingBBox.max.y : door.max.y + 0.5,
          Math.max(door.max.y + 0.25, floorY + 2.15),
        );
        const horizontalOverlap =
          worldX + worldW / 2 > apertureMinX && worldX - worldW / 2 < apertureMaxX &&
          worldZ + worldD / 2 > apertureMinZ && worldZ - worldD / 2 < apertureMaxZ;
        const verticalOverlap = worldBottom < apertureTopY && worldBottom + worldH > floorY - 0.05;
        const isSmallCell = Math.max(worldW, worldD) <= Math.max(door.size.x, door.size.z) + 1.6;
        return horizontalOverlap && verticalOverlap && isSmallCell;
      });
      if (overlapsDoor) continue;

      this.addCollider(
        worldX, worldBottom, worldZ,
        worldW, worldH, worldD, !!a.climbable, a.type || null,
      );
      count++;
    }
    return count;
  }

  async _loadGLBAsset(a) {
    if (!this._gltfLoader) this._gltfLoader = new GLTFLoader();
    if (!this._glbModelCache) this._glbModelCache = new Map();
    try {
      let baseScene = this._glbModelCache.get(a.url);
      if (!baseScene) {
        // Reuse the same network fetch and decode for concurrent placements.
        if (!this._glbModelPromises) this._glbModelPromises = new Map();
        let pending = this._glbModelPromises.get(a.url);
        if (!pending) {
          pending = new Promise((res, rej) => this._gltfLoader.load(a.url, res, undefined, rej))
            .then((gltf) => {
              this._glbModelCache.set(a.url, gltf.scene);
              return gltf.scene;
            })
            .finally(() => this._glbModelPromises.delete(a.url));
          this._glbModelPromises.set(a.url, pending);
        }
        baseScene = await pending;
      }
      const model = baseScene.clone(true);
      const streamChunk = this._activeStreamingChunk;
      if (streamChunk) {
        const url = String(a.url);
        streamChunk.assetUrls.set(url, (streamChunk.assetUrls.get(url) || 0) + 1);
        this._glbUrlRefCounts.set(url, (this._glbUrlRefCounts.get(url) || 0) + 1);
      }
      const worldKitReport = annotateWorldKitInstance(model, a);
      await loadAssetOverrides();
      const assetEdit = applyAssetOverrides(model, a.url);
      const rootEdit = assetEdit.root || {};
      const rootPos = rootEdit.position || {}, rootRot = rootEdit.rotation || {}, rootScale = rootEdit.scale || {};
      const sx = Number.isFinite(rootScale.x) ? rootScale.x : 1, sy = Number.isFinite(rootScale.y) ? rootScale.y : 1, sz = Number.isFinite(rootScale.z) ? rootScale.z : 1;
      const uniformRootScale = Math.abs(sx-sy)<1e-5 && Math.abs(sx-sz)<1e-5;
      const hasMeshEdits = Object.keys(assetEdit.meshes || {}).length > 0;
      const rootTilted = Math.abs(rootRot.x || 0)>1e-5 || Math.abs(rootRot.z || 0)>1e-5;
      a = { ...a, x:(a.x||0)+(Number(rootPos.x)||0), z:(a.z||0)+(Number(rootPos.z)||0), elevation:(a.elevation||0)+(Number(rootPos.y)||0), ry:(a.ry||0)+(Number(rootRot.y)||0) };

      // Every imported world asset is brought into the same metre space.
      // targetH is the final vertical size in metres; unitScale is only needed
      // for assets authored without a targetH fit. The cumulative scale is also
      // used for collision sidecars, so visual and physics geometry cannot drift.
      const rawBBox = new THREE.Box3().setFromObject(model);
      const rawH = rawBBox.max.y - rawBBox.min.y;
      const scalePlan = getWorldKitScalePlan(rawH, a, getWorldKitDefinition(a.url));
      let scaleFactor = scalePlan.totalScale;
      model.scale.setScalar(scaleFactor);
      model.scale.set(model.scale.x * sx, model.scale.y * sy, model.scale.z * sz);
      if (uniformRootScale) scaleFactor *= sx;
      model.rotation.set(Number(rootRot.x)||0, a.ry||0, Number(rootRot.z)||0);

      // Keep an unrotated, scaled local footprint for collision walls, interiors
      // and doorway placement. afterScaleBBox is the yaw-rotated placement box.
      model.updateMatrixWorld(true);
      const authoredRotation = model.rotation.clone();
      const authoredPosition = model.position.clone();
      model.rotation.y = 0;
      model.updateMatrixWorld(true);
      const modelLocalBBox = new THREE.Box3().setFromObject(model);
      model.rotation.copy(authoredRotation);
      model.position.copy(authoredPosition);
      model.updateMatrixWorld(true);
      const afterScaleBBox = new THREE.Box3().setFromObject(model);
      const yOffset = -afterScaleBBox.min.y + (a.elevation || 0);
      const anchorOffset = getWorldKitPlacementOffset(afterScaleBBox, a);
      // Apply the pivot correction to the placement itself before collision,
      // door, interior and building registries consume the same x/z values.
      a = { ...a, x: a.x + anchorOffset.x, z: a.z + anchorOffset.z };
      model.position.set(a.x, yOffset, a.z);
      this.group.add(model);
      if (streamChunk) streamChunk.roots.push(model);
      const worldKitInstance = {
        root: model,
        id: worldKitReport.id,
        category: worldKitReport.category,
        role: worldKitReport.role,
        meshCount: worldKitReport.meshCount,
        roleCounts: worldKitReport.roleCounts,
        building: !!a.building,
        position: { x: a.x, y: yOffset, z: a.z },
        scalePlan,
      };
      this.worldKitComponents.push(worldKitInstance);
      model.updateMatrixWorld(true);
      this._registerAssetNpcInteractables(model);

      // Enhance all materials for realism
      const envMap = this.scene.environment;
      // Keep shadow casters to buildings; dozens of separate trees and lamps
      // casting shadows multiplies shadow-map work across the city.
      const shouldCastShadow = !!a.building;
      model.traverse(o => {
        if (!o.isMesh) return;
        o.castShadow = shouldCastShadow;
        o.receiveShadow = true;
        const mat = o.material;
        const anisotropy = this._maxAnisotropy || 4;
        const applyAnisotropy = material => {
          if (!material) return;
          for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'bumpMap', 'alphaMap']) {
            if (material[key]) {
              material[key].anisotropy = anisotropy;
              material[key].needsUpdate = true;
            }
          }
        };
        if (mat && mat.isMeshStandardMaterial) {
          if (mat.roughness > 0.9) mat.roughness = Math.min(mat.roughness, 0.92);
          if (mat.metalness < 0.01 && mat.roughness < 0.5) mat.metalness = 0.05;
          if (envMap && !mat.envMap) { mat.envMap = envMap; mat.envMapIntensity = this._quality === 'ultra' ? 0.55 : 0.35; }
          applyAnisotropy(mat);
          mat.needsUpdate = true;
        } else if (mat && mat.isMeshPhongMaterial) {
          const std = new THREE.MeshStandardMaterial({
            color: mat.color,
            roughness: 0.7,
            metalness: 0.05,
          });
          if (envMap) { std.envMap = envMap; std.envMapIntensity = this._quality === 'ultra' ? 0.55 : 0.35; }
          applyAnisotropy(std);
          std.needsUpdate = true;
          o.material = std;
        }
      });

      // Add solid collision for GLB asset
      const assetUrl = (a.url || '').toLowerCase();
      const assetName = a.url.split('/').pop();
      const collisionProfile = a.collisionProfile || worldKitReport.collisionProfile;
      // Prefer explicit World Kit semantics. Keep filename fallbacks only for
      // older unregistered assets while the catalogue is being completed.
      const isTree = collisionProfile === 'trunk-only' ||
        (collisionProfile === 'placement-default' && (assetUrl.includes('tree') || assetUrl.includes('palm') || assetUrl.includes('coconut') || (a.tags && a.tags.includes('nature'))));
      const isLamp = collisionProfile === 'pole-proxy' ||
        (collisionProfile === 'placement-default' && (assetUrl.includes('street_light') || assetUrl.includes('lamp') || assetUrl.includes('light')));
      // Road collision is assigned only to assets explicitly registered as
      // drivable road surfaces. A filename containing "road" is not enough:
      // road barriers, bumps and small marked panels are ordinary props/details.
      const isRoad = collisionProfile === 'road-surface';
      const hasNoCollision = !!a.noCollision || collisionProfile === 'no-collision';

      // Imported street-road surfaces supply their own detailed tyre-contact
      // geometry. Only the authored asphalt planes enter the road physics mesh
      // batch; side textures and edge details remain visual-only.
      if (isRoad) {
        let importedRoadMeshes = 0;
        model.traverse(o => {
          if (!o.isMesh || !o.geometry) return;
          const names = [];
          for (let node = o; node && node !== model; node = node.parent) {
            if (node.name) names.unshift(node.name);
          }
          const sourceName = names.join('/').toLowerCase();
          if (!sourceName.includes('two_lane_road') || sourceName.includes('side_texture')) return;
          const geometry = o.geometry.clone();
          geometry.applyMatrix4(o.matrixWorld);
          geometry.computeBoundingBox();
          geometry.computeBoundingSphere();
          const roadSurface = { kind: 'imported_road', geometry };
          if (streamChunk) roadSurface._streamChunkKey = streamChunk.key;
          this.roadPhysicsMeshes.push(roadSurface);
          o.userData.worldKit ||= {};
          o.userData.worldKit.role = 'road-surface';
          importedRoadMeshes++;
        });
        if (!importedRoadMeshes) {
          console.warn('[WorldKit] Road-surface asset supplied no recognised road meshes:', a.url);
        }
      }

      const bbox = new THREE.Box3().setFromObject(model, true);
      // Invert only the placement translation/yaw (not scale) to preserve
      // exact model-local door dimensions for rotated buildings.
      const placementInverse = new THREE.Matrix4().compose(
        new THREE.Vector3(a.x || 0, yOffset, a.z || 0),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0, a.ry || 0, 0)),
        new THREE.Vector3(1, 1, 1),
      ).invert();
      const collisionProxyBoxes = [];
      const doorMeshes = [];
      const floorCollisionBoxes = [];
      const stairMeshes = [];
      model.traverse((o) => {
        if (!o.isMesh) return;
        // Support both a mesh named col_wall and a mesh nested inside a node
        // named col_wall (common after Blender/glTF export).
        const isProxy = this._hasAncestorPrefix(o, 'col_');
        const isDoor = classifyWorldKitMesh(o, model) === 'door';
        const isFloor = this._hasAncestorPrefix(o, 'floor_');
        const isStair = this._hasAncestorPrefix(o, 'stairs_');
        if (!isProxy && !isDoor && !isFloor && !isStair) return;
        o.updateWorldMatrix(true, false);
        const geo = o.geometry;
        if (!geo || !geo.attributes.position) return;
        if (!geo.boundingBox) geo.computeBoundingBox();
        if (!geo.boundingBox) return;
        const meshBox = new THREE.Box3().copy(geo.boundingBox).applyMatrix4(o.matrixWorld);
        const size = meshBox.getSize(new THREE.Vector3());
        const center = meshBox.getCenter(new THREE.Vector3());
        const localMatrix = placementInverse.clone().multiply(o.matrixWorld);
        const localBox = new THREE.Box3().copy(geo.boundingBox).applyMatrix4(localMatrix);
        const localSize = localBox.getSize(new THREE.Vector3());
        const localCenter = localBox.getCenter(new THREE.Vector3());
        const record = {
          name: o.name,
          min: meshBox.min.clone(), max: meshBox.max.clone(), center, size,
          localMin: localBox.min.clone(), localMax: localBox.max.clone(),
          localCenter, localSize,
        };
        if (isProxy) collisionProxyBoxes.push(record);
        if (isDoor) {
          record.source = 'native-door-mesh';
          doorMeshes.push(record);
        }
        if (isFloor) floorCollisionBoxes.push(record);
        if (isStair) stairMeshes.push(o);
      });
      // Some source models group a complete entrance under a descriptive
      // node instead of exposing one door_* mesh. Collapse that hierarchy into
      // one doorway marker using the group's actual imported bounds.
      if (a.building && doorMeshes.length === 0) {
        const groupNames = getWorldKitDoorGroups(worldKitReport.id);
        if (groupNames.length) {
          model.traverse(node => {
            if (!groupNames.includes(node.name) || node.isMesh) return;
            node.updateWorldMatrix(true, false);
            const groupBounds = new THREE.Box3().setFromObject(node);
            if (groupBounds.isEmpty()) return;
            const worldCenter = groupBounds.getCenter(new THREE.Vector3());
            const worldSize = groupBounds.getSize(new THREE.Vector3());
            if (worldSize.x < 0.25 || worldSize.y < 1.2 || worldSize.z < 0.08) return;
            const localBounds = groupBounds.clone().applyMatrix4(placementInverse);
            const localCenter = localBounds.getCenter(new THREE.Vector3());
            const localSize = localBounds.getSize(new THREE.Vector3());
            doorMeshes.push({
              name: node.name,
              center: worldCenter,
              size: worldSize,
              min: groupBounds.min.clone(),
              max: groupBounds.max.clone(),
              localCenter,
              localSize,
              side: null,
              source: 'world-kit-door-group',
            });
            this._addWorldKitDoorProxyMarker(
              model, node.name, localCenter, localSize, 'world-kit-door-group',
            );
          });
        }
      }

      // Older downloaded models have no door_* marker nodes. Add authoring
      // markers from the World Kit metadata only when no imported doorway was
      // found. These metre-space records never replace or rewrite source meshes.
      if (a.building && doorMeshes.length === 0) {
        const markers = Array.isArray(a.doorMarkers)
          ? a.doorMarkers
          : getWorldKitDoorMarkers(worldKitReport.id);
        const min = modelLocalBBox.min, max = modelLocalBBox.max;
        const width = max.x - min.x, depth = max.z - min.z;
        const c = Math.cos(a.ry || 0), sn = Math.sin(a.ry || 0);
        for (const marker of markers) {
          const side = ['north', 'south', 'east', 'west'].includes(marker.side) ? marker.side : 'south';
          const u = THREE.MathUtils.clamp(Number.isFinite(marker.u) ? marker.u : 0.5, 0.06, 0.94);
          const doorWidth = THREE.MathUtils.clamp(Number(marker.width) || 1.2, 0.7, 4.5);
          const doorHeight = THREE.MathUtils.clamp(Number(marker.height) || 2.15, 1.7, 3.6);
          const doorDepth = THREE.MathUtils.clamp(Number(marker.depth) || 0.24, 0.12, 0.65);
          const localCenter = new THREE.Vector3(
            side === 'west' ? min.x + doorDepth / 2
              : side === 'east' ? max.x - doorDepth / 2
              : min.x + width * u,
            min.y + doorHeight / 2,
            side === 'north' ? min.z + doorDepth / 2
              : side === 'south' ? max.z - doorDepth / 2
              : min.z + depth * u,
          );
          const localSize = side === 'west' || side === 'east'
            ? new THREE.Vector3(doorDepth, doorHeight, doorWidth)
            : new THREE.Vector3(doorWidth, doorHeight, doorDepth);
          const center = new THREE.Vector3(
            (a.x || 0) + localCenter.x * c + localCenter.z * sn,
            yOffset + localCenter.y,
            (a.z || 0) - localCenter.x * sn + localCenter.z * c,
          );
          const size = new THREE.Vector3(
            Math.abs(c) * localSize.x + Math.abs(sn) * localSize.z,
            localSize.y,
            Math.abs(sn) * localSize.x + Math.abs(c) * localSize.z,
          );
          doorMeshes.push({
            name: marker.name || 'door_main',
            side,
            center,
            size,
            localCenter,
            localSize,
            min: center.clone().sub(size.clone().multiplyScalar(0.5)),
            max: center.clone().add(size.clone().multiplyScalar(0.5)),
            source: 'world-kit-door-marker',
          });
          this._addWorldKitDoorProxyMarker(
            model, marker.name || 'door_main', localCenter, localSize, 'world-kit-door-marker',
          );
        }
      }

      // Hide collision proxy geometry after recording its world-space bounds,
      // including child meshes nested beneath a col_* node.
      model.traverse((o) => { if (o.isMesh && this._hasAncestorPrefix(o, 'col_')) o.visible = false; });

      // Empty/degenerate col_* meshes must not suppress sidecar or fallback
      // collision. Only a usable proxy counts as an authored collision source.
      const usableCollisionProxyBoxes = collisionProxyBoxes.filter(
        p => p.size.x > 0.05 && p.size.y > 0.05 && p.size.z > 0.05,
      );

      // Prefer usable authored col_* meshes. Avoid fetching a manifest when a
      // dedicated proxy type or explicit per-world collision dimensions win.
      const collisionManifestUrl = getWorldKitCollisionManifest(a.url, a);
      const collisionManifest = collisionManifestUrl && !usableCollisionProxyBoxes.length && !isTree && !isLamp && !hasNoCollision &&
        !a.collisionSize && !a.collisionH && !hasMeshEdits && uniformRootScale && !rootTilted
        ? await this._loadCollisionManifest({ ...a, collisionManifest: collisionManifestUrl })
        : null;
      // True only if this loading path actually injected sidecar colliders.
      // Merely finding a sidecar must not suppress floor_/stairs_ fallbacks when
      // a per-world collisionSize/collisionH override takes priority.
      let usesCollisionManifest = false;

      let collisionSource = hasNoCollision ? 'no-collision' : isRoad ? 'road-surface' : 'unresolved';
      let generatedCollisionProxyCount = 0;

      if (!hasNoCollision && !isRoad && !bbox.isEmpty()) {
        const size = bbox.getSize(new THREE.Vector3());
        const center = bbox.getCenter(new THREE.Vector3());
        if (size.x > 0.1 && size.y > 0.1 && size.z > 0.1) {
          // Explicit col_* boxes are the preferred authoring format. They are
          // hidden visuals but become solid gameplay colliders, for buildings
          // as well as climbable props.
          if (usableCollisionProxyBoxes.length) {
            collisionSource = 'authored-col-proxies';
            for (const p of usableCollisionProxyBoxes) {
              this.addCollider(p.center.x, p.min.y, p.center.z, p.size.x, p.size.y, p.size.z, !!a.climbable, a.type || null);
            }
          } else if (isTree) {
            collisionSource = 'trunk-only';
            this.addCollider(a.x, bbox.min.y, a.z, 0.5, size.y, 0.5);
          } else if (isLamp) {
            collisionSource = 'pole-proxy';
            this.addCollider(a.x, bbox.min.y, a.z, 0.35, size.y, 0.35);
          } else if (a.collisionSize) {
            collisionSource = 'placement-override';
            const yaw = a.ry || 0;
            const cs = Math.abs(Math.cos(yaw)), sn = Math.abs(Math.sin(yaw));
            const collisionW = cs * a.collisionSize[0] + sn * a.collisionSize[1];
            const collisionD = sn * a.collisionSize[0] + cs * a.collisionSize[1];
            this.addCollider(a.x, bbox.min.y, a.z, collisionW, a.collisionH || size.y, collisionD, !!a.climbable, a.type || null);
          } else if (a.collisionH) {
            collisionSource = 'placement-override';
            this.addCollider(center.x, bbox.min.y, center.z, size.x, a.collisionH, size.z, !!a.climbable, a.type || null);
          } else if (collisionManifest?.boxes?.length) {
            const injected = this._injectManifestColliders(collisionManifest, a, scaleFactor, yOffset, doorMeshes, bbox);
            usesCollisionManifest = injected > 0;
            if (injected) {
              collisionSource = 'collision-sidecar';
            } else if (a.building) {
              generatedCollisionProxyCount = this._addBuildingWallColliders(bbox, doorMeshes, {
                localBBox: modelLocalBBox,
                x: a.x || 0,
                z: a.z || 0,
                yOffset,
                yaw: a.ry || 0,
                modelRoot: model,
              });
              collisionSource = 'generated-building-wall-proxies';
            } else {
              collisionSource = 'solid-bounds';
              this.addCollider(center.x, bbox.min.y, center.z, size.x, size.y, size.z, !!a.climbable, a.type || null);
            }
            console.log(`[World] Injected ${injected} collision boxes from ${collisionManifestUrl}`);
          } else if (a.building) {
            generatedCollisionProxyCount = this._addBuildingWallColliders(bbox, doorMeshes, {
              localBBox: modelLocalBBox,
              x: a.x || 0,
              z: a.z || 0,
              yOffset,
              yaw: a.ry || 0,
              modelRoot: model,
            });
            collisionSource = 'generated-building-wall-proxies';
          } else {
            collisionSource = 'solid-bounds';
            this.addCollider(center.x, bbox.min.y, center.z, size.x, size.y, size.z, !!a.climbable, a.type || null);
          }
        }
      }

      worldKitInstance.doorCount = doorMeshes.length;
      worldKitInstance.doorSources = [...new Set(doorMeshes.map(door => door.source || 'native-door-mesh'))];
      worldKitInstance.doorSource = worldKitInstance.doorSources[0] || 'missing';
      worldKitInstance.collisionSource = collisionSource;
      worldKitInstance.generatedCollisionProxyCount = generatedCollisionProxyCount;

      // A floor_* mesh is an actual walkable slab. The GLB manifest normally
      // provides finer per-cell boxes; when none exists, create a thin slab at
      // the mesh's real top height rather than leaving the visible floor ghosted.
      if (!hasNoCollision && !isRoad && !usesCollisionManifest) {
        for (const floor of floorCollisionBoxes) {
          const h = Math.max(floor.size.y, 0.12);
          const bottomY = floor.max.y - h;
          if (floor.size.x > 0.2 && floor.size.z > 0.2) {
            this.addCollider(floor.center.x, bottomY, floor.center.z, floor.size.x, h, floor.size.z);
          }
        }
        // Simple stair meshes without a sidecar still get top-tread colliders.
        // Detailed assets should use *_col.json, which provides denser cells.
        const hasStairProxy = usableCollisionProxyBoxes.some(p => /stairs?/i.test(p.name));
        if (!hasStairProxy) {
          let treadCount = 0;
          for (const stair of stairMeshes) {
            for (const step of this._collectStairStepBoxes(stair)) {
              this.addCollider(step.x, step.topY - step.h, step.z, step.w, step.h, step.d);
              treadCount++;
            }
          }
          if (stairMeshes.length) {
            console.log(`[World] Injected ${treadCount} walkable stair treads for ${assetName}`);
          }
        }
      }

      if (a.building) {
        const buildingIdx = this._buildingData.length;
        this._buildingData.push({
          url: assetName,
          min: bbox.min.clone(),
          max: bbox.max.clone(),
          x: a.x, z: a.z,
          doors: [],
          interior: null,
        });

        // Door bounds were collected before collision generation so the wall
        // colliders can leave an opening at the entrance.
        if (doorMeshes.length > 0) {
          this._registerBuildingDoors(a, model, doorMeshes, buildingIdx, {
            localBBox: modelLocalBBox, x: a.x || 0, z: a.z || 0, yaw: a.ry || 0,
          });
        }

        // Hide col_* proxy meshes if present
        model.traverse(o => {
          if (o.isMesh && this._isCollisionMesh(o.name)) o.visible = false;
        });
      }

      this.coverPoints.push(new THREE.Vector3(a.x, 0, a.z));

      // Register model meshes for BVH collision — ONLY buildings and climbables
      // (Foliage/trees/lamps should never clip 3rd-person camera into the player's head)
      if (this.bvhWorld && !isTree && !isLamp && (a.building || a.climbable)) {
        this.bvhWorld.registerModel(model, {
          tags: a.tags || [],
          selective: true,
          layer: 1,
        });
      }

      console.log('[World] Spawned GLB asset:', assetName, a.climbable ? '(climbable)' : '', a.building ? '(building)' : '');
    } catch (e) {
      console.warn('[World] Failed to load GLB asset:', a.url, e);
    }
  }

  _addWorldKitDoorProxyMarker(model, markerName, localCenter, localSize, source = 'world-kit-metadata') {
    if (!model || !localCenter || !localSize) return null;
    const safeName = String(markerName || 'main').replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '');
    // Marker bounds are measured after model normalization. Divide by the
    // parent root scale before attaching so the node is not scaled a second time.
    const rootScale = model.scale;
    const sx = Math.abs(rootScale.x) > 1e-8 ? rootScale.x : 1;
    const sy = Math.abs(rootScale.y) > 1e-8 ? rootScale.y : 1;
    const sz = Math.abs(rootScale.z) > 1e-8 ? rootScale.z : 1;
    const geometry = new THREE.BoxGeometry(
      Math.max(0.05, localSize.x / Math.abs(sx)),
      Math.max(0.05, localSize.y / Math.abs(sy)),
      Math.max(0.05, localSize.z / Math.abs(sz)),
    );
    const marker = new THREE.Mesh(geometry, this._getWorldKitProxyMaterial());
    marker.name = 'door_auto_' + (safeName || 'main');
    marker.visible = false;
    marker.castShadow = false;
    marker.receiveShadow = false;
    marker.position.set(localCenter.x / sx, localCenter.y / sy, localCenter.z / sz);
    marker.userData.worldKit = { role: 'door', source, generated: true };
    model.add(marker);
    model.updateWorldMatrix(true, false);
    return marker;
  }

  _getWorldKitProxyMaterial() {
    if (!this._worldKitProxyMaterial) this._worldKitProxyMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
    return this._worldKitProxyMaterial;
  }

  _addBuildingWallColliders(bbox, doors = [], transform = null) {
    const localBBox = transform?.localBBox;
    if (!localBBox) return;
    const min = localBBox.min, max = localBBox.max;
    const width = max.x - min.x, depth = max.z - min.z, height = max.y - min.y;
    if (width < 1 || depth < 1 || height < 1) return;

    const originX = transform.x || 0, originZ = transform.z || 0;
    const yaw = transform.yaw || 0;
    const c = Math.cos(yaw), sn = Math.sin(yaw);
    const yOffset = transform.yOffset || 0;
    const proxyMatrices = [];
    const proxyDummy = new THREE.Object3D();
    const thickness = THREE.MathUtils.clamp(Math.min(width, depth) * 0.025, 0.22, 0.45);
    const doorHeight = Math.min(height, 2.2);
    const toWorld = (x, z) => ({
      x: originX + x * c + z * sn,
      z: originZ - x * sn + z * c,
    });
    const toLocal = (x, z) => {
      const dx = x - originX, dz = z - originZ;
      return { x: dx * c - dz * sn, z: dx * sn + dz * c };
    };
    const addLocalBox = (x, y, z, w, h, d) => {
      if (w <= 0.05 || h <= 0.05 || d <= 0.05) return;
      const p = toWorld(x, z);
      // Movement uses AABBs, so approximate a rotated wall with short boxes.
      // Segmenting the wall keeps diagonal building colliders close to the
      // visible facade instead of enclosing half the building in one huge box.
      const worldW = Math.abs(c) * w + Math.abs(sn) * d;
      const worldD = Math.abs(sn) * w + Math.abs(c) * d;
      this.addCollider(p.x, yOffset + y, p.z, worldW, h, worldD);
      if (transform.modelRoot) {
        // Wall extents are already in normalized metres. Convert them back to
        // the model root's local source coordinates before adding the child.
        const rootScale = transform.modelRoot.scale;
        const sx = Math.abs(rootScale.x) > 1e-8 ? rootScale.x : 1;
        const sy = Math.abs(rootScale.y) > 1e-8 ? rootScale.y : 1;
        const sz = Math.abs(rootScale.z) > 1e-8 ? rootScale.z : 1;
        proxyDummy.position.set(x / sx, (y + h / 2) / sy, z / sz);
        proxyDummy.rotation.set(0, 0, 0);
        proxyDummy.scale.set(w / Math.abs(sx), h / Math.abs(sy), d / Math.abs(sz));
        proxyDummy.updateMatrix();
        proxyMatrices.push(proxyDummy.matrix.clone());
      }
    };

    const sideOpenings = { west: [], east: [], north: [], south: [] };
    for (const door of doors) {
      const p = door.localCenter || toLocal(door.center.x, door.center.z);
      const side = door.side || [
        ['west', Math.abs(p.x - min.x)],
        ['east', Math.abs(p.x - max.x)],
        ['north', Math.abs(p.z - min.z)],
        ['south', Math.abs(p.z - max.z)],
      ].sort((a, b) => a[1] - b[1])[0][0];
      // Use the doorway's exact unrotated, scaled dimensions when available.
      // A world-axis-aligned box grows at diagonal angles and overestimates gaps.
      const openingAxis = side === 'west' || side === 'east' ? 'z' : 'x';
      const openingSize = door.localSize?.[openingAxis]
        || Math.max(door.size.x, door.size.z) / Math.max(0.5, Math.max(Math.abs(c), Math.abs(sn)));
      const span = THREE.MathUtils.clamp(
        openingSize + 0.25,
        1.1,
        (side === 'west' || side === 'east' ? depth : width) * 0.6,
      );
      const center = side === 'west' || side === 'east' ? p.z : p.x;
      const alongMin = side === 'west' || side === 'east' ? min.z : min.x;
      const alongMax = side === 'west' || side === 'east' ? max.z : max.x;
      const openStart = THREE.MathUtils.clamp(center - span / 2, alongMin, alongMax);
      const openEnd = THREE.MathUtils.clamp(center + span / 2, alongMin, alongMax);
      sideOpenings[side].push({ start: openStart, end: openEnd, center, span });
    }

    const addWallRuns = (side) => {
      const horizontal = side === 'north' || side === 'south';
      const runMin = horizontal ? min.x : min.z;
      const runMax = horizontal ? max.x : max.z;
      const fixed = side === 'west' ? min.x + thickness / 2
        : side === 'east' ? max.x - thickness / 2
        : side === 'north' ? min.z + thickness / 2
        : max.z - thickness / 2;
      const openings = sideOpenings[side].sort((a, b) => a.start - b.start);
      const addRun = (a, b) => {
        if (b - a < 0.08) return;
        const segmentMax = 1.25;
        const count = Math.max(1, Math.ceil((b - a) / segmentMax));
        for (let i = 0; i < count; i++) {
          const s = a + (b - a) * i / count;
          const e = a + (b - a) * (i + 1) / count;
          const alongCenter = (s + e) / 2;
          const alongSize = e - s + 0.04;
          if (horizontal) {
            addLocalBox(alongCenter, min.y, fixed, alongSize, height, thickness);
          } else {
            addLocalBox(fixed, min.y, alongCenter, thickness, height, alongSize);
          }
        }
      };
      let cursor = runMin;
      for (const opening of openings) {
        const a = THREE.MathUtils.clamp(opening.start, runMin, runMax);
        const b = THREE.MathUtils.clamp(opening.end, runMin, runMax);
        addRun(cursor, a);
        cursor = Math.max(cursor, b);
      }
      addRun(cursor, runMax);

      // Keep the wall above each doorway solid so players cannot jump or fall
      // through a full-height cutout where the entrance should only be ~2.2m.
      for (const opening of openings) {
        if (height <= doorHeight + 0.05) continue;
        const span = Math.max(0.05, opening.end - opening.start);
        const center = (opening.start + opening.end) / 2;
        if (horizontal) addLocalBox(center, min.y + doorHeight, fixed, span, height - doorHeight, thickness);
        else addLocalBox(fixed, min.y + doorHeight, center, thickness, height - doorHeight, span);
      }
    };

    addWallRuns('west');
    addWallRuns('east');
    addWallRuns('north');
    addWallRuns('south');

    // The generated proxy is a single hidden InstancedMesh named col_auto_*.
    // Movement keeps the separate wall AABBs above, preserving every doorway.
    if (transform.modelRoot && proxyMatrices.length) {
      const proxy = new THREE.InstancedMesh(
        new THREE.BoxGeometry(1, 1, 1),
        this._getWorldKitProxyMaterial(),
        proxyMatrices.length,
      );
      proxy.name = 'col_auto_building_shell';
      proxy.count = proxyMatrices.length;
      proxy.visible = false;
      proxy.castShadow = false;
      proxy.receiveShadow = false;
      proxy.frustumCulled = false;
      for (let i = 0; i < proxyMatrices.length; i++) proxy.setMatrixAt(i, proxyMatrices[i]);
      proxy.instanceMatrix.needsUpdate = true;
      proxy.userData.worldKit = {
        role: 'collision-proxy',
        source: 'generated-perimeter-wall',
        boxCount: proxyMatrices.length,
      };
      transform.modelRoot.add(proxy);
      transform.modelRoot.updateWorldMatrix(true, false);
    }

    return proxyMatrices.length;
  }

  _hasAncestorPrefix(object, prefix) {
    let current = object;
    while (current && current !== this.group) {
      if ((current.name || '').toLowerCase().startsWith(prefix)) return true;
      current = current.parent;
    }
    return false;
  }

  _isDoorMesh(name) {
    return (name || '').toLowerCase().startsWith('door_');
  }

  _isCollisionMesh(name) {
    return (name || '').toLowerCase().startsWith('col_');
  }

  _isRoomMarker(name) {
    const m = (name || '').toLowerCase().match(/^room_(\d+)_marker$/);
    return m ? parseInt(m[1]) : -1;
  }

  _isStairMesh(name) {
    return (name || '').toLowerCase().startsWith('stairs_');
  }

  _collectStairStepBoxes(mesh) {
    const geo = mesh?.geometry;
    const pos = geo?.attributes?.position;
    if (!pos || pos.count < 3) return [];
    mesh.updateWorldMatrix(true, false);
    const index = geo.index;
    const triangleCount = index ? Math.floor(index.count / 3) : Math.floor(pos.count / 3);
    if (triangleCount > 30000) return [];
    const v = new THREE.Vector3();
    const vertex = (i) => {
      const sourceIndex = index ? index.getX(i) : i;
      v.set(pos.getX(sourceIndex), pos.getY(sourceIndex), pos.getZ(sourceIndex));
      return v.clone().applyMatrix4(mesh.matrixWorld);
    };
    const levels = new Map();
    for (let t = 0; t < triangleCount; t++) {
      const a = vertex(t * 3), b = vertex(t * 3 + 1), c = vertex(t * 3 + 2);
      const minY = Math.min(a.y, b.y, c.y), maxY = Math.max(a.y, b.y, c.y);
      if (maxY - minY > 0.08) continue; // only horizontal tread faces
      const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z;
      const vx = c.x - a.x, vy = c.y - a.y, vz = c.z - a.z;
      const nx = uy * vz - uz * vy;
      const ny = uz * vx - ux * vz;
      const nz = ux * vy - uy * vx;
      const normalLength = Math.hypot(nx, ny, nz);
      if (normalLength < 1e-6 || Math.abs(ny / normalLength) < 0.85) continue;
      const minX = Math.min(a.x, b.x, c.x), maxX = Math.max(a.x, b.x, c.x);
      const minZ = Math.min(a.z, b.z, c.z), maxZ = Math.max(a.z, b.z, c.z);
      if (maxX - minX < 0.05 || maxZ - minZ < 0.05) continue;
      const topY = Math.round(((a.y + b.y + c.y) / 3) * 20) / 20;
      let level = levels.get(topY);
      if (!level) {
        level = { minX, maxX, minZ, maxZ, topY };
        levels.set(topY, level);
      } else {
        level.minX = Math.min(level.minX, minX);
        level.maxX = Math.max(level.maxX, maxX);
        level.minZ = Math.min(level.minZ, minZ);
        level.maxZ = Math.max(level.maxZ, maxZ);
      }
    }
    const steps = [];
    for (const level of levels.values()) {
      const w = level.maxX - level.minX + 0.03;
      const d = level.maxZ - level.minZ + 0.03;
      if (w < 0.1 || d < 0.1) continue;
      steps.push({
        x: (level.minX + level.maxX) / 2,
        z: (level.minZ + level.maxZ) / 2,
        topY: level.topY,
        w, d, h: 0.12,
      });
    }
    return steps;
  }

  _isFloorMesh(name) {
    return (name || '').toLowerCase().startsWith('floor_');
  }

  _isWindowMesh(name) {
    return (name || '').toLowerCase().startsWith('window_');
  }

  _isSkipMesh(name) {
    const n = (name || '').toLowerCase();
    return n.startsWith('trim_') || n.startsWith('window_') || n.startsWith('roof_detail')
      || n.startsWith('sign') || n.startsWith('awning');
  }

  _subdivideMeshCollision(mesh) {
    const geo = mesh.geometry;
    if (!geo || !geo.attributes.position) return [];
    const posAttr = geo.attributes.position;
    const idx = geo.index;
    const wm = mesh.matrixWorld;
    const v = new THREE.Vector3();
    const colliders = [];

    const worldVerts = [];
    for (let i = 0; i < posAttr.count; i++) {
      v.set(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i));
      v.applyMatrix4(wm);
      worldVerts.push(v.clone());
    }

    let tris = [];
    if (idx) {
      for (let i = 0; i < idx.count; i += 3) {
        tris.push([idx.getX(i), idx.getX(i + 1), idx.getX(i + 2)]);
      }
    } else {
      for (let i = 0; i < posAttr.count; i += 3) {
        tris.push([i, i + 1, i + 2]);
      }
    }

    if (tris.length > 5000) return [];

    for (const tri of tris) {
      const a = worldVerts[tri[0]], b = worldVerts[tri[1]], c = worldVerts[tri[2]];
      const xMin = Math.min(a.x, b.x, c.x);
      const xMax = Math.max(a.x, b.x, c.x);
      const yMin = Math.min(a.y, b.y, c.y);
      const yMax = Math.max(a.y, b.y, c.y);
      const zMin = Math.min(a.z, b.z, c.z);
      const zMax = Math.max(a.z, b.z, c.z);
      const wx = xMax - xMin;
      const wy = yMax - yMin;
      const wz = zMax - zMin;
      if (wx < 0.02 || wy < 0.02 || wz < 0.02) continue;
      colliders.push({
        min: new THREE.Vector3(xMin, yMin, zMin),
        max: new THREE.Vector3(xMax, yMax, zMax),
      });
    }

    return colliders;
  }

  _meshNeedsSubdivision(mesh) {
    const geo = mesh.geometry;
    if (!geo || !geo.attributes.position) return false;
    const verts = geo.attributes.position.count;
    if (verts > 200) return true;
    mesh.updateWorldMatrix(true, false);
    geo.computeBoundingBox();
    const lb = geo.boundingBox;
    if (!lb) return false;
    const s = new THREE.Vector3().subVectors(lb.max, lb.min);
    const vol = s.x * s.y * s.z;
    const aspect = Math.max(s.x, s.y, s.z) / (Math.min(s.x, s.y, s.z) + 0.01);
    return vol > 8 || aspect > 4;
  }

  _registerBuildingDoors(a, model, doorMeshes, buildingIdx, transform = null) {
    const bd = this._buildingData[buildingIdx];
    const wallMargin = 1.0;
    const originX = transform?.x ?? a.x ?? 0;
    const originZ = transform?.z ?? a.z ?? 0;
    const yaw = transform?.yaw ?? a.ry ?? 0;
    // The interior volume is stored in the same local coordinate system as the
    // scaled GLB. An axis-aligned world bbox around a rotated building includes
    // outdoor corners and causes false "inside" state near the perimeter.
    const bounds = transform?.localBBox || new THREE.Box3(bd.min.clone(), bd.max.clone());
    const interiorMin = new THREE.Vector3(bounds.min.x + wallMargin, bounds.min.y, bounds.min.z + wallMargin);
    const interiorMax = new THREE.Vector3(bounds.max.x - wallMargin, bounds.max.y, bounds.max.z - wallMargin);
    if (interiorMin.x < interiorMax.x && interiorMin.z < interiorMax.z) {
      const interiorTransform = transform?.localBBox ? { x: originX, z: originZ, yaw } : null;
      bd.interior = { min: interiorMin, max: interiorMax, transform: interiorTransform };
      this.addInterior(interiorMin, interiorMax, interiorTransform);
    }
    const c = Math.cos(yaw), sn = Math.sin(yaw);
    const localBBox = transform?.localBBox;
    const toLocal = (x, z) => {
      const dx = x - originX, dz = z - originZ;
      return { x: dx * c - dz * sn, z: dx * sn + dz * c };
    };
    const toWorldDirection = (x, z) => new THREE.Vector3(x * c + z * sn, 0, -x * sn + z * c).normalize();

    for (const door of doorMeshes) {
      const local = door.localCenter || toLocal(door.center.x, door.center.z);
      let side = door.side || null;
      if (!side && localBBox) {
        const min = localBBox.min, max = localBBox.max;
        side = [
          ['west', Math.abs(local.x - min.x)],
          ['east', Math.abs(local.x - max.x)],
          ['north', Math.abs(local.z - min.z)],
          ['south', Math.abs(local.z - max.z)],
        ].sort((p, q) => p[1] - q[1])[0][0];
      } else if (!side) {
        const bCenterX = (bd.min.x + bd.max.x) / 2;
        const bCenterZ = (bd.min.z + bd.max.z) / 2;
        side = [
          ['west', Math.abs(door.center.x - bd.min.x)],
          ['east', Math.abs(door.center.x - bd.max.x)],
          ['north', Math.abs(door.center.z - bd.min.z)],
          ['south', Math.abs(door.center.z - bd.max.z)],
        ].sort((p, q) => p[1] - q[1])[0][0];
      }
      // Outward normal is based on the local building side, then rotated into
      // world coordinates. This stays correct for buildings placed at 30–60°.
      const localOut = side === 'west' ? [-1, 0]
        : side === 'east' ? [1, 0]
        : side === 'north' ? [0, -1] : [0, 1];
      const outward = toWorldDirection(localOut[0], localOut[1]);
      const entrancePos = door.center.clone();
      entrancePos.y = 0;
      const interiorPos = entrancePos.clone().sub(outward.clone().multiplyScalar(2.0));
      const exitPos = entrancePos.clone().add(outward.clone().multiplyScalar(2.0));

      this.addPortal(entrancePos, outward.clone().negate(), interiorPos, 'enter', buildingIdx);
      this.addPortal(interiorPos, outward.clone(), exitPos, 'exit', buildingIdx);
      bd.doors.push({
        name: door.name,
        entrance: entrancePos.clone(),
        exit: interiorPos.clone(),
        dir: outward.clone().negate(),
      });
      console.log(`[World] Door "${door.name}" at (${entrancePos.x.toFixed(1)}, ${entrancePos.z.toFixed(1)}) → interior at (${interiorPos.x.toFixed(1)}, ${interiorPos.z.toFixed(1)})`);
    }

    model.traverse(o => {
      const roomIdx = this._isRoomMarker(o.name);
      if (roomIdx >= 0) {
        o.updateWorldMatrix(true, false);
        const wp = new THREE.Vector3();
        wp.setFromMatrixPosition(o.matrixWorld);
        bd.rooms = bd.rooms || [];
        bd.rooms.push({ idx: roomIdx, pos: wp });
        console.log(`[World] Room ${roomIdx} marker at (${wp.x.toFixed(1)}, ${wp.z.toFixed(1)})`);
      }
    });
  }

  _rebuildGrid() {
    if (!this.bvhWorld) return;
    this.bvhWorld.aabbColliders.length = 0;
    this.bvhWorld._climbables.length = 0;
    for (const c of this.colliders) this.bvhWorld.aabbColliders.push(c);
    for (const c of this.climbables) this.bvhWorld._climbables.push(c);
    this.bvhWorld.rebuildAABBIndex();
  }

  // Material spec: string role or {m, c:[r,g,b]} with optional tint.
  _sceneMat(spec) {
    const s = spec || 'concrete';
    const m = typeof s === 'string' ? s : s.m;
    const c = typeof s === 'string' ? null : s.c;
    const key = (c ? m + c.join(',') : m);
    if (!this._mats) this._mats = {};
    if (this._mats[key]) return this._mats[key];
    const mk = () => {
      const col = c ? new THREE.Color(c[0] / 255, c[1] / 255, c[2] / 255) : null;
      switch (m) {
        case 'road': return this.mRoad();
        case 'walk': return this.mSidewalk();
        case 'plaza': return new THREE.MeshStandardMaterial({ map: TEX.makeSidewalkTexture(), color: col || 0x9a958c, roughness: .95, metalness: 0 });
        case 'concrete': return this.mConcrete(col ? [c[0], c[1], c[2]] : undefined);
        case 'brick': return this.mBrick(col ? [c[0], c[1], c[2]] : undefined);
        case 'panel': return this.mPanel(col ? [c[0], c[1], c[2]] : undefined);
        case 'wood': return this.mWood();
        case 'metal': return col ? new THREE.MeshStandardMaterial({ map: TEX.makeMetalTexture(512, [c[0], c[1], c[2]]), roughness: .5, metalness: .65 }) : this.mMetal();
        case 'crate': return this.mCrate();
        case 'roof': return this.mRoof();
        case 'shingle': return this.mShingle();
        case 'tile': return this.mTile();
        case 'roller': return this.mRoller();
        case 'corrugated': return this.mCorrugated(col ? [c[0], c[1], c[2]] : undefined);
        case 'barrel': return this.mBarrel();
        case 'glass': return this.mGlass();
        case 'modernglass': return this.mModernGlass();
        case 'door': return this.mDoor(col ? [c[0], c[1], c[2]] : undefined);
        case 'sand': return this.mSand();
        case 'ocean':
        case 'water': return this.mOcean();
        case 'artdeco':
        case 'artdecopink': return this.mArtDeco('pink');
        case 'artdecoteal': return this.mArtDeco('teal');
        case 'artdecocream': return this.mArtDeco('cream');
        case 'deck':
        case 'wooddeck': return this.mWoodDeck();
        case 'neon':
        case 'neonpink': return this.mNeon('#ff2a85', 'VICE');
        case 'neoncyan': return this.mNeon('#00f0ff', 'CLUB');
        case 'neongold': return this.mNeon('#ffd24a', 'CASINO');
        case 'palmtrunk': return this.mPalmTrunk();
        case 'palmfrond': return this.mPalmFrond();
        default: return this.mConcrete();
      }
    };
    if (this._quality === 'ultra-low') this._mats[key] = new THREE.MeshBasicMaterial({ color: 0x888888 });
    else this._mats[key] = mk();
    return this._mats[key];
  }

  // Roads: polylines of [x,z] waypoints, drawn as continuous mitered polygons
  // (no corner gaps, no overlaps). Optional 2.4m raised sidewalks with curbs.
  // Points are auto-smoothed via Catmull-Rom interpolation for realistic curves.
  _addRoadSurfaceColliders(pts, width, topY, closed = false, thickness = 0.05) {
    if (!pts || pts.length < 2 || width <= 0 || thickness <= 0) return 0;
    let added = 0;
    const segmentCount = pts.length - 1 + (closed ? 1 : 0);
    for (let i = 0; i < segmentCount; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      const dx = b.x - a.x, dz = b.z - a.z;
      const length = Math.hypot(dx, dz);
      if (length < 0.05) continue;
      const ux = dx / length, uz = dz / length;
      const centerX = (a.x + b.x) * 0.5;
      const centerZ = (a.z + b.z) * 0.5;
      const topA = (Number.isFinite(a.y) ? a.y : 0) + topY;
      const topB = (Number.isFinite(b.y) ? b.y : 0) + topY;
      const minTop = Math.min(topA, topB);
      const maxTop = Math.max(topA, topB);
      // Broadphase-only proxy. Its precise centreline and height profile are
      // stored separately; Rapier uses the rendered road triangle mesh.
      const overlap = Math.min(0.18, length * 0.08);
      const segmentLength = length + overlap * 2;
      const boxW = Math.abs(ux) * segmentLength + Math.abs(uz) * width;
      const boxD = Math.abs(uz) * segmentLength + Math.abs(ux) * width;
      const boxH = maxTop - minTop + thickness;
      const collider = this.addCollider(
        centerX, minTop - thickness, centerZ,
        boxW + 0.035, boxH, boxD + 0.035, false, 'road_surface',
      );
      collider.surfaceOnly = true;
      collider.surfaceSegment = {
        a: { x: a.x, z: a.z, y: topA },
        b: { x: b.x, z: b.z, y: topB },
        width,
        thickness,
      };
      collider.orientedBox = {
        center: { x: centerX, y: (topA + topB) / 2 - thickness / 2, z: centerZ },
        halfExtents: {
          x: segmentLength / 2,
          y: thickness / 2 + Math.abs(topB - topA) / 2,
          z: width / 2,
        },
        yaw: Math.atan2(-uz, ux),
      };
      added++;
    }
    return added;
  }

  // Highest valid support surface at XZ. Road proxies include centreline heights,
  // so ramps and stacked roads can be sampled without treating road edges as walls.
  groundHeightAt(x, z, maxHeight = Infinity) {
    let height = 0;
    const candidates = this.bvhWorld
      ? this.bvhWorld.queryAABB(x - 0.12, z - 0.12, x + 0.12, z + 0.12)
      : this.colliders;
    for (const c of candidates) {
      if (c.surfaceOnly && c.surfaceSegment) {
        const s = c.surfaceSegment;
        const dx = s.b.x - s.a.x, dz = s.b.z - s.a.z;
        const lenSq = dx * dx + dz * dz;
        if (lenSq < 1e-8) continue;
        const t = ((x - s.a.x) * dx + (z - s.a.z) * dz) / lenSq;
        if (t < -0.01 || t > 1.01) continue;
        const clampedT = THREE.MathUtils.clamp(t, 0, 1);
        const px = s.a.x + dx * clampedT, pz = s.a.z + dz * clampedT;
        if (Math.hypot(x - px, z - pz) > s.width * 0.5 + 0.15) continue;
        const surfaceY = THREE.MathUtils.lerp(s.a.y, s.b.y, clampedT);
        // A bridge may overlap a lower road in XZ. Only choose a surface the
        // caller can actually stand on; don't teleport a ground-level player
        // onto a deck several metres overhead.
        if (surfaceY > maxHeight + 1e-4) continue;
        height = Math.max(height, surfaceY);
        continue;
      }
      // Road proxies are height-sampling metadata, never movement obstacles.
      if (c.surfaceOnly || c.type === 'road_surface') continue;
      const h = c.max.y - c.min.y;
      if (h > 0.15 || c.min.y < -0.1 || c.max.y > 0.3) continue;
      if (x < c.min.x || x > c.max.x || z < c.min.z || z > c.max.z) continue;
      height = Math.max(height, c.max.y);
    }
    return height;
  }

  // Sample the physical surface under a tyre, including stacked roads/flyovers.
  // This mirrors the terrainAt() model: surface grip, rolling resistance and
  // speed allowance alter the existing vehicle physics rather than creating a second controller.
  vehicleSurfaceAt(x, z, y = 0) {
    const profiles = {
      asphalt: { surface: 'asphalt', grip: 1.0, rollingDrag: 1.0, speedLimitMultiplier: 1.0 },
      concrete: { surface: 'concrete', grip: 0.88, rollingDrag: 1.16, speedLimitMultiplier: 0.9 },
      dirt: { surface: 'dirt', grip: 0.66, rollingDrag: 1.48, speedLimitMultiplier: 0.68 },
      gravel: { surface: 'gravel', grip: 0.56, rollingDrag: 1.72, speedLimitMultiplier: 0.6 },
      mud: { surface: 'mud', grip: 0.42, rollingDrag: 2.05, speedLimitMultiplier: 0.45 },
      offroad: { surface: 'offroad', grip: 0.62, rollingDrag: 1.55, speedLimitMultiplier: 0.62 },
    };
    let best = null;
    let bestScore = Infinity;
    for (const chain of this._roadChains || []) {
      const pts = chain.pts || [];
      if (pts.length < 2) continue;
      const count = pts.length - 1 + (chain.closed ? 1 : 0);
      for (let i = 0; i < count; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        const dx = b.x - a.x, dz = b.z - a.z;
        const lenSq = dx * dx + dz * dz;
        if (lenSq < 1e-8) continue;
        const t = THREE.MathUtils.clamp(((x - a.x) * dx + (z - a.z) * dz) / lenSq, 0, 1);
        const px = a.x + dx * t, pz = a.z + dz * t;
        const lateral = Math.hypot(x - px, z - pz);
        const edge = (chain.W || 12) * 0.5;
        let key = String(chain.surface || 'asphalt').toLowerCase();
        if (lateral > edge + 0.25) {
          if (chain.sidewalk && lateral <= edge + 3.55) key = 'concrete';
          else continue;
        }
        if (key === 'off-road') key = 'offroad';
        if (!profiles[key]) key = 'asphalt';
        const height = THREE.MathUtils.lerp(Number(a.y) || 0, Number(b.y) || 0, t) + (chain.roadY ?? 0.06);
        const verticalDelta = Math.abs(height - y);
        if (verticalDelta > 1.25) continue; // Ignore a road above/below the vehicle.
        const score = lateral + verticalDelta * 2.0;
        if (score < bestScore) {
          bestScore = score;
          best = { key, height, distance: lateral, verticalDelta };
        }
      }
    }
    if (!best) {
      return { ...profiles.offroad, height: Number.isFinite(y) ? y : 0, distance: Infinity };
    }
    return { ...profiles[best.key], height: best.height, distance: best.distance, verticalDelta: best.verticalDelta };
  }

  _buildRoadPackSurface(pts, width, roadY, roadIndex = 0, roadName = '', blockedRanges = []) {
    const prefabs = this._roadPackPrefabs;
    if (!prefabs?.size || !pts || pts.length < 2) return 0;

    const cumulative = this._roadPolylineLengths(pts);
    const total = cumulative[cumulative.length - 1] || 0;
    if (total < 1) return 0;

    const wide = width >= 7.5;
    const longId = wide ? 'road-straight-long-02' : 'road-straight-long-01';
    const shortId = wide ? 'road-straight-02' : 'road-straight-01';
    const longPrefab = prefabs.get(longId);
    const shortPrefab = prefabs.get(shortId);
    if (!longPrefab || !shortPrefab) return 0;

    const at = distance => {
      let i = 0;
      while (i < cumulative.length - 2 && cumulative[i + 1] < distance) i++;
      const segment = Math.max(1e-6, cumulative[i + 1] - cumulative[i]);
      const t = THREE.MathUtils.clamp((distance - cumulative[i]) / segment, 0, 1);
      return {
        x: THREE.MathUtils.lerp(pts[i].x, pts[i + 1].x, t),
        y: THREE.MathUtils.lerp(Number(pts[i].y) || 0, Number(pts[i + 1].y) || 0, t),
        z: THREE.MathUtils.lerp(pts[i].z, pts[i + 1].z, t),
      };
    };
    const tangentAt = distance => {
      const a = at(Math.max(0, distance - 0.65));
      const b = at(Math.min(total, distance + 0.65));
      return new THREE.Vector3(b.x - a.x, b.y - a.y, b.z - a.z).normalize();
    };
    const angleBetween = (a, b) => Math.acos(THREE.MathUtils.clamp(a.dot(b), -1, 1));

    const intervals = [];
    let rangeCursor = 0;
    for (const range of blockedRanges || []) {
      const start = THREE.MathUtils.clamp(range[0], 0, total);
      const end = THREE.MathUtils.clamp(range[1], 0, total);
      if (start > rangeCursor + 0.1) intervals.push([rangeCursor, start]);
      rangeCursor = Math.max(rangeCursor, end);
    }
    if (rangeCursor < total - 0.1) intervals.push([rangeCursor, total]);
    if (!blockedRanges?.length) intervals.push([0, total]);

    const dummy = new THREE.Object3D();
    const basis = new THREE.Matrix4();
    const tangent = new THREE.Vector3();
    const right = new THREE.Vector3();
    const up = new THREE.Vector3();
    let tileIndex = 0;
    let placed = 0;
    const longLength = longPrefab.dimensions[2];

    for (const [intervalStart, intervalEnd] of intervals) {
      let cursor = intervalStart;
      while (cursor < intervalEnd - 0.08) {
        const remaining = intervalEnd - cursor;
        const probeLength = Math.min(longLength, remaining);
        const startTangent = tangentAt(cursor + Math.min(0.4, probeLength * 0.15));
        const endTangent = tangentAt(Math.max(cursor, cursor + probeLength - Math.min(0.4, probeLength * 0.15)));
        const curvature = angleBetween(startTangent, endTangent);
        const useLong = remaining >= Math.min(longLength * 0.76, 18)
          && curvature <= THREE.MathUtils.degToRad(13);
        const prefab = useLong ? longPrefab : shortPrefab;
        const tileLength = Math.min(prefab.dimensions[2], remaining);
        if (tileLength < 0.08) break;

        const start = at(cursor);
        const end = at(cursor + tileLength);
        const middle = at(cursor + tileLength * 0.5);
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        const dz = end.z - start.z;
        const horizontalLength = Math.hypot(dx, dz);
        const spatialLength = Math.hypot(horizontalLength, dy);
        if (horizontalLength < 0.05 || spatialLength < 0.05) {
          cursor += tileLength;
          continue;
        }

        tangent.set(dx, dy, dz).normalize();
        right.set(dz / horizontalLength, 0, -dx / horizontalLength).normalize();
        up.crossVectors(tangent, right).normalize();
        basis.makeBasis(right, up, tangent);

        dummy.position.set(middle.x, middle.y + roadY, middle.z);
        dummy.quaternion.setFromRotationMatrix(basis);
        dummy.scale.set(width / prefab.dimensions[0], 1, spatialLength / prefab.dimensions[2]);
        dummy.updateMatrix();

        let bucket = this._roadPackGeometryBuckets.get(prefab.id);
        if (!bucket) {
          bucket = { prefab, matrices: [] };
          this._roadPackGeometryBuckets.set(prefab.id, bucket);
        }
        bucket.matrices.push(dummy.matrix.clone());
        this.roadModuleInstances.push({
          id: prefab.id,
          roadName,
          x: middle.x,
          y: middle.y + roadY,
          z: middle.z,
          width,
          length: spatialLength,
          scaleX: width / prefab.dimensions[0],
          scaleZ: spatialLength / prefab.dimensions[2],
          tileIndex,
        });
        cursor += tileLength;
        tileIndex++;
        placed++;
      }
    }

    if (placed) this.roadPackRoadCount++;
    return placed;
  }

  // Merge road subgrade, shoulders and junction foundations into a single static mesh.
  // Street bases follow authored road curves and exclude elevated bridge decks.
  _buildStreetBases(chains, junctionData) {
    const positions = [], uvs = [], indices = [];
    let baseRoadCount = 0, segmentCount = 0, junctionCount = 0;
    const material = this._mat('street-base-subgrade', () => new THREE.MeshStandardMaterial({
      map: TEX.makeConcreteTexture(512, [105, 102, 95]),
      roughness: 0.99,
      metalness: 0,
      side: THREE.DoubleSide,
    }));
    const addVertex = (x, y, z, u, v) => {
      positions.push(x, y, z);
      uvs.push(u, v);
      return positions.length / 3 - 1;
    };
    const addTri = (a, b, c) => indices.push(a, b, c);

    // Straight/curved road foundations are cut back before intersections so the
    // shaped junction base below can join them without stacked coplanar faces.
    for (let chainIndex = 0; chainIndex < (chains || []).length; chainIndex++) {
      const chain = chains[chainIndex];
      if (!chain.streetBase || chain.flyover || chain.pts.length < 2) continue;
      const spec = chain.streetBase;
      const shoulder = THREE.MathUtils.clamp(
        Number.isFinite(Number(spec.shoulder)) ? Number(spec.shoulder) : (chain.W >= 12 ? 0.72 : 0.52),
        0.25, 1.5,
      );
      const depth = THREE.MathUtils.clamp(
        Number.isFinite(Number(spec.depth)) ? Number(spec.depth) : 0.34,
        0.18, 0.8,
      );
      const inset = THREE.MathUtils.clamp(
        Number.isFinite(Number(spec.inset)) ? Number(spec.inset) : 0.035,
        0.015, 0.12,
      );
      const halfTop = chain.W * 0.5 + shoulder;
      const halfBottom = halfTop + Math.min(0.32, shoulder * 0.4);
      const cumulative = junctionData.metadata[chainIndex].cumulative;
      const total = junctionData.metadata[chainIndex].total;
      const ranges = junctionData.ranges[chainIndex] || [];
      const intervals = [];
      let cursor = 0;
      if (!ranges.length) intervals.push([0, total]);
      else {
        for (const range of ranges) {
          const start = THREE.MathUtils.clamp(range[0], 0, total);
          const end = THREE.MathUtils.clamp(range[1], 0, total);
          if (start > cursor + 0.2) intervals.push([cursor, start]);
          cursor = Math.max(cursor, end);
        }
        if (cursor < total - 0.2) intervals.push([cursor, total]);
      }

      let roadHasBase = false;
      for (const [start, end] of intervals) {
        const piece = this._sliceRoadPolyline(chain.pts, cumulative, start, end);
        if (piece.length < 2) continue;
        const leftTop = this._offsetRoadPolyline(piece, halfTop);
        const rightTop = this._offsetRoadPolyline(piece, -halfTop);
        const leftBottom = this._offsetRoadPolyline(piece, halfBottom);
        const rightBottom = this._offsetRoadPolyline(piece, -halfBottom);
        const first = positions.length / 3;
        let distance = 0;
        for (let i = 0; i < piece.length; i++) {
          if (i > 0) distance += Math.hypot(piece[i].x - piece[i - 1].x, piece[i].z - piece[i - 1].z);
          const v = distance / 5.5;
          const topY = (Number(piece[i].y) || 0) + chain.roadY - inset;
          addVertex(leftTop[i].x, topY, leftTop[i].z, 0, v);
          addVertex(rightTop[i].x, topY, rightTop[i].z, 1, v);
          addVertex(leftBottom[i].x, topY - depth, leftBottom[i].z, 0, v + 0.1);
          addVertex(rightBottom[i].x, topY - depth, rightBottom[i].z, 1, v + 0.1);
          if (i > 0) {
            const a = first + (i - 1) * 4;
            const b = first + i * 4;
            addTri(a, b, a + 1);
            addTri(a + 1, b, b + 1);
            addTri(a, a + 2, b);
            addTri(a + 2, b + 2, b);
            addTri(a + 1, b + 1, a + 3);
            addTri(a + 3, b + 1, b + 3);
          }
        }
        const firstEnd = first, lastEnd = first + (piece.length - 1) * 4;
        addTri(firstEnd, firstEnd + 2, firstEnd + 1);
        addTri(firstEnd + 1, firstEnd + 2, firstEnd + 3);
        addTri(lastEnd, lastEnd + 1, lastEnd + 2);
        addTri(lastEnd + 1, lastEnd + 3, lastEnd + 2);
        roadHasBase = true;
        segmentCount++;
      }
      if (roadHasBase) baseRoadCount++;
    }

    // Build a matching raised foundation beneath every connected T, X or bend.
    // Its wider arms include the road shoulders and the core fills the centre.
    const junctionGroups = new Map();
    for (let chainIndex = 0; chainIndex < (chains || []).length; chainIndex++) {
      const chain = chains[chainIndex];
      if (!chain.streetBase || chain.flyover || chain.surface !== 'road-pack') continue;
      const usedDistances = [];
      for (const hit of junctionData.hits[chainIndex] || []) {
        if (usedDistances.some(distance => Math.abs(distance - hit.distance) < 0.65)) continue;
        usedDistances.push(hit.distance);
        const key = Math.round(hit.x * 4) + ':' + Math.round(hit.z * 4);
        if (!junctionGroups.has(key)) junctionGroups.set(key, { x: hit.x, z: hit.z, entries: [] });
        junctionGroups.get(key).entries.push({ chainIndex, chain, hit });
      }
    }

    const steps = 48;
    for (const junction of junctionGroups.values()) {
      const arms = [];
      let roadYTotal = 0, depthTotal = 0, count = 0;
      for (const entry of junction.entries) {
        const chain = entry.chain;
        const meta = junctionData.metadata[entry.chainIndex];
        const at = d => {
          let i = 0;
          while (i < meta.cumulative.length - 2 && meta.cumulative[i + 1] < d) i++;
          const length = Math.max(1e-6, meta.cumulative[i + 1] - meta.cumulative[i]);
          const t = THREE.MathUtils.clamp((d - meta.cumulative[i]) / length, 0, 1);
          return {
            x: THREE.MathUtils.lerp(chain.pts[i].x, chain.pts[i + 1].x, t),
            y: THREE.MathUtils.lerp(Number(chain.pts[i].y) || 0, Number(chain.pts[i + 1].y) || 0, t),
            z: THREE.MathUtils.lerp(chain.pts[i].z, chain.pts[i + 1].z, t),
          };
        };
        const before = at(Math.max(0, entry.hit.distance - 0.7));
        const after = at(Math.min(meta.total, entry.hit.distance + 0.7));
        let dx = after.x - before.x, dz = after.z - before.z;
        const length = Math.hypot(dx, dz);
        if (length < 0.05) continue;
        dx /= length; dz /= length;
        const nearStart = entry.hit.distance <= Math.max(0.8, chain.W * 0.055);
        const nearEnd = meta.total - entry.hit.distance <= Math.max(0.8, chain.W * 0.055);
        const dirs = nearStart && nearEnd ? [[dx, dz], [-dx, -dz]]
          : nearStart ? [[dx, dz]]
            : nearEnd ? [[-dx, -dz]]
              : [[dx, dz], [-dx, -dz]];
        const shoulder = THREE.MathUtils.clamp(
          Number.isFinite(Number(chain.streetBase.shoulder)) ? Number(chain.streetBase.shoulder) : 0.52,
          0.25, 1.5,
        );
        const depth = THREE.MathUtils.clamp(
          Number.isFinite(Number(chain.streetBase.depth)) ? Number(chain.streetBase.depth) : 0.34,
          0.18, 0.8,
        );
        roadYTotal += (Number(entry.hit.y) || 0) + chain.roadY;
        depthTotal += depth;
        count++;
        for (const dir of dirs) {
          if (arms.some(arm => arm.dx * dir[0] + arm.dz * dir[1] > 0.995
            && Math.abs(arm.halfWidth - (chain.W * 0.5 + shoulder)) < 0.45)) continue;
          arms.push({
            dx: dir[0], dz: dir[1],
            halfWidth: chain.W * 0.5 + shoulder,
            reach: entry.hit.radius + shoulder + 0.45,
          });
        }
      }
      if (arms.length < 2) continue;
      const fallbackCore = Math.max(...arms.map(arm => arm.halfWidth)) * 1.05;
      const ring = [];
      for (let i = 0; i < steps; i++) {
        const angle = i / steps * Math.PI * 2;
        const rayX = Math.cos(angle), rayZ = Math.sin(angle);
        let radius = fallbackCore;
        for (const arm of arms) {
          const along = rayX * arm.dx + rayZ * arm.dz;
          if (along < -1e-4) continue;
          const lateral = Math.abs(rayX * arm.dz - rayZ * arm.dx);
          const lengthLimit = along > 1e-4 ? arm.reach / along : Infinity;
          const widthLimit = arm.halfWidth / Math.max(lateral, 1e-4);
          radius = Math.max(radius, Math.min(lengthLimit, widthLimit));
        }
        ring.push({ x: junction.x + rayX * radius, z: junction.z + rayZ * radius });
      }
      const baseY = (roadYTotal / Math.max(1, count)) - 0.035;
      const depth = depthTotal / Math.max(1, count);
      const centerIndex = addVertex(junction.x, baseY, junction.z, junction.x / 5.5, junction.z / 5.5);
      const ringStart = positions.length / 3;
      for (const point of ring) {
        addVertex(point.x, baseY, point.z, point.x / 5.5, point.z / 5.5);
      }
      for (let i = 0; i < ring.length; i++) {
        const next = (i + 1) % ring.length;
        indices.push(centerIndex, ringStart + next, ringStart + i);
      }
      // Subgrade side wall around the outer perimeter.
      const lowerStart = positions.length / 3;
      for (const point of ring) addVertex(point.x, baseY - depth, point.z, point.x / 5.5, point.z / 5.5);
      for (let i = 0; i < ring.length; i++) {
        const next = (i + 1) % ring.length;
        const topA = ringStart + i, topB = ringStart + next;
        const lowA = lowerStart + i, lowB = lowerStart + next;
        indices.push(topA, lowA, topB, topB, lowA, lowB);
      }
      junctionCount++;
    }

    if (!positions.length) {
      this.streetBaseMeshes = [];
      this.streetBaseCount = 0;
      this.streetBaseSegmentCount = 0;
      this.streetBaseJunctionCount = 0;
      return 0;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'world_street_base_subgrade';
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.frustumCulled = true;
    mesh.userData.worldKit = {
      role: 'street-base-subgrade',
      roadCount: baseRoadCount,
      segmentCount,
      junctionCount,
      triangleCount: indices.length / 3,
    };
    this.group.add(mesh);
    this.streetBaseMeshes = [mesh];
    this.streetBaseCount = baseRoadCount;
    this.streetBaseSegmentCount = segmentCount;
    this.streetBaseJunctionCount = junctionCount;
    return baseRoadCount;
  }

  _buildRoadPackJunctionPatches(chains, junctionData) {
    if (!junctionData?.hits?.length) return 0;
    const groups = new Map();

    for (let chainIndex = 0; chainIndex < chains.length; chainIndex++) {
      const chain = chains[chainIndex];
      if (chain.surface !== 'road-pack') continue;
      const usedDistances = [];
      for (const hit of junctionData.hits[chainIndex] || []) {
        if (usedDistances.some(distance => Math.abs(distance - hit.distance) < 0.65)) continue;
        usedDistances.push(hit.distance);
        const key = Math.round(hit.x * 4) + ':' + Math.round(hit.z * 4);
        if (!groups.has(key)) groups.set(key, { x: hit.x, z: hit.z, entries: [] });
        groups.get(key).entries.push({ chainIndex, chain, hit });
      }
    }
    if (!groups.size) {
      this.roadPackJunctionMeshes = [];
      this.roadPackJunctionCount = 0;
      this.roadJunctionTypeCounts = { tJunction: 0, crossroads: 0, bends: 0, complex: 0 };
      return 0;
    }

    const sampleAt = (chain, cumulative, distance) => {
      let i = 0;
      while (i < cumulative.length - 2 && cumulative[i + 1] < distance) i++;
      const segment = Math.max(1e-6, cumulative[i + 1] - cumulative[i]);
      const t = THREE.MathUtils.clamp((distance - cumulative[i]) / segment, 0, 1);
      return {
        x: THREE.MathUtils.lerp(chain.pts[i].x, chain.pts[i + 1].x, t),
        y: THREE.MathUtils.lerp(Number(chain.pts[i].y) || 0, Number(chain.pts[i + 1].y) || 0, t),
        z: THREE.MathUtils.lerp(chain.pts[i].z, chain.pts[i + 1].z, t),
      };
    };

    const positions = [], uvs = [], indices = [];
    const typeCounts = { tJunction: 0, crossroads: 0, bends: 0, complex: 0 };
    const steps = 64;
    let validJunctionCount = 0;

    for (const junction of groups.values()) {
      const arms = [];
      let yTotal = 0, yCount = 0;
      for (const entry of junction.entries) {
        const meta = junctionData.metadata[entry.chainIndex];
        const total = meta?.total || 0;
        const before = sampleAt(entry.chain, meta.cumulative, Math.max(0, entry.hit.distance - 0.7));
        const after = sampleAt(entry.chain, meta.cumulative, Math.min(total, entry.hit.distance + 0.7));
        let dx = after.x - before.x, dz = after.z - before.z;
        const length = Math.hypot(dx, dz);
        if (length < 0.05) continue;
        dx /= length;
        dz /= length;
        const tolerance = Math.max(0.8, entry.chain.W * 0.055);
        const nearStart = entry.hit.distance <= tolerance;
        const nearEnd = total - entry.hit.distance <= tolerance;
        const directions = nearStart && nearEnd ? [[dx, dz], [-dx, -dz]]
          : nearStart ? [[dx, dz]]
            : nearEnd ? [[-dx, -dz]]
              : [[dx, dz], [-dx, -dz]];
        yTotal += (Number(entry.hit.y) || 0) + entry.chain.roadY;
        yCount++;
        for (const direction of directions) {
          const duplicate = arms.some(arm => arm.dx * direction[0] + arm.dz * direction[1] > 0.995
            && Math.abs(arm.halfWidth - entry.chain.W * 0.5) < 0.45);
          if (duplicate) continue;
          arms.push({
            dx: direction[0],
            dz: direction[1],
            halfWidth: entry.chain.W * 0.5,
            reach: Math.max(entry.hit.radius + 0.35, entry.chain.W * 0.5 + 1.1),
          });
        }
      }
      if (arms.length < 2) continue;

      let type = 'complex';
      if (arms.length === 3) type = 'tJunction';
      else if (arms.length === 4) type = 'crossroads';
      else if (arms.length === 2) type = 'bends';
      typeCounts[type]++;

      // This is the union of the approach corridors plus a compact central core.
      // The radial contour avoids stacked rectangles and leaves no exposed centre gap.
      const coreRadius = Math.max(...arms.map(arm => arm.halfWidth)) * 1.05;
      const ring = [];
      for (let i = 0; i < steps; i++) {
        const angle = i / steps * Math.PI * 2;
        const rayX = Math.cos(angle), rayZ = Math.sin(angle);
        let radius = coreRadius;
        for (const arm of arms) {
          const along = rayX * arm.dx + rayZ * arm.dz;
          if (along < -1e-4) continue;
          const lateral = Math.abs(rayX * arm.dz - rayZ * arm.dx);
          const lengthLimit = along > 1e-4 ? arm.reach / along : Infinity;
          const widthLimit = (arm.halfWidth + 0.14) / Math.max(lateral, 1e-4);
          radius = Math.max(radius, Math.min(lengthLimit, widthLimit));
        }
        ring.push({ x: junction.x + rayX * radius, z: junction.z + rayZ * radius });
      }

      const patchY = yCount ? yTotal / yCount : 0;
      const centerIndex = positions.length / 3;
      positions.push(junction.x, patchY + 0.012, junction.z);
      uvs.push(junction.x / 8, junction.z / 8);
      const ringStart = positions.length / 3;
      for (const point of ring) {
        positions.push(point.x, patchY + 0.012, point.z);
        uvs.push(point.x / 8, point.z / 8);
      }
      for (let i = 0; i < ring.length; i++) {
        const next = (i + 1) % ring.length;
        // Counter-clockwise in x/z gives an upward-facing +Y normal with this index order.
        indices.push(centerIndex, ringStart + next, ringStart + i);
      }
      validJunctionCount++;
    }

    this.roadJunctionTypeCounts = typeCounts;
    this.roadPackJunctionCount = validJunctionCount;
    if (!positions.length) {
      this.roadPackJunctionMeshes = [];
      return 0;
    }

    if (!this._roadPackJunctionMaterial) {
      const source = this.mRoad();
      this._roadPackJunctionMaterial = source.clone();
      if (source.map) {
        this._roadPackJunctionMaterial.map = source.map.clone();
        this._roadPackJunctionMaterial.map.wrapS = THREE.RepeatWrapping;
        this._roadPackJunctionMaterial.map.wrapT = THREE.RepeatWrapping;
        this._roadPackJunctionMaterial.map.repeat.set(1, 1);
        this._roadPackJunctionMaterial.map.needsUpdate = true;
      }
      this._roadPackJunctionMaterial.roughness = 0.96;
      this._roadPackJunctionMaterial.metalness = 0;
      this._roadPackJunctionMaterial.side = THREE.DoubleSide;
      this._roadPackJunctionMaterial.depthWrite = true;
      this._roadPackJunctionMaterial.needsUpdate = true;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, this._roadPackJunctionMaterial);
    mesh.name = 'worldkit_road_pack_connected_junction_surfaces';
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.renderOrder = 1.1;
    mesh.userData.worldKit = {
      assetId: 'road-pack',
      role: 'connected-junction-surface',
      junctionCount: validJunctionCount,
      junctionTypes: { ...typeCounts },
      triangleCount: indices.length / 3,
    };
    this.group.add(mesh);
    this.roadPackJunctionMeshes = [mesh];
    this.roadPhysicsMeshes.push({ kind: 'road', source: 'road-pack-junction', geometry });
    return validJunctionCount;
  }

  _flushRoadPackSurfaces() {
    if (!this._roadPackGeometryBuckets?.size) return;
    for (const [componentId, bucket] of this._roadPackGeometryBuckets) {
      const source = bucket.prefab.geometry;
      const sourceAttributes = source.attributes;
      const attributeNames = Object.keys(sourceAttributes).filter(name =>
        ['position', 'normal', 'tangent', 'uv', 'uv1'].includes(name)
      );
      const arrays = Object.fromEntries(attributeNames.map(name => [name, []]));
      const indices = [];
      let vertexOffset = 0;

      for (const matrix of bucket.matrices) {
        const transformed = source.clone();
        transformed.applyMatrix4(matrix);
        for (const name of attributeNames) {
          const attribute = transformed.getAttribute(name);
          if (!attribute) continue;
          const values = arrays[name];
          for (let i = 0; i < attribute.array.length; i++) values.push(attribute.array[i]);
        }

        const sourceIndex = transformed.index;
        if (sourceIndex) {
          for (const index of sourceIndex.array) indices.push(vertexOffset + index);
        } else {
          const count = transformed.getAttribute('position').count;
          for (let i = 0; i < count; i++) indices.push(vertexOffset + i);
        }
        vertexOffset += transformed.getAttribute('position').count;
        transformed.dispose();
      }

      const geometry = new THREE.BufferGeometry();
      for (const name of attributeNames) {
        const sourceAttribute = sourceAttributes[name];
        const values = arrays[name];
        if (!values?.length) continue;
        geometry.setAttribute(name, new THREE.Float32BufferAttribute(values, sourceAttribute.itemSize, sourceAttribute.normalized));
      }
      geometry.setIndex(indices);
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();

      const mesh = new THREE.Mesh(geometry, bucket.prefab.material);
      mesh.name = 'worldkit_road_surface_' + componentId;
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      mesh.renderOrder = 1;
      mesh.frustumCulled = true;
      mesh.userData.worldKit = {
        assetId: 'road-pack',
        componentId,
        role: 'road-surface',
        tileCount: bucket.matrices.length,
        source: './data/models/assets/roads/road_pack/scene.gltf',
      };
      this.group.add(mesh);
      this.roadPackSurfaceMeshes.push(mesh);
      // Register the same imported triangles for Rapier and tyre contact.
      this.roadPhysicsMeshes.push({
        kind: 'road',
        source: 'imported-road-pack',
        componentId,
        tileCount: bucket.matrices.length,
        geometry,
      });
    }
    this._roadPackGeometryBuckets.clear();
  }

  async _buildAuthoredRoads(roads) {
    const roadPack = await this._loadRoadPackPrefabs();
    if (roads.some(road => road.sidewalk)) await this._loadSidewalkKit();
    const roadMat = roadPack ? null : this.mRoad();
    const walkMat = this._sceneMat('walk');
    const curbMat = this.mCurb();
    this._roadChains = [];
    function catmullRom(p0, p1, p2, p3, t) {
      const t2 = t * t, t3 = t2 * t;
      const sample = key => 0.5 * (
        2 * p1[key]
        + (-p0[key] + p2[key]) * t
        + (2 * p0[key] - 5 * p1[key] + 4 * p2[key] - p3[key]) * t2
        + (-p0[key] + 3 * p1[key] - 3 * p2[key] + p3[key]) * t3
      );
      return { x: sample('x'), z: sample('z'), y: sample('y') };
    }
    function smoothPts(pts, segs) {
      if (pts.length < 3) return pts;
      const out = [], n = pts.length;
      for (let i = 0; i < n - 1; i++) {
        const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[Math.min(n - 1, i + 1)], p3 = pts[Math.min(n - 1, i + 2)];
        for (let s = 0; s < segs; s++) out.push(catmullRom(p0, p1, p2, p3, s / segs));
      }
      out.push(pts[n - 1]);
      return out;
    }
    const chains = [];
    for (const rd of roads) {
      const sourcePts = rd.points || [];
      if (sourcePts.length < 2) continue;
      const W = rd.w || 12;
      const baseElevation = Number.isFinite(rd.elevation) ? rd.elevation
        : Number.isFinite(rd.y) ? rd.y : 0;
      const closed = sourcePts.length > 2
        && sourcePts[0][0] === sourcePts[sourcePts.length - 1][0]
        && sourcePts[0][1] === sourcePts[sourcePts.length - 1][1];
      const work = closed ? sourcePts.slice(0, -1) : sourcePts;
      // Legacy points are [x,z]. Add a third ordinate [x,z,y] to author ramps.
      const raw = work.map(p => ({
        x: p[0], z: p[1],
        y: Number.isFinite(p[2]) ? p[2] : baseElevation,
      }));
      const smoothed = rd.smooth !== false ? smoothPts(raw, 6) : raw;
      const requestedSurface = String(rd.surface || 'road-pack').toLowerCase();
      const surface = requestedSurface === 'asphalt' && roadPack ? 'road-pack'
        : !rd.surface && roadPack ? 'road-pack' : requestedSurface;
      const flyover = !!(rd.flyover || rd.bridge) || surface === 'modular-bridge' || surface === 'imported-street-road';
      const streetBase = flyover || rd.streetBase === false ? null
        : rd.streetBase && typeof rd.streetBase === 'object' ? { ...rd.streetBase } : {};
      chains.push({
        pts: smoothed, W, sidewalk: !!rd.sidewalk, closed,
        name: rd.name || 'unnamed-road',
        surface,
        guardrails: !!(rd.guardrails || rd.bridge || rd.flyover),
        flyover,
        keepEnds: !!rd.keepEnds,
        streetBase,
        stopLine: rd.stopLine === true,
        stopLine: rd.stopLine === true,
      });
    }
    for (const ch of chains) {
      ch.cutStart = 0; ch.cutEnd = 0;
      if (ch.closed || ch.keepEnds || ch.pts.length < 2) continue;
      const n = ch.pts.length;
      const sDir = { x: ch.pts[1].x - ch.pts[0].x, z: ch.pts[1].z - ch.pts[0].z };
      const eDir = { x: ch.pts[n - 1].x - ch.pts[n - 2].x, z: ch.pts[n - 1].z - ch.pts[n - 2].z };
      for (const other of chains) {
        if (other === ch) continue;
        const sNear = this._nearAnyEnd(ch.pts[0], other);
        const eNear = this._nearAnyEnd(ch.pts[n - 1], other);
        for (let i = 0; i < other.pts.length - 1; i++) {
          const a = other.pts[i], b = other.pts[i + 1];
          if (!sNear) ch.cutStart = Math.max(ch.cutStart, this._tCut(ch.pts[0], sDir, a, b, other.W, ch.W));
          if (!eNear) ch.cutEnd = Math.max(ch.cutEnd, this._tCut(ch.pts[n - 1], eDir, a, b, other.W, ch.W));
        }
      }
    }
    const renderChains = [];
    for (const chain of chains) {
      const pts = (chain.closed || chain.keepEnds)
        ? chain.pts
        : this._trimChain(chain.pts, chain.cutStart, chain.cutEnd);
      if (pts.length < 2) {
        if (chain.surface === 'road-pack') this.roadPackRoadSkippedNames.push(chain.name);
        continue;
      }
      renderChains.push({ ...chain, pts, roadY: 0.06 });
    }
    this._roadChains = renderChains;
    const junctionData = this._roadJunctionData(renderChains);
    this._buildStreetBases(renderChains, junctionData);

    for (let ci = 0; ci < renderChains.length; ci++) {
      const chain = renderChains[ci];
      const pts = chain.pts;
      const roadY = chain.roadY;
      const renderedByImportedSurface = chain.surface === 'modular-bridge'
        || chain.surface === 'imported-street-road'
        || chain.surface === 'road-pack';

      if (chain.surface === 'road-pack' && roadPack) {
        const tileCount = this._buildRoadPackSurface(
          pts, chain.W, roadY, ci, chain.name, junctionData.ranges[ci],
        );
        if (!tileCount) this.roadPackRoadSkippedNames.push(chain.name);
      } else if (!renderedByImportedSurface) {
        this.legacyRoadSurfaceCount++;
        this._strokeMitered(pts, chain.W, roadY, roadMat || this.mRoad(), chain.closed);
      }

      // These thin segments are height-sampling metadata; imported road/bridge
      // triangles provide the actual Rapier surface geometry.
      this._addRoadSurfaceColliders(pts, chain.W, roadY, chain.closed, 0.05);
      const usesImportedBridgeAssembly = chain.surface === 'modular-bridge';
      if (chain.flyover && !usesImportedBridgeAssembly) {
        this._buildFlyoverStructure(pts, chain.W, roadY, 0.48, 18, chain.name, 1.2);
      }
      if (chain.guardrails && !usesImportedBridgeAssembly) {
        this._buildRoadGuardrails(pts, chain.W, roadY, 0.78, 0.22, chain.name);
      }
    }
    this._buildRoadPackJunctionPatches(renderChains, junctionData);
    this._flushRoadPackSurfaces();
    // Sidewalks and their physical surfaces stop before same-level road
    // junctions. Higher flyovers remain independent and keep their own paths.
    this._buildRoadSidewalks(this._roadChains, walkMat, curbMat);
    // Paint is independent geometry so road markings can stop before junctions.
    this._buildRoadMarkings(this._roadChains);

    // Legacy combat maps receive ambient spawn points. Compact exploration maps
    // can opt out so empty authored spawn arrays stay genuinely empty.
    if (!this.sceneData?.disableAutoSpawns) {
    for (const ch of this._roadChains) {
      const pts = ch.pts;
      let acc = 0;
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        const len = Math.hypot(b.x - a.x, b.z - a.z);
        const dirX = (b.x - a.x) / len, dirZ = (b.z - a.z) / len;
        let left = len;
        while (left > 0) {
          const take = Math.min(left, 55);
          acc += take;
          left -= take;
          if (acc >= 55) {
            acc = 0;
            const sx = a.x + (len - left) * dirX, sz = a.z + (len - left) * dirZ;
            if (Math.hypot(sx, sz) < this.bounds - 30) this.spawnPoints.push(new THREE.Vector3(sx, 0, sz));
          }
        }
      }
    }
    }
  }

  _roadPolylineLengths(pts) {
    const cumulative = [0];
    for (let i = 1; i < pts.length; i++) {
      cumulative.push(cumulative[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
    }
    return cumulative;
  }

  _sliceRoadPolyline(pts, cumulative, start, end) {
    if (pts.length < 2 || end <= start) return [];
    const total = cumulative[cumulative.length - 1];
    start = THREE.MathUtils.clamp(start, 0, total);
    end = THREE.MathUtils.clamp(end, 0, total);
    if (end - start < 0.05) return [];
    const at = (distance) => {
      let i = 0;
      while (i < cumulative.length - 2 && cumulative[i + 1] < distance) i++;
      const segLen = cumulative[i + 1] - cumulative[i];
      const t = segLen > 1e-6 ? THREE.MathUtils.clamp((distance - cumulative[i]) / segLen, 0, 1) : 0;
      return {
        x: THREE.MathUtils.lerp(pts[i].x, pts[i + 1].x, t),
        y: THREE.MathUtils.lerp(Number(pts[i].y) || 0, Number(pts[i + 1].y) || 0, t),
        z: THREE.MathUtils.lerp(pts[i].z, pts[i + 1].z, t),
      };
    };
    const out = [at(start)];
    for (let i = 1; i < pts.length - 1; i++) {
      if (cumulative[i] > start + 0.01 && cumulative[i] < end - 0.01) out.push(pts[i]);
    }
    out.push(at(end));
    return out;
  }

  _sliceOffsetRoadPolyline(centerPts, offsetPts, cumulative, start, end) {
    if (centerPts.length < 2 || offsetPts.length !== centerPts.length || end <= start) return [];
    const total = cumulative[cumulative.length - 1];
    start = THREE.MathUtils.clamp(start, 0, total);
    end = THREE.MathUtils.clamp(end, 0, total);
    if (end - start < 0.05) return [];
    const at = distance => {
      let i = 0;
      while (i < cumulative.length - 2 && cumulative[i + 1] < distance) i++;
      const segment = Math.max(1e-6, cumulative[i + 1] - cumulative[i]);
      const t = THREE.MathUtils.clamp((distance - cumulative[i]) / segment, 0, 1);
      return {
        x: THREE.MathUtils.lerp(offsetPts[i].x, offsetPts[i + 1].x, t),
        y: THREE.MathUtils.lerp(Number(offsetPts[i].y) || 0, Number(offsetPts[i + 1].y) || 0, t),
        z: THREE.MathUtils.lerp(offsetPts[i].z, offsetPts[i + 1].z, t),
      };
    };
    const out = [at(start)];
    for (let i = 1; i < centerPts.length - 1; i++) {
      if (cumulative[i] > start + 0.01 && cumulative[i] < end - 0.01) out.push(offsetPts[i]);
    }
    out.push(at(end));
    return out;
  }

  _offsetRoadPolyline(pts, offset) {
    const n = pts.length;
    if (n < 2 || Math.abs(offset) < 1e-6) return pts.map(p => ({ x: p.x, z: p.z, y: p.y || 0 }));
    return pts.map((p, i) => {
      const prev = pts[Math.max(0, i - 1)];
      const next = pts[Math.min(n - 1, i + 1)];
      const ax = p.x - prev.x, az = p.z - prev.z;
      const bx = next.x - p.x, bz = next.z - p.z;
      const al = Math.hypot(ax, az), bl = Math.hypot(bx, bz);
      let nx = 0, nz = 0;
      if (i === 0 && bl > 1e-6) {
        nx = -bz / bl; nz = bx / bl;
      } else if (i === n - 1 && al > 1e-6) {
        nx = -az / al; nz = ax / al;
      } else if (al > 1e-6 && bl > 1e-6) {
        const anx = -az / al, anz = ax / al;
        const bnx = -bz / bl, bnz = bx / bl;
        const dot = anx * bnx + anz * bnz;
        const denom = Math.max(0.35, 1 + dot);
        nx = (anx + bnx) / denom;
        nz = (anz + bnz) / denom;
        const miterLen = Math.hypot(nx, nz);
        if (miterLen > 2.2) { nx *= 2.2 / miterLen; nz *= 2.2 / miterLen; }
      }
      return { x: p.x + nx * offset, z: p.z + nz * offset, y: p.y || 0 };
    });
  }

  _findRoadJunctions(chains, metadata) {
    const hits = chains.map(() => []);
    const addHit = (ia, da, ib, db, x, z) => {
      const radius = Math.max(chains[ia].W, chains[ib].W) * 0.5 + 1.4;
      hits[ia].push({ distance: da, radius, x, z });
      hits[ib].push({ distance: db, radius, x, z });
    };
    const cross = (ax, az, bx, bz) => ax * bz - az * bx;

    for (let ia = 0; ia < chains.length; ia++) {
      const a = chains[ia], ma = metadata[ia];
      if (a.pts.length < 2) continue;
      for (let ib = ia + 1; ib < chains.length; ib++) {
        const b = chains[ib], mb = metadata[ib];
        if (b.pts.length < 2) continue;

        // Find proper intersections between centre-line segments, including T-junctions.
        for (let ai = 0; ai < a.pts.length - 1; ai++) {
          const p = a.pts[ai], p2 = a.pts[ai + 1];
          const rx = p2.x - p.x, rz = p2.z - p.z;
          const rLen = ma.segmentLengths[ai];
          if (rLen < 1e-5) continue;
          for (let bi = 0; bi < b.pts.length - 1; bi++) {
            const q = b.pts[bi], q2 = b.pts[bi + 1];
            const sx = q2.x - q.x, sz = q2.z - q.z;
            const sLen = mb.segmentLengths[bi];
            if (sLen < 1e-5) continue;
            const denom = cross(rx, rz, sx, sz);
            if (Math.abs(denom) < 1e-5) continue;
            const qpx = q.x - p.x, qpz = q.z - p.z;
            const ta = cross(qpx, qpz, sx, sz) / denom;
            const tb = cross(qpx, qpz, rx, rz) / denom;
            if (ta < -0.001 || ta > 1.001 || tb < -0.001 || tb > 1.001) continue;
            const tA = THREE.MathUtils.clamp(ta, 0, 1);
            const tB = THREE.MathUtils.clamp(tb, 0, 1);
            const x = p.x + rx * tA, z = p.z + rz * tA;
            const yA = THREE.MathUtils.lerp(p.y || 0, p2.y || 0, tA);
            const yB = THREE.MathUtils.lerp(q.y || 0, q2.y || 0, tB);
            if (Math.abs(yA - yB) > 1.25) continue;
            addHit(ia, ma.cumulative[ai] + rLen * tA, ib, mb.cumulative[bi] + sLen * tB, x, z);
          }
        }

        // Map data often has endpoints a metre or so away from the cross street.
        // Snap those near misses into a junction zone too.
        for (const endpoint of [
          { p: a.pts[0], dist: 0 },
          { p: a.pts[a.pts.length - 1], dist: ma.total },
        ]) {
          let best = null;
          for (let bi = 0; bi < b.pts.length - 1; bi++) {
            const q = b.pts[bi], q2 = b.pts[bi + 1];
            const vx = q2.x - q.x, vz = q2.z - q.z;
            const ll = vx * vx + vz * vz;
            if (ll < 1e-6) continue;
            const t = THREE.MathUtils.clamp(((endpoint.p.x - q.x) * vx + (endpoint.p.z - q.z) * vz) / ll, 0, 1);
            const x = q.x + vx * t, z = q.z + vz * t;
            const distance = Math.hypot(endpoint.p.x - x, endpoint.p.z - z);
            if (!best || distance < best.distance) best = { x, z, distance, segment: bi, t, length: Math.sqrt(ll) };
          }
          const tolerance = Math.max(0.85, Math.min(2.1, (a.W + b.W) * 0.055));
          if (best && best.distance <= tolerance) {
            const db = mb.cumulative[best.segment] + best.length * best.t;
            addHit(ia, endpoint.dist, ib, db, (endpoint.p.x + best.x) / 2, (endpoint.p.z + best.z) / 2);
          }
        }
      }
    }
    return hits;
  }

  _roadJunctionData(chains) {
    const metadata = chains.map(ch => {
      const cumulative = this._roadPolylineLengths(ch.pts);
      const segmentLengths = cumulative.slice(1).map((d, i) => d - cumulative[i]);
      return { cumulative, segmentLengths, total: cumulative[cumulative.length - 1] || 0 };
    });
    const hits = this._findRoadJunctions(chains, metadata);
    const ranges = hits.map((items, i) => {
      const total = metadata[i].total;
      const intervals = items.map(hit => [
        Math.max(0, hit.distance - hit.radius),
        Math.min(total, hit.distance + hit.radius),
      ]).filter(range => range[1] - range[0] > 0.05).sort((a, b) => a[0] - b[0]);
      const merged = [];
      for (const range of intervals) {
        const last = merged[merged.length - 1];
        if (last && range[0] <= last[1] + 0.2) last[1] = Math.max(last[1], range[1]);
        else merged.push(range.slice());
      }
      return merged;
    });
    return { metadata, hits, ranges };
  }

  async _loadRoadPackPrefabs() {
    if (this._roadPackPrefabs) return this._roadPackPrefabs;
    if (this._roadPackPromise) return this._roadPackPromise;

    this._roadPackPromise = (async () => {
      const loader = this._gltfLoader || (this._gltfLoader = new GLTFLoader());
      const gltf = await loader.loadAsync('./data/models/assets/roads/road_pack/scene.gltf');
      const prefabs = new Map();
      gltf.scene.updateMatrixWorld(true);
      gltf.scene.traverse(node => {
        if (!node.isMesh || !node.geometry) return;
        const definition = WORLD_KIT_ROAD_PACK_PARTS[node.name];
        if (!definition) return;

        // Extract the imported child with every source transform applied, then
        // rebase it around its own centre. The geometry/material stay imported.
        const geometry = node.geometry.clone().applyMatrix4(node.matrixWorld);
        geometry.computeBoundingBox();
        const bounds = geometry.boundingBox;
        if (!bounds || bounds.isEmpty()) {
          geometry.dispose();
          return;
        }
        const center = bounds.getCenter(new THREE.Vector3());
        const sourceSize = bounds.getSize(new THREE.Vector3());
        geometry.translate(-center.x, -bounds.min.y, -center.z);
        geometry.scale(WORLD_KIT_ROAD_PACK_SCALE, 1, WORLD_KIT_ROAD_PACK_SCALE);
        geometry.computeBoundingBox();
        geometry.computeBoundingSphere();

        const sourceMaterial = Array.isArray(node.material) ? node.material[0] : node.material;
        const material = sourceMaterial?.clone?.();
        if (!material) {
          geometry.dispose();
          return;
        }
        // Keep the imported road texture/normal maps, but remove the wet,
        // metallic-looking reflection from the wide boulevard surfaces.
        material.metalness = 0;
        material.roughness = 0.92;
        if ('specularIntensity' in material) material.specularIntensity = 0.12;
        if ('envMapIntensity' in material) material.envMapIntensity = 0.16;
        if (material.normalScale?.set) material.normalScale.set(0.55, 0.55);
        for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap']) {
          if (material[key]) material[key].anisotropy = this._maxAnisotropy;
        }
        material.needsUpdate = true;
        prefabs.set(definition.id, {
          id: definition.id,
          geometry,
          material,
          sourceName: node.name,
          sourceDimensions: [sourceSize.x, sourceSize.y, sourceSize.z],
          dimensions: [
            sourceSize.x * WORLD_KIT_ROAD_PACK_SCALE,
            sourceSize.y,
            sourceSize.z * WORLD_KIT_ROAD_PACK_SCALE,
          ],
        });
      });

      for (const definition of Object.values(WORLD_KIT_ROAD_PACK_PARTS)) {
        if (!prefabs.has(definition.id)) throw new Error('Road Pack is missing imported component ' + definition.id);
      }
      if (prefabs.size !== 6) throw new Error('Road Pack must expose all six imported surface prefabs');
      this._roadPackPrefabs = prefabs;
      console.info('[WorldKit] Imported road modules:', [...prefabs.keys()].join(', '));
      return prefabs;
    })().catch(error => {
      this._roadPackPromise = null;
      console.warn('[WorldKit] Road Pack unavailable; authored road ribbons remain active:', error);
      return null;
    });
    return this._roadPackPromise;
  }

  async _spawnRoadModules(placements = []) {
    if (!Array.isArray(placements) || !placements.length) return;
    const prefabs = await this._loadRoadPackPrefabs();
    if (!prefabs?.size) return;

    for (const placement of placements) {
      const id = placement.componentId || placement.id;
      const prefab = prefabs.get(id);
      if (!prefab) {
        console.warn('[WorldKit] Unknown road module:', id);
        continue;
      }
      const mesh = new THREE.Mesh(prefab.geometry, prefab.material);
      mesh.name = 'worldkit_road_module_' + id;
      mesh.position.set(
        Number(placement.x) || 0,
        Number.isFinite(placement.y) ? placement.y : 0.068,
        Number(placement.z) || 0,
      );
      mesh.rotation.y = Number(placement.yaw) || 0;
      const scale = Number(placement.scale);
      if (Number.isFinite(scale) && scale > 0) mesh.scale.setScalar(scale);
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      mesh.renderOrder = 1;
      mesh.userData.worldKit = {
        id,
        category: 'road',
        role: WORLD_KIT_ROAD_PACK_PARTS[prefab.sourceName]?.role || 'road-module',
        source: './data/models/assets/roads/road_pack/scene.gltf',
        collision: 'authored-road-ribbon',
      };
      this.group.add(mesh);
      this.roadModuleInstances.push({
        id,
        mesh,
        dimensions: prefab.dimensions.map(value => value * (Number.isFinite(scale) && scale > 0 ? scale : 1)),
      });
    }
  }

  _buildWaterways(channels = []) {
    for (const channel of channels) {
      const start = channel.start || [];
      const end = channel.end || [];
      const dx = Number(end[0]) - Number(start[0]);
      const dz = Number(end[1]) - Number(start[1]);
      const length = Math.hypot(dx, dz);
      const width = Number(channel.width) || 6;
      if (length < 2 || width < 1) continue;

      const ux = dx / length, uz = dz / length;
      const nx = -uz, nz = ux;
      const halfWidth = width * 0.5;
      const waterY = Number.isFinite(channel.waterY) ? channel.waterY : -0.55;
      const point = (x, z, side) => ({
        x: x + nx * side,
        y: waterY,
        z: z + nz * side,
      });
      const a = { x: Number(start[0]), z: Number(start[1]) };
      const b = { x: Number(end[0]), z: Number(end[1]) };
      const al = point(a.x, a.z, halfWidth);
      const bl = point(b.x, b.z, halfWidth);
      const ar = point(a.x, a.z, -halfWidth);
      const br = point(b.x, b.z, -halfWidth);

      const positions = [
        al.x, al.y, al.z,
        bl.x, bl.y, bl.z,
        ar.x, ar.y, ar.z,
        br.x, br.y, br.z,
      ];
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geometry.setIndex([0, 1, 2, 2, 1, 3]);
      geometry.computeVertexNormals();

      const waterMaterial = new THREE.MeshPhysicalMaterial({
        color: new THREE.Color(channel.color || 0x456c73),
        roughness: 0.28,
        metalness: 0.04,
        clearcoat: 0.35,
        transparent: true,
        opacity: 0.92,
        side: THREE.DoubleSide,
      });
      const water = new THREE.Mesh(geometry, waterMaterial);
      water.name = 'world_waterway_' + String(channel.name || 'channel').toLowerCase().replace(/[^a-z0-9]+/g, '_');
      water.receiveShadow = false;
      water.castShadow = false;
      water.frustumCulled = false;
      this.group.add(water);

      const bankBottom = Number.isFinite(channel.bankBottom) ? channel.bankBottom : -1.05;
      const bedMaterial = new THREE.MeshStandardMaterial({
        color: new THREE.Color(channel.bedColor || 0x514a3d),
        roughness: 0.98,
        metalness: 0,
      });
      const bedGeometry = new THREE.BufferGeometry();
      bedGeometry.setAttribute('position', new THREE.Float32BufferAttribute([
        al.x, bankBottom, al.z,
        bl.x, bankBottom, bl.z,
        ar.x, bankBottom, ar.z,
        br.x, bankBottom, br.z,
      ], 3));
      bedGeometry.setIndex([0, 1, 2, 2, 1, 3]);
      bedGeometry.computeVertexNormals();
      const bed = new THREE.Mesh(bedGeometry, bedMaterial);
      bed.name = 'world_waterway_bed_' + String(channel.name || 'channel').toLowerCase().replace(/[^a-z0-9]+/g, '_');
      bed.receiveShadow = true;
      bed.castShadow = false;
      this.group.add(bed);

      const bankWidth = Number(channel.bankWidth) || 0.7;
      const bankHeight = Number(channel.bankHeight) || 1.25;
      const bankMaterial = this.mConcrete([118, 122, 120]);
      const bankYaw = Math.atan2(dx, dz);
      for (const side of [-1, 1]) {
        const cx = (a.x + b.x) * 0.5 + nx * side * (halfWidth + bankWidth * 0.5);
        const cz = (a.z + b.z) * 0.5 + nz * side * (halfWidth + bankWidth * 0.5);
        this.box(cx, bankBottom, cz, bankWidth, bankHeight, length, bankMaterial, true, bankYaw);
      }
    }
  }

  async _loadBridgeKit() {
    if (this._bridgeKit) return this._bridgeKit;
    if (this._bridgeKitPromise) return this._bridgeKitPromise;

    this._bridgeKitPromise = (async () => {
      const loader = this._gltfLoader || (this._gltfLoader = new GLTFLoader());
      const gltf = await loader.loadAsync(WORLD_BRIDGE_KIT_URL);
      this._bridgeKit = extractWorldBridgeKit(gltf.scene);
      console.info('[WorldKit] Imported bridge components:', [...this._bridgeKit.keys()].join(', '));
      return this._bridgeKit;
    })().catch(error => {
      this._bridgeKitPromise = null;
      this._bridgeKitError = String(error?.stack || error);
      console.error('[WorldKit] Bridge component kit unavailable:', error);
      return null;
    });
    return this._bridgeKitPromise;
  }

  _bridgeGroundHeightAt(x, z) {
    const ground = this.sceneData?.ground || {};
    const baseY = Number.isFinite(ground.elevation) ? ground.elevation
      : Number.isFinite(ground.y) ? ground.y : 0;
    for (const channel of this.sceneData?.waterways || []) {
      const start = channel.start || [];
      const end = channel.end || [];
      const dx = Number(end[0]) - Number(start[0]);
      const dz = Number(end[1]) - Number(start[1]);
      const lengthSq = dx * dx + dz * dz;
      if (lengthSq < 1e-6) continue;
      const t = ((x - Number(start[0])) * dx + (z - Number(start[1])) * dz) / lengthSq;
      if (t < 0 || t > 1) continue;
      const nearestX = Number(start[0]) + dx * t;
      const nearestZ = Number(start[1]) + dz * t;
      const lateral = Math.hypot(x - nearestX, z - nearestZ);
      const halfOpening = (Number(channel.width) || 6) * 0.5 + (Number(channel.bankWidth) || 0.7);
      if (lateral <= halfOpening + 0.08) {
        return Number.isFinite(channel.bankBottom) ? channel.bankBottom : -1.05;
      }
    }
    return baseY;
  }

  async _spawnBridgeAssemblies(assemblies = []) {
    if (!Array.isArray(assemblies) || !assemblies.length) return;
    const kit = await this._loadBridgeKit();
    if (!kit?.size) return;

    for (const assemblyData of assemblies) {
      const id = assemblyData.id || 'bridge-assembly-' + this.bridgeSectionInstances.length;
      const assembly = new THREE.Group();
      assembly.name = 'worldkit_bridge_' + id;
      assembly.position.set(
        Number(assemblyData.x) || 0,
        Number(assemblyData.y) || 0,
        Number(assemblyData.z) || 0,
      );
      assembly.rotation.y = Number(assemblyData.yaw) || 0;
      this.group.add(assembly);

      const placements = Array.isArray(assemblyData.components) ? assemblyData.components : [];
      const placedComponents = [];
      const sectionGroups = new Map();

      for (const placement of placements) {
        const componentId = placement.componentId || placement.id;
        const prefab = kit.get(componentId);
        if (!prefab) {
          console.warn('[WorldKit] Unknown independent bridge component:', componentId);
          continue;
        }

        const foundationY = Number.isFinite(placement.foundationY)
          ? placement.foundationY
          : Number.isFinite(assemblyData.foundationY) ? assemblyData.foundationY : 0;
        const deckY = Number.isFinite(placement.deckY)
          ? placement.deckY
          : Number.isFinite(assemblyData.deckY) ? assemblyData.deckY : null;
        const rise = deckY == null ? null : deckY - foundationY;
        if (prefab.role === 'bridge-structure' && !(rise > 0.1)) {
          console.warn('[WorldKit] Skipping bridge support without a positive metric deck rise:', componentId);
          continue;
        }

        const uniformScale = Number.isFinite(placement.scale) && placement.scale > 0 ? placement.scale : 1;
        const sx = Number.isFinite(placement.scaleX) && placement.scaleX > 0 ? placement.scaleX : uniformScale;
        const sz = Number.isFinite(placement.scaleZ) && placement.scaleZ > 0 ? placement.scaleZ : uniformScale;
        const sy = prefab.role === 'bridge-structure'
          ? rise / prefab.sourceDeckHeight
          : (Number.isFinite(placement.scaleY) && placement.scaleY > 0 ? placement.scaleY : 1);

        // Structure and asphalt are separate reusable meshes with independent
        // vertical placement:
        // - the concrete support starts at foundationY and stretches upward;
        // - the road piece keeps its authored slope/thickness and its highest
        //   driving surface lands exactly on deckY.
        const positionY = prefab.role === 'bridge-structure'
          ? foundationY - assembly.position.y
          : (deckY == null
            ? (Number(placement.y) || 0)
            : deckY - prefab.sourceDeckHeight - assembly.position.y);

        const component = prefab.mesh.clone();
        component.name = 'worldkit_bridge_component_' + componentId;
        component.position.set(
          Number(placement.x) || 0,
          positionY,
          Number(placement.z) || 0,
        );
        component.rotation.y = Number(placement.yaw) || 0;
        component.scale.set(sx, sy, sz);
        component.castShadow = prefab.role === 'bridge-structure';
        component.receiveShadow = true;
        component.userData.worldKit = {
          assetId: 'modular-bridge',
          componentId,
          sectionId: placement.sectionId || prefab.sectionId,
          role: prefab.role,
          kind: prefab.kind,
          assemblyId: id,
          sourceNode: prefab.sourceNode,
          sourceSectionNode: prefab.sourceSectionNode,
          foundationY,
          deckY,
          sourceDeckHeight: prefab.sourceDeckHeight,
          supportFootContacts: prefab.supportFootContacts || [],
          longitudinalAxis: prefab.longitudinalAxis,
        };
        assembly.add(component);

        const record = {
          assemblyId: id,
          componentId,
          sectionId: placement.sectionId || prefab.sectionId,
          role: prefab.role,
          kind: prefab.kind,
          sourceNode: prefab.sourceNode,
          sourceSectionNode: prefab.sourceSectionNode,
          foundationY,
          deckY,
          sourceDeckHeight: prefab.sourceDeckHeight,
          longitudinalAxis: prefab.longitudinalAxis,
          supportFootContacts: prefab.supportFootContacts || [],
          scale: { x: sx, y: sy, z: sz },
          mesh: component,
        };
        placedComponents.push(record);
        this.bridgeComponentInstances.push(record);
        this.worldKitComponents.push({
          root: component,
          id: componentId,
          category: 'infrastructure',
          role: prefab.role,
          meshCount: 1,
          assemblyId: id,
          position: { x: component.position.x, y: component.position.y, z: component.position.z },
        });

        const sectionId = record.sectionId;
        if (!sectionGroups.has(sectionId)) {
          sectionGroups.set(sectionId, {
            assemblyId: id,
            sectionId,
            foundationY,
            deckY,
            structure: null,
            deck: null,
          });
        }
        const group = sectionGroups.get(sectionId);
        if (group.foundationY !== foundationY || group.deckY !== deckY) {
          throw new Error('Bridge section components disagree on metric height: ' + sectionId);
        }
        if (prefab.role === 'bridge-structure') group.structure = record;
        else if (prefab.role === 'bridge-deck') group.deck = record;
      }

      assembly.updateMatrixWorld(true);

      // Replace the imported ramp's abrupt flat-to-11-degree hinge with a
      // vertical curve. The curve spans the ramp plus half of the adjacent
      // straight module (2 * ramp length total), so both grade and height are
      // continuous at the straight/ramp seam and at the approach-road joint.
      const orderedSections = [...sectionGroups.values()];
      const rampSections = orderedSections.filter(section =>
        section.deck?.kind === 'sloped-end-abutment'
      );
      const straightSections = orderedSections.filter(section =>
        section.deck?.kind === 'straight-span'
      );
      if (rampSections.length === 2 && straightSections.length >= 2) {
        const firstStraightCenter = straightSections[0].deck.mesh.getWorldPosition(new THREE.Vector3());
        const nextStraightCenter = straightSections[1].deck.mesh.getWorldPosition(new THREE.Vector3());
        const routeDirection = new THREE.Vector3(
          nextStraightCenter.x - firstStraightCenter.x,
          0,
          nextStraightCenter.z - firstStraightCenter.z,
        ).normalize();
        const firstRamp = rampSections[0].deck;
        const lastRamp = rampSections[1].deck;
        const firstRampCenter = firstRamp.mesh.getWorldPosition(new THREE.Vector3());
        const lastRampCenter = lastRamp.mesh.getWorldPosition(new THREE.Vector3());
        const rampBounds = firstRamp.mesh.geometry.boundingBox
          || (firstRamp.mesh.geometry.computeBoundingBox(), firstRamp.mesh.geometry.boundingBox);
        const rampLength = rampBounds
          ? rampBounds.getSize(new THREE.Vector3()).x * Math.abs(firstRamp.mesh.scale.x)
          : 8.889 * Math.abs(firstRamp.mesh.scale.x);
        const rampGeometryBounds = firstRamp.mesh.geometry.boundingBox
          || (firstRamp.mesh.geometry.computeBoundingBox(), firstRamp.mesh.geometry.boundingBox);
        const rampDrop = rampGeometryBounds
          ? Math.abs(rampGeometryBounds.max.y - rampGeometryBounds.min.y)
            * Math.abs(firstRamp.mesh.scale.y)
          : 1.744578;
        const rampGrade = rampDrop / Math.max(0.01, rampLength);
        if (!Number.isFinite(rampDrop) || rampDrop < 0.5
          || !Number.isFinite(rampLength) || rampLength < 4) {
          throw new Error('Imported bridge end ramp has invalid metric dimensions: ' + id);
        }
        // Spread each ramp's rise/drop over the full ramp plus a full adjacent
        // straight span. A 3R cubic transition keeps the grade gentler for a
        // low sports-car chassis and gives the suspension time to follow it.
        const transitionLength = rampLength * 3;
        const entryLow = firstRampCenter.clone().addScaledVector(routeDirection, -rampLength * 0.5);
        const exitLow = lastRampCenter.clone().addScaledVector(routeDirection, rampLength * 0.5);
        const bridgeLength = exitLow.clone().sub(entryLow).dot(routeDirection);
        const lowY = firstRamp.deckY - rampDrop;
        const deckY = firstRamp.deckY;
        if (!Number.isFinite(bridgeLength) || bridgeLength <= transitionLength * 2) {
          throw new Error('Bridge is too short for two non-overlapping vertical transitions: ' + id);
        }
        if (![lowY, deckY, entryLow.x, entryLow.z, exitLow.x, exitLow.z].every(Number.isFinite)) {
          throw new Error('Bridge vertical transition has a non-finite datum: ' + id);
        }
        const smoothStep01 = value => {
          const t = THREE.MathUtils.clamp(value, 0, 1);
          return t * t * (3 - 2 * t);
        };
        const baseProfileY = progress => {
          if (progress < 0) return lowY;
          if (progress <= rampLength) return lowY + rampDrop * (progress / rampLength);
          if (progress < bridgeLength - rampLength) return deckY;
          if (progress <= bridgeLength) {
            const t = (progress - (bridgeLength - rampLength)) / rampLength;
            return deckY - rampDrop * t;
          }
          return lowY;
        };
        const targetProfileY = progress => {
          if (!Number.isFinite(progress) || progress < 0 || progress > bridgeLength) {
            return baseProfileY(progress);
          }
          if (progress <= transitionLength) {
            return lowY + rampDrop * smoothStep01(progress / transitionLength);
          }
          if (progress >= bridgeLength - transitionLength) {
            const t = (progress - (bridgeLength - transitionLength)) / transitionLength;
            return deckY - rampDrop * smoothStep01(t);
          }
          return deckY;
        };
        const verticalCurveCorrection = progress => {
          if (!Number.isFinite(progress) || progress < 0 || progress > bridgeLength) return 0;
          const correction = targetProfileY(progress) - baseProfileY(progress);
          if (!Number.isFinite(correction)) {
            throw new Error('Non-finite vertical curve correction on ' + id + ' at ' + progress);
          }
          return correction;
        };
        const bridgeRoad = (this._roadChains || []).find(chain =>
          chain.surface === 'modular-bridge'
          && ((id === 'main-city-flyover' && chain.name.includes('Main City Flyover'))
            || (id === 'fate-drainage-bridge' && chain.name.includes('Fate Drainage Bridge')))
        );
        // Road-chain points are stored 6cm below the actual rendered deck;
        // vehicleSurfaceAt adds chain.roadY back during tyre queries.
        const roadSurfaceOffset = Number.isFinite(bridgeRoad?.roadY) ? bridgeRoad.roadY : 0.06;

        let deformedComponentCount = 0;
        for (const record of placedComponents) {
          const mesh = record.mesh;
          const geometry = mesh.geometry;
          if (!geometry?.attributes?.position) continue;
          mesh.updateWorldMatrix(true, false);
          const matrixWorld = mesh.matrixWorld.clone();
          const inverseWorld = matrixWorld.clone().invert();
          const positions = geometry.attributes.position;
          let changed = false;
          const foundation = Number.isFinite(record.foundationY) ? record.foundationY : 0;
          const deck = Number.isFinite(record.deckY) ? record.deckY : foundation + 2.068;
          const verticalRise = Math.max(0.1, deck - foundation);

          // Never mutate the shared extracted prefab geometry. Each placed
          // transition section receives its own deformed geometry instance.
          let deformedGeometry = null;
          for (let vertex = 0; vertex < positions.count; vertex++) {
            const sourceVertex = new THREE.Vector3(
              positions.getX(vertex), positions.getY(vertex), positions.getZ(vertex),
            );
            if (![sourceVertex.x, sourceVertex.y, sourceVertex.z].every(Number.isFinite)) {
              throw new Error('Bridge component contains a non-finite source vertex: ' + record.componentId);
            }
            const worldVertex = sourceVertex.applyMatrix4(matrixWorld);
            const progress = new THREE.Vector3(
              worldVertex.x - entryLow.x,
              0,
              worldVertex.z - entryLow.z,
            ).dot(routeDirection);
            const correction = verticalCurveCorrection(progress);
            if (!Number.isFinite(worldVertex.y) || !Number.isFinite(correction)) {
              throw new Error('Bridge vertical curve produced a non-finite vertex: '
                + record.componentId + ' vertex ' + vertex);
            }
            if (Math.abs(correction) < 1e-5) continue;

            const weight = record.role === 'bridge-deck'
              ? 1
              : (() => {
                const heightRatio = THREE.MathUtils.clamp(
                  (worldVertex.y - foundation) / verticalRise, 0, 1,
                );
                return heightRatio * heightRatio * (3 - 2 * heightRatio);
              })();
            if (weight < 1e-4) continue;
            if (!deformedGeometry) deformedGeometry = geometry.clone();
            worldVertex.y += correction * weight;
            worldVertex.applyMatrix4(inverseWorld);
            if (![worldVertex.x, worldVertex.y, worldVertex.z].every(Number.isFinite)) {
              throw new Error('Bridge deformation wrote a non-finite local vertex: '
                + record.componentId + ' vertex ' + vertex);
            }
            deformedGeometry.attributes.position.setXYZ(
              vertex, worldVertex.x, worldVertex.y, worldVertex.z,
            );
            changed = true;
          }

          if (changed && deformedGeometry) {
            deformedGeometry.attributes.position.needsUpdate = true;
            deformedGeometry.computeVertexNormals();
            deformedGeometry.computeBoundingBox();
            deformedGeometry.computeBoundingSphere();
            mesh.geometry = deformedGeometry;
            deformedComponentCount++;
          }
        }

        // Keep gameplay height sampling on the same vertical curve as the
        // rendered/collidable meshes. Subdivide the bridge route to 2m samples
        // so suspension helpers don't interpolate across a long curved segment.
        let routeSampleCount = 0;
        if (bridgeRoad?.pts?.length >= 2) {
          const dense = [];
          for (let segment = 0; segment < bridgeRoad.pts.length - 1; segment++) {
            const a = bridgeRoad.pts[segment];
            const b = bridgeRoad.pts[segment + 1];
            const length = Math.hypot(b.x - a.x, b.z - a.z);
            const steps = Math.max(1, Math.ceil(length / 2));
            for (let step = 0; step < steps; step++) {
              const t = step / steps;
              const point = {
                x: THREE.MathUtils.lerp(a.x, b.x, t),
                y: THREE.MathUtils.lerp(a.y || 0, b.y || 0, t),
                z: THREE.MathUtils.lerp(a.z, b.z, t),
              };
              const progress = new THREE.Vector3(
                point.x - entryLow.x, 0, point.z - entryLow.z,
              ).dot(routeDirection);
              point.y = targetProfileY(progress) - roadSurfaceOffset;
              dense.push(point);
            }
          }
          const finalPoint = { ...bridgeRoad.pts[bridgeRoad.pts.length - 1] };
          const finalProgress = new THREE.Vector3(
            finalPoint.x - entryLow.x, 0, finalPoint.z - entryLow.z,
          ).dot(routeDirection);
          finalPoint.y = targetProfileY(finalProgress) - roadSurfaceOffset;
          dense.push(finalPoint);
          bridgeRoad.pts = dense;
          routeSampleCount = dense.length;
        }

        firstRamp.expectedDeckMaxY = targetProfileY(rampLength);
        lastRamp.expectedDeckMaxY = targetProfileY(bridgeLength - rampLength);
        this.bridgeVerticalTransitions ||= [];
        this.bridgeVerticalTransitions.push({
          assemblyId: id,
          rampLength,
          rampDrop,
          originalGradeDegrees: THREE.MathUtils.radToDeg(Math.atan(rampGrade)),
          smoothedMaxGradeDegrees: THREE.MathUtils.radToDeg(
            Math.atan((1.5 * rampDrop) / transitionLength),
          ),
          transitionLength,
          deformedComponentCount,
          routeSampleCount,
          entryLow: entryLow.toArray(),
          exitLow: exitLow.toArray(),
        });
      }

      assembly.updateMatrixWorld(true);

      for (const record of placedComponents) {
        const bounds = new THREE.Box3().setFromObject(record.mesh);
        record.bounds = {
          min: bounds.min.toArray(),
          max: bounds.max.toArray(),
        };
        record.minY = bounds.min.y;
        record.maxY = bounds.max.y;
      }

      for (const section of sectionGroups.values()) {
        const structure = section.structure;
        const deck = section.deck;
        if (!structure || !deck) {
          throw new Error('Bridge section must place its structure and deck as independent meshes: ' + section.sectionId);
        }
        const supportFootContacts = (structure.supportFootContacts || [])
          .map(point => structure.mesh.localToWorld(new THREE.Vector3(point.x, point.y, point.z)))
          .map(point => ({
            x: point.x,
            y: point.y,
            z: point.z,
            groundY: this._bridgeGroundHeightAt(point.x, point.z),
            error: point.y - this._bridgeGroundHeightAt(point.x, point.z),
          }));
        const supportFootFailures = supportFootContacts.filter(contact => Math.abs(contact.error) > 0.04);
        const structureCenterX = (structure.bounds.min[0] + structure.bounds.max[0]) * 0.5;
        const structureCenterZ = (structure.bounds.min[2] + structure.bounds.max[2]) * 0.5;
        const expectedGroundY = this._bridgeGroundHeightAt(structureCenterX, structureCenterZ);
        const groundContactError = structure.minY - expectedGroundY;
        const expectedDeckMaxY = Number.isFinite(deck.expectedDeckMaxY)
          ? deck.expectedDeckMaxY : section.deckY;
        const deckAlignmentError = deck.maxY - expectedDeckMaxY;
        this.bridgeSectionInstances.push({
          assemblyId: id,
          sectionId: section.sectionId,
          foundationY: section.foundationY,
          expectedGroundY,
          deckY: section.deckY,
          structureComponentId: structure.componentId,
          deckComponentId: deck.componentId,
          structureKind: structure.kind,
          structureMinY: structure.minY,
          structureMaxY: structure.maxY,
          deckMinY: deck.minY,
          deckMaxY: deck.maxY,
          expectedDeckMaxY,
          supportFootContactCount: supportFootContacts.length,
          supportFootContacts,
          supportFootFailures,
          groundContactError,
          deckAlignmentError,
          structureBounds: structure.bounds,
          deckBounds: deck.bounds,
        });
      }

      if (assemblyData.registerRoadPhysics !== false) {
        for (const record of placedComponents) {
          const geometry = record.mesh.geometry.clone();
          geometry.applyMatrix4(record.mesh.matrixWorld);
          geometry.computeBoundingBox();
          geometry.computeBoundingSphere();
          this.roadPhysicsMeshes.push({
            kind: record.role === 'bridge-deck' ? 'bridge_deck' : 'bridge_support',
            source: 'imported-bridge-component',
            componentId: record.componentId,
            sectionId: record.sectionId,
            geometry,
          });
        }
      }
    }
  }

  async _loadSidewalkKit() {
    if (this._sidewalkKit) return this._sidewalkKit;
    if (this._sidewalkKitPromise) return this._sidewalkKitPromise;

    this._sidewalkKitPromise = (async () => {
      const loader = this._gltfLoader || (this._gltfLoader = new GLTFLoader());
      const gltf = await loader.loadAsync('./data/models/assets/roads/sidewalks/scene.gltf');
      const kit = new Map();
      gltf.scene.updateMatrixWorld(true);

      gltf.scene.traverse(node => {
        if (!node.isMesh || !node.geometry) return;
        const definition = WORLD_KIT_SIDEWALK_COMPONENTS[node.name];
        if (!definition || kit.has(definition.id)) return;

        // Extract each named source surface from the original display layout.
        // Curb meshes remain separate because the road edge is procedurally
        // joined around arbitrary curves and junctions.
        const geometry = node.geometry.clone().applyMatrix4(node.matrixWorld);
        geometry.computeBoundingBox();
        const bounds = geometry.boundingBox;
        if (!bounds || bounds.isEmpty()) {
          geometry.dispose();
          return;
        }
        const sourceSize = bounds.getSize(new THREE.Vector3());
        const center = bounds.getCenter(new THREE.Vector3());
        geometry.translate(-center.x, -bounds.min.y, -center.z);
        geometry.computeBoundingBox();
        geometry.computeBoundingSphere();

        const sourceMaterial = Array.isArray(node.material) ? node.material[0] : node.material;
        const material = sourceMaterial?.clone?.();
        if (!material) {
          geometry.dispose();
          return;
        }
        for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap']) {
          if (material[key]) material[key].anisotropy = this._maxAnisotropy;
        }
        material.needsUpdate = true;
        kit.set(definition.id, {
          ...definition,
          geometry,
          material,
          sourceName: node.name,
          dimensions: [sourceSize.x, sourceSize.y, sourceSize.z],
        });
      });

      for (const id of ['sidewalk-panel-01', 'sidewalk-panel-02', 'sidewalk-panel-03', 'sidewalk-panel-04', 'sidewalk-cracked']) {
        if (!kit.has(id)) throw new Error('Sidewalk pack is missing imported tile ' + id);
      }
      this._sidewalkKit = kit;
      console.info('[WorldKit] Imported sidewalk components:', [...kit.keys()].join(', '));
      return kit;
    })().catch(error => {
      this._sidewalkKitPromise = null;
      console.warn('[WorldKit] Sidewalk pack unavailable; using curved ribbon fallback:', error);
      return null;
    });
    return this._sidewalkKitPromise;
  }

  async _spawnSidewalkModules(placements = []) {
    if (!Array.isArray(placements) || !placements.length) return;
    const kit = await this._loadSidewalkKit();
    if (!kit?.size) return;

    for (const placement of placements) {
      const id = placement.componentId || placement.id;
      const prefab = kit.get(id);
      if (!prefab) {
        console.warn('[WorldKit] Unknown sidewalk component:', id);
        continue;
      }
      const mesh = new THREE.Mesh(prefab.geometry, prefab.material);
      mesh.name = 'worldkit_sidewalk_module_' + id;
      mesh.position.set(
        Number(placement.x) || 0,
        Number.isFinite(placement.y) ? placement.y : 0.12,
        Number(placement.z) || 0,
      );
      mesh.rotation.y = Number(placement.yaw) || 0;
      const scale = Number.isFinite(placement.scale) && placement.scale > 0 ? placement.scale : 1;
      const scaleX = Number.isFinite(placement.scaleX) && placement.scaleX > 0 ? placement.scaleX : scale;
      const scaleZ = Number.isFinite(placement.scaleZ) && placement.scaleZ > 0 ? placement.scaleZ : scale;
      mesh.scale.set(scaleX, 1, scaleZ);
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      mesh.renderOrder = 1;
      mesh.userData.worldKit = {
        id,
        category: 'road',
        role: 'sidewalk-piece',
        componentKind: prefab.kind,
        source: './data/models/assets/roads/sidewalks/scene.gltf',
        collision: 'authored-sidewalk-ribbon',
      };
      this.group.add(mesh);
      this.sidewalkModuleInstances.push({
        id,
        mesh,
        dimensions: [prefab.dimensions[0] * scaleX, prefab.dimensions[1], prefab.dimensions[2] * scaleZ],
      });
    }
  }

  _createSidewalkInstances(chains) {
    const kit = this._sidewalkKit;
    if (!kit?.size || this._sidewalkInstances) return;
    const totalLength = chains.reduce((sum, chain) => {
      if (!chain.sidewalk || chain.pts.length < 2) return sum;
      const lengths = this._roadPolylineLengths(chain.pts);
      return sum + (lengths[lengths.length - 1] || 0);
    }, 0);
    const capacity = Math.max(64, Math.ceil(totalLength * 1.12));
    this._sidewalkInstances = new Map();
    const autoTileIds = ['sidewalk-panel-01', 'sidewalk-panel-02', 'sidewalk-panel-03', 'sidewalk-panel-04', 'sidewalk-cracked'];
    for (const id of autoTileIds) {
      const prefab = kit.get(id);
      if (!prefab) continue;
      const batch = new THREE.InstancedMesh(prefab.geometry, prefab.material, capacity);
      batch.name = 'worldkit_sidewalk_' + id;
      batch.count = 0;
      batch.instanceMatrix.setUsage(THREE.StaticDrawUsage);
      batch.castShadow = false;
      batch.receiveShadow = true;
      batch.frustumCulled = false;
      this.group.add(batch);
      this._sidewalkInstances.set(id, batch);
    }
  }

  _placeImportedSidewalkTiles(centerPts, offsetPts, cumulative, start, end, side, roadIndex) {
    if (!this._sidewalkInstances || end - start < 0.6) return false;
    const sample = (points, distance) => {
      const last = cumulative.length - 1;
      let index = 0;
      const d = THREE.MathUtils.clamp(distance, 0, cumulative[last]);
      while (index < last - 1 && cumulative[index + 1] < d) index++;
      const segment = Math.max(1e-6, cumulative[index + 1] - cumulative[index]);
      const t = THREE.MathUtils.clamp((d - cumulative[index]) / segment, 0, 1);
      const a = points[index], b = points[index + 1];
      return {
        x: THREE.MathUtils.lerp(a.x, b.x, t),
        z: THREE.MathUtils.lerp(a.z, b.z, t),
      };
    };
    const temp = new THREE.Object3D();
    const tileLength = 2.01;
    const innerOffset = 1.0;
    let cursor = start;
    let tileIndex = 0;
    while (cursor < end - 0.05) {
      const length = Math.min(tileLength, end - cursor);
      if (length < 0.6) break;
      const distance = cursor + length * 0.5;
      const position = sample(offsetPts, distance);
      const before = sample(centerPts, Math.max(start, distance - 0.2));
      const after = sample(centerPts, Math.min(end, distance + 0.2));
      const dx = after.x - before.x, dz = after.z - before.z;
      const dirLength = Math.hypot(dx, dz);
      if (dirLength > 1e-5) {
        // Local X follows the road tangent. Each imported square prefab is
        // about 2 m × 2 m and is compressed only along the street for short
        // leftover runs at a junction or road end.
        const yaw = Math.atan2(-dz / dirLength, dx / dirLength);
        const variant = tileIndex % 29 === 17
          ? 'sidewalk-cracked'
          : 'sidewalk-panel-0' + (1 + ((tileIndex + roadIndex * 3 + (side > 0 ? 1 : 0)) % 4));
        const key = this._sidewalkInstances.has(variant) ? variant : 'sidewalk-panel-01';
        const batch = this._sidewalkInstances.get(key);
        if (batch.count < batch.instanceMatrix.count) {
          temp.position.set(position.x, 0.12, position.z);
          temp.rotation.set(0, yaw, 0);
          temp.scale.set(length / tileLength, 1, 1);
          temp.updateMatrix();
          batch.setMatrixAt(batch.count, temp.matrix);
          batch.count++;
        }
      }
      cursor += tileLength;
      tileIndex++;
    }
    return true;
  }

  _buildRoadSidewalks(chains, walkMat = this._sceneMat('walk'), curbMat = this.mCurb()) {
    if (!chains?.length) return;
    this._createSidewalkInstances(chains);
    const useImportedKit = !!this._sidewalkInstances?.size;
    const { metadata, ranges } = this._roadJunctionData(chains);
    const drawRuns = (centerPts, offsetPts, data, blocked, width, y, mat, colliderWidth, thickness, side, chainIndex, imported = false) => {
      let cursor = 0;
      const draw = (start, end) => {
        if (end - start < 0.08) return;
        // Slice by the centreline's arc-length so pavement/collision runs end
        // at exactly the same junction boundaries as the curb.
        const run = this._sliceOffsetRoadPolyline(
          centerPts, offsetPts, data.cumulative, start, end,
        );
        if (run.length < 2) return;
        if (imported && useImportedKit) {
          this._placeImportedSidewalkTiles(centerPts, offsetPts, data.cumulative, start, end, side, chainIndex);
          // A short procedural cap closes sub-tile gaps at junctions without
          // replacing the imported sidewalk surface along the street.
          const used = Math.floor((end - start) / 2.01) * 2.01;
          if (end - start - used > 0.6) {
            const cap = this._sliceOffsetRoadPolyline(
              centerPts, offsetPts, data.cumulative,
              start + used, end,
            );
            if (cap.length >= 2) this._strokeMitered(cap, width, y, mat, false);
          }
        } else {
          this._strokeMitered(run, width, y, mat, false);
        }
        this._addRoadSurfaceColliders(run, colliderWidth, y, false, thickness);
      };
      for (const [start, end] of blocked) {
        if (start > cursor + 0.05) draw(cursor, start);
        cursor = Math.max(cursor, end);
        if (cursor >= data.total) break;
      }
      if (cursor < data.total - 0.05) draw(cursor, data.total);
    };

    for (let i = 0; i < chains.length; i++) {
      const chain = chains[i];
      if (!chain.sidewalk || chain.pts.length < 2) continue;
      const data = metadata[i];
      const blocked = chain.closed ? [] : ranges[i];
      const edge = chain.W / 2;
      for (const side of [-1, 1]) {
        const pavement = this._offsetRoadPolyline(chain.pts, side * (edge + 1.0));
        if (chain.closed) {
          if (useImportedKit) {
            this._placeImportedSidewalkTiles(chain.pts, pavement, data.cumulative, 0, data.total, side, i);
          } else {
            this._strokeMitered(pavement, 2.4, 0.12, walkMat, true);
          }
          this._addRoadSurfaceColliders(pavement, 2.0, 0.12, true, 0.04);
        } else {
          drawRuns(chain.pts, pavement, data, blocked, 2.0, 0.12, walkMat, 2.0, 0.04, side, i, true);
        }
      }
      // Curbs remain procedurally joined: this creates a continuous road-edge
      // transition around arbitrary bends and junctions where rectangular
      // imported curb pieces would otherwise leave seams.
      for (const side of [-1, 1]) {
        const curb = this._offsetRoadPolyline(chain.pts, side * (edge + 0.12));
        if (chain.closed) {
          this._strokeMitered(curb, 0.36, 0.10, curbMat, true);
          this._addRoadSurfaceColliders(curb, 0.36, 0.12, true, 0.06);
        } else {
          drawRuns(chain.pts, curb, data, blocked, 0.36, 0.10, curbMat, 0.36, 0.06, side, i, false);
        }
      }
    }
    for (const batch of this._sidewalkInstances?.values() || []) {
      batch.instanceMatrix.needsUpdate = true;
      batch.computeBoundingBox();
      batch.computeBoundingSphere();
    }
  }

  _buildRoadMarkings(chains) {
    if (!chains?.length) return;
    const yellow = this._mat('lane-center-mark', () => new THREE.MeshStandardMaterial({
      color: 0xd7bd62, roughness: 0.96, metalness: 0, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    }));
    const white = this._mat('lane-white-mark', () => new THREE.MeshStandardMaterial({
      color: 0xd8d9d4, roughness: 0.96, metalness: 0, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    }));
    const crosswalk = this._mat('crosswalk-mark', () => new THREE.MeshStandardMaterial({
      color: 0xe4e4dc, roughness: 0.96, metalness: 0, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    }));

    const { metadata, hits, ranges: mergedRanges } = this._roadJunctionData(chains);

    const blocked = (ranges, start, end) => ranges.some(r => start < r[1] && end > r[0]);
    const drawDashed = (chain, data, offsetPts, ranges, startDistance, endDistance, dash, period, width, mat) => {
      for (let d = startDistance; d + dash <= endDistance; d += period) {
        if (blocked(ranges, d, d + dash)) continue;
        const line = this._sliceRoadPolyline(offsetPts, data.cumulative, d, d + dash);
        if (line.length >= 2) this._strokeMitered(line, width, chain.roadY + 0.008, mat, false);
      }
    };
    const drawSolid = (chain, data, offsetPts, ranges, startDistance, endDistance, width, mat) => {
      let cursor = startDistance;
      for (const [a, b] of ranges) {
        if (b <= cursor || a >= endDistance) continue;
        if (a > cursor + 0.05) {
          const line = this._sliceRoadPolyline(offsetPts, data.cumulative, cursor, Math.min(a, endDistance));
          if (line.length >= 2) this._strokeMitered(line, width, chain.roadY + 0.008, mat, false);
        }
        cursor = Math.max(cursor, b);
        if (cursor >= endDistance) break;
      }
      if (cursor < endDistance - 0.05) {
        const line = this._sliceRoadPolyline(offsetPts, data.cumulative, cursor, endDistance);
        if (line.length >= 2) this._strokeMitered(line, width, chain.roadY + 0.008, mat, false);
      }
    };

    const drawCrosswalk = (chain, data, centerDistance) => {
      const total = data.total;
      const halfBand = 1.45;
      const span = Math.max(1.2, chain.W - 1.0);
      const transverseHalf = span / 2;
      for (let offset = -1.2; offset <= 1.21; offset += 0.6) {
        const d = centerDistance + offset;
        if (d < 0.15 || d > total - 0.15) continue;
        const tangent = this._sliceRoadPolyline(
          chain.pts, data.cumulative,
          Math.max(0, d - 0.15), Math.min(total, d + 0.15),
        );
        if (tangent.length < 2) continue;
        const dx = tangent[tangent.length - 1].x - tangent[0].x;
        const dz = tangent[tangent.length - 1].z - tangent[0].z;
        const len = Math.hypot(dx, dz);
        if (len < 1e-5) continue;
        const nx = -dz / len, nz = dx / len;
        const center = tangent[Math.floor(tangent.length / 2)];
        const roadY = Number(center.y) || 0;
        const ends = [
          { x: center.x - nx * transverseHalf, y: roadY, z: center.z - nz * transverseHalf },
          { x: center.x + nx * transverseHalf, y: roadY, z: center.z + nz * transverseHalf },
        ];
        this._strokeMitered(ends, 0.14, chain.roadY + 0.008, crosswalk, false);
      }
    };

    for (let i = 0; i < chains.length; i++) {
      const chain = chains[i], data = metadata[i], ranges = mergedRanges[i];
      if (chain.surface === 'modular-bridge' || chain.surface === 'imported-street-road') continue;
      const total = data.total;

      if (chain.surface === 'road-pack') {
        if (chain.stopLine && chain.W >= 5.5 && total > 4) {
          for (const hit of hits[i]) {
            const endpointTolerance = Math.max(0.8, chain.W * 0.055);
            const atStart = hit.distance <= endpointTolerance;
            const atEnd = total - hit.distance <= endpointTolerance;
            if (!atStart && !atEnd) continue;
            const centerDistance = atStart ? Math.min(total - 0.1, 1.15) : Math.max(0.1, total - 1.15);
            const tangent = this._sliceRoadPolyline(
              chain.pts, data.cumulative,
              Math.max(0, centerDistance - 0.18), Math.min(total, centerDistance + 0.18),
            );
            if (tangent.length < 2) continue;
            const dx = tangent[tangent.length - 1].x - tangent[0].x;
            const dz = tangent[tangent.length - 1].z - tangent[0].z;
            const length = Math.hypot(dx, dz);
            if (length < 0.05) continue;
            const nx = -dz / length, nz = dx / length;
            const center = tangent[Math.floor(tangent.length / 2)];
            const halfSpan = Math.max(1.7, chain.W * 0.5 - 0.62);
            this._strokeMitered([
              { x: center.x - nx * halfSpan, z: center.z - nz * halfSpan },
              { x: center.x + nx * halfSpan, z: center.z + nz * halfSpan },
            ], 0.20, chain.roadY + 0.022, white, false);
            this.roadStopLineCount++;
          }
        }
        if (chain.W >= 8 && total > 18) {
          const proposed = [];
          for (const hit of hits[i]) {
            const offset = hit.radius + 2.75;
            if (hit.distance - offset > 4.2) proposed.push(hit.distance - offset);
            if (hit.distance + offset < total - 4.2) proposed.push(hit.distance + offset);
          }
          proposed.sort((a, b) => a - b);
          let last = -Infinity;
          for (const distance of proposed) {
            if (distance - last < 4.8) continue;
            drawCrosswalk(chain, data, distance);
            last = distance;
          }
        }
        continue;
      }
      if (total < 4 || chain.W < 6.5) continue;
      const roadPts = chain.pts;
      // Broken yellow centre line; dash gaps are removed entirely around junctions.
      drawDashed(chain, data, roadPts, ranges, 1.0, total - 1.0, 2.7, 5.8, Math.min(0.13, chain.W * 0.014), yellow);

      // Solid white edge lines sit inside the curb, not on the pavement edge.
      const edgeOffset = Math.max(0.5, chain.W / 2 - 0.55);
      for (const side of [-1, 1]) {
        const edgePts = this._offsetRoadPolyline(roadPts, side * edgeOffset);
        drawSolid(chain, data, edgePts, ranges, 0.2, total - 0.2, 0.10, white);
      }

      // Wider boulevards get dashed white lane separators in each direction.
      const lanesPerSide = Math.max(1, Math.floor(edgeOffset / 3.5));
      for (let side of [-1, 1]) {
        for (let lane = 1; lane < lanesPerSide; lane++) {
          const offset = side * edgeOffset * lane / lanesPerSide;
          const lanePts = this._offsetRoadPolyline(roadPts, offset);
          drawDashed(chain, data, lanePts, ranges, 1.0, total - 1.0, 2.7, 5.8, 0.085, white);
        }
      }

      // Paint a zebra crossing on both approaches of junctions on streets wide
      // enough to read as a proper pedestrian crossing. Every stripe is separate
      // geometry, so no paint is stretched across curved segments or into the junction.
      if (chain.W >= 8 && total > 18) {
        const proposed = [];
        for (const hit of hits[i]) {
          const offset = hit.radius + 2.75;
          if (hit.distance - offset > 4.2) proposed.push(hit.distance - offset);
          if (hit.distance + offset < total - 4.2) proposed.push(hit.distance + offset);
        }
        proposed.sort((a, b) => a - b);
        let last = -Infinity;
        for (const d of proposed) {
          if (d - last < 4.8) continue;
          drawCrosswalk(chain, data, d);
          last = d;
        }
      }
    }
  }

  // Distance from point p to a segment of chain `other` — if < ~4m it's a shared junction point.
  _nearAnyEnd(p, other) {
    const n = other.pts.length;
    if (n < 2) return false;
    return this._dist2(p, other.pts[0]) < 4 || this._dist2(p, other.pts[n - 1]) < 4;
  }
  _dist2(a, b) { const dx = a.x - b.x, dz = a.z - b.z; return dx * dx + dz * dz; }

  // How far back from endpoint p (heading `dir`) the road must trim so its end face sits
  // just inside the far edge of segment a->b (road of width wOther). 0 when unrelated.
  _tCut(p, dir, a, b, wOther, wMine) {
    const abx = b.x - a.x, abz = b.z - a.z;
    const l = Math.hypot(abx, abz);
    if (!l) return 0;
    const abUx = abx / l, abUz = abz / l;
    const tRaw = ((p.x - a.x) * abx + (p.z - a.z) * abz) / (l * l);
    // endpoint must be longitudinally within this segment — otherwise it's off
    // the far side of the road (a point can sit on a segment's EXTENDED line
    // while being hundreds of metres from the actual segment).
    if (tRaw < -0.01 || tRaw > 1.01) return 0;
    const t = Math.max(0, Math.min(1, tRaw));
    const px = p.x - (a.x + abx * t), pz = p.z - (a.z + abz * t);
    const perp = Math.abs(px * -abUz + pz * abUx);
    if (perp > wOther / 2 + 4) return 0; // endpoint not near this road
    const dl = Math.hypot(dir.x, dir.z) || 1;
    const ux = dir.x / dl, uz = dir.z / dl;
    const sinT = Math.max(Math.abs(ux * abUz - uz * abUx), 0.35);
    return (wOther / 2 + 0.5 + (wMine / 2) * sinT * 0.9) / sinT;
  }

  // Trim cutStart / cutEnd (metres) off the ends of an open polyline.
  _trimChain(pts, cutStart, cutEnd) {
    if (cutStart <= 0 && cutEnd <= 0) return pts;
    const L = pts.length;
    const segLens = [];
    let total = 0;
    for (let i = 0; i < L - 1; i++) {
      const l = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].z - pts[i].z);
      segLens.push(l); total += l;
    }
    const s = Math.min(cutStart, total * 0.8), e = Math.min(cutEnd, total * 0.8);
    const out = [];
    let acc = 0, i0 = 0;
    for (let i = 0; i < segLens.length; i++) {
      if (acc + segLens[i] >= s) { i0 = i; break; }
      acc += segLens[i];
    }
    const ax = pts[i0].x, az = pts[i0].z;
    let ddx = pts[i0 + 1].x - ax, ddz = pts[i0 + 1].z - az;
    const dl = Math.hypot(ddx, ddz) || 1;
    const startT = segLens[i0] > 1e-6 ? THREE.MathUtils.clamp((s - acc) / segLens[i0], 0, 1) : 0;
    out.push({
      x: ax + ddx / dl * (s - acc), z: az + ddz / dl * (s - acc),
      y: THREE.MathUtils.lerp(pts[i0].y || 0, pts[i0 + 1].y || 0, startT),
    });
    for (let i = i0 + 1; i < L; i++) out.push(pts[i]);
    let rem = e;
    while (out.length > 1) {
      const last = out[out.length - 1], prev = out[out.length - 2];
      const l = Math.hypot(last.x - prev.x, last.z - prev.z);
      if (l <= rem) { out.pop(); rem -= l; }
      else {
        const f = 1 - rem / l;
        out[out.length - 1] = {
          x: prev.x + (last.x - prev.x) * f,
          z: prev.z + (last.z - prev.z) * f,
          y: THREE.MathUtils.lerp(prev.y || 0, last.y || 0, f),
        };
        break;
      }
    }
    return out;
  }

  // Build the structural pieces of a raised crossing from the same elevated
  // centreline used by the asphalt ribbon. Vertices are in world coordinates,
  // because registerStaticRoadMeshes consumes geometry positions directly.
  _buildFlyoverStructure(pts, width, roadOffset = 0.06, slabThickness = 0.48, pierSpacing = 18, roadName = '', minimumPierHeight = 1.9) {
    if (!pts || pts.length < 2) return;
    const deckPositions = [], deckIndices = [];
    const addQuad = (positions, indices, a, b, c, d) => {
      const base = positions.length / 3;
      for (const p of [a, b, c, d]) positions.push(p.x, p.y, p.z);
      indices.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
    };
    const profileY = p => Number.isFinite(p.y) ? p.y : 0;
    const pointY = p => profileY(p) + roadOffset;
    // Taper the underside thickness near ground-level ramp ends so the concrete
    // does not bury itself into the terrain; full slab depth is used aloft.
    const thicknessAt = p => Math.min(slabThickness, Math.max(0.035, profileY(p) + roadOffset - 0.04));
    const crossSection = (p, nx, nz, side, bottom = false) => ({
      x: p.x + nx * side,
      y: pointY(p) - 0.035 - (bottom ? thicknessAt(p) : 0),
      z: p.z + nz * side,
    });

    // Continuous concrete box deck: asphalt remains the tyre-contact surface;
    // the slab supplies a visible underside and solid sides beneath it.
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz);
      if (len < 0.05) continue;
      const nx = -dz / len, nz = dx / len, half = width * 0.5;
      const ltA = crossSection(a, nx, nz, half), rtA = crossSection(a, nx, nz, -half);
      const ltB = crossSection(b, nx, nz, half), rtB = crossSection(b, nx, nz, -half);
      const lbA = crossSection(a, nx, nz, half, true), rbA = crossSection(a, nx, nz, -half, true);
      const lbB = crossSection(b, nx, nz, half, true), rbB = crossSection(b, nx, nz, -half, true);
      addQuad(deckPositions, deckIndices, ltA, ltB, rtA, rtB);
      addQuad(deckPositions, deckIndices, rbA, rbB, lbA, lbB);
      addQuad(deckPositions, deckIndices, ltA, lbA, ltB, lbB);
      addQuad(deckPositions, deckIndices, rtA, rtB, rbA, rbB);
      if (i === 0) addQuad(deckPositions, deckIndices, ltA, rtA, lbA, rbA);
      if (i === pts.length - 2) addQuad(deckPositions, deckIndices, rtB, ltB, rbB, lbB);
    }
    const deckGeometry = new THREE.BufferGeometry();
    deckGeometry.setAttribute('position', new THREE.Float32BufferAttribute(deckPositions, 3));
    deckGeometry.setIndex(deckIndices);
    deckGeometry.computeVertexNormals();
    const deckMaterial = this.mConcrete([128, 130, 132]);
    deckMaterial.side = THREE.DoubleSide;
    deckMaterial.needsUpdate = true;
    const deckMesh = new THREE.Mesh(deckGeometry, deckMaterial);
    deckMesh.castShadow = true;
    deckMesh.receiveShadow = true;
    deckMesh.userData.worldKit = {
      assetId: 'authored-flyover-approach',
      role: 'approach-deck',
      roadName,
    };
    this.group.add(deckMesh);
    this.roadPhysicsMeshes.push({
      kind: 'bridge_deck',
      source: 'generated-flyover-approach',
      roadName,
      geometry: deckGeometry,
    });

    // Paired tapered columns and a crosshead beam every 18m where the road
    // deck is high enough. Ground-height portions remain ramp-only.
    const lengths = this._roadPolylineLengths(pts);
    const totalLength = lengths[lengths.length - 1] || 0;
    if (totalLength < pierSpacing) return;
    const supportPositions = [], supportIndices = [];
    const appendGeometry = geometry => {
      const attr = geometry.attributes.position;
      const base = supportPositions.length / 3;
      for (let i = 0; i < attr.count; i++) supportPositions.push(attr.getX(i), attr.getY(i), attr.getZ(i));
      if (geometry.index) for (const index of geometry.index.array) supportIndices.push(base + index);
      else for (let i = 0; i < attr.count; i++) supportIndices.push(base + i);
      geometry.dispose();
    };
    const sampleAt = distance => {
      let i = 0;
      while (i < lengths.length - 2 && lengths[i + 1] < distance) i++;
      const segmentLength = Math.max(1e-6, lengths[i + 1] - lengths[i]);
      const t = THREE.MathUtils.clamp((distance - lengths[i]) / segmentLength, 0, 1);
      const a = pts[i], b = pts[i + 1];
      const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz) || 1;
      return {
        x: THREE.MathUtils.lerp(a.x, b.x, t), z: THREE.MathUtils.lerp(a.z, b.z, t),
        y: THREE.MathUtils.lerp(a.y || 0, b.y || 0, t),
        nx: -dz / len, nz: dx / len, dx, dz,
      };
    };
    for (let distance = pierSpacing; distance < totalLength - 5; distance += pierSpacing) {
      const s = sampleAt(distance);
      const deckBottom = s.y + roadOffset - 0.035 - slabThickness;
      const capHeight = 0.52;
      const columnHeight = deckBottom - capHeight;
      if (columnHeight < minimumPierHeight) continue;
      for (const side of [-1, 1]) {
        const x = s.x + s.nx * side * (width * 0.5 + 1.1);
        const z = s.z + s.nz * side * (width * 0.5 + 1.1);
        const column = new THREE.CylinderGeometry(0.54, 0.76, columnHeight, 8, 1, false);
        column.translate(x, columnHeight * 0.5, z);
        appendGeometry(column);
      }
      const cap = new THREE.BoxGeometry(width + 2.8, capHeight, 1.55);
      const transform = new THREE.Object3D();
      transform.position.set(s.x, deckBottom - capHeight * 0.5, s.z);
      transform.rotation.y = Math.atan2(s.dx, s.dz);
      transform.updateMatrix();
      cap.applyMatrix4(transform.matrix);
      appendGeometry(cap);
    }
    if (supportPositions.length) {
      const supportGeometry = new THREE.BufferGeometry();
      supportGeometry.setAttribute('position', new THREE.Float32BufferAttribute(supportPositions, 3));
      supportGeometry.setIndex(supportIndices);
      supportGeometry.computeVertexNormals();
      const supportMaterial = this.mConcrete([116, 119, 121]);
      supportMaterial.side = THREE.DoubleSide;
      supportMaterial.needsUpdate = true;
      const supportMesh = new THREE.Mesh(supportGeometry, supportMaterial);
      supportMesh.castShadow = true;
      supportMesh.receiveShadow = true;
      supportMesh.userData.worldKit = {
        assetId: 'authored-flyover-approach',
        role: 'approach-supports',
        roadName,
      };
      this.group.add(supportMesh);
      this.roadPhysicsMeshes.push({
        kind: 'bridge_support',
        source: 'generated-flyover-approach',
        roadName,
        geometry: supportGeometry,
      });
    }
  }

  _buildRoadGuardrails(pts, width, yOffset = 0.06, height = 0.78, thickness = 0.22, roadName = '') {
    if (!pts || pts.length < 2) return;
    const positions = [], indices = [];
    const quad = (a,b,c,d) => { const i=positions.length/3; for(const p of [a,b,c,d]) positions.push(p.x,p.y,p.z); indices.push(i,i+1,i+2,i+2,i+1,i+3); };
    for(const side of [-1,1]) for(let i=0;i<pts.length-1;i++) {
      const a=pts[i],b=pts[i+1],dx=b.x-a.x,dz=b.z-a.z,len=Math.hypot(dx,dz); if(len<0.05)continue;
      // Start guardrails only once the road is raised. At-grade approach
      // asphalt remains a normal street; the parapets continue into the
      // imported bridge end-ramp where the deck becomes elevated.
      if (Math.max(Number(a.y)||0, Number(b.y)||0) + yOffset < 0.85) continue;
      const nx=-dz/len,nz=dx/len,p=(v,o,h=0)=>({x:v.x+nx*o,y:(v.y||0)+yOffset+h,z:v.z+nz*o});
      const inner=side*(width/2-thickness),outer=side*width/2;
      const ai=p(a,inner),bi=p(b,inner),ao=p(a,outer),bo=p(b,outer),ait=p(a,inner,height),bit=p(b,inner,height),aot=p(a,outer,height),bot=p(b,outer,height);
      quad(ai,bi,ait,bit); quad(ao,aot,bo,bot); quad(ait,bit,aot,bot);
    }
    const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geo.setIndex(indices);geo.computeVertexNormals();
    const mat=this.mCurb();mat.side=THREE.DoubleSide;mat.needsUpdate=true;
    const mesh=new THREE.Mesh(geo,mat);mesh.castShadow=true;mesh.receiveShadow=true;
    mesh.userData.worldKit = {
      assetId: 'authored-flyover-approach',
      role: 'approach-guardrails',
      roadName,
    };
    this.group.add(mesh);
    this.roadPhysicsMeshes.push({
      kind: 'barrier',
      source: 'generated-flyover-approach',
      roadName,
      geometry: geo,
    });
  }

  // Stroke a polyline as a solid mitered polygon (correct corners, no gaps) into _ribbonBatch.
  _strokeMitered(pts, w, y, mat, closed = false) {
    const L = pts.length;
    if (L < 2) return;
    const hw = w / 2;
    const left = [], right = [];
    for (let i = 0; i < L; i++) {
      const p = pts[i];
      const prev = pts[closed ? (i - 1 + L) % L : Math.max(0, i - 1)];
      const next = pts[closed ? (i + 1) % L : Math.min(L - 1, i + 1)];
      const px = p.x - prev.x, pz = p.z - prev.z;
      const nx = next.x - p.x, nz = next.z - p.z;
      const pl = Math.hypot(px, pz), nl = Math.hypot(nx, nz);
      let mx, mz;
      // Open endpoints have a zero-length adjacent segment. Use the one valid
      // normal instead of collapsing the road width to a single vertex.
      if (!closed && i === 0 && nl > 1e-6) {
        mx = -nz / nl; mz = nx / nl;
      } else if (!closed && i === L - 1 && pl > 1e-6) {
        mx = -pz / pl; mz = px / pl;
      } else if (pl > 1e-6 && nl > 1e-6) {
        const nux = -pz / pl, nuz = px / pl;
        const nvx = -nz / nl, nvz = nx / nl;
        const dot = nux * nvx + nuz * nvz;
        const denom = Math.max(0.3, 1 + dot);
        mx = (nux + nvx) / denom;
        mz = (nuz + nvz) / denom;
        const ml = Math.hypot(mx, mz);
        if (ml > 2.5) { mx = mx / ml * 2.5; mz = mz / ml * 2.5; }
      } else {
        mx = 0; mz = 0;
      }
      const y = Number(p.y) || 0;
      left.push({ x: p.x + mx * hw, y, z: p.z + mz * hw });
      right.push({ x: p.x - mx * hw, y, z: p.z - mz * hw });
    }
    this._ribbonBatch.push({ left, right, y, mat, closed });
  }
  _removeWorldCollider(col) {
    if (!col) return;
    let i = this.colliders.indexOf(col);
    if (i >= 0) this.colliders.splice(i, 1);
    i = this.climbables.indexOf(col);
    if (i >= 0) this.climbables.splice(i, 1);
    if (this.bvhWorld) this.bvhWorld.removeAABB(col);
    if (col.physicsCollider && this._physics) this._physics.removeCollider(col.physicsCollider);
    col.physicsCollider = null;
  }

  removeLoot(idx) {
    const L = this.lootPoints[idx];
    if (!L || L.looted) return;
    L.looted = true;
    if (L.mesh) this.group.remove(L.mesh);
    this._removeWorldCollider(L.col);
    const r = L.mesh && this.reactiveObjects.find(o => o.mesh === L.mesh);
    if (r) {
      r.dead = true;
      r.mesh.visible = false;
      this._removeWorldCollider(r.col);
    }
  }


  // ===== SPAWN POINTS FALLBACK =====
  _finishSpawnPoints() {
    if (this.sceneData?.disableAutoSpawns) return;
    if (!this.spawnPoints.length) {
      const P = (x, z) => this.spawnPoints.push(new THREE.Vector3(x, 0, z));
      for (let i = 0; i < 80; i++) {
        const a = rng(0, Math.PI * 2);
        const r = rng(50, this.bounds - 30);
        P(Math.cos(a) * r, Math.sin(a) * r);
      }
    }
  }

  // ===== COLLISION QUERIES =====
  losBlocked(a, b) {
    if (this.grid) return this.grid.losBlocked(a, b);
    for (const c of this.colliders) {
      if (c.max.y < 1.2) continue;
      if (segmentAABB(a, b, c)) return true;
    }
    return false;
  }

  colliderAt(x, z, r = 0.4) {
    const radius = r + 0.05;
    const near = this.grid
      ? this.grid.queryPoint(x, z, radius)
      : this.colliders;
    for (const c of near) {
      // Road/sidewalk proxy boxes are height-sampling metadata only. Their broad
      // AABBs can extend beyond the visible strip and must never block walking.
      if (c.surfaceOnly || c.type === 'road_surface') continue;
      if (c.max.y < 0.3) continue;
      if (c.orientedBox) {
        // Road/sidewalk AABBs are broadphase only. Use a circle-vs-oriented
        // rectangle test so their empty corners never become invisible walls.
        const o = c.orientedBox;
        const dx = x - o.center.x, dz = z - o.center.z;
        const cs = Math.cos(o.yaw), sn = Math.sin(o.yaw);
        const lx = dx * cs - dz * sn, lz = dx * sn + dz * cs;
        const cx = THREE.MathUtils.clamp(lx, -o.halfExtents.x, o.halfExtents.x);
        const cz = THREE.MathUtils.clamp(lz, -o.halfExtents.z, o.halfExtents.z);
        if ((lx - cx) ** 2 + (lz - cz) ** 2 <= radius * radius) return true;
        continue;
      }
      if (x + radius > c.min.x && x - radius < c.max.x &&
          z + radius > c.min.z && z - radius < c.max.z) return true;
    }
    return false;
  }

  raycast(origin, dir, maxDist) {
    let best = null;
    if (this.grid) {
      best = this.grid.raycast(origin, dir, maxDist);
    } else {
      for (const c of this.colliders) {
        const hit = rayAABB(origin, dir, c, maxDist);
        if (hit && (!best || hit.dist < best.dist)) best = hit;
      }
    }
    if (dir.y < -1e-5) {
      const t = -origin.y / dir.y;
      if (t > 0 && t < maxDist && (!best || t < best.dist)) {
        best = { dist: t, point: origin.clone().addScaledVector(dir, t), ground: true };
      }
    }
    return best;
  }

  raycastSolids(origin, dir, maxDist) {
    if (this.grid) return this.grid.raycast(origin, dir, maxDist);
    let best = null;
    for (const c of this.colliders) {
      const hit = rayAABB(origin, dir, c, maxDist);
      if (hit && (!best || hit.dist < best.dist)) best = hit;
    }
    return best;
  }

  climbableAt(p, range = 1.4) {
    for (const c of this.climbables) {
      const cx = (c.min.x + c.max.x) / 2, cz = (c.min.z + c.max.z) / 2;
      if (Math.abs(p.x - cx) < range && Math.abs(p.z - cz) < range) return c;
    }
    return null;
  }

  // GTA-style: find any wall/surface within reach by casting a ray forward.
  // Returns the first climbable wall hit (height 0.5m to 2.8m, within maxDist).
  findClimbWall(pos, yaw, maxDist = 1.8, minH = 0.5, maxH = 2.8) {
    const dir = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    const origin = new THREE.Vector3(pos.x, pos.y + 0.9, pos.z);
    const candidates = this.grid
      ? this.grid.queryRadius(pos.x, pos.z, maxDist + 1)
      : this.colliders;
    let best = null, bestDist = maxDist;
    for (const c of candidates) {
      if (c.max.y - c.min.y < minH || c.max.y - c.min.y > maxH) continue;
      const hit = rayAABB(origin, dir, c, maxDist + 0.5);
      if (hit && hit.dist < bestDist) {
        const wallH = c.max.y - c.min.y;
        if (wallH >= minH && wallH <= maxH) {
          bestDist = hit.dist;
          best = c;
        }
      }
    }
    return best;
  }
}

export function rayAABB(o, d, box, maxDist) {
  let tmin = 0, tmax = maxDist, axis = -1, sign = 0;
  for (const ax of ['x', 'y', 'z']) {
    const inv = 1 / d[ax];
    let t0 = (box.min[ax] - o[ax]) * inv, t1 = (box.max[ax] - o[ax]) * inv;
    let s = -1;
    if (inv < 0) { [t0, t1] = [t1, t0]; s = 1; }
    if (t0 > tmin) { tmin = t0; axis = ax; sign = s; }
    tmax = Math.min(tmax, t1);
    if (tmax < tmin) return null;
  }
  const point = o.clone().addScaledVector(d, tmin);
  const normal = new THREE.Vector3();
  if (axis !== -1) normal[axis] = sign;
  return { dist: tmin, point, normal };
}

function segmentAABB(a, b, box) {
  const d = b.clone().sub(a);
  const len = d.length();
  if (len < 1e-6) return false;
  d.divideScalar(len);
  return rayAABB(a, d, box, len) !== null;
}
