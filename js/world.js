// World — GLB-only city with authored roads.
import * as THREE from 'three';
import * as TEX from './textures.js';
import { GLTFLoader } from './lib/GLTFLoader.js';
import { BVHWorld } from './bvh-collision.js';
import { Atmosphere } from './atmosphere.js';
import { prefetch } from './model-loader.js';

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
  constructor(scene, quality = 'high', sceneData = null) {
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
    this.vehicleSpawns = [];  // {x,z,ry,kind} parked/drivable vehicles
    this._buildingData = [];  // {url,min,max,x,z,doors[],interior} — auto-detected from GLB
    this.bounds = sceneData && sceneData.bounds ? sceneData.bounds : (quality === 'ultra-low' ? 1000 : 2000);
    this._quality = quality;
    this.group = new THREE.Group();
    scene.add(this.group);
    this._boxBatch = [];     // {x,y,z,w,h,d,ry,mat,shadow} — static boxes to batch
    this._planeBatch = [];   // {x,y,z,rw,rh,rz,mat,w,h,shadow} — static planes to batch
    this._ribbonBatch = [];  // {left[], right[], y, mat, closed} — mitered road/sidewalk ribbons
    this._trimBatch = [];    // {x,y,z,w,h,d,ry,mat} — AO base skirts + roofline lips

    // Create collision indexes before assets load; initializing BVHWorld after
    // loading discards model BVHs registered during _loadGLBAsset.
    this._physics = null; // set by main.js after Physics.init()
    this.bvhWorld = new BVHWorld();
    this.grid = this.bvhWorld;
    this.buildLighting(quality);
    if (quality !== 'ultra-low') this.buildSky();
    this.buildGround(sceneData && sceneData.ground);
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
    const tex = new THREE.TextureLoader().load('./data/models/textures/roadtex.jpg', (t) => { t.colorSpace = THREE.SRGBColorSpace; });
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    return new THREE.MeshStandardMaterial({ map: tex, roughness: .92, metalness: 0, side: THREE.DoubleSide });
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
    if (climb) this.climbables.push(c); else this.colliders.push(c);
    if (this.bvhWorld) {
      if (climb) this.bvhWorld._climbables.push(c); else this.bvhWorld.aabbColliders.push(c);
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

  addInterior(min, max) { this.interiors.push({ min, max }); }

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
    for (const v of this.interiors) if (p.x > v.min.x && p.x < v.max.x && p.z > v.min.z && p.z < v.max.z) return true;
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
            positions.push(r.left[i].x, r.y, r.left[i].z);
            uvs.push(0, u * (totalLen / 6));
            positions.push(r.right[i].x, r.y, r.right[i].z);
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
    if (this._quality === 'ultra-low') { this.scene.background = new THREE.Color(0x5a6a78); return; }
    // Atmosphere handles the sky dome; just set env map for PBR reflections
    const sky = TEX.makeSkyTexture();
    this.scene.environment = sky;
    this.scene.environmentIntensity = 0.45;
    // Don't set background — atmosphere sky dome renders over it
  }

  buildGround(spec = null) {
    const ultra = this._quality === 'ultra-low';
    const gSize = spec && spec.size ? spec.size : (ultra ? 3000 : 5000);
    let groundMat;
    if (ultra) {
      groundMat = new THREE.MeshBasicMaterial({ color: 0x5a6048 });
    } else if (spec && spec.color) {
      let colorStr = spec.color;
      if (typeof colorStr === 'string' && colorStr.startsWith('0x')) colorStr = '#' + colorStr.slice(2);
      const c3 = new THREE.Color(colorStr);
      groundMat = new THREE.MeshStandardMaterial({ map: TEX.makeGroundTexture(512, [c3.r * 255, c3.g * 255, c3.b * 255]), roughness: 0.96, metalness: 0 });
      groundMat.map.repeat.set(100, 100);
    } else {
      groundMat = new THREE.MeshStandardMaterial({ map: TEX.makeGroundTexture(), roughness: 0.96, metalness: 0 });
      groundMat.map.repeat.set(120, 120);
    }
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(gSize, gSize), groundMat);
    ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
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

    // Prefetch all GLB binaries off main thread in parallel before decoding
    const glbUrls = assets.map(a => a.url).filter(u => u && (u.endsWith('.glb') || u.endsWith('.gltf')));
    if (glbUrls.length) {
      prefetch(glbUrls);
      console.log(`[World] Prefetching ${glbUrls.length} model binaries in background`);
    }

    // Load assets in parallel batches of 4
    const CONCURRENT = 4;
    for (let i = 0; i < assets.length; i += CONCURRENT) {
      const batch = assets.slice(i, i + CONCURRENT);
      await Promise.allSettled(batch.map(a => this._loadGLBAsset(a)));
    }

    this._rebuildGrid();
    if (this._physics && this._physics.world) {
      this._physics.registerStaticBatch(this.colliders);
    }
    console.log('[World] Grid rebuilt with', this.colliders.length, 'colliders +', this.climbables.length, 'climbables +', this.portals.length, 'portals');
    return;
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

  _injectManifestColliders(manifest, a, scaleFactor, yOffset) {
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
      // Rotate each local box's footprint into a conservative world AABB.
      const worldW = (Math.abs(c) * w + Math.abs(sn) * d) * scaleFactor;
      const worldD = (Math.abs(sn) * w + Math.abs(c) * d) * scaleFactor;
      this.addCollider(
        worldX, yOffset + ly - worldH / 2, worldZ,
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

      // Measure raw bbox BEFORE any transforms
      const rawBBox = new THREE.Box3().setFromObject(model);
      const rawH = rawBBox.max.y - rawBBox.min.y;

      // Keep the sidecar's collision boxes on the exact same scale as the GLB.
      let scaleFactor = 1;
      if (a.targetH && rawH > 0.01) {
        scaleFactor = a.targetH / rawH;
        model.scale.setScalar(scaleFactor);
      } else if (a.scale) {
        scaleFactor = a.scale;
        model.scale.setScalar(scaleFactor);
      }

      // Position: snap model's bottom to ground (y=0), plus any elevation offset.
      model.updateMatrixWorld(true);
      const afterScaleBBox = new THREE.Box3().setFromObject(model);
      const yOffset = -afterScaleBBox.min.y + (a.elevation || 0);
      model.position.set(a.x, yOffset, a.z);
      model.rotation.y = a.ry || 0;
      this.group.add(model);
      model.updateMatrixWorld(true);

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
        if (mat && mat.isMeshStandardMaterial) {
          if (mat.roughness > 0.9) mat.roughness = Math.min(mat.roughness, 0.92);
          if (mat.metalness < 0.01 && mat.roughness < 0.5) mat.metalness = 0.05;
          if (envMap && !mat.envMap) { mat.envMap = envMap; mat.envMapIntensity = 0.35; }
          mat.needsUpdate = true;
        } else if (mat && mat.isMeshPhongMaterial) {
          const std = new THREE.MeshStandardMaterial({
            color: mat.color,
            roughness: 0.7,
            metalness: 0.05,
          });
          if (envMap) { std.envMap = envMap; std.envMapIntensity = 0.35; }
          std.needsUpdate = true;
          o.material = std;
        }
      });

      // Add solid collision for GLB asset
      const assetUrl = (a.url || '').toLowerCase();
      const assetName = a.url.split('/').pop();
      const isTree = assetUrl.includes('tree') || assetUrl.includes('palm') || assetUrl.includes('coconut') || (a.tags && a.tags.includes('nature'));
      const isLamp = assetUrl.includes('street_light') || assetUrl.includes('lamp') || assetUrl.includes('light');
      const isRoad = assetUrl.includes('road.glb') || (assetUrl.includes('road') && !assetUrl.includes('barrier'));

      const bbox = new THREE.Box3().setFromObject(model, true);
      const collisionProxyBoxes = [];
      const doorMeshes = [];
      const floorCollisionBoxes = [];
      model.traverse((o) => {
        if (!o.isMesh) return;
        const isProxy = this._isCollisionMesh(o.name);
        const isDoor = this._isDoorMesh(o.name);
        const isFloor = this._isFloorMesh(o.name);
        if (!isProxy && !isDoor && !isFloor) return;
        o.updateWorldMatrix(true, false);
        const geo = o.geometry;
        if (!geo || !geo.attributes.position) return;
        if (!geo.boundingBox) geo.computeBoundingBox();
        if (!geo.boundingBox) return;
        const meshBox = new THREE.Box3().copy(geo.boundingBox).applyMatrix4(o.matrixWorld);
        const size = meshBox.getSize(new THREE.Vector3());
        const center = meshBox.getCenter(new THREE.Vector3());
        const record = { name: o.name, min: meshBox.min.clone(), max: meshBox.max.clone(), center, size };
        if (isProxy) collisionProxyBoxes.push(record);
        if (isDoor) doorMeshes.push(record);
        if (isFloor) floorCollisionBoxes.push(record);
      });
      // Collision helpers are hidden only after their dimensions have been read.
      model.traverse((o) => { if (o.isMesh && this._isCollisionMesh(o.name)) o.visible = false; });

      // Prefer authored col_* meshes. Only request a sidecar if none exist and
      // this is not foliage/pole geometry, which has a cheaper purpose-built proxy.
      const collisionManifest = !collisionProxyBoxes.length && !isTree && !isLamp
        ? await this._loadCollisionManifest(a)
        : null;
      const usesCollisionManifest = !!collisionManifest?.boxes?.length && !collisionProxyBoxes.length;

      if (!a.noCollision && !isRoad && !bbox.isEmpty()) {
        const size = bbox.getSize(new THREE.Vector3());
        const center = bbox.getCenter(new THREE.Vector3());
        if (size.x > 0.1 && size.y > 0.1 && size.z > 0.1) {
          // Explicit col_* boxes are the preferred authoring format. They are
          // hidden visuals but become solid gameplay colliders, for buildings
          // as well as climbable props.
          if (collisionProxyBoxes.length) {
            for (const p of collisionProxyBoxes) {
              if (p.size.x > 0.05 && p.size.y > 0.05 && p.size.z > 0.05) {
                this.addCollider(p.center.x, p.min.y, p.center.z, p.size.x, p.size.y, p.size.z, !!a.climbable, a.type || null);
              }
            }
          } else if (isTree) {
            // Avoid blocking the road with foliage: trees collide at the trunk.
            this.addCollider(a.x, bbox.min.y, a.z, 0.5, size.y, 0.5);
          } else if (isLamp) {
            this.addCollider(a.x, bbox.min.y, a.z, 0.35, size.y, 0.35);
          } else if (a.collisionSize) {
            this.addCollider(a.x, bbox.min.y, a.z, a.collisionSize[0], a.collisionH || size.y, a.collisionSize[1], !!a.climbable, a.type || null);
          } else if (a.collisionH) {
            this.addCollider(center.x, bbox.min.y, center.z, size.x, a.collisionH, size.z, !!a.climbable, a.type || null);
          } else if (collisionManifest?.boxes?.length) {
            const injected = this._injectManifestColliders(collisionManifest, a, scaleFactor, yOffset);
            if (!injected) {
              if (a.building) this._addBuildingWallColliders(bbox, doorMeshes);
              else this.addCollider(center.x, bbox.min.y, center.z, size.x, size.y, size.z, !!a.climbable, a.type || null);
            }
            console.log(`[World] Injected ${injected} collision boxes from ${a.collisionManifest || a.url.replace(/\.(glb|gltf)(?:[?#].*)?$/i, '_col.json')}`);
          } else if (a.building) {
            // Safe fallback when no authored proxies or generated sidecar exists.
            this._addBuildingWallColliders(bbox, doorMeshes);
          } else {
            this.addCollider(center.x, bbox.min.y, center.z, size.x, size.y, size.z, !!a.climbable, a.type || null);
          }
        }
      }

      // A floor_* mesh is an actual walkable slab. The GLB manifest normally
      // provides finer per-cell boxes; when none exists, create a thin slab at
      // the mesh's real top height rather than leaving the visible floor ghosted.
      if (!a.noCollision && !isRoad && !usesCollisionManifest) {
        for (const floor of floorCollisionBoxes) {
          const h = Math.max(floor.size.y, 0.12);
          const bottomY = floor.max.y - h;
          if (floor.size.x > 0.2 && floor.size.z > 0.2) {
            this.addCollider(floor.center.x, bottomY, floor.center.z, floor.size.x, h, floor.size.z);
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
          this._registerBuildingDoors(a, model, doorMeshes, buildingIdx);
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

  _addBuildingWallColliders(bbox, doors = []) {
    const min = bbox.min, max = bbox.max;
    const width = max.x - min.x, depth = max.z - min.z, height = max.y - min.y;
    if (width < 1 || depth < 1 || height < 1) return;
    const thickness = THREE.MathUtils.clamp(Math.min(width, depth) * 0.035, 0.25, 0.6);
    const door = doors.length
      ? doors.reduce((best, d) => !best || Math.abs(d.center.y - (min.y + 1.0)) < Math.abs(best.center.y - (min.y + 1.0)) ? d : best, null)
      : null;
    let side = null;
    if (door) {
      side = [
        ['west', Math.abs(door.center.x - min.x)],
        ['east', Math.abs(door.center.x - max.x)],
        ['north', Math.abs(door.center.z - min.z)],
        ['south', Math.abs(door.center.z - max.z)],
      ].sort((a, b) => a[1] - b[1])[0][0];
    }
    const spanX = door ? Math.min(width * 0.75, Math.max(door.size.x, 1.1) + 0.35) : 0;
    const spanZ = door ? Math.min(depth * 0.75, Math.max(door.size.z, 1.1) + 0.35) : 0;
    const add = (x, z, w, d) => { if (w > 0.15 && d > 0.15) this.addCollider(x, min.y, z, w, height, d); };
    const xWall = (z, opening) => {
      if (!opening || !door) { add((min.x + max.x) / 2, z, width, thickness); return; }
      const a = THREE.MathUtils.clamp(door.center.x - spanX / 2, min.x, max.x);
      const b = THREE.MathUtils.clamp(door.center.x + spanX / 2, min.x, max.x);
      add((min.x + a) / 2, z, a - min.x, thickness);
      add((b + max.x) / 2, z, max.x - b, thickness);
    };
    const zWall = (x, opening) => {
      if (!opening || !door) { add(x, (min.z + max.z) / 2, thickness, depth); return; }
      const a = THREE.MathUtils.clamp(door.center.z - spanZ / 2, min.z, max.z);
      const b = THREE.MathUtils.clamp(door.center.z + spanZ / 2, min.z, max.z);
      add(x, (min.z + a) / 2, thickness, a - min.z);
      add(x, (b + max.z) / 2, thickness, max.z - b);
    };
    zWall(min.x + thickness / 2, side === 'west');
    zWall(max.x - thickness / 2, side === 'east');
    xWall(min.z + thickness / 2, side === 'north');
    xWall(max.z - thickness / 2, side === 'south');
  }

  _isDoorMesh(name) {
    return (name || '').startsWith('door_');
  }

  _isCollisionMesh(name) {
    return (name || '').startsWith('col_');
  }

  _isRoomMarker(name) {
    const m = (name || '').match(/^room_(\d+)_marker$/);
    return m ? parseInt(m[1]) : -1;
  }

  _isStairMesh(name) {
    return (name || '').startsWith('stairs_');
  }

  _isFloorMesh(name) {
    return (name || '').startsWith('floor_');
  }

  _isWindowMesh(name) {
    return (name || '').startsWith('window_');
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

  _registerBuildingDoors(a, model, doorMeshes, buildingIdx) {
    const bd = this._buildingData[buildingIdx];
    const wallMargin = 1.0;
    const interiorMin = new THREE.Vector3(bd.min.x + wallMargin, bd.min.y, bd.min.z + wallMargin);
    const interiorMax = new THREE.Vector3(bd.max.x - wallMargin, bd.max.y, bd.max.z - wallMargin);
    if (interiorMin.x < interiorMax.x && interiorMin.z < interiorMax.z) {
      bd.interior = { min: interiorMin, max: interiorMax };
      this.addInterior(interiorMin, interiorMax);
    }

    const bCenterX = (bd.min.x + bd.max.x) / 2;
    const bCenterZ = (bd.min.z + bd.max.z) / 2;

    for (const door of doorMeshes) {
      const thinAxis = door.size.x < door.size.z ? 'x' : 'z';
      const outward = new THREE.Vector3(0, 0, 0);
      if (thinAxis === 'x') {
        outward.z = door.center.z > bCenterZ ? 1 : -1;
      } else {
        outward.x = door.center.x > bCenterX ? 1 : -1;
      }

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
        console.log(`[World] Room ${roomIdx} marker at (${wp.x.toFixed(1)}, ${wp.y.toFixed(1)}, ${wp.z.toFixed(1)})`);
      }
    });
  }

  _rebuildGrid() {
    if (!this.bvhWorld) return;
    this.bvhWorld.aabbColliders.length = 0;
    this.bvhWorld._climbables.length = 0;
    for (const c of this.colliders) this.bvhWorld.aabbColliders.push(c);
    for (const c of this.climbables) this.bvhWorld._climbables.push(c);
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
  async _buildAuthoredRoads(roads) {
    const roadMat = this.mRoad();
    const walkMat = this._sceneMat('walk');
    const curbMat = this.mCurb();
    if (!this._roadChains) this._roadChains = [];
    function catmullRom(p0, p1, p2, p3, t) {
      const t2 = t * t, t3 = t2 * t;
      return {
        x: 0.5*((2*p1.x)+(-p0.x+p2.x)*t+(2*p0.x-5*p1.x+4*p2.x-p3.x)*t2+(-p0.x+3*p1.x-3*p2.x+p3.x)*t3),
        z: 0.5*((2*p1.z)+(-p0.z+p2.z)*t+(2*p0.z-5*p1.z+4*p2.z-p3.z)*t2+(-p0.z+3*p1.z-3*p2.z+p3.z)*t3),
      };
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
      const pts = rd.points || [];
      if (pts.length < 2) continue;
      const W = rd.w || 12;
      const closed = pts.length > 2 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1];
      const work = closed ? pts.slice(0, -1) : pts;
      const raw = work.map(p => ({ x: p[0], z: p[1] }));
      const smoothed = rd.smooth !== false ? smoothPts(raw, 6) : raw;
      chains.push({ pts: smoothed, W, sidewalk: !!rd.sidewalk, closed });
    }
    for (const ch of chains) {
      ch.cutStart = 0; ch.cutEnd = 0;
      if (ch.closed || ch.pts.length < 2) continue;
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
    for (let ci = 0; ci < chains.length; ci++) {
      const ch = chains[ci];
      const walkY = 0.12 + (ci % 4) * 0.004;
      const pts = ch.closed ? ch.pts : this._trimChain(ch.pts, ch.cutStart, ch.cutEnd);
      if (pts.length < 2) continue;

      // Road surface: textured mitered ribbon (roadtex.jpg), no collision boxes
      const roadY = 0.06 + (ci % 4) * 0.02;
      this._strokeMitered(pts, ch.W, roadY, roadMat, ch.closed);

      this._roadChains.push({ pts, W: ch.W, sidewalk: ch.sidewalk });
      if (!ch.sidewalk) continue;
      const edge = ch.W / 2;
      for (const side of [-1, 1]) {
        const offPts = pts.map((p, pi) => {
          const prev = pts[Math.max(0, pi - 1)];
          const next = pts[Math.min(pts.length - 1, pi + 1)];
          let ux = p.x - prev.x, uz = p.z - prev.z;
          let vx = next.x - p.x, vz = next.z - p.z;
          const l1 = Math.hypot(ux, uz) || 1, l2 = Math.hypot(vx, vz) || 1;
          ux /= l1; uz /= l1; vx /= l2; vz /= l2;
          let nx = -(uz + vz) / 2, nz = (ux + vx) / 2;
          const nl = Math.hypot(nx, nz) || 1;
          return { x: p.x + nx / nl * side * (edge + 1.2), z: p.z + nz / nl * side * (edge + 1.2) };
        });
        this._strokeMitered(offPts, 2.4, walkY, walkMat, ch.closed);
      }
      for (const side of [-1, 1]) {
        const curbPts = pts.map((p, pi) => {
          const prev = pts[Math.max(0, pi - 1)];
          const next = pts[Math.min(pts.length - 1, pi + 1)];
          let ux = p.x - prev.x, uz = p.z - prev.z;
          let vx = next.x - p.x, vz = next.z - p.z;
          const l1 = Math.hypot(ux, uz) || 1, l2 = Math.hypot(vx, vz) || 1;
          ux /= l1; uz /= l1; vx /= l2; vz /= l2;
          let nx = -(uz + vz) / 2, nz = (ux + vx) / 2;
          const nl = Math.hypot(nx, nz) || 1;
          return { x: p.x + nx / nl * side * (edge + 0.12), z: p.z + nz / nl * side * (edge + 0.12) };
        });
        this._strokeMitered(curbPts, 0.36, 0.10, curbMat, ch.closed);
      }
    }
    // Ambient spawn points along every road every ~55m
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
    out.push({ x: ax + ddx / dl * (s - acc), z: az + ddz / dl * (s - acc) });
    for (let i = i0 + 1; i < L; i++) out.push(pts[i]);
    let rem = e;
    while (out.length > 1) {
      const last = out[out.length - 1], prev = out[out.length - 2];
      const l = Math.hypot(last.x - prev.x, last.z - prev.z);
      if (l <= rem) { out.pop(); rem -= l; }
      else {
        const f = 1 - rem / l;
        out[out.length - 1] = { x: prev.x + (last.x - prev.x) * f, z: prev.z + (last.z - prev.z) * f };
        break;
      }
    }
    return out;
  }

  // Place road.glb model clones along a polyline, adding thin road collision
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
      left.push({ x: p.x + mx * hw, z: p.z + mz * hw });
      right.push({ x: p.x - mx * hw, z: p.z - mz * hw });
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
    if (this.grid) {
      const near = this.grid.queryPoint(x, z, r + 0.05);
      for (const c of near) {
        if (c.max.y < 0.3) continue;
        if (x + r > c.min.x && x - r < c.max.x && z + r > c.min.z && z - r < c.max.z) return true;
      }
      return false;
    }
    r += 0.05;
    for (const c of this.colliders) {
      if (c.max.y < 0.3) continue;
      if (x + r > c.min.x && x - r < c.max.x && z + r > c.min.z && z - r < c.max.z) return true;
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