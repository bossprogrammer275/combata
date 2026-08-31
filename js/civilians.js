// CIVILIANS — living city streets. Pedestrians who walk, idle, flee gunfire,
// and can be caught in the crossfire (with penalties). Never armed.
import * as THREE from 'three';
import { Character } from './character.js';
import { OUTFIT_PRESETS } from './utils/sa-wardrobe.js';

const OUTFITS = ['casual', 'urban', 'cadpat', 'navy'];
const SHIRTS = [
  [0.65, 0.45, 0.3], [0.85, 0.8, 0.7], [0.3, 0.35, 0.5], [0.55, 0.3, 0.28],
  [0.75, 0.6, 0.35], [0.4, 0.45, 0.4], [0.6, 0.35, 0.45], [0.8, 0.5, 0.6],
];

export class Civilian {
  constructor(scene, world, pos) {
    this.scene = scene;
    this.world = world;
    this.pos = new THREE.Vector3(pos.x, 0, pos.z);
    this.yaw = Math.random() * Math.PI * 2;
    this.alive = true;
    this.civilian = true;
    this.hp = 55;
    this.deathT = 0;
    this.hitFlash = 0;
    this.headOffset = new THREE.Vector3(0, 1.62, 0);
    this.chestOffset = new THREE.Vector3(0, 1.1, 0);
    this.dir = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    this.walkT = 0;
    this.idleT = 1 + Math.random() * 2;
    this.speed = 0;
    this.phase = Math.random() * 10;
    this.fleeT = 0;
    this.fleeTo = null;

    this.ch = new Character({
      skin: [0.72, 0.56, 0.45],
      pants: [0.22, 0.24, 0.28],
      shirt: SHIRTS[(Math.random() * SHIRTS.length) | 0],
      boots: [0.1, 0.1, 0.1],
      vest: null,
      helmet: false,
      weaponType: 'pistol',
      weaponTint: [0.15, 0.15, 0.18],
    });
    this.ch.setAppearance({ outfit: OUTFITS[(Math.random() * OUTFITS.length) | 0], glasses: Math.random() < .3, showCap: Math.random() < .4 });
    // Apply SA Wardrobe preset for modular civilian clothing
    if (this.ch.wardrobe) {
      const civPreset = Math.random() > 0.5 ? OUTFIT_PRESETS.casual : OUTFIT_PRESETS.minimal;
      for (const [slot, item] of Object.entries(civPreset)) {
        if (item) this.ch.wardrobe.equip(slot, item);
        else this.ch.wardrobe.unequip(slot);
      }
    }
    this.ch.root.position.copy(this.pos);
    this.ch.root.rotation.y = this.yaw;
    this.scene.add(this.ch.root);
  }

  fleeFrom(pos, radius) {
    if (!this.alive) return;
    if (this.pos.distanceTo(pos) < radius) {
      this.fleeTo = pos.clone();
      this.fleeT = 2 + Math.random() * 1.5;
      this.idleT = 0;
      this.walkT = 0;
    }
  }

  raycastHit(origin, dir, maxDist) {
    const headC = this.pos.clone().add(this.headOffset);
    const chestC = this.pos.clone().add(this.chestOffset);
    let best = null;
    const sphere = (c, r, head) => {
      const oc = c.clone().sub(origin);
      const t = oc.dot(dir);
      if (t < 0 || t > maxDist) return null;
      const d2 = oc.lengthSq() - t * t;
      if (d2 > r * r) return null;
      const dist = t - Math.sqrt(r * r - d2);
      return { dist: Math.max(dist, 0), head };
    };
    const h = sphere(headC, .2, true);
    const b = sphere(chestC, .42, false);
    const leg = sphere(this.pos.clone().add(new THREE.Vector3(0, .45, 0)), .36, false);
    for (const x of [h, b, leg]) if (x && (!best || x.dist < best.dist)) best = x;
    return best;
  }

  takeDamage(amount, head) {
    if (!this.alive) return false;
    this.hp -= amount;
    this.hitFlash = .12;
    if (this.hp <= 0) { this.die(); return true; }
    return false;
  }

  die() {
    this.alive = false;
    this.deathT = 0;
    if (this.onDie) this.onDie(this);
  }

  update(dt) {
    if (!this.alive) {
      this.deathT += dt;
      const k = Math.min(this.deathT / .5, 1);
      this.ch.root.rotation.x = -k * Math.PI / 2 * .96;
      this.ch.root.position.y = Math.sin(k * Math.PI) * .15 - Math.max(0, this.deathT - 2.2) * .4;
      return;
    }
    if (this.hitFlash > 0) this.hitFlash -= dt;

    if (this.fleeT > 0) {
      this.fleeT -= dt;
      const away = this.pos.clone().sub(this.fleeTo);
      away.y = 0;
      if (away.lengthSq() > 0.01) away.normalize(); else away.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
      this.dir.lerp(away, .25).normalize();
      this.speed = 3.8;
    } else if (this.idleT > 0) {
      this.idleT -= dt;
      this.speed = 0;
    } else {
      if (this.walkT <= 0) {
        this.walkT = 1.5 + Math.random() * 2.5;
        const a = Math.random() * Math.PI * 2;
        this.dir.set(Math.sin(a), 0, Math.cos(a));
      }
      this.walkT -= dt;
      this.speed = 1.4;
    }

    const nx = this.pos.x + this.dir.x * this.speed * dt;
    const nz = this.pos.z + this.dir.z * this.speed * dt;
    if (this.world.colliderAt(nx, nz, .45)) {
      this.dir.set(-this.dir.x, 0, -this.dir.z);
      this.walkT = Math.min(this.walkT, .4);
    } else {
      this.pos.set(nx, 0, nz);
    }
    this.yaw = Math.atan2(this.dir.x, this.dir.z);

    this.phase += dt * (this.speed * 1.8 + .5);
    this.ch.setState({
      x: this.pos.x, y: 0, z: this.pos.z, yaw: this.yaw, pitch: 0,
      crouch: 0, aim: 0, moveX: 0, moveZ: 1, sprint: 0, lean: 0,
      speed: this.speed, phase: this.phase, weaponType: 'pistol', airborne: 0, landDip: 0
    });
  }
}

export class Civilians {
  constructor(scene, world, count, spawnPoints) {
    this.scene = scene;
    this.world = world;
    this.list = [];
    this.onCasualty = null;
    this.seed(count, spawnPoints);
  }

  seed(count, spawnPoints) {
    this.clearAll();
    if (!spawnPoints || !spawnPoints.length) return;
    for (let i = 0; i < count; i++) {
      const sp = spawnPoints[(Math.random() * spawnPoints.length) | 0];
      const pos = new THREE.Vector3(sp.x + (Math.random() - .5) * 8, 0, sp.z + (Math.random() - .5) * 8);
      if (this.world && this.world.colliderAt(pos.x, pos.z, .6)) continue;
      const c = new Civilian(this.scene, this.world, pos);
      c.onDie = (civ) => { if (this.onCasualty) this.onCasualty(civ); };
      this.list.push(c);
    }
  }

  alive() {
    const out = [];
    for (const c of this.list) if (c.alive) out.push(c);
    return out;
  }

  update(dt) {
    for (const c of this.list) c.update(dt);
  }

  fleeFrom(pos, radius) {
    for (const c of this.list) c.fleeFrom(pos, radius);
  }

  clearAll() {
    for (const c of this.list) {
      this.scene.remove(c.ch.root);
    }
    this.list = [];
  }
}
