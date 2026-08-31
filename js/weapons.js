// Weapons: procedural viewmodels, firing, ADS, recoil, reload, tracers.
import * as THREE from 'three';
import { makeMetalTexture, makeCamoTexture, makeFlashSprite } from './textures.js';

const V = () => new THREE.Vector3();

export class WeaponSystem {
  constructor(camera, scene, world, effects, audio, hud) {
    this.camera = camera; this.scene = scene; this.world = world;
    this.fx = effects; this.audio = audio; this.hud = hud;
    this.rig = new THREE.Group();           // attached to camera
    camera.add(this.rig);
    this.swayRot = new THREE.Vector2();
    this.recoil = 0; this.recoilRot = 0;
    this.adsT = 0;                          // 0 hip, 1 ads
    this.switching = 0;
    this.flashTex = makeFlashSprite();
    this.defs = this.buildDefs();
    this.current = 0;
    this.projectiles = [];
    this.equip(0, true);
  }

  buildDefs() {
    return [
      {
        id: 'rifle', name: 'AR-77 VANGUARD', mode: 'FULL AUTO', auto: true, type: 'hitscan',
        rpm: 720, damage: 26, headMult: 2.4, mag: 30, reserve: 240, reloadTime: 1.05,
        spreadHip: 0.028, spreadAds: 0.0035, kick: 0.016, range: 120, zoomFov: 48,
        tracerEvery: 1, adsPos: new THREE.Vector3(0, -0.145, 0.1), buildMesh: () => buildRifle(),
      },
      {
        id: 'pistol', name: 'P9 SIDEARM', mode: 'SEMI AUTO', auto: false, type: 'hitscan',
        rpm: 380, damage: 34, headMult: 2.3, mag: 15, reserve: 120, reloadTime: 0.75,
        spreadHip: 0.02, spreadAds: 0.005, kick: 0.028, range: 70, zoomFov: 62,
        tracerEvery: 1, adsPos: new THREE.Vector3(0, -0.125, 0.08), buildMesh: () => buildPistol(),
      },
      {
        id: 'dmr', name: 'LR-50 LONGSHOT', mode: 'SEMI AUTO', auto: false, type: 'hitscan',
        rpm: 190, damage: 85, headMult: 2.6, mag: 8, reserve: 60, reloadTime: 1.3,
        spreadHip: 0.045, spreadAds: 0.0008, kick: 0.06, range: 220, zoomFov: 26,
        tracerEvery: 1, adsPos: new THREE.Vector3(0, -0.15, 0.1), buildMesh: () => buildDMR(),
      },
      {
        id: 'sniper', name: 'M-40 HEADHUNTER', mode: 'BOLT ACTION', auto: false, type: 'hitscan',
        rpm: 45, damage: 110, headMult: 4.0, mag: 5, reserve: 40, reloadTime: 1.5,
        spreadHip: 0.06, spreadAds: 0.0002, kick: 0.11, range: 320, zoomFov: 14,
        tracerEvery: 1, adsPos: new THREE.Vector3(0, -0.16, 0.12), buildMesh: () => buildSniper(),
      },
      {
        id: 'lmg', name: 'MG-60 REAPER', mode: 'FULL AUTO', auto: true, type: 'hitscan',
        rpm: 600, damage: 22, headMult: 2.2, mag: 100, reserve: 300, reloadTime: 2.1,
        spreadHip: 0.05, spreadAds: 0.012, kick: 0.022, range: 110, zoomFov: 52,
        tracerEvery: 1, adsPos: new THREE.Vector3(0, -0.16, 0.12), buildMesh: () => buildLMG(),
      },
      {
        id: 'rocket', name: 'RPG-9 WARHEAD', mode: 'LAUNCHER', auto: false, type: 'bouncer',
        rpm: 30, damage: 320, headMult: 1, mag: 9999, reserve: 9999, reloadTime: 0.15,
        spreadHip: 0.001, spreadAds: 0.0005, kick: 0.05, range: 200, zoomFov: 55,
        blastRadius: 16, blastDmg: 320, tracerEvery: 1, adsPos: new THREE.Vector3(0, -0.16, 0.12), buildMesh: () => buildRocket(),
      },
      {
        id: 'grenade', name: 'M67 FRAG', mode: 'THROWABLE', auto: false, type: 'grenade',
        rpm: 120, damage: 150, headMult: 1, mag: 2, reserve: 6, reloadTime: 0.6,
        spreadHip: 0, spreadAds: 0, kick: 0, range: 40, zoomFov: 70,
        blastRadius: 600, blastDmg: 180, adsPos: new THREE.Vector3(0, -0.14, 0.12), buildMesh: () => buildGrenade(),
      },
      {
        id: 'flame', name: 'M2 INFERNO', mode: 'FLAMETHROWER', auto: true, type: 'flame',
        rpm: 600, damage: 7, headMult: 1, mag: 200, reserve: 600, reloadTime: 1.4,
        spreadHip: 0.04, spreadAds: 0.02, kick: 0.004, range: 16, zoomFov: 68,
        flameRange: 16, flameDps: 26, burnDur: 4.5, adsPos: new THREE.Vector3(0, -0.15, 0.12), buildMesh: () => buildFlame(),
      },
    ];
  }

  equip(i, instant = false) {
    if (this.state && this.state.reloading) this.state.reloading = false;
    if (this.mesh) this.rig.remove(this.mesh);
    this.current = i;
    const d = this.defs[i];
    if (!d.state) d.state = { mag: d.mag, reserve: d.reserve, reloading: false, reloadT: 0, lastShot: 0, semiLatch: false };
    this.state = d.state;
    this.mesh = d.buildMesh();
    this.mesh.position.copy(this.hipPos());
    this.rig.add(this.mesh);
    this.muzzle = this.mesh.getObjectByName('muzzle');
    this.flash = this.mesh.getObjectByName('flash');
    this.switching = instant ? 0 : 1;
    this.hud.setWeapon(d, this.state);
  }

  hipPos() { return new THREE.Vector3(0.22, -0.2, -0.42); }

  get def() { return this.defs[this.current]; }

  swap(dir) {
    const n = (this.current + dir + this.defs.length) % this.defs.length;
    if (n !== this.current) { this.audio.reload(1); this.equip(n); }
  }

  startReload() {
    const d = this.def, s = this.state;
    if (s.reloading || s.mag >= d.mag || s.reserve <= 0) return;
    s.reloading = true; s.reloadT = d.reloadTime;
    this.audio.reload(0);
    this.hud.setReloading(true);
  }

  update(dt, input, enemies, onKill, game) {
    const d = this.def, s = this.state;

    // switching animation
    if (this.switching > 0) this.switching = Math.max(0, this.switching - dt * 4);

    // reload
    if (s.reloading) {
      s.reloadT -= dt;
      if (s.reloadT <= 0) {
        const need = d.mag - s.mag;
        const take = Math.min(need, s.reserve);
        s.mag += take; s.reserve -= take;
        s.reloading = false;
        this.audio.reload(1);
        this.hud.setReloading(false);
        this.hud.setWeapon(d, s);
      }
    } else if (s.mag <= 0 && s.reserve > 0 && d.type !== 'grenade') {
      // automatic reload when the magazine runs dry
      this.startReload();
    }

    // ADS
    const wantAds = input.ads && !s.reloading && this.switching <= 0 && !game.player.sprinting;
    this.adsT += ((wantAds ? 1 : 0) - this.adsT) * Math.min(dt * 11, 1);
    game.player.fovKick = (d.zoomFov - game.player.fovBase) * this.adsT;

    // firing
    const canFire = !s.reloading && this.switching <= 0 && !game.player.sprinting;
    const interval = 60 / d.rpm;
    const now = performance.now() / 1000;
    if (input.throwGrenade) {
      const gi = this.defs.findIndex(x => x.id === 'grenade');
      if (gi >= 0) {
        if (!this.defs[gi].state) this.equip(gi, true); // ensure grenade state exists (first use)
        if (this.def.id !== 'grenade') this.equip(gi);
        if (this.def.id === 'grenade') this.throwGrenade(game);
      }
      input.throwGrenade = false;
    }

    if (input.fire && canFire && now - s.lastShot >= interval) {
      if (d.type === 'grenade') { /* grenades are thrown, not fired */ }
      else if (d.type === 'flame') {
        if (s.mag > 0) { this.flame(enemies, game); s.lastShot = now; }
        else { this.audio.reload(0); this.hud.showReloadHint(true); }
      }
      else if (d.auto || !s.semiLatch) {
        if (s.mag > 0) { this.fire(enemies, onKill, game); s.lastShot = now; s.semiLatch = true; }
        else { this.audio.reload(0); s.semiLatch = true; this.hud.showReloadHint(true); }
      }
    }
    if (!input.fire) s.semiLatch = false;
    if (s.mag > 0) this.hud.showReloadHint(false);
    else if (!s.reloading) this.hud.showReloadHint(true);

    // recoil recovery
    this.recoil *= Math.pow(0.001, dt);
    this.recoilRot *= Math.pow(0.001, dt);
    game.player.pitch += this.recoilRot * dt * 10;
    this.recoilRot *= Math.pow(0.02, dt);

    // viewmodel motion
    const p = game.player;
    this.swayRot.x += ((-input.mouseDX * 0.0016) - this.swayRot.x) * Math.min(dt * 9, 1);
    this.swayRot.y += ((-input.mouseDY * 0.0016) - this.swayRot.y) * Math.min(dt * 9, 1);
    input.mouseDX *= 0.5; input.mouseDY *= 0.5;

    const hip = this.hipPos(), ads = d.adsPos;
    const t = this.adsT;
    const pos = hip.clone().lerp(ads, t);
    const bob = Math.sin(p.bobPhase) * 0.008 * p.bobAmp * (1 - t * .9);
    const bob2 = Math.abs(Math.cos(p.bobPhase)) * 0.006 * p.bobAmp * (1 - t * .9);
    pos.x += bob; pos.y += bob2;
    pos.z += this.recoil * 0.12;
    pos.y += this.switching * -0.25;
    this.mesh.position.copy(pos);
    this.mesh.rotation.set(
      this.recoil * 1.2 + this.swayRot.y + this.switching * -.8,
      this.swayRot.x,
      this.swayRot.x * .5
    );

    // hide viewmodel at high ADS zoom (scope feel) for DMR
    this.mesh.visible = !(d.id === 'dmr' && this.adsT > 0.85);

    // muzzle flash decay
    if (this.flash && this.flash.visible) {
      this.flash.material.opacity -= dt * 14;
      if (this.flash.material.opacity <= 0) this.flash.visible = false;
    }

    // travelling warheads (rocket)
    if (this.projectiles.length) this.updateProjectiles(dt, enemies, onKill, game);
  }

  fire(enemies, onKill, game) {
    const d = this.def, s = this.state;
    s.mag--;
    this.hud.setWeapon(d, s);

    // recoil
    const kick = d.kick * (1 - this.adsT * .45);
    game.player.pitch += kick * (0.8 + Math.random() * .4);
    game.player.yaw += kick * (Math.random() - .5) * .8;
    this.recoil = Math.min(this.recoil + kick * 3.2, .3);
    this.recoilRot = kick * .4;
    this.fx.addShake(d.id === 'dmr' ? .12 : .04);

    // spread
    const spread = (d.spreadHip * (1 - this.adsT) + d.spreadAds * this.adsT) * (game.player.sprinting ? 1.6 : 1);
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    dir.x += (Math.random() - .5) * spread * 2;
    dir.y += (Math.random() - .5) * spread * 2;
    dir.z += (Math.random() - .5) * spread * 2;
    dir.normalize();

    const origin = this.camera.getWorldPosition(V());

    // muzzle world position for tracer/flash origin
    const muzzlePos = new THREE.Vector3();
    if (this.muzzle) this.muzzle.getWorldPosition(muzzlePos);
    else muzzlePos.copy(origin).addScaledVector(dir, 1);

    // explosive weapons (rocket) spawn a travelling warhead instead of a hitscan
    if (d.type === 'bouncer') {
      this.spawnRocket(muzzlePos, dir, d, game);
      this.audio.gunshot('rocket', 0);
      if (this.flash) { this.flash.visible = true; this.flash.material.opacity = 1; this.flash.rotation.z = Math.random() * Math.PI; this.flash.scale.setScalar(.9); }
      this.fx.flashLight(muzzlePos, 0xffc060, 26, .06);
      if (game.civilians) game.civilians.fleeFrom(this.camera.position, 45);
      game.stats.shotsFired++;
      return;
    }

    // raycast: enemies first (sphere tests), then world
    const myTeam = game.network?.myTeam;
    let hitDist = d.range, hitEnemy = null, hitHead = false;
    for (const e of enemies) {
      if (!e.alive) continue;
      if (myTeam >= 0 && e.team === myTeam) continue;
      const hit = e.raycastHit(origin, dir, hitDist);
      if (hit && hit.dist < hitDist) { hitDist = hit.dist; hitEnemy = e; hitHead = hit.head; }
    }
    // Solid world geometry can occlude the shot, but the ground plane should NOT
    // cancel an enemy hit (aiming slightly down at a target on the ground).
    const wHit = this.world.raycastSolids(origin, dir, hitDist);
    if (wHit && wHit.dist < hitDist) { hitDist = wHit.dist; hitEnemy = null; }

    const end = origin.clone().addScaledVector(dir, hitDist);
    this.fx.tracer(muzzlePos, end);
    this.audio.gunshot(d.id === 'dmr' ? 'sniper' : d.id);
    if (game.civilians) game.civilians.fleeFrom(this.camera.position, 45);

    // muzzle flash
    if (this.flash) {
      this.flash.visible = true;
      this.flash.material.opacity = 1;
      this.flash.rotation.z = Math.random() * Math.PI;
      const fs = 0.5 + Math.random() * .3;
      this.flash.scale.setScalar(fs);
    }
    this.fx.flashLight(muzzlePos, 0xffc060, 26, .06);

    if (hitEnemy) {
      const dmg = d.damage * (hitHead ? d.headMult : 1);
      this.fx.bloodPuff(end);
      const killed = hitEnemy.takeDamage(dmg, hitHead);
      this.hud.hitmarker(killed);
      this.audio.hitmarker(killed);
      game.stats.shotsHit++;
      if (killed) onKill(hitEnemy, hitHead, d);
    } else if (wHit) {
      this.fx.impactDust(end, wHit.normal && !wHit.ground ? wHit.normal : new THREE.Vector3(0, 1, 0));
      // shooting solid world geometry can set flexible props swaying or set flammables alight
      if (!wHit.ground) this.world.hitReactive(end, true);
    }
    game.stats.shotsFired++;
  }

  spawnRocket(pos, dir, d, game) {
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(.06, .06, .5, 8),
      new THREE.MeshStandardMaterial({ color: 0x2a2c28, roughness: .6, metalness: .5, emissive: 0x551500, emissiveIntensity: .6 })
    );
    mesh.rotation.x = Math.PI / 2;
    mesh.position.copy(pos);
    this.scene.add(mesh);
    const vel = dir.clone().multiplyScalar(60);
    this.projectiles.push({ mesh, vel, pos: pos.clone(), life: 5, dmg: d.damage, blast: d.blastRadius, blastDmg: d.blastDmg, game, bouncer: true });
    this.fx.flashLight(pos.clone(), 0xff7020, 18, .1);
  }

  throwGrenade(game) {
    const d = this.def;
    if (this.state.mag <= 0) { this.audio.reload(0); this.hud.showReloadHint(true); return; }
    this.state.mag--;
    this.hud.setWeapon(d, this.state);
    game.stats.shotsFired++;
    // launch from camera, gentle lob
    const origin = this.camera.getWorldPosition(V());
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(.12, 8, 6),
      new THREE.MeshStandardMaterial({ color: 0x2f3a22, roughness: .8 })
    );
    mesh.position.copy(origin);
    this.scene.add(mesh);
    const vel = dir.clone().multiplyScalar(22); vel.y += 6;
    this.projectiles.push({ mesh, vel, pos: origin.clone(), life: 3.5, dmg: d.damage, blast: d.blastRadius, blastDmg: d.blastDmg, game, grenade: true });
    this.audio.grenadeThrow();
    this.fx.flashLight(origin.clone(), 0xfff0c0, 8, .05);
  }

  // Flamethrower: sprays a short fire cone. Enemies caught in it are ignited (set on
  // fire) and take burn damage; they can do nothing while burning.
  flame(enemies, game) {
    const d = this.def, s = this.state;
    s.mag--;
    this.hud.setWeapon(d, s);
    game.stats.shotsFired++;
    const origin = this.camera.getWorldPosition(V());
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    const muzzle = new THREE.Vector3();
    if (this.muzzle) this.muzzle.getWorldPosition(muzzle); else muzzle.copy(origin).addScaledVector(dir, 1);
    this.fx.fire(muzzle, dir, 1);
    this.audio.flame();
    this.fx.flashLight(muzzle, 0xff6a20, 10, .05);
    // ignite + damage enemies within range and inside the cone
    const myTeam = game.network?.myTeam;
    for (const e of enemies) {
      if (!e.alive) continue;
      if (myTeam >= 0 && e.team === myTeam) continue;
      const to = e.pos.clone().add(new THREE.Vector3(0, 1, 0)).sub(origin);
      const dist = to.length();
      if (dist > d.flameRange) continue;
      to.normalize();
      if (to.dot(dir) < 0.86) continue; // outside the ~30° cone
      e.takeDamage(d.damage, false);
      if (e.ignite) e.ignite(d.burnDur, d.flameDps);
    }
    // also set nearby flammable world props alight
    const tip = origin.clone().addScaledVector(dir, d.flameRange * 0.6);
    this.world.hitReactive(tip, true);
  }

  updateProjectiles(dt, enemies, onKill, game) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.life -= dt;
      p.vel.y -= 9 * dt;                       // slight arc
      const step = p.vel.clone().multiplyScalar(dt);
      const next = p.pos.clone().add(step);
      // hit world solids?
      const wHit = this.world.raycastSolids(p.pos, step.clone().normalize(), step.length());
      // hit ground?
      let groundHit = null;
      if (step.y < 0 && next.y <= 0.1) groundHit = p.pos.clone().setY(0.1);
      // hit enemy?
      let enemyHit = null;
      for (const e of enemies) {
        if (!e.alive) continue;
        const hit = e.raycastHit(p.pos, step.clone().normalize(), step.length());
        if (hit) { enemyHit = e; break; }
      }
      if (p.life <= 0) {
        // grenade / rocket fuse runs out -> detonate in place (grenade "waits until it explodes")
        this.detonate(next.clone(), p, enemies, onKill, game);
        this.scene.remove(p.mesh);
        this.projectiles.splice(i, 1);
      } else if (enemyHit && (p.bouncer || p.grenade)) {
        // rocket / grenade strikes a target -> massive explosion
        this.detonate(enemyHit.pos.clone().add(new THREE.Vector3(0, 1, 0)), p, enemies, onKill, game);
        this.scene.remove(p.mesh);
        this.projectiles.splice(i, 1);
      } else if ((p.grenade || p.bouncer) && (groundHit || wHit)) {
        // bounce off surfaces, losing energy, until the fuse expires
        if (groundHit) { p.vel.y = Math.abs(p.vel.y) * .5; p.vel.x *= .62; p.vel.z *= .62; p.pos.y = 0.12; }
        if (wHit) { p.vel.x *= -.42; p.vel.z *= -.42; p.vel.y = Math.abs(p.vel.y) * .32; }
        this.audio.grenadeBounce();
        if (p.vel.lengthSq() < 0.5) p.vel.set(0, 0, 0);
      } else if (groundHit || wHit) {
        // fallback: detonate on contact
        const at = groundHit || (wHit ? wHit.point : next.clone());
        this.detonate(at, p, enemies, onKill, game);
        this.scene.remove(p.mesh);
        this.projectiles.splice(i, 1);
      } else {
        p.pos.copy(next);
        p.mesh.position.copy(next);
        // orient along velocity
        const dir = p.vel.clone().normalize();
        p.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
        this.fx.flashLight(next.clone(), 0xff6020, 10, .04);
      }
    }
  }

  detonate(at, p, enemies, onKill, game) {
    this.fx.explosion(at, Math.min(p.blast / 7, 4));
    this.audio.rocketImpact(0);
    // damage every enemy within blast radius
    const myTeam = game.network?.myTeam;
    for (const e of enemies) {
      if (!e.alive) continue;
      if (myTeam >= 0 && e.team === myTeam) continue;
      const dist = e.pos.distanceTo(at);
      if (dist < p.blast) {
        const dmg = p.blastDmg * (1 - dist / p.blast) + 30;
        const killed = e.takeDamage(dmg, false);
        game.stats.shotsHit++;
        if (killed) onKill(e, false, { name: p.bouncer ? 'RPG-9' : 'M67', headMult: 1 });
      }
    }
    // self-damage if close (capped so the giant frag doesn't always kill)
    const pd = game.player.pos.distanceTo(at);
    if (pd < p.blast) game.damagePlayer(Math.min(p.blastDmg * (1 - pd / p.blast) * 0.5, 60), null);
    if (game.civilians) game.civilians.fleeFrom(at, p.blast + 12);
  }
}

// ---------- procedural gun meshes ----------
function gunMats() {
  const metal = new THREE.MeshStandardMaterial({ map: makeMetalTexture(128, [52, 54, 58]), roughness: .45, metalness: .8 });
  const polymer = new THREE.MeshStandardMaterial({ color: 0x1c1e20, roughness: .8, metalness: .1 });
  const camo = new THREE.MeshStandardMaterial({ map: makeCamoTexture(128), roughness: .85 });
  return { metal, polymer, camo };
}

function part(g, geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z); m.rotation.set(rx, ry, rz);
  m.castShadow = false;
  g.add(m); return m;
}

function addMuzzleAndFlash(g, x, y, z, flashTexScale = 1) {
  const mz = new THREE.Object3D(); mz.name = 'muzzle'; mz.position.set(x, y, z); g.add(mz);
  const flash = new THREE.Sprite(new THREE.SpriteMaterial({
    map: sharedFlashTex(), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false
  }));
  flash.name = 'flash'; flash.position.set(x, y, z - 0.05); flash.visible = false;
  flash.scale.setScalar(0.5 * flashTexScale);
  g.add(flash);
}

let _flashTex = null;
function sharedFlashTex() {
  if (!_flashTex) _flashTex = makeFlashSprite();
  return _flashTex;
}

function buildRifle() {
  const { metal, polymer, camo } = gunMats();
  const g = new THREE.Group();
  part(g, new THREE.BoxGeometry(.055, .09, .5), camo, 0, 0, -0.1);              // receiver
  part(g, new THREE.CylinderGeometry(.014, .014, .42, 8), metal, 0, .012, -0.5, Math.PI / 2); // barrel
  part(g, new THREE.BoxGeometry(.04, .05, .1), polymer, 0, .012, -0.72);        // muzzle brake
  part(g, new THREE.BoxGeometry(.05, .07, .26), polymer, 0, -.02, -0.42);       // handguard
  part(g, new THREE.BoxGeometry(.014, .05, .02), metal, 0, .075, -0.62);        // front sight
  part(g, new THREE.BoxGeometry(.04, .045, .14), metal, 0, .075, -0.08);        // rear sight / optic base
  part(g, new THREE.CylinderGeometry(.02, .02, .07, 8), metal, 0, .095, -0.08, Math.PI / 2); // optic
  part(g, new THREE.BoxGeometry(.045, .1, .07), polymer, 0, -.1, .02, 0.25);    // grip
  part(g, new THREE.BoxGeometry(.045, .14, .06), polymer, 0, -.12, -0.2, -0.12);// magazine
  part(g, new THREE.BoxGeometry(.05, .08, .22), camo, 0, -.01, .2);             // stock
  part(g, new THREE.BoxGeometry(.05, .1, .04), polymer, 0, -.02, .31);          // butt pad
  addMuzzleAndFlash(g, 0, .012, -0.78);
  return g;
}

function buildPistol() {
  const { metal, polymer } = gunMats();
  const g = new THREE.Group();
  part(g, new THREE.BoxGeometry(.04, .06, .24), metal, 0, .02, -0.06);          // slide
  part(g, new THREE.BoxGeometry(.038, .045, .2), polymer, 0, -.02, -0.04);      // frame
  part(g, new THREE.BoxGeometry(.04, .11, .05), polymer, 0, -.09, .05, 0.2);    // grip
  part(g, new THREE.BoxGeometry(.01, .02, .015), metal, 0, .06, -0.16);         // front sight
  part(g, new THREE.BoxGeometry(.03, .02, .015), metal, 0, .06, .03);           // rear sight
  part(g, new THREE.CylinderGeometry(.009, .009, .05, 6), metal, 0, .02, -0.19, Math.PI / 2); // barrel tip
  addMuzzleAndFlash(g, 0, .02, -0.22, .7);
  return g;
}

function buildDMR() {
  const { metal, polymer, camo } = gunMats();
  const g = new THREE.Group();
  part(g, new THREE.BoxGeometry(.06, .1, .6), camo, 0, 0, -0.15);               // receiver+chassis
  part(g, new THREE.CylinderGeometry(.016, .016, .6, 8), metal, 0, .02, -0.7, Math.PI / 2); // long barrel
  part(g, new THREE.BoxGeometry(.045, .06, .12), metal, 0, .02, -1.0);          // suppressor-ish
  part(g, new THREE.BoxGeometry(.05, .06, .3), polymer, 0, -.03, -0.5);         // handguard
  part(g, new THREE.CylinderGeometry(.028, .028, .18, 10), metal, 0, .11, -0.15, Math.PI / 2); // scope
  part(g, new THREE.BoxGeometry(.012, .04, .02), metal, 0, .06, -0.2);          // scope mount
  part(g, new THREE.BoxGeometry(.012, .04, .02), metal, 0, .06, -0.08);
  part(g, new THREE.BoxGeometry(.05, .11, .08), polymer, 0, -.11, .05, 0.25);   // grip
  part(g, new THREE.BoxGeometry(.05, .16, .07), polymer, 0, -.14, -0.18);       // mag
  part(g, new THREE.BoxGeometry(.055, .09, .28), camo, 0, 0, .25);              // stock
  part(g, new THREE.BoxGeometry(.02, .06, .1), polymer, 0, -.07, .3);           // monopod
  addMuzzleAndFlash(g, 0, .02, -1.08, 1.4);
  return g;
}

function buildSniper() {
  const { metal, polymer, camo } = gunMats();
  const g = new THREE.Group();
  part(g, new THREE.BoxGeometry(.05, .08, .62), camo, 0, 0, -0.1);
  part(g, new THREE.CylinderGeometry(.014, .014, .9, 8), metal, 0, .02, -0.85, Math.PI / 2); // long heavy barrel
  part(g, new THREE.CylinderGeometry(.03, .03, .2, 10), metal, 0, .11, -0.15, Math.PI / 2);   // big scope
  part(g, new THREE.BoxGeometry(.012, .04, .02), metal, 0, .06, -0.2);
  part(g, new THREE.BoxGeometry(.012, .04, .02), metal, 0, .06, -0.08);
  part(g, new THREE.BoxGeometry(.045, .11, .08), polymer, 0, -.11, .06, 0.25);  // grip
  part(g, new THREE.BoxGeometry(.045, .14, .06), polymer, 0, -.13, -0.16);       // mag
  part(g, new THREE.BoxGeometry(.06, .1, .3), camo, 0, .0, .26);                 // stock
  part(g, new THREE.BoxGeometry(.02, .05, .12), polymer, 0, -.06, .34);          // cheek rest
  addMuzzleAndFlash(g, 0, .02, -1.3, 1.5);
  return g;
}

function buildLMG() {
  const { metal, polymer, camo } = gunMats();
  const g = new THREE.Group();
  part(g, new THREE.BoxGeometry(.07, .11, .55), camo, 0, 0, -0.1);
  part(g, new THREE.CylinderGeometry(.018, .018, .55, 8), metal, 0, .012, -0.55, Math.PI / 2);
  part(g, new THREE.BoxGeometry(.05, .07, .3), polymer, 0, -.02, -0.45);
  part(g, new THREE.CylinderGeometry(.03, .03, .12, 8), metal, 0, .08, -0.1, Math.PI / 2); // optic
  part(g, new THREE.BoxGeometry(.05, .12, .09), polymer, 0, -.12, .02, 0.25);   // grip
  // belt-fed box mag
  part(g, new THREE.BoxGeometry(.09, .12, .16), metal, 0, -.14, -0.18);
  part(g, new THREE.BoxGeometry(.06, .08, .22), camo, 0, -.05, .18);            // stock
  part(g, new THREE.CylinderGeometry(.02, .02, .3, 6), metal, 0, -.16, -.28, Math.PI / 2); // bipod leg
  addMuzzleAndFlash(g, 0, .012, -0.82, 1.1);
  return g;
}

function buildRocket() {
  const { metal, polymer, camo } = gunMats();
  const g = new THREE.Group();
  part(g, new THREE.BoxGeometry(.07, .1, .3), polymer, 0, 0, -0.02);            // launch tube body
  part(g, new THREE.CylinderGeometry(.06, .06, .9, 12), camo, 0, 0, -0.45, Math.PI / 2); // tube
  part(g, new THREE.BoxGeometry(.08, .12, .12), metal, 0, -.02, .12, 0.2);      // grip/pistol
  part(g, new THREE.BoxGeometry(.04, .06, .1), metal, 0, .06, .1);             // sight
  part(g, new THREE.BoxGeometry(.05, .1, .14), polymer, 0, -.05, .2);           // shoulder rest
  addMuzzleAndFlash(g, 0, 0, -0.9, 1.2);
  return g;
}

function buildGrenade() {
  const { metal, polymer } = gunMats();
  const g = new THREE.Group();
  part(g, new THREE.CylinderGeometry(.055, .055, .13, 10), metal, 0, 0, -0.05);     // body
  part(g, new THREE.SphereGeometry(.06, 8, 6), metal, 0, 0, 0.02);                  // top
  part(g, new THREE.BoxGeometry(.02, .03, .02), polymer, 0, .07, 0.02);            // pin
  return g;
}

function buildFlame() {
  const { metal, polymer, camo } = gunMats();
  const g = new THREE.Group();
  part(g, new THREE.CylinderGeometry(.06, .08, 1.0, 12), camo, 0, 0, -0.5, Math.PI / 2); // fuel tank
  part(g, new THREE.BoxGeometry(.09, .12, .18), polymer, 0, -.02, .12);                  // grip
  part(g, new THREE.BoxGeometry(.05, .07, .3), metal, 0, .02, -.7);                      // nozzle
  part(g, new THREE.BoxGeometry(.1, .08, .06), metal, 0, .03, .2);                        // top valve
  addMuzzleAndFlash(g, 0, 0, -0.85, 1.1);
  return g;
}