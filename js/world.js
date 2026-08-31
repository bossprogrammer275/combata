// World: 4000x4000m organic city — Mega-City Core, Abandoned Docks, Overgrown Perimeter.
// Curved Bezier roads, random-angle intersections, asymmetrical buildings. No grid.
import * as THREE from 'three';
import * as TEX from './textures.js';
import { installAssets } from '../assets/loader.js';
import { SpatialGrid } from './spatial-grid.js';

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
    this.coverPoints = [];   // positions bots can fight from
    this.spawnPoints = [];   // where waves spawn
    this.lootPoints = [];    // {x,z} lootable crates
    this.namedLocations = []; // {x,z,name,color} labelled landmarks
    this.transitPoints = [];  // {x,z,name} fast-travel destinations
    this.roofAccess = [];     // {x,z,y,rx,rz} walkable rooftops
    this.reactiveObjects = []; // {mesh, kind, base, sway, ...}
    this.vehicleSpawns = [];  // {x,z,ry,kind} parked/drivable vehicles
    this.bounds = sceneData && sceneData.bounds ? sceneData.bounds : (quality === 'ultra-low' ? 1000 : 2000);
    this._quality = quality;
    this.group = new THREE.Group();
    scene.add(this.group);
    this._branches = [];
    this._leaves = [];
    this._roadNodes = [];
    this._roadSegments = [];
    this._boxBatch = [];     // {x,y,z,w,h,d,ry,mat,shadow} — static boxes to batch
    this._planeBatch = [];   // {x,y,z,rw,rh,rz,mat,w,h,shadow} — static planes to batch
    this._ribbonBatch = [];  // {left[], right[], y, mat, closed} — mitered road/sidewalk ribbons
    this._trimBatch = [];    // {x,y,z,w,h,d,ry,mat} — AO base skirts + roofline lips

    this.buildLighting(quality);
    this.buildSky();
    this.buildGround(sceneData && sceneData.ground);
    this.startPoint = { x: 0, z: 40, yaw: Math.PI };
    if (sceneData) {
      this.buildFromScene(sceneData);
    } else {
      this.buildCity();
      if (quality !== 'ultra-low') this.buildZones();
    }
    this._finishSpawnPoints();
    if (quality !== 'ultra-low') this._finalizeFoliage(quality);
    this._flushGeometry();
    this.grid = new SpatialGrid(12);
    for (const c of this.colliders) this.grid.insert(c);
  }

  _finalizeFoliage(quality) {
    const trunkMat = this.mTrunk();
    const leafMats = [
      new THREE.MeshStandardMaterial({ color: 0x2e6628, roughness: 0.85, metalness: 0.05, flatShading: false }),
      new THREE.MeshStandardMaterial({ color: 0x3d7e32, roughness: 0.85, metalness: 0.05, flatShading: false }),
      new THREE.MeshStandardMaterial({ color: 0x245520, roughness: 0.90, metalness: 0.05, flatShading: false }),
    ];
    if (this._branches.length) {
      const g = new THREE.CylinderGeometry(1, 1, 1, 10);
      const im = new THREE.InstancedMesh(g, trunkMat, this._branches.length);
      im.castShadow = quality !== 'low';
      im.receiveShadow = quality !== 'low';
      im.frustumCulled = true;
      const m = new THREE.Matrix4();
      for (let i = 0; i < this._branches.length; i++) {
        const b = this._branches[i];
        m.compose(new THREE.Vector3(b.pos[0], b.pos[1], b.pos[2]),
                  new THREE.Quaternion(b.quat[0], b.quat[1], b.quat[2], b.quat[3]),
                  new THREE.Vector3(b.scale[0], b.scale[1], b.scale[2]));
        im.setMatrixAt(i, m);
      }
      im.instanceMatrix.needsUpdate = true;
      this.group.add(im);
    }
    if (this._leaves.length) {
      const g = new THREE.SphereGeometry(1, 14, 10);
      const buckets = [[], [], []];
      for (const l of this._leaves) buckets[l.color[0] % 3].push(l);
      for (let bi = 0; bi < 3; bi++) {
        const arr = buckets[bi]; if (!arr.length) continue;
        const im = new THREE.InstancedMesh(g, leafMats[bi], arr.length);
        im.castShadow = quality !== 'low'; im.receiveShadow = quality !== 'low';
        const m = new THREE.Matrix4();
        for (let i = 0; i < arr.length; i++) {
          const l = arr[i];
          m.compose(new THREE.Vector3(l.pos[0], l.pos[1], l.pos[2]),
                    new THREE.Quaternion(), new THREE.Vector3(l.scale[0], l.scale[1], l.scale[2]));
          im.setMatrixAt(i, m);
        }
        im.instanceMatrix.needsUpdate = true;
        this.group.add(im);
      }
    }
    this._branches = null; this._leaves = null;
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
  mRoad() { return this._mat('road', () => new THREE.MeshStandardMaterial({ map: TEX.makeRoadTexture(), roughness: .95, metalness: 0 })); }
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
  addCollider(x, y, z, w, h, d, climb = false) {
    const c = { min: new THREE.Vector3(x - w / 2, y, z - d / 2), max: new THREE.Vector3(x + w / 2, y + h, z + d / 2) };
    if (climb) this.climbables.push(c); else this.colliders.push(c);
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
        const mesh = new THREE.Mesh(geo, mat);
        mesh.receiveShadow = true;
        mesh.frustumCulled = false;
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
          if (this.grid) this.grid.remove(o.col);
          const j = this.climbables.indexOf(o.col);
          if (j >= 0) this.climbables.splice(j, 1);
        }
      }
    }
  }

  // ===== LIGHTING & SKY =====
  buildLighting(quality) {
    const sun = new THREE.DirectionalLight(0xfff1dd, quality === 'ultra-low' ? 1.8 : 2.6);
    sun.position.set(200, 180, 80);
    sun.castShadow = quality !== 'low' && quality !== 'ultra-low';
    if (sun.castShadow) {
      sun.shadow.mapSize.setScalar(quality === 'high' ? 4096 : 2048);
      const S = quality === 'high' ? 300 : 150;
      Object.assign(sun.shadow.camera, { left: -S, right: S, top: S, bottom: -S, near: 10, far: 600 });
      sun.shadow.bias = -0.001; sun.shadow.normalBias = 0.02;
    }
    this.sun = sun;
    this.scene.add(sun);
    this.scene.add(new THREE.HemisphereLight(0xcfe3ff, 0x5a5c50, 0.9));
    const fill = new THREE.DirectionalLight(0xa8bfd8, quality === 'ultra-low' ? 0.35 : 0.5);
    fill.position.set(-60, 20, -80);
    this.scene.add(fill);
    this.scene.fog = new THREE.FogExp2(0x9aa3ac, quality === 'ultra-low' ? 0.006 : 0.0026);
  }

  buildSky() {
    if (this._quality === 'ultra-low') { this.scene.background = new THREE.Color(0x5a6a78); return; }
    const sky = TEX.makeSkyTexture();
    this.scene.background = sky;
    this.scene.backgroundIntensity = 1.0;
    this.scene.environment = sky;
    this.scene.environmentIntensity = 0.45;
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
    this._placeBuildingsAlongRoads();
    this._placeInfillBuildings();
    this._placeDedicatedForest();
    this._addZoneSpecificContent();
    // Spawn points at road nodes + mid-segment points
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
    this._autoStreetProps();
  }

  // ===== AUTHORED SCENE (map JSON) =====
  // Builds the world from a handcrafted scene file (data/worlds/*.json).
  // The map editor writes the same format. Everything is explicit — no RNG placement.
  buildFromScene(sd) {
    if (sd.startPoint) {
      this.startPoint = {
        x: sd.startPoint.x || 0,
        z: sd.startPoint.z || 40,
        yaw: sd.startPoint.yaw != null ? sd.startPoint.yaw : Math.PI,
      };
    }
    if (sd.roads) this._buildAuthoredRoads(sd.roads);
    if (sd.pads) for (const p of sd.pads) this._authoredPad(p);
    if (sd.buildings) for (const b of sd.buildings) this._authoredBuilding(b);
    if (sd.props) for (const p of sd.props) this._authoredProp(p);
    if (sd.trees) for (const t of sd.trees) this.tree(t.x, t.z, t.s != null ? t.s : 1, !!t.dead);
    if (sd.landmarks) for (const lm of sd.landmarks) this._authoredLandmark(lm);
    if (sd.spawns) for (const sp of sd.spawns) this.spawnPoints.push(new THREE.Vector3(sp[0], 0, sp[1]));
    if (sd.cover) for (const c of sd.cover) this.coverPoints.push(new THREE.Vector3(c[0], 0, c[1]));
    if (sd.transit) for (const t of sd.transit) this.transitPoints.push({ x: t.x, z: t.z, name: t.name });
    if (sd.named) for (const n of sd.named) this.namedLocations.push({ x: n.x, z: n.z, name: n.name, color: n.color || '#ffd24a' });
    if (sd.interiors) for (const v of sd.interiors) {
      const c = Math.abs(Math.cos(v.ry || 0)), s = Math.abs(Math.sin(v.ry || 0));
      const ex = (v.w / 2) * c + (v.d / 2) * s, ez = (v.w / 2) * s + (v.d / 2) * c;
      this.addInterior(new THREE.Vector3(v.x - ex, 0, v.z - ez), new THREE.Vector3(v.x + ex, v.h || 4, v.z + ez));
    }
    if (sd.roofs) for (const r of sd.roofs) this.addRoof(r.x, r.z, r.y, r.rx, r.rz);
    if (sd.reactives) for (const rc of sd.reactives) this._authoredReactive(rc);
    if (sd.vehicles) for (const v of sd.vehicles) this.vehicleSpawns.push({ x: v.x, z: v.z, ry: v.ry || 0, kind: v.kind || 'car' });
    if (sd.buildings) for (const b of sd.buildings) if (b._overlays && b._overlays.length) this._renderOverlays(b._overlays, b.x, b.z, b.ry || 0, b.w || 12, b.h || 4, b.d || 12);
    if (sd.landmarks) for (const lm of sd.landmarks) if (lm._overlays && lm._overlays.length) { const ls = this._landmarkSize(lm); this._renderOverlays(lm._overlays, lm.x, lm.z, lm.ry || 0, ls[0], ls[1], ls[2]); }
    this._dedupeNamed();
    const tSeen = new Map();
    for (const t of this.transitPoints) tSeen.set(t.name, t);
    this.transitPoints = [...tSeen.values()];
    if (sd.streetProps === true) this._autoStreetProps();
  }

  _dedupeNamed() {
    const seen = new Map();
    for (const n of this.namedLocations) seen.set(n.name, n);
    this.namedLocations = [...seen.values()];
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
  _buildAuthoredRoads(roads) {
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
    // Pass 1 — collect raw chains (no corner softening; mitering handles joints)
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
    // Pass 2 — trim open-chain endpoints that terminate inside another road (T-junctions),
    // so each strip ends flush at the other road's edge (no overlapping geometry).
    for (const ch of chains) {
      ch.cutStart = 0; ch.cutEnd = 0;
      if (ch.closed || ch.pts.length < 2) continue;
      const n = ch.pts.length;
      const sDir = { x: ch.pts[1].x - ch.pts[0].x, z: ch.pts[1].z - ch.pts[0].z };
      const eDir = { x: ch.pts[n - 1].x - ch.pts[n - 2].x, z: ch.pts[n - 1].z - ch.pts[n - 2].z };
      for (const other of chains) {
        if (other === ch) continue;
        // end-to-end junction? (both roads stop at ~the same point) -> leave both uncut
        const sNear = this._nearAnyEnd(ch.pts[0], other);
        const eNear = this._nearAnyEnd(ch.pts[n - 1], other);
        for (let i = 0; i < other.pts.length - 1; i++) {
          const a = other.pts[i], b = other.pts[i + 1];
          if (!sNear) ch.cutStart = Math.max(ch.cutStart, this._tCut(ch.pts[0], sDir, a, b, other.W, ch.W));
          if (!eNear) ch.cutEnd = Math.max(ch.cutEnd, this._tCut(ch.pts[n - 1], eDir, a, b, other.W, ch.W));
        }
      }
    }
    // Pass 3 — geometry
    for (let ci = 0; ci < chains.length; ci++) {
      const ch = chains[ci];
      const roadY = 0.04 + (ci % 4) * 0.015;
      const walkY = 0.12 + (ci % 4) * 0.004;
      const pts = ch.closed ? ch.pts : this._trimChain(ch.pts, ch.cutStart, ch.cutEnd);
      if (pts.length < 2) continue;
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
      // single continuous curb ribbon along both road edges (no scattered boxes)
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
      const ux0 = p.x - prev.x, uz0 = p.z - prev.z;
      const vx0 = next.x - p.x, vz0 = next.z - p.z;
      const l1 = Math.hypot(ux0, uz0), l2 = Math.hypot(vx0, vz0);
      if (!l1 || !l2) { left.push({ x: p.x, z: p.z }); right.push({ x: p.x, z: p.z }); continue; }
      const ux = ux0 / l1, uz = uz0 / l1, vx = vx0 / l2, vz = vz0 / l2;
      const nux = -uz, nuz = ux, nvx = -vz, nvz = vz;
      let mx, mz;
      if (!closed && (i === 0 || i === L - 1)) {
        mx = (i === 0) ? nux : nvx; mz = (i === 0) ? nuz : nvz;
      } else {
        const dot = nux * nvx + nuz * nvz;
        let denom = 1 + dot;
        if (denom < 0.3) denom = 0.3;
        mx = (nux + nvx) / denom; mz = (nuz + nvz) / denom;
        const ml = Math.hypot(mx, mz);
        if (ml > 1.25) { mx = mx / ml * 1.25; mz = mz / ml * 1.25; }
      }
      left.push({ x: p.x + mx * hw, z: p.z + mz * hw });
      right.push({ x: p.x - mx * hw, z: p.z - mz * hw });
    }
    this._ribbonBatch.push({ left, right, y, mat, closed });
  }

  // Scatter street furniture / trees along recorded road chains (after buildings are placed).
  _autoStreetProps() {
    if (this._quality === 'ultra-low') return;
    const chains = this._roadChains || [];
    if (!chains.length) return;
    const step = 22, chance = 0.6;
    for (const ch of chains) {
      let side = 1;
      let carry = 0;
      for (let i = 0; i < ch.pts.length - 1; i++) {
        const a = ch.pts[i], b = ch.pts[i + 1];
        const len = Math.hypot(b.x - a.x, b.z - a.z);
        const ux = (b.x - a.x) / len, uz = (b.z - a.z) / len;
        const nx = -uz, nz = ux;
        let t = -carry;
        while (t + step <= len) {
          t += step;
          side *= -1;
          if (Math.random() > chance) continue;
          const off = ch.W / 2 + 1.7;
          const px = a.x + ux * t + nx * side * off;
          const pz = a.z + uz * t + nz * side * off;
          if (Math.hypot(px, pz) > this.bounds - 8) continue;
          const ry = Math.atan2(nx, nz) + (side > 0 ? 0 : Math.PI);
          const roll = Math.random();
          if (roll < 0.38) this.tree(px, pz, 0.7 + Math.random() * 0.9, false);
          else if (roll < 0.5) this._authoredProp({ kind: 'bench', x: px, z: pz, ry });
          else if (roll < 0.6) this._authoredProp({ kind: 'hydrant', x: px, z: pz, ry });
          else if (roll < 0.7) this._authoredProp({ kind: 'trashcan', x: px, z: pz, ry });
          else if (roll < 0.78) this._authoredProp({ kind: 'mailbox', x: px, z: pz, ry });
          else if (roll < 0.86) this._authoredProp({ kind: 'busstop', x: px, z: pz, ry });
          else if (roll < 0.93) this._authoredProp({ kind: 'bollard', x: px, z: pz, ry });
          else if (roll < 0.96) this._authoredProp({ kind: 'crate', x: px, z: pz, ry });
          else if (roll < 0.98) this._authoredProp({ kind: 'barrels', x: px, z: pz, ry, react: 'firex' });
          else this._authoredProp({ kind: 'planter', x: px, z: pz, ry });
        }
        carry = t + step - len;
      }
    }
  }

  _authoredPad(p) {
      this._planeBatch.push({ x: p.x, y: 0.03, z: p.z, rx: -Math.PI / 2, ry: 0, rz: -(p.ry || 0), mat: this._sceneMat(p.m || 'plaza'), w: p.w, h: p.d });
  }

  _landmarkSize(lm) {
    const sz = { fuel:[6,7,6], port:[21,15,15], trainstation:[25,13,13], warehouse:[34,9,22], mosque:[16,8,14], mall:[40,8.5,20], stadium:[82,4,57], firestation:[18,6,14], policestation:[14,6,12], nightclub:[18,8,16] }[lm.kind] || [8,4,8];
    return sz;
  }

  _renderOverlays(overlays, x, z, ry, w, h, d) {
    if (this._quality === 'ultra-low' || this._quality === 'low') return;
    const cs = Math.cos(ry), sn = Math.sin(ry);
    for (const ov of overlays) {
      const faceSide = ov.face === 'back' ? -1 : 1;
      const faceAxis = ov.face === 'left' || ov.face === 'right' ? 'x' : 'z';
      let localX = ov.offX || 0, localZ = ov.offZ || 0;
      let faceY = h * 0.6;
      let faceRot = ry;
      if (faceAxis === 'x') {
        const side = ov.face === 'right' ? 1 : -1;
        const wx = x + (w / 2 + 0.08) * side * Math.cos(ry) + localX * Math.cos(ry);
        const wz = z + (w / 2 + 0.08) * side * Math.sin(ry) + localX * Math.sin(ry);
        const tw = Math.max(1.5, ov.text.length * 0.55);
        const th = Math.max(0.8, (ov.fontSize || 14) * 0.06);
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(64, tw * 48); canvas.height = Math.max(32, th * 48);
        const cx = canvas.getContext('2d');
        cx.clearRect(0, 0, canvas.width, canvas.height);
        if (ov.stroke !== false) { cx.strokeStyle = '#000000'; cx.lineWidth = 4; cx.lineJoin = 'round'; cx.font = `bold ${canvas.height * 0.65}px ${ov.font || 'Arial'}`; cx.textAlign = 'center'; cx.textBaseline = 'middle'; cx.strokeText(ov.text, canvas.width/2, canvas.height/2); }
        cx.fillStyle = ov.color || '#ffffff'; cx.font = `bold ${canvas.height * 0.65}px ${ov.font || 'Arial'}`; cx.textAlign = 'center'; cx.textBaseline = 'middle'; cx.fillText(ov.text, canvas.width/2, canvas.height/2);
        const tex = new THREE.CanvasTexture(canvas); tex.minFilter = THREE.LinearFilter;
        const mat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, side: THREE.DoubleSide, roughness: .8, depthWrite: false });
        const m = new THREE.Mesh(new THREE.PlaneGeometry(tw, th), mat);
        m.position.set(wx, faceY + (localZ * 0.05), wz);
        m.rotation.y = ry + Math.PI / 2;
        this.group.add(m);
      } else {
        const side = ov.face === 'back' ? -1 : 1;
        const wx = x + localX * Math.cos(ry);
        const wz = z + (d / 2 + 0.08) * side * Math.cos(ry) + localX * Math.sin(ry) * side;
        const tw = Math.max(1.5, ov.text.length * 0.55);
        const th = Math.max(0.8, (ov.fontSize || 14) * 0.06);
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(64, tw * 48); canvas.height = Math.max(32, th * 48);
        const cx = canvas.getContext('2d');
        cx.clearRect(0, 0, canvas.width, canvas.height);
        if (ov.stroke !== false) { cx.strokeStyle = '#000000'; cx.lineWidth = 4; cx.lineJoin = 'round'; cx.font = `bold ${canvas.height * 0.65}px ${ov.font || 'Arial'}`; cx.textAlign = 'center'; cx.textBaseline = 'middle'; cx.strokeText(ov.text, canvas.width/2, canvas.height/2); }
        cx.fillStyle = ov.color || '#ffffff'; cx.font = `bold ${canvas.height * 0.65}px ${ov.font || 'Arial'}`; cx.textAlign = 'center'; cx.textBaseline = 'middle'; cx.fillText(ov.text, canvas.width/2, canvas.height/2);
        const tex = new THREE.CanvasTexture(canvas); tex.minFilter = THREE.LinearFilter;
        const mat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, side: THREE.DoubleSide, roughness: .8, depthWrite: false });
        const m = new THREE.Mesh(new THREE.PlaneGeometry(tw, th), mat);
        m.position.set(wx, faceY, z + (d / 2 + 0.08) * side + localZ * 0.05);
        m.rotation.y = ry + (side > 0 ? 0 : Math.PI);
        this.group.add(m);
      }
    }
  }

  _sceneWindows(x, z, w, h, d, ry, faces, style, opts = {}) {
    if (this._quality === 'low' || this._quality === 'ultra-low') return;
    this._applyFacade(x, z, w, h, d, ry, faces, style, opts.seed || 1);
    if (opts.door) this._facadeDoor(x, z, w, d, ry, opts.door.w || 1.2, opts.door.mat);
  }

  // Wall with a full window grid baked into a facade texture, one plane per face.
  _applyFacade(x, z, w, h, d, ry, faces, style, seed = 1, yBase = 0) {
    if (this._quality === 'ultra-low') return;
    const cs = Math.cos(ry), sn = Math.sin(ry);
    const l2w = (lx, lz) => ({ x: x + lx * cs + lz * sn, z: z - lx * sn + lz * cs });
    const off = 0.04;
    let fi = 0;
    for (const f of faces) {
      const fw = (f === 'x' || f === '-x') ? d : w;
      let pos, rot;
      // rotation.y=ry maps local +Z -> (sin ry, cos ry); each face's plane
      // must face outward: z->ry, -z->ry+pi, x->ry+pi/2, -x->ry-pi/2.
      if (f === 'z') { pos = l2w(0, d / 2 + off); rot = ry; }
      else if (f === '-z') { pos = l2w(0, -d / 2 - off); rot = ry + Math.PI; }
      else if (f === 'x') { pos = l2w(w / 2 + off, 0); rot = ry + Math.PI / 2; }
      else { pos = l2w(-w / 2 - off, 0); rot = ry - Math.PI / 2; }
      const seedI = (Math.abs(x) * 7 + Math.abs(z) * 13 + f.charCodeAt(0) * 37 + seed * 131) | 0;
      const tex = TEX.makeFacadeTexture(fw, h, style, seedI);
      const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: .92 });
      const m = new THREE.Mesh(new THREE.PlaneGeometry(fw + 0.04, h + 0.04), mat);
      m.position.set(pos.x, yBase + h / 2, pos.z);
      m.rotation.y = rot;
      m.receiveShadow = true;
      this.group.add(m);
      fi++;
    }
  }

  // Solid door leaf mounted proud of the +Z face of a building.
  _facadeDoor(x, z, w, d, ry, doorW, mat, offX = 0) {
    const cs = Math.cos(ry), sn = Math.sin(ry);
    const nx = sn, nz = cs;
    const px = x + nx * (d / 2 + 0.05) + offX * cs, pz = z + nz * (d / 2 + 0.05) - offX * sn;
    const dw = Math.max(1.6, Math.min(doorW * 0.7, 2.4));
    const dh = 3.0;
    // door frame surround (dark trim around the opening)
    this.box(px, 0, pz, dw + 0.3, dh + 0.2, 0.15, this.mDoor([60, 42, 30]), false, ry);
    // door leaf
    this.box(px, 0, pz, dw, dh, 0.12, mat || this.mDoor(), false, ry);
    // door handle
    const hx = px + 0.3 * cs, hz = pz - 0.3 * sn;
    this.box(hx, dh * 0.45, hz, 0.06, 0.2, 0.06, this.mMetal(), false, ry);
    return { x: px, z: pz };
  }

  // Roof details: AC units, vents, water tank — small solid blocks on the roof.
  // `topY` must be the y of the ROOF TOP surface (wall height + slab thickness).
  roofProps(x, z, ry, w, d, topY, mat) {
    if (this._quality === 'low' || this._quality === 'ultra-low') return;
    const cs = Math.cos(ry), sn = Math.sin(ry);
    const l2w = (lx, lz) => ({ x: x + lx * cs + lz * sn, z: z - lx * sn + lz * cs });
    const unitMat = mat || this.mMetal();
    const ventMat = this.mConcrete([160, 158, 154]);
    const spots = [[-w * 0.32, -d * 0.3], [w * 0.3, -d * 0.34], [-w * 0.26, d * 0.32]];
    spots.forEach(([lx, lz], i) => {
      const p = l2w(lx, lz);
      const s = 1.1 + Math.random() * 0.9;
      this.box(p.x, topY + 0.03, p.z, s, s * 0.62, s, i === 1 ? ventMat : unitMat, false, ry);
    });
    const tp = l2w(w * 0.3, d * 0.3);
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.05, 1.7, 24), this.mMetal());
    tank.position.set(tp.x, topY + 0.03 + 0.85, tp.z);
    tank.castShadow = true;
    this.group.add(tank);
    // parapet cap ring
    const capMat = this.mConcrete([168, 166, 162]);
    this.box(x, topY + 0.02, z, w + 0.9, 0.14, d + 0.9, capMat, false, ry);
  }

  // Foundation plinth + AO dark band at the ground seam, plus a roofline lip on
  // flat-roofed massing. Both are cheap batched boxes that break up the
  // "bare box floating on ground" silhouette.
  _baseTrim(x, z, w, d, ry, h, opts = {}) {
    if (this._quality === 'ultra-low') return;
    const band = Math.min(0.45, 0.14 + h * 0.09);
    this._trimBatch.push({ x, y: 0.02, z, w: w + 0.22, h: band, d: d + 0.22, ry, mat: this.mTrimAO() });
    if (opts.lip && this._quality !== 'low') {
      // sits on top of the roof slab (slab spans h..h+0.35)
      this._trimBatch.push({ x, y: h + 0.36, z, w: w + 0.6, h: 0.2, d: d + 0.6, ry, mat: this.mTrimLip() });
    }
  }

  // Real buildings are never clean boxes: attach a seeded imperfection —
  // wall AC unit, corner downspout, or rooftop antenna.
  _buildingImperfections(x, z, w, d, ry, h, seed) {
    if (this._quality === 'low' || this._quality === 'ultra-low') return;
    const rnd = mulberry(seed + (x * 13 + z * 7) | 0);
    const cs = Math.cos(ry), sn = Math.sin(ry);
    const l2w = (lx, lz) => ({ x: x + lx * cs + lz * sn, z: z - lx * sn + lz * cs });
    const roll = rnd();
    if (roll < 0.3) {
      // wall-mounted AC unit on the front face
      const p = l2w((rnd() - .5) * w * 0.5, (d / 2) * (rnd() < .5 ? 1 : -1));
      const acMat = this.mMetal();
      this.box(p.x, 1.6 + rnd() * 1.2, p.z, 1.1, .7, .5, acMat, false, ry);
    } else if (roll < 0.6) {
      // corner downspout running the full wall height
      const corner = [rnd() < .5 ? -w / 2 : w / 2, rnd() < .5 ? -d / 2 : d / 2];
      const cp = l2w(corner[0], corner[1]);
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(.05, .05, Math.max(.5, h - .6), 8), this.mMetal());
      pipe.position.set(cp.x, Math.max(.5, h - .6) / 2, cp.z);
      pipe.castShadow = true;
      this.group.add(pipe);
    } else if (roll < 0.8) {
      // rooftop antenna mast
      const ap = l2w((rnd() - .5) * w * 0.4, (rnd() - .5) * d * 0.4);
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(.04, .05, 3.2, 8), this.mMetal());
      mast.position.set(ap.x, h + 1.6, ap.z);
      mast.castShadow = true;
      this.group.add(mast);
      const cross = new THREE.Mesh(new THREE.BoxGeometry(1.2, .06, .06), this.mMetal());
      cross.position.set(ap.x, h + 2.4, ap.z);
      this.group.add(cross);
    }
  }





  // ---- BEZIER ROAD NETWORK ----
  _generateRoadNetwork() {
    const nodes = [];
    const ultra = this._quality === 'ultra-low';
    // Core city: dense curved grid within ~700m
    const coreAnchors = [];
    const coreR = 700;
    const coreNodeCount = ultra ? 20 : 60;
    for (let i = 0; i < coreNodeCount; i++) {
      // Jittered positions within the core circle
      const a = rng(0, Math.PI * 2);
      const r = rng(0, coreR);
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      // Add jitter
      const jx = x + rng(-30, 30);
      const jz = z + rng(-30, 30);
      // Avoid duplicating nearby nodes
      let tooClose = false;
      for (const n of nodes) {
        if (Math.hypot(n.x - jx, n.z - jz) < 50) { tooClose = true; break; }
      }
      if (tooClose) continue;
      nodes.push({ x: jx, z: jz, connections: [] });
      coreAnchors.push(nodes.length - 1);
    }
    // Docks zone: sparser nodes in SE quadrant
    const dockCount = ultra ? 8 : 25;
    for (let i = 0; i < dockCount; i++) {
      const x = rng(400, 1200);
      const z = rng(200, 1100);
      let tooClose = false;
      for (const n of nodes) {
        if (Math.hypot(n.x - x, n.z - z) < 80) { tooClose = true; break; }
      }
      if (tooClose) continue;
      nodes.push({ x, z, connections: [] });
    }
    // Perimeter: sparse nodes around the edges
    const perimCount = ultra ? 10 : 30;
    for (let i = 0; i < perimCount; i++) {
      const a = rng(0, Math.PI * 2);
      const r = rng(900, 1700);
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      let tooClose = false;
      for (const n of nodes) {
        if (Math.hypot(n.x - x, n.z - z) < 150) { tooClose = true; break; }
      }
      if (tooClose) continue;
      nodes.push({ x, z, connections: [] });
    }

    // Connect each node to 2-5 nearest neighbors within threshold distance
    const connectThreshold = 500;
    for (let i = 0; i < nodes.length; i++) {
      const dists = [];
      for (let j = 0; j < nodes.length; j++) {
        if (i === j) continue;
        const d = Math.hypot(nodes[i].x - nodes[j].x, nodes[i].z - nodes[j].z);
        if (d < connectThreshold) dists.push({ idx: j, d });
      }
      dists.sort((a, b) => a.d - b.d);
      const maxConn = 3 + Math.floor(Math.random() * 3);
      let connCount = 0;
      for (const nd of dists) {
        if (connCount >= maxConn) break;
        // Avoid duplicate connections
        if (nodes[i].connections.includes(nd.idx)) continue;
        // Also check if this would cross existing connections too sharply (organic feel)
        nodes[i].connections.push(nd.idx);
        nodes[nd.idx].connections.push(i);
        connCount++;
      }
    }
    // Cull 20% of connections randomly for organic irregularity
    for (const n of nodes) {
      const keep = [];
      for (const c of n.connections) {
        if (Math.random() > 0.2) keep.push(c);
      }
      n.connections = keep;
    }

    this._roadNodes = nodes;

    // Build segments from connections (avoid duplicates)
    const seen = new Set();
    const segments = [];
    for (let i = 0; i < nodes.length; i++) {
      for (const j of nodes[i].connections) {
        const key = i < j ? i + ',' + j : j + ',' + i;
        if (seen.has(key)) continue;
        seen.add(key);
        // Control point offset perpendicular to the segment direction for curvature
        const dx = nodes[j].x - nodes[i].x;
        const dz = nodes[j].z - nodes[i].z;
        const len = Math.hypot(dx, dz);
        const perpX = -dz / len;
        const perpZ = dx / len;
        const curveAmount = rng(0.15, 0.45) * len;
        const side = Math.random() < 0.5 ? 1 : -1;
        // Control point at midpoint + perpendicular offset
        const mx = (nodes[i].x + nodes[j].x) / 2 + perpX * curveAmount * side;
        const mz = (nodes[i].z + nodes[j].z) / 2 + perpZ * curveAmount * side;
        segments.push({ n1: i, n2: j, cx: mx, cz: mz, len });
      }
    }
    // Mark 30% of terminal nodes as cul-de-sacs (nodes with only 1 connection)
    for (const n of nodes) {
      if (n.connections.length === 1 && Math.random() < 0.3) {
        n._culdesac = true;
      }
    }
    this._roadSegments = segments;
  }

  _buildRoadMeshes() {
    const roadMat = this.mRoad();
    const walkMat = this.mSidewalk();
    const curbMat = this.mCurb();
    const RW = 12;
    const nodes = this._roadNodes;
    for (const seg of this._roadSegments) {
      const n1 = nodes[seg.n1], n2 = nodes[seg.n2];
      const pts = [];
      for (let i = 0; i <= 12; i++) {
        const t = i / 12;
        const p = bezier2(n1, n2, { x: seg.cx, z: seg.cz }, t);
        pts.push(p);
      }
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        const dx = b.x - a.x, dz = b.z - a.z;
        const len = Math.hypot(dx, dz);
        if (len < 0.5) continue;
        const angle = Math.atan2(-(b.z - a.z), b.x - a.x);
        const midX = (a.x + b.x) / 2, midZ = (a.z + b.z) / 2;
        this._planeBatch.push({ x: midX, y: 0.04, z: midZ, rx: -Math.PI / 2, ry: 0, rz: -angle, mat: roadMat, w: RW, h: len });
        for (const side of [-1, 1]) {
          const sOff = (RW / 2 + 1.2) * side;
          const sx = midX + Math.cos(angle + Math.PI / 2) * sOff;
          const sz = midZ + Math.sin(angle + Math.PI / 2) * sOff;
          this._planeBatch.push({ x: sx, y: 0.05, z: sz, rx: -Math.PI / 2, ry: 0, rz: -angle, mat: walkMat, w: 2.4, h: len });
        }
        for (const side of [-1, 1]) {
          const cOff = (RW / 2 + 0.16) * side;
          const cx = midX + Math.cos(angle + Math.PI / 2) * cOff;
          const cz = midZ + Math.sin(angle + Math.PI / 2) * cOff;
          this._boxBatch.push({ x: cx, y: 0.08, z: cz, w: 0.32, h: 0.16, d: len, ry: angle, mat: curbMat, shadow: true });
        }
      }
    }
    for (const n of nodes) {
      if (n._culdesac) {
        this._planeBatch.push({ x: n.x, y: 0.04, z: n.z, rx: -Math.PI / 2, ry: 0, rz: 0, mat: roadMat, w: 16, h: 16 });
        this.climbBox(n.x + rng(-2, 2), 0, n.z + rng(-2, 2), 1.4, 1.2, 1.4, this.mCrate(), Math.random() * Math.PI, 'fire');
      }
    }
  }

  // ---- BUILDING PLACEMENT ALONG ROADS ----
  _placeBuildingsAlongRoads() {
    const nodes = this._roadNodes;
    // For each road segment, place buildings on both sides
    const placed = []; // {x,z} to prevent overlapping

    const isOccupied = (x, z, margin) => {
      for (const p of placed) {
        if (Math.hypot(p.x - x, p.z - z) < margin) return true;
      }
      return false;
    };

    const coreThreshold = (x, z) => Math.hypot(x, z) < 750;
    const dockThreshold = (x, z) => x > 400 && z > 200 && x < 1200 && z < 1100;

    const stepSize = this._quality === 'ultra-low' ? 60 : this._quality === 'low' ? 40 : 25;
    for (const seg of this._roadSegments) {
      const n1 = nodes[seg.n1], n2 = nodes[seg.n2];
      const steps = Math.max(1, Math.floor(seg.len / stepSize));
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const p = bezier2(n1, n2, { x: seg.cx, z: seg.cz }, t);
        // Tangent direction at this point
        const dt = 0.01;
        const p2 = bezier2(n1, n2, { x: seg.cx, z: seg.cz }, Math.min(t + dt, 1));
        const dx = p2.x - p.x, dz = p2.z - p.z;
        const ang = Math.atan2(dx, dz);
        // Perpendicular directions (both sides of road)
        for (const side of [-1, 1]) {
          const perpAng = ang + Math.PI / 2 * side;
          const distFromRoad = rng(4, 10);
          const bx = p.x + Math.cos(perpAng) * distFromRoad;
          const bz = p.z + Math.sin(perpAng) * distFromRoad;
          // Skip if outside bounds
          if (Math.hypot(bx, bz) > this.bounds - 16) continue;
          // Skip if too close to another building
          if (isOccupied(bx, bz, 14)) continue;
          // Skip some fraction randomly for open space (more in perimeter)
          const inCore = coreThreshold(bx, bz);
          const inDocks = dockThreshold(bx, bz);
          const baseSparsity = this._quality === 'ultra-low' ? 0.6 : this._quality === 'low' ? 0.3 : 0;
          const sparsity = inCore ? 0.08 + baseSparsity : inDocks ? 0.15 + baseSparsity : 0.3 + baseSparsity;
          if (Math.random() < sparsity) continue;

          placed.push({ x: bx, z: bz });

          // Building rotation: roughly parallel to road + 5-45° random
          const bRot = ang + rng(-0.3, 0.3);

          if (inCore) {
            this._placeCoreBuilding(bx, bz, bRot, seg.len);
          } else if (inDocks) {
            this._placeDockBuilding(bx, bz, bRot);
          } else {
            this._placePerimeterBuilding(bx, bz, bRot);
          }
        }
      }
    }
  }

  _placeCoreBuilding(x, z, ry, roadLen) {
    const ultra = this._quality === 'ultra-low';
    // Mega-City Core: highrises, apartments, shops, houses, public buildings
    const roll = Math.random();
    if (roll < 0.28) {
      // Highrise: 2-6 floors, wider near center
      const dist = Math.hypot(x, z);
      const floors = ultra ? 1 + Math.floor(rng(0, 1)) : dist < 300 ? 3 + Math.floor(rng(0, 4)) : 2 + Math.floor(rng(0, 3));
      const w = rng(12, 18);
      const d = rng(12, 18);
      this.highrise(x, z, ry, floors, w, d, 0, true);
    } else if (!ultra && roll < 0.46) {
      // Apartment block with balconies
      const w = rng(16, 26);
      const d = rng(12, 16);
      this.apartment(x, z, ry, w, d, 2 + Math.floor(rng(0, 4)), true, 3);
    } else if (!ultra && roll < 0.60) {
      // Enterable building (shop/office)
      const w = rng(10, 16);
      const h = rng(4, 5.5);
      const d = rng(9, 14);
      this.enterableBuilding(x, z, w, h, d, this.mConcrete(this._pal('eb', this._coreBrick)), ry, true);
    } else if (roll < 0.72) {
      // House / townhouse
      this.house(x, z, ry, Math.random() < 0.2, true);
    } else if (!ultra && roll < 0.82) {
      // Row house row, a mosque, or a corner store
      const rr = Math.random();
      if (rr < 0.45) this.rowhouse(x, z, ry, rng(16, 28), rng(7, 9), rng(6, 7.5), true, 7);
      else if (rr < 0.8) this.store(x, z, ry, rng(9, 13), rng(10, 14), rng(4.5, 6), true, 19);
      else this.box(x, 0, z, rng(13, 17), rng(5, 8), rng(14, 20), this._sceneMat('brick'), true, ry);
    } else if (!ultra && roll < 0.88) {
      // Warehouse or factory
      this.warehouse(x, z, rng(18, 26), rng(12, 18), rng(6, 9), true);
    } else if (!ultra && roll < 0.94) {
      // Workshop / small store
      this.box(x, 0, z, rng(8, 14), rng(4, 6), rng(8, 12), this._sceneMat('brick'), true, ry);
    } else if (!ultra && roll < 0.98) {
      // Gas station or fuel tank
      if (Math.random() < 0.5) this.gasstation(x, z, ry, true, 13);
      else this.fuelTank(x, z, rng(2, 4), rng(5, 9), true);
    } else {
      // Climbable crate stack / cover
      this.climbBox(x, 0, z, rng(2, 4), rng(1.5, 3), rng(2, 4), this.mCrate(), ry, 'fire');
    }
  }

  _placeDockBuilding(x, z, ry) {
    // Abandoned Docks: containers, factories, warehouses, fuel tanks
    const roll = Math.random();
    if (roll < 0.25) {
      // Shipping container cluster at random angles (NEAT ROWS PROHIBITED)
      const nCont = 2 + Math.floor(rng(0, 4));
      for (let i = 0; i < nCont; i++) {
        const cx = x + rng(-6, 6);
        const cz = z + rng(-6, 6);
        const cr = ry + rng(-0.8, 0.8);
        const colIdx = Math.floor(rng(0, 5));
        const cols = [[150, 60, 45], [60, 90, 110], [95, 100, 70], [120, 70, 120], [60, 110, 90]];
        const c3 = cols[colIdx % cols.length];
        const cm = new THREE.MeshStandardMaterial({ map: TEX.makeMetalTexture(512, c3), roughness: .6, metalness: .5 });
        this.enterableContainer(cx, cz, cr, cm);
        // 40% chance of a toppled/stacked second container
        if (Math.random() < 0.4) {
          // Toppled: rotate onto its side to form a ramp
          const toppled = new THREE.Mesh(new THREE.BoxGeometry(4, 2.4, 2.6), cm);
          toppled.position.set(cx + rng(-1, 1), 1.3 + rng(0, 1), cz + rng(-1, 1));
          toppled.rotation.x = rng(-0.6, 0.6);
          toppled.rotation.y = cr + rng(-0.3, 0.3);
          toppled.castShadow = toppled.receiveShadow = true;
          this.group.add(toppled);
          this.addCollider(cx, 0, cz, 4, 2.4, 2.6);
        }
      }
    } else if (roll < 0.45) {
      // Warehouse variant
      const w = rng(24, 36);
      const d = rng(16, 24);
      this.warehouse(x, z, w, d, rng(7, 10), true);
    } else if (roll < 0.60) {
      // Fuel tanks
      this.fuelTank(x + rng(-3, 3), z + rng(-3, 3), rng(2.5, 4.5), rng(6, 10), true);
    } else if (roll < 0.75) {
      // Open storage / scrap
      this.climbBox(x, 0, z, rng(3, 5), rng(1.5, 2.5), rng(3, 5), this.mMetal(), ry, 'flex');
    } else {
      // Shipping container
      const colIdx = Math.floor(rng(0, 4));
      const cols = [[150, 60, 45], [60, 90, 110], [95, 100, 70], [120, 70, 120]];
      const cm = new THREE.MeshStandardMaterial({ map: TEX.makeMetalTexture(512, cols[colIdx]), roughness: .6, metalness: .5 });
      this.enterableContainer(x, z, ry, cm);
    }
  }

  _placePerimeterBuilding(x, z, ry) {
    // Overgrown Perimeter: sparse, ruined, natural
    const roll = Math.random();
    if (roll < 0.28) {
      // Ruined house
      this.house(x, z, ry, true, true);
    } else if (roll < 0.44) {
      // Small warehouse
      this.warehouse(x, z, rng(12, 20), rng(8, 14), rng(5, 7), true);
    } else if (roll < 0.58) {
      // Ruined rowhouse
      this.rowhouse(x, z, ry, rng(12, 18), rng(7, 9), rng(5, 6), true, 1);
    } else if (roll < 0.68) {
      // Rock field / natural cover
      this.rockField(x, z, rng(6, 14));
    } else if (roll < 0.76) {
      // Fuel tank
      this.fuelTank(x, z, rng(2.5, 3.5), rng(4, 5.5), true);
    } else {
      // Rock field / natural cover
      this.rockField(x, z, rng(6, 12));
    }
  }

  // ---- INFILL: fill open gaps between zones with extra buildings ----
  _placeInfillBuildings() {
    const q = this._quality;
    if (q === 'ultra-low') return;
    const placed = [];
    const isOccupied = (x, z, m) => { for (const p of placed) { if (Math.hypot(p.x - x, p.z - z) < m) return true; } return false; };
    const limit = q === 'low' ? 40 : 120;
    for (let i = 0; i < limit; i++) {
      const a = rng(0, Math.PI * 2);
      const r = rng(100, this.bounds - 20);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (isOccupied(x, z, 16)) continue;
      if (this.colliderAt(x, z, 1)) continue;
      placed.push({ x, z });
      const inCore = Math.hypot(x, z) < 750;
      const inDocks = x > 400 && z > 200 && x < 1200 && z < 1100;
      const ry = rng(0, Math.PI);
      if (inCore) {
        this._placeCoreBuilding(x, z, ry, 50);
      } else if (inDocks) {
        this._placeDockBuilding(x, z, ry);
      } else {
        const roll = Math.random();
        if (roll < 0.25) this.warehouse(x, z, rng(8, 16), rng(6, 12), rng(5, 7), true);
        else if (roll < 0.5) this.rowhouse(x, z, rng(0, Math.PI), rng(10, 16), rng(7, 9), rng(5, 6), true, 2);
        else this._placePerimeterBuilding(x, z, ry);
      }
    }
  }


  // ---- ZONE-SPECIFIC CONTENT ----
  _addZoneSpecificContent() {
    // --- Named landmarks ---
    // Central plaza
    this.namedLocations.push({ x: 0, z: 0, name: 'CENTRAL', color: '#ffd24a' });

    // Police station in the core
    this.box(-200, 0, 250, 16, 7, 12, this._sceneMat('concrete'), true, 0);
    this.namedLocations.push({ x: -200, z: 250, name: 'POLICE', color: '#4488ff' });

    // Port in the docks
    this.port(900, 400, 0, true);
  }

  // ===== ZONE 3: OVERGROWN PERIMETER =====
  buildZones() {
    // Temple ruins: broken pillars scattered in the overgrown zones
    const pillarMat = new THREE.MeshStandardMaterial({ map: TEX.makeConcreteTexture(256, [130, 124, 112]), roughness: .95 });
    for (let i = 0; i < 30; i++) {
      const a = rng(0, Math.PI * 2);
      const r = rng(900, 1600);
      const px = Math.cos(a) * r + rng(-100, 100);
      const pz = Math.sin(a) * r + rng(-100, 100);
      if (Math.hypot(px, pz) < 800) continue;
      const h = rng(1.5, 4);
      const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.8, h, 12), pillarMat);
      pillar.position.set(px, h / 2, pz);
      pillar.rotation.x = rng(-0.15, 0.15);
      pillar.rotation.z = rng(-0.15, 0.15);
      pillar.castShadow = pillar.receiveShadow = true;
      this.group.add(pillar);
      this.addCollider(px, 0, pz, 1.2, h, 1.2);
      // Fallen pillar nearby
      if (Math.random() < 0.4) {
        const fx = px + rng(-4, 4), fz = pz + rng(-4, 4);
        const fallen = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.6, rng(2, 4), 12), pillarMat);
        fallen.position.set(fx, 0.4, fz);
        fallen.rotation.x = Math.PI / 2 + rng(-0.3, 0.3);
        fallen.rotation.z = rng(0, Math.PI);
        fallen.castShadow = true;
        this.group.add(fallen);
        this.addCollider(fx, 0, fz, 3, 0.6, 0.6);
      }
    }

    // Bunkers half-buried into slopes at perimeter
    for (let i = 0; i < 6; i++) {
      const a = rng(0, Math.PI * 2);
      const r = rng(1000, 1500);
      const bx = Math.cos(a) * r, bz = Math.sin(a) * r;
      this.warehouse(bx, bz, rng(8, 12), rng(6, 9), rng(5, 7), true);
    }

    // Scattered cover points across perimeter
    for (let i = 0; i < 20; i++) {
      const a = rng(0, Math.PI * 2);
      const r = rng(800, 1700);
      const cx = Math.cos(a) * r, cz = Math.sin(a) * r;
      if (Math.hypot(cx, cz) < 600) continue;
      this.climbBox(cx, 0, cz, 1.4, .9, .7, this.mCrate(), rng(0, Math.PI), 'flex');
    }
    // Rock outcrops for terrain variety
    for (let i = 0; i < 6; i++) {
      const a = rng(0, Math.PI * 2);
      const r = rng(600, 1500);
      this.rockField(Math.cos(a) * r, Math.sin(a) * r, rng(8, 16));
    }
  }

  // ===== BUILDING PRIMITIVES (unchanged from original) =====

  climbBox(x, y, z, w, h, d, mat, ry = 0, reactive = null) {
    return this.box(x, y, z, w, h, d, mat, true, ry, true, reactive);
  }


  // ---- DEDICATED FOREST ----
  // Large forest in an empty area (NE quadrant), trees + weeds, no building overlap.
  _placeDedicatedForest() {
    if (this._quality === 'ultra-low') return;
    const cx = 1500, cz = 1500, r = 450;
    const treeCount = this._quality === 'low' ? 20 : 60;
    // Trees
    const placed = [];
    for (let i = 0; i < treeCount; i++) {
      const a = rng(0, Math.PI * 2);
      const rd = rng(20, r);
      const x = cx + Math.cos(a) * rd, z = cz + Math.sin(a) * rd;
      if (Math.abs(x) > this.bounds - 14 || Math.abs(z) > this.bounds - 14) continue;
      if (this.colliderAt(x, z, 2)) continue;
      let ok = true;
      for (const p of placed) if (Math.hypot(p.x - x, p.z - z) < 7) { ok = false; break; }
      if (!ok) continue;
      placed.push({ x, z });
      this.tree(x, z, 0.8 + Math.random() * 0.8, Math.random() < 0.25);
    }
    this.namedLocations.push({ x: cx, z: cz, name: 'DARK FOREST', color: '#4a8a3a' });
  }

  gableRoof(x, z, w, h, d, ry, pitch, mat) {
    const a = Math.atan(pitch);
    const L = (w / 2) / Math.cos(a);
    const ridgeY = h + (w / 2) * pitch;
    const over = 0.5, thick = 0.4;
    const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ry; this.group.add(g);
    // Ridge runs along Z (front-to-back). Two roof planes slope left-right.
    const plane = (xoff, rot) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(L, thick, d + over * 2), mat);
      m.position.set(xoff, h + (w * pitch) / 4, 0);
      m.rotation.z = rot; m.castShadow = m.receiveShadow = true; g.add(m);
    };
    plane(-w / 4, a);   // left slope
    plane(w / 4, -a);   // right slope
    // Gable end triangles at front (+d/2) and back (-d/2) walls
    const tri = new THREE.Shape();
    tri.moveTo(-w / 2, 0); tri.lineTo(w / 2, 0); tri.lineTo(0, ridgeY - h); tri.lineTo(-w / 2, 0);
    const tgeo = new THREE.ExtrudeGeometry(tri, { depth: 0.6, bevelEnabled: false });
    // Front gable — face flush with the +d/2 wall, extrude inward
    const mf = new THREE.Mesh(tgeo, mat);
    mf.position.set(0, h, d / 2); mf.rotation.y = Math.PI; mf.castShadow = mf.receiveShadow = true; g.add(mf);
    // Back gable — face flush with the -d/2 wall, extrude inward
    const mb = new THREE.Mesh(tgeo, mat);
    mb.position.set(0, h, -d / 2); mb.castShadow = mb.receiveShadow = true; g.add(mb);
    // Collider block to stop bullets passing through roof — rotated with building
    const roofH = (w * pitch) / 2 + 0.4;
    if (ry) {
      const c = Math.abs(Math.cos(ry)), s = Math.abs(Math.sin(ry));
      const ex = ((w + 1) / 2) * c + ((d + 1) / 2) * s, ez = ((w + 1) / 2) * s + ((d + 1) / 2) * c;
      this.addCollider(x, h + (w * pitch) / 3, z, ex * 2, roofH, ez * 2);
    } else {
      this.addCollider(x, h + (w * pitch) / 3, z, w + 1, roofH, d + 1);
    }
    return g;
  }

  stairs(x, z, n, stepH, stepW, stepD, ry, mat, climb = false) {
    const fx = Math.sin(ry), fz = Math.cos(ry);
    const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ry; this.group.add(g);
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(stepW, stepH, stepD), mat);
      m.position.set(0, i * stepH + stepH / 2, i * stepD + stepD / 2);
      m.castShadow = m.receiveShadow = true; g.add(m);
      this.addCollider(x + fx * (i * stepD + stepD / 2), i * stepH, z + fz * (i * stepD + stepD / 2), stepW, stepH, stepD, climb);
    }
  }







  // ====== AUTHORED SCENE DISPATCHERS ======
  _authoredBuilding(b) {
    const x = b.x, z = b.z, ry = b.ry || 0, w = b.w || 12, d = b.d || 12, h = b.h || 8;
    const m = this._sceneMat(b.m || 'concrete');
    const rm = this._sceneMat(b.roofM || 'roof');
    const k = b.kind || 'box';
    const cs = Math.cos(ry), sn = Math.sin(ry);
    const l2w = (lx, lz) => ({ x: x + lx * cs + lz * sn, z: z - lx * sn + lz * cs });
    const collide = b.solid !== false;
    const addWin = b.windows !== false && h > 3 && this._quality !== 'ultra-low' && this._quality !== 'low';
    const addDoor = b.doorW > 0 || h > 2;
    const doorW = b.doorW || 2.4;
    const addRoofDetail = b.roof && this._quality !== 'ultra-low' && this._quality !== 'low';
    const addEnterable = b.enterable && this._quality !== 'ultra-low';
    const seed = (Math.abs(x) * 13 + Math.abs(z) * 7) | 0;
    switch (k) {
      case 'box': case 'plainbox': case 'shell': {
        this.box(x, 0, z, w, h, d, m, collide, ry);
        if (addRoofDetail) this.roofProps(x, z, ry, w, d, h, rm);
        if (b.roof) this._baseTrim(x, z, w, d, ry, h, { lip: true });
        this._buildingImperfections(x, z, w, d, ry, h, seed);
        if (addWin) this._sceneWindows(x, z, w, h, d, ry, seed);
        if (addDoor) this._facadeDoor(x, z, w, d, ry, doorW, this._sceneMat('door'));
        if (b.roofAccess) this.addRoof(x, z, h + 0.4);
        break;
      }
      case 'tower': {
        const tw = w * 0.7, td = d * 0.7;
        this.box(x, 0, z, tw, h, td, m, collide, ry);
        this.box(x, h, z, tw * 0.85, h * 0.3, td * 0.85, m, false, ry);
        this._baseTrim(x, z, tw, td, ry, h * 1.3, { lip: true });
        if (addRoofDetail) this.roofProps(x, z, ry, tw * 0.85, td * 0.85, h * 1.3, rm);
        if (addWin) this._sceneWindows(x, z, tw, td, h * 1.3, ry, seed);
        break;
      }
      case 'container': {
        this.box(x, 0, z, 6, 2.6, 2.4, this._sceneMat({ m: 'metal', c: [140, 60, 50] }), collide, ry);
        break;
      }
      case 'house': case 'housedetailed': {
        const bh = h || rng(4, 6);
        this.box(x, 0, z, w, bh, d, m, collide, ry);
        this.gableRoof(x, z, w + 1, bh, d + 1, ry, 0.7, rm);
        this._baseTrim(x, z, w, d, ry, bh);
        if (addWin) this._sceneWindows(x, z, w, d, bh, ry, seed);
        if (addDoor) this._facadeDoor(x, z, w, d, ry, doorW, this._sceneMat('door'));
        break;
      }
      case 'apartment': case 'townhouse': {
        const stories = b.stories || Math.max(2, Math.floor(h / 3.2));
        const floorH = h / stories;
        for (let s = 0; s < stories; s++) {
          this.box(x, s * floorH, z, w, floorH + 0.1, d, m, s === 0 && collide, ry);
        }
        this._baseTrim(x, z, w, d, ry, h, { lip: true });
        if (addRoofDetail) this.roofProps(x, z, ry, w, d, h, rm);
        if (addWin) this._sceneWindows(x, z, w, h, d, ry, seed);
        if (addDoor) this._facadeDoor(x, z, w, d, ry, doorW, this._sceneMat('door'));
        break;
      }
      case 'rowhouse': {
        const count = Math.max(2, Math.floor(w / 6));
        const unitW = w / count;
        for (let i = 0; i < count; i++) {
          const ox = -w / 2 + unitW / 2 + i * unitW;
          const lp = l2w(ox, 0);
          const unitH = h + rng(-1, 1);
          this.box(lp.x, 0, lp.z, unitW - 0.3, unitH, d, m, collide, ry);
          if (addDoor) this._facadeDoor(lp.x, lp.z, unitW - 0.3, d, ry, doorW, this._sceneMat('door'));
        }
        this._baseTrim(x, z, w, d, ry, h);
        if (addWin) this._sceneWindows(x, z, w, h, d, ry, seed);
        break;
      }
      case 'lcorner': {
        const hw = w / 2, hd = d / 2;
        this.box(x - hw / 4, 0, z - hd / 4, hw, h, hd, m, collide, ry);
        this.box(x + hw / 4, 0, z + hd / 4, hw, h, hd, m, false, ry);
        if (addWin) this._sceneWindows(x, z, w, h, d, ry, seed);
        if (addDoor) this._facadeDoor(x, z, w, d, ry, doorW, this._sceneMat('door'));
        if (addRoofDetail) this.roofProps(x, z, ry, w, d, h, rm);
        break;
      }
      case 'store': case 'supermarket': {
        const sh = h || 4;
        this.box(x, 0, z, w, sh, d, m, collide, ry);
        this._baseTrim(x, z, w, d, ry, sh);
        if (addRoofDetail) this.roofProps(x, z, ry, w, d, sh, rm);
        if (addDoor) this._facadeDoor(x, z, w, d, ry, doorW * 1.5, this._sceneMat('door'));
        if (addWin) this._sceneWindows(x, z, w, d, sh, ry, seed);
        break;
      }
      case 'motel': {
        const floors = 2;
        const fh = 3.2;
        for (let s = 0; s < floors; s++) this.box(x, s * fh, z, w, fh + 0.1, d, m, s === 0 && collide, ry);
        const bh = floors * fh;
        if (addWin) this._sceneWindows(x, z, w, d, bh, ry, seed);
        if (addDoor) this._facadeDoor(x, z, w, d, ry, doorW, this._sceneMat('door'));
        if (addRoofDetail) this.roofProps(x, z, ry, w, d, bh, rm);
        break;
      }
      case 'gasstation': {
        const pw = w || 14, pd = d || 10;
        this.box(x, 0, z, pw * 0.4, 3.5, pd * 0.35, this._sceneMat('metal'), collide, ry);
        for (const side of [-1, 1]) {
          const pp = l2w(side * pw * 0.25, 0);
          this.box(pp.x, 0, pp.z, 1.2, 3.2, 1.2, this._sceneMat('metal'), false, ry);
        }
        this._baseTrim(x, z, pw, pd, ry, 3.5);
        break;
      }
      case 'parking': {
        const floors = Math.max(2, Math.floor(h / 3.2));
        const fh = 3.2;
        for (let s = 0; s < floors; s++) {
          const shrink = s * 0.3;
          this.box(x, s * fh, z, w - shrink, fh * 0.7, d - shrink, this._sceneMat('concrete'), s === 0 && collide, ry);
        }
        if (addWin) this._sceneWindows(x, z, w, d, floors * fh, ry, seed);
        break;
      }
      case 'bank': {
        this.box(x, 0, z, w, h, d, this._sceneMat('marble'), collide, ry);
        const lw = w + 1.5, ld = d + 0.6;
        this.box(x, h, z, lw, 0.4, ld, this._sceneMat('metal'), false, ry);
        if (addDoor) this._facadeDoor(x, z, w, d, ry, doorW * 1.2, this._sceneMat('door'));
        if (addWin) this._sceneWindows(x, z, w, h, d, ry, seed);
        break;
      }
      case 'hospital': {
        this.box(x, 0, z, w, h, d, this._sceneMat('concrete'), collide, ry);
        this.box(x, h, z, 3, 2, 3, this._sceneMat('metal'), false, ry);
        if (addWin) this._sceneWindows(x, z, w, h, d, ry, seed);
        if (addDoor) this._facadeDoor(x, z, w, d, ry, doorW * 1.5, this._sceneMat('door'));
        if (addRoofDetail) this.roofProps(x, z, ry, w, d, h, rm);
        break;
      }
      case 'highrise': {
        const tw = w * 0.65, td = d * 0.65;
        this.box(x, 0, z, w, h * 0.15, d, this._sceneMat('concrete'), collide, ry);
        this.box(x, h * 0.15, z, tw, h * 0.85, td, this._sceneMat('glass'), false, ry);
        this._baseTrim(x, z, w, d, ry, h * 0.15);
        if (addWin) this._sceneWindows(x, z, tw, td, h, ry, seed);
        if (addRoofDetail) this.roofProps(x, z, ry, tw, td, h, rm);
        break;
      }
      case 'warehouse': {
        this.box(x, 0, z, w, h, d, this._sceneMat('metal'), collide, ry);
        if (addRoofDetail) {
          this.box(x, h + 0.15, z, w + 0.6, 0.15, d + 0.6, this._sceneMat('corrugated'), false, ry);
        }
        if (addDoor) this._facadeDoor(x, z, w, d, ry, Math.min(doorW * 2, w * 0.6), this._sceneMat('metal'));
        break;
      }
      case 'policestation': {
        this.box(x, 0, z, w, h, d, this._sceneMat('concrete'), collide, ry);
        this._baseTrim(x, z, w, d, ry, h);
        if (addWin) this._sceneWindows(x, z, w, h, d, ry, seed);
        if (addDoor) this._facadeDoor(x, z, w, d, ry, doorW * 1.5, this._sceneMat('door'));
        break;
      }
      case 'nightclub': {
        this.box(x, 0, z, w, h, d, this._sceneMat('brick'), collide, ry);
        this.box(x, h * 0.5, z, w + 0.3, h * 0.15, d + 0.3, this._sceneMat('metal'), false, ry);
        if (addWin) this._sceneWindows(x, z, w, h, d, ry, seed);
        if (addDoor) this._facadeDoor(x, z, w, d, ry, doorW, this._sceneMat('door'));
        break;
      }
      case 'mosque': {
        this.box(x, 0, z, w, h, d, this._sceneMat('concrete'), collide, ry);
        this.box(x, h, z, w * 0.5, h * 0.4, d * 0.5, this._sceneMat('concrete'), false, ry);
        this._baseTrim(x, z, w, d, ry, h);
        if (addWin) this._sceneWindows(x, z, w, h, d, ry, seed);
        if (addDoor) this._facadeDoor(x, z, w, d, ry, doorW || 4, this._sceneMat('door'));
        break;
      }
      case 'mall': {
        this.box(x, 0, z, w, h, d, this._sceneMat('concrete'), collide, ry);
        this._baseTrim(x, z, w, d, ry, h, { lip: true });
        if (addWin) this._sceneWindows(x, z, w, h, d, ry, seed);
        if (addDoor) this._facadeDoor(x, z, w, d, ry, doorW || 6, this._sceneMat('door'));
        if (addRoofDetail) this.roofProps(x, z, ry, w, d, h, rm);
        break;
      }
      case 'stadium': {
        this.box(x, 0, z, w, h * 0.6, d, this._sceneMat('concrete'), collide, ry);
        this.box(x, h * 0.6, z, w * 0.9, h * 0.2, d * 0.9, this._sceneMat('concrete'), false, ry);
        break;
      }
      default: {
        this.box(x, 0, z, w, h, d, m, collide, ry);
        if (addRoofDetail) this.roofProps(x, z, ry, w, d, h, rm);
        if (addWin) this._sceneWindows(x, z, w, h, d, ry, seed);
        break;
      }
    }
    if (addEnterable) {
      const c = Math.abs(Math.cos(ry)), s = Math.abs(Math.sin(ry));
      const ex = (w / 2) * c + (d / 2) * s, ez = (w / 2) * s + (d / 2) * c;
      this.addInterior(new THREE.Vector3(x - ex, 0, z - ez), new THREE.Vector3(x + ex, h * 0.8, z + ez));
    }
  }

  _authoredProp(p) {
    const x = p.x, z = p.z, ry = p.ry || 0;
    const k = p.kind || 'crate';
    const cs = Math.cos(ry), sn = Math.sin(ry);
    const l2w = (lx, lz) => ({ x: x + lx * cs + lz * sn, z: z - lx * sn + lz * cs });
    switch (k) {
      case 'crate': this.box(x, 0, z, 1.2, 1.2, 1.2, this.mCrate(), true, ry, false, 'flex'); break;
      case 'barrel': this.box(x, 0, z, 0.8, 1.2, 0.8, this.mBarrel(), true, ry, false, p.react || 'flex'); break;
      case 'barrels': {
        const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ry; this.group.add(g);
        for (let i = 0; i < 3; i++) {
          const bx = (i - 1) * 0.9;
          const m = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 1.1, 12), this.mBarrel());
          m.position.set(bx, 0.55, 0); m.castShadow = m.receiveShadow = true; g.add(m);
        }
        this.addCollider(x, 0, z, 3, 1.2, 1.2);
        break;
      }
      case 'lamp': {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 5, 8), this.mMetal());
        pole.position.set(x, 2.5, z); pole.castShadow = true; this.group.add(pole);
        const arm = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.08, 0.08), this.mMetal());
        arm.position.set(x + cs * 0.6, 5, z - sn * 0.6); arm.rotation.y = ry; this.group.add(arm);
        const light = new THREE.Mesh(new THREE.SphereGeometry(0.15, 8, 8), new THREE.MeshStandardMaterial({ color: 0xffeeaa, emissive: 0xffeeaa, emissiveIntensity: 0.6 }));
        light.position.set(x + cs * 1.2, 4.9, z - sn * 1.2); this.group.add(light);
        this.addCollider(x, 0, z, 0.3, 5, 0.3);
        break;
      }
      case 'hydrant': {
        this.box(x, 0, z, 0.3, 0.7, 0.3, new THREE.MeshStandardMaterial({ color: 0xcc2222, roughness: .8 }), true, ry);
        this.box(x, 0.7, z, 0.15, 0.25, 0.15, new THREE.MeshStandardMaterial({ color: 0xcc2222, roughness: .8 }), false, ry);
        break;
      }
      case 'dumpster': {
        this.box(x, 0, z, 2, 1.1, 1.2, this._sceneMat(p.m || { m: 'metal', c: [70, 110, 70] }), true, ry);
        break;
      }
      case 'trashcan': {
        const m = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: .9 });
        const r = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.22, 0.8, 10), m);
        r.position.set(x, 0.4, z); r.castShadow = true; this.group.add(r);
        this.addCollider(x, 0, z, 0.6, 0.8, 0.6);
        break;
      }
      case 'mailbox': {
        this.box(x, 0, z, 0.3, 1, 0.2, new THREE.MeshStandardMaterial({ color: 0x2244aa, roughness: .8 }), true, ry);
        break;
      }
      case 'busstop': {
        this.box(x, 0, z, 3, 0.08, 1.2, this._sceneMat('metal'), true, ry);
        for (const side of [-1, 1]) {
          const pp = l2w(0, side * 0.55);
          this.box(pp.x, 0, pp.z, 0.08, 2.5, 0.08, this.mMetal(), false, ry);
        }
        const top = l2w(0, 0);
        this.box(top.x, 2.5, top.z, 3, 0.06, 1.2, this._sceneMat('glass'), false, ry);
        break;
      }
      case 'trafficlight': {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 6, 8), this.mMetal());
        pole.position.set(x, 3, z); pole.castShadow = true; this.group.add(pole);
        for (let i = 0; i < 3; i++) {
          const c = [0x22cc22, 0xcccc22, 0xcc2222][i];
          const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 8), new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.3 }));
          bulb.position.set(x, 5.5 - i * 0.3, z); this.group.add(bulb);
        }
        this.addCollider(x, 0, z, 0.3, 6, 0.3);
        break;
      }
      case 'pole': {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 4, 6), this.mMetal());
        pole.position.set(x, 2, z); pole.castShadow = true; this.group.add(pole);
        this.addCollider(x, 0, z, 0.2, 4, 0.2);
        break;
      }
      case 'planter': {
        this.box(x, 0, z, 1.2, 0.5, 1.2, this._sceneMat('brick'), true, ry);
        if (this._quality !== 'ultra-low') {
          const foliage = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 6), new THREE.MeshStandardMaterial({ color: 0x2d6b22, roughness: 1, flatShading: true }));
          foliage.position.set(x, 0.9, z); foliage.scale.y = 0.7; foliage.castShadow = true; this.group.add(foliage);
        }
        break;
      }
      case 'bollard': {
        this.box(x, 0, z, 0.25, 0.7, 0.25, this.mMetal(), true, ry);
        break;
      }
      case 'billboard': {
        for (const side of [-1, 1]) {
          const pp = l2w(side * 1.5, 0);
          this.box(pp.x, 0, pp.z, 0.15, 5, 0.15, this.mMetal(), true, ry);
        }
        this.box(x, 4, z, 4, 2.2, 0.12, this._sceneMat('metal'), true, ry);
        break;
      }
      case 'bench': {
        this.box(x, 0, z, 1.8, 0.06, 0.5, this._sceneMat('wood'), true, ry);
        this.box(x, 0, z - 0.2 * Math.cos(ry), 1.8, 0.4, 0.06, this._sceneMat('wood'), false, ry);
        for (const side of [-1, 1]) {
          const pp = l2w(side * 0.75, 0);
          this.box(pp.x, 0, pp.z, 0.08, 0.4, 0.5, this.mMetal(), false, ry);
        }
        break;
      }
      case 'umbrella': {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 3, 6), this.mMetal());
        pole.position.set(x, 1.5, z); this.group.add(pole);
        const canopy = new THREE.Mesh(new THREE.ConeGeometry(1.2, 0.4, 12), new THREE.MeshStandardMaterial({ color: 0xcc3333, roughness: .9 }));
        canopy.position.set(x, 3, z); this.group.add(canopy);
        break;
      }
      case 'cafetable': {
        this.box(x, 0, z, 0.8, 0.7, 0.8, this._sceneMat('metal'), true, ry);
        break;
      }
      default: this.box(x, 0, z, 1, 1, 1, this.mCrate(), true, ry); break;
    }
    if (p.react && k !== 'barrel' && k !== 'barrels' && k !== 'crate') {
      const col = this.colliders[this.colliders.length - 1];
      if (col) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), this.mCrate());
        m.position.set(x, 0.5, z); m.rotation.y = ry; m.visible = false; this.group.add(m);
        this._registerReactive(m, p.react, col);
      }
    }
  }

  _authoredLandmark(lm) {
    const x = lm.x, z = lm.z, ry = lm.ry || 0;
    const k = lm.kind || 'warehouse';
    const cs = Math.cos(ry), sn = Math.sin(ry);
    const l2w = (lx, lz) => ({ x: x + lx * cs + lz * sn, z: z - lx * sn + lz * cs });
    const solid = lm.solid !== false;
    switch (k) {
      case 'fuel': {
        const r = lm.r || 3, h = lm.h || 7;
        const tank = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 20), this.mMetal());
        tank.position.set(x, h / 2, z); tank.castShadow = tank.receiveShadow = true; this.group.add(tank);
        this.addCollider(x, 0, z, r * 2.2, h, r * 2.2);
        break;
      }
      case 'port': {
        this.box(x, 0, z, 20, 3, 14, this._sceneMat('concrete'), solid, ry);
        for (let i = 0; i < 4; i++) {
          const cx = x + (i - 1.5) * 5 * cs, cz = z + (i - 1.5) * 5 * sn;
          const colors = [[150, 60, 45], [60, 90, 110], [95, 100, 70], [120, 70, 120]];
          const cm = new THREE.MeshStandardMaterial({ map: TEX.makeMetalTexture(256, colors[i]), roughness: .6, metalness: .5 });
          this.box(cx, 3, cz, 4, 2.4, 2.4, cm, false, ry + rng(-0.3, 0.3));
        }
        break;
      }
      case 'trainstation': {
        const tw = lm.w || 25, td = lm.d || 13, th = lm.h || 10;
        this.box(x, 0, z, tw, th * 0.5, td, this._sceneMat('brick'), solid, ry);
        this.gableRoof(x, z, tw + 1, th * 0.5, td + 1, ry, 0.5, this._sceneMat('roof'));
        if (this._quality !== 'ultra-low') {
          this._facadeDoor(x, z, tw, td, ry, 4, this._sceneMat('door'));
          this._sceneWindows(x, z, tw, th, td, ry, (Math.abs(x) * 7 + Math.abs(z) * 13) | 0);
        }
        break;
      }
      case 'warehouse': {
        const w = lm.w || 34, d = lm.d || 22, h = lm.h || 9;
        this.box(x, 0, z, w, h, d, this._sceneMat('metal'), solid, ry);
        if (this._quality !== 'ultra-low') {
          this.box(x, h + 0.15, z, w + 0.6, 0.15, d + 0.6, this._sceneMat('corrugated'), false, ry);
          this._facadeDoor(x, z, w, d, ry, 5, this._sceneMat('metal'));
        }
        break;
      }
      case 'mall': {
        const w = lm.w || 40, d = lm.d || 20, h = lm.h || 8.5;
        this.box(x, 0, z, w, h, d, this._sceneMat('concrete'), solid, ry);
        this._baseTrim(x, z, w, d, ry, h, { lip: true });
        if (this._quality !== 'ultra-low') {
          this._facadeDoor(x, z, w, d, ry, 6, this._sceneMat('door'));
          this._sceneWindows(x, z, w, h, d, ry, (Math.abs(x) * 7 + Math.abs(z) * 13) | 0);
          this.roofProps(x, z, ry, w, d, h, this._sceneMat('roof'));
        }
        break;
      }
      case 'stadium': {
        const w = lm.w || 82, d = lm.d || 57, h = lm.h || 12;
        this.box(x, 0, z, w, h * 0.6, d, this._sceneMat('concrete'), solid, ry);
        this.box(x, h * 0.6, z, w * 0.9, h * 0.2, d * 0.9, this._sceneMat('concrete'), false, ry);
        if (this._quality !== 'ultra-low') {
          for (let i = 0; i < 8; i++) {
            const a = (i / 8) * Math.PI * 2;
            const lx = x + Math.cos(a) * w * 0.4, lz = z + Math.sin(a) * d * 0.4;
            const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, h + 2, 6), this.mMetal());
            pole.position.set(lx, (h + 2) / 2, lz); pole.castShadow = true; this.group.add(pole);
          }
        }
        break;
      }
      case 'mosque': {
        const w = lm.w || 16, d = lm.d || 14, h = lm.h || 8;
        this.box(x, 0, z, w, h, d, this._sceneMat('concrete'), solid, ry);
        this.box(x, h, z, w * 0.5, h * 0.4, d * 0.5, this._sceneMat('concrete'), false, ry);
        this._baseTrim(x, z, w, d, ry, h);
        if (this._quality !== 'ultra-low') {
          this._facadeDoor(x, z, w, d, ry, 4, this._sceneMat('door'));
          this._sceneWindows(x, z, w, h, d, ry, (Math.abs(x) * 7 + Math.abs(z) * 13) | 0);
        }
        break;
      }
      case 'firestation': {
        const w = lm.w || 18, d = lm.d || 14, h = lm.h || 6;
        this.box(x, 0, z, w, h, d, new THREE.MeshStandardMaterial({ color: 0xaa3333, roughness: .85 }), solid, ry);
        this._baseTrim(x, z, w, d, ry, h);
        if (this._quality !== 'ultra-low') {
          this._facadeDoor(x, z, w, d, ry, 5, this._sceneMat('metal'));
          this._sceneWindows(x, z, w, h, d, ry, (Math.abs(x) * 7 + Math.abs(z) * 13) | 0);
        }
        break;
      }
      case 'policestation': {
        const w = lm.w || 16, d = lm.d || 12, h = lm.h || 7;
        this.box(x, 0, z, w, h, d, this._sceneMat('concrete'), solid, ry);
        this._baseTrim(x, z, w, d, ry, h);
        if (this._quality !== 'ultra-low') {
          this._facadeDoor(x, z, w, d, ry, 3.5, this._sceneMat('door'));
          this._sceneWindows(x, z, w, h, d, ry, (Math.abs(x) * 7 + Math.abs(z) * 13) | 0);
        }
        break;
      }
      case 'nightclub': {
        const w = lm.w || 18, d = lm.d || 16, h = lm.h || 8;
        this.box(x, 0, z, w, h, d, this._sceneMat('brick'), solid, ry);
        this.box(x, h * 0.6, z, w + 0.3, h * 0.12, d + 0.3, this._sceneMat('metal'), false, ry);
        if (this._quality !== 'ultra-low') {
          this._facadeDoor(x, z, w, d, ry, 3, this._sceneMat('door'));
          this._sceneWindows(x, z, w, h, d, ry, (Math.abs(x) * 7 + Math.abs(z) * 13) | 0);
        }
        break;
      }
      case 'transit': {
        this.box(x, 0, z, 8, 0.1, 8, this._sceneMat('plaza'), false);
        this.box(x, 0, z, 4, 3, 4, this._sceneMat('glass'), false);
        this.transitPoints.push({ x, z, name: lm.name || 'STATION' });
        this.namedLocations.push({ x, z, name: lm.name || 'TRANSIT', color: '#7dd0ff' });
        break;
      }
      default: {
        this.box(x, 0, z, lm.w || 10, lm.h || 6, lm.d || 10, this._sceneMat('concrete'), solid, ry);
        break;
      }
    }
    if (this._quality !== 'ultra-low') {
      const ls = this._landmarkSize(lm);
      if (lm.name) this.namedLocations.push({ x, z, name: lm.name, color: '#ffd24a' });
    }
  }

  // ====== BUILDING FUNCTIONS (auto-gen city) ======
  house(x, z, ry, ruin, collide) {
    const w = rng(8, 14), d = rng(7, 11), h = rng(3.5, 5.5);
    const m = this._sceneMat(ruin ? 'brick' : 'concrete');
    this.box(x, 0, z, w, h, d, m, collide, ry);
    this.gableRoof(x, z, w + 0.8, h, d + 0.8, ry, 0.6, this._sceneMat('roof'));
    if (!ruin) this._buildingImperfections(x, z, w, d, ry, h, (Math.abs(x) * 13 + Math.abs(z) * 7) | 0);
    if (this._quality !== 'ultra-low') this._sceneWindows(x, z, w, h, d, ry, (Math.abs(x) * 7 + Math.abs(z) * 13) | 0);
  }

  fuelTank(x, z, r, h, collide) {
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 16), this.mMetal());
    tank.position.set(x, h / 2, z); tank.castShadow = tank.receiveShadow = true; this.group.add(tank);
    this.addCollider(x, 0, z, r * 2.2, h, r * 2.2);
  }

  gasstation(x, z, ry, collide, w) {
    w = w || 14;
    const d = w * 0.7;
    this.box(x, 0, z, w * 0.35, 3.5, d * 0.3, this._sceneMat('metal'), collide, ry);
    for (const side of [-1, 1]) {
      const cs = Math.cos(ry), sn = Math.sin(ry);
      const px = x + side * w * 0.25 * cs, pz = z - side * w * 0.25 * sn;
      this.box(px, 0, pz, 1.2, 3.2, 1.2, this.mMetal(), false, ry);
    }
  }

  rowhouse(x, z, ry, w, d, h, collide, stories) {
    stories = stories || 2;
    const count = Math.max(2, Math.floor(w / 6));
    const unitW = w / count;
    const cs = Math.cos(ry), sn = Math.sin(ry);
    for (let i = 0; i < count; i++) {
      const ox = -w / 2 + unitW / 2 + i * unitW;
      const px = x + ox * cs, pz = z - ox * sn;
      const uh = h + rng(-0.5, 0.5);
      this.box(px, 0, pz, unitW - 0.3, uh, d, this._sceneMat('brick'), i === 0 && collide, ry);
      if (this._quality !== 'ultra-low') this._facadeDoor(px, pz, unitW - 0.3, d, ry, 2, this._sceneMat('door'));
    }
  }

  port(x, z, ry, collide) {
    this.box(x, 0, z, 20, 3, 14, this._sceneMat('concrete'), collide, ry);
    for (let i = 0; i < 3; i++) {
      const cs = Math.cos(ry), sn = Math.sin(ry);
      const cx = x + (i - 1) * 5 * cs, cz = z + (i - 1) * 5 * sn;
      const colors = [[150, 60, 45], [60, 90, 110], [95, 100, 70]];
      const cm = new THREE.MeshStandardMaterial({ map: TEX.makeMetalTexture(256, colors[i]), roughness: .6, metalness: .5 });
      this.box(cx, 3, cz, 4, 2.4, 2.4, cm, false, ry + rng(-0.3, 0.3));
    }
  }

  trainStation(x, z, ry, collide) {
    this.box(x, 0, z, 25, 6.5, 13, this._sceneMat('brick'), collide, ry);
    this.gableRoof(x, z, 26, 6.5, 14, ry, 0.5, this._sceneMat('roof'));
    if (this._quality !== 'ultra-low') {
      this._facadeDoor(x, z, 25, 13, ry, 4, this._sceneMat('door'));
      this._sceneWindows(x, z, 25, 13, 6.5, ry, (Math.abs(x) * 7 + Math.abs(z) * 13) | 0);
    }
  }

  transitStation(x, z, name) {
    this.box(x, 0, z, 8, 0.1, 8, this._sceneMat('plaza'), false);
    this.box(x, 0, z, 4, 3, 4, this._sceneMat('glass'), false);
    this.transitPoints.push({ x, z, name: name || 'STATION' });
    this.namedLocations.push({ x, z, name: name || 'TRANSIT', color: '#7dd0ff' });
  }

  store(x, z, ry, w, d, h, collide) {
    w = w || 10; d = d || 12; h = h || 5;
    this.box(x, 0, z, w, h, d, this._sceneMat('concrete'), collide, ry);
    this._baseTrim(x, z, w, d, ry, h);
    if (this._quality !== 'ultra-low') {
      this._facadeDoor(x, z, w, d, ry, 3, this._sceneMat('door'));
      this._sceneWindows(x, z, w, h, d, ry, (Math.abs(x) * 7 + Math.abs(z) * 13) | 0);
    }
  }

  warehouse(x, z, w, d, h, collide) {
    this.box(x, 0, z, w, h, d, this._sceneMat('metal'), collide);
    if (this._quality !== 'ultra-low') {
      this.box(x, h + 0.15, z, w + 0.6, 0.15, d + 0.6, this._sceneMat('corrugated'), false);
      this._facadeDoor(x, z, w, d, 0, 5, this._sceneMat('metal'));
    }
  }

  rockField(x, z, r) {
    if (this._quality === 'ultra-low') return;
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x777777, roughness: 1, flatShading: true });
    for (let i = 0; i < 8; i++) {
      const a = rng(0, Math.PI * 2), rd = rng(0, r);
      const rx = x + Math.cos(a) * rd, rz = z + Math.sin(a) * rd;
      const s = rng(0.5, 2);
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), rockMat);
      rock.position.set(rx, s * 0.4, rz); rock.rotation.set(rng(0, 1), rng(0, 1), rng(0, 1));
      rock.castShadow = rock.receiveShadow = true; this.group.add(rock);
      this.addCollider(rx, 0, rz, s * 2, s * 1.2, s * 2);
    }
  }

  hill(x, z, r, h) {
    r = r || 14; h = h || 8;
    const hillMesh = new THREE.Mesh(new THREE.ConeGeometry(r, h, 24), new THREE.MeshStandardMaterial({ color: 0x4a7a3c, roughness: 1, flatShading: true }));
    hillMesh.position.set(x, 0, z); hillMesh.receiveShadow = true; this.group.add(hillMesh);
    this.addCollider(x, 0, z, r * 2, h, r * 2);
  }

  removeLoot(idx) {
    const L = this.lootPoints[idx];
    if (!L || L.looted) return;
    L.looted = true;
    if (L.mesh) {
      this.group.remove(L.mesh);
      const r = this.reactiveObjects.find(o => o.mesh === L.mesh);
      if (r) {
        r.dead = true;
        r.mesh.visible = false;
        if (r.col) {
          const i = this.colliders.indexOf(r.col);
          if (i >= 0) this.colliders.splice(i, 1);
          if (this.grid) this.grid.remove(r.col);
        }
      }
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
}

installAssets(World);

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
