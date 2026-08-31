import * as THREE from 'three';
import { Character } from './character.js';
import { OUTFIT_PRESETS } from './utils/sa-wardrobe.js';

const NAMES = ['VIPER', 'JACKAL', 'REAPER', 'GHOST-7', 'WOLF', 'COBRA', 'TALON', 'HAVOC', 'SPECTRE', 'ONYX', 'FALCON', 'DINGO'];

let botId = 0;

export class Enemy {
  constructor(scene, world, spawnPos, wave, diff, quality) {
    diff = diff || { dmg: 1, acc: 1, spd: 1, aggro: 1 };
    this._scanInterval = quality === 'ultra-low' ? 0.8 : quality === 'low' ? 0.5 : 0.25;
    this.id = botId++;
    this.name = NAMES[this.id % NAMES.length] + '-' + (100 + ((this.id * 37) % 900));
    this.scene = scene; this.world = world;
    
    const WCLASSES = ['rifle', 'rifle', 'smg', 'pistol', 'dmr', 'lmg', 'shotgun', 'sniper'];
    this.weaponType = WCLASSES[(Math.random() * WCLASSES.length) | 0];
    this._effRange = this.weaponType === 'sniper' ? 65 : this.weaponType === 'dmr' ? 55 : this.weaponType === 'rifle' || this.weaponType === 'lmg' ? 42 : this.weaponType === 'smg' ? 30 : this.weaponType === 'shotgun' ? 15 : 25;

    const camoTints = [
      [0.25, 0.28, 0.22],
      [0.32, 0.30, 0.26],
      [0.20, 0.22, 0.24]
    ];
    const myCamo = camoTints[this.id % camoTints.length];

    this.char = new Character({
      skin: [0.72, 0.58, 0.46],
      pants: [0.18, 0.20, 0.22],
      shirt: myCamo,
      boots: [0.12, 0.12, 0.12],
      vest: [0.25, 0.26, 0.22],
      helmet: true,
      pack: Math.random() > 0.4,
      weaponType: this.weaponType,
      weaponTint: [0.15, 0.15, 0.18]
    });
    // Apply SA Wardrobe preset for modular NPC outfit
    const enemyPresets = ['soldier', 'navy', 'cadpat'];
    const presetKey = enemyPresets[this.id % enemyPresets.length];
    if (this.char.wardrobe) {
      const preset = OUTFIT_PRESETS[presetKey] || OUTFIT_PRESETS.soldier;
      for (const [slot, item] of Object.entries(preset)) {
        if (item) this.char.wardrobe.equip(slot, item);
        else this.char.wardrobe.unequip(slot);
      }
    }
    this.group = this.char.root;
    this.pos = spawnPos.clone();
    this.group.position.copy(this.pos);
    scene.add(this.group);

    this.alive = true;
    this.eye = 1.62;
    this.team = -1;
    this.isBot = true;
    this.hp = (100 + wave * 6) * diff.dmg;
    this.maxHp = this.hp;
    this.speed = (2.6 + Math.min(wave * .15, 1.6) + Math.random() * .6) * diff.spd;
    this.damage = (7 + wave * .8) * diff.dmg;
    this.accuracy = Math.min((.35 + wave * .04) * diff.acc, 1);
    this.aggroChance = diff.aggro;
    this.state = 'patrol';
    this.target = null;
    this.strafeDir = Math.random() > .5 ? 1 : -1;
    this.strafeTimer = 0;
    this.shootTimer = 0;
    this.burstLeft = 0;
    this.walkPhase = Math.random() * 6;
    this.deathT = 0;
    this.vel = new THREE.Vector3();
    this.yaw = Math.random() * Math.PI * 2;
    this.headOffset = new THREE.Vector3(0, 1.62, 0);
    this.chestOffset = new THREE.Vector3(0, 1.12, 0);
    this.patrolTarget = this.randomPatrolPoint();
    this.lastSeenTarget = null;
    this.aggro = false;
    this.hitFlash = 0;
    this.burning = false;
    this.burnT = 0;
    this.burnDps = 0;
    this.burnTick = 0;
    this.lastDamagedT = -10;
    this.coverTarget = null;
    this.flankSign = Math.random() > .5 ? 1 : -1;
    this.repathTimer = 0;
    this.crouching = false;
    this.firing = false;
    this.onDamaged = null;
    this._lastTargetPos = null;
    this._warnT = 0;
  }

  ignite(duration, dps) {
    if (!this.alive) return;
    this.burning = true;
    this.burnT = Math.max(this.burnT, duration);
    this.burnDps = Math.max(this.burnDps, dps);
  }

  randomPatrolPoint() {
    const pts = this.world.coverPoints;
    for (let tries = 0; tries < 12; tries++) {
      let p;
      if (pts.length && Math.random() > .35) p = pts[(Math.random() * pts.length) | 0].clone();
      else p = new THREE.Vector3((Math.random() - .5) * 140, 0, (Math.random() - .5) * 140);
      if (!this.world.colliderAt(p.x, p.z, 0.6)) return p;
    }
    return new THREE.Vector3((Math.random() - .5) * 120, 0, (Math.random() - .5) * 120);
  }

  nearestCover(pos, from) {
    const pts = this.world.coverPoints;
    if (!pts.length) return null;
    let best = null, bestD = 1e9;
    for (const p of pts) {
      const d = p.clone().sub(pos).setY(0).length();
      if (d < 2 || d > 40) continue;
      if (!this.world.losBlocked(p.clone().add(new THREE.Vector3(0, 1.4, 0)), from.clone().add(new THREE.Vector3(0, 1.5, 0)))) continue;
      if (d < bestD) { bestD = d; best = p.clone(); }
    }
    return best;
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
    this.aggro = true;
    this.lastDamagedT = 0;
    if (this.onDamaged) this.onDamaged(amount, head, this);
    if (this.hp <= 0) { this.die(); return true; }
    return false;
  }

  die() {
    this.alive = false;
    this.deathT = 0;
  }

  setTeam(team) { this.team = team; }
  setPlayerTeam(team) { this._playerTeam = team; }

  // find the nearest point outside any collider (for escape when stuck in a building)
  _escapeToClear(origin, radius) {
    for (let ang = 0; ang < Math.PI * 2; ang += 0.35) {
      const p = origin.clone().add(new THREE.Vector3(Math.cos(ang) * radius, 0, Math.sin(ang) * radius));
      if (!this.world.colliderAt(p.x, p.z, 0.5)) return p;
    }
    return null;
  }

  update(dt, player, effects, audio, onPlayerHit, allEnemies) {
    if (!this.alive) {
      this.deathT += dt;
      const k = Math.min(this.deathT / .5, 1);
      this.group.rotation.x = -k * Math.PI / 2 * .96;
      this.group.position.y = this.pos.y + Math.sin(k * Math.PI) * .15 - Math.max(0, this.deathT - 2.2) * .4;
      const fade = Math.max(0, 1 - Math.max(0, this.deathT - 2) / 1);
      if (fade < 1) {
        this.group.traverse(o => {
          if (o.isMesh) { o.material.transparent = true; o.material.opacity = fade; }
        });
      }
      return this.deathT < 3;
    }

    if (this.burning) {
      this.burnT -= dt;
      this.burnTick -= dt;
      if (this.burnTick <= 0) {
        this.burnTick = .4;
        const killed = this.takeDamage(this.burnDps * .4, false);
        effects.burst(this.pos.clone().add(new THREE.Vector3(0, 1.2 + Math.random() * .4, 0)), 2,
          new THREE.Color(1, .5 + Math.random() * .3, .15), 2, .5, .5, 1.2);
        if (Math.random() < .5) effects.smoke(this.pos.clone().add(new THREE.Vector3(0, 1.4, 0)), .5, .6, 1.3);
        effects.flashLight(this.pos.clone().add(new THREE.Vector3(0, 1.2, 0)), 0xff5a10, 6, .06);
        if (killed) return false;
      }
      
      const s = {
        x: this.pos.x, y: this.pos.y, z: this.pos.z,
        yaw: this.yaw, pitch: 0, crouch: 0, aim: 0,
        moveX: 0, moveZ: 0, sprint: 0, lean: 0, speed: 0,
        phase: 0, weaponType: this.weaponType, airborne: 0, landDip: 0
      };
      this.char.setState(s);
      
      if (this.burnT <= 0) {
        this.burning = false;
      }
      return true;
    }

    const myEye = this.pos.clone().add(this.headOffset);
    this.lastDamagedT += dt;
    this.repathTimer -= dt;
    this.scanT = (this.scanT ?? 0) - dt;

    // ===== TARGET SELECTION =====
    let target = this._cachedTarget, dist = this._cachedDist ?? 1e9;
    let hunt = this._cachedHunt, huntDist = this._cachedHuntDist ?? 1e9;
    let anyContact = false;

    if (this.scanT <= 0) {
      this.scanT = this._scanInterval || 0.25;
      target = null; dist = 1e9;
      hunt = null; huntDist = 1e9;

      const consider = (c, isPlayer) => {
        if (!c || !c.alive) return;
        if (c === this) return;
        if (isPlayer) {
          if (this.team >= 0 && this._playerTeam !== undefined && this._playerTeam === this.team) return;
        }
        else if (this.team >= 0 && c.team === this.team) return;
        const ep = c.pos.clone().add(new THREE.Vector3(0, (c.eye || 1.6), 0));
        const d = myEye.distanceTo(ep);
        if (d > 90) return;
        if (d < huntDist) { huntDist = d; hunt = c; }
        if (d > 70) return;
        if (this.world.losBlocked(myEye, ep)) return;
        if (d < dist) { dist = d; target = c; target._isPlayer = isPlayer; }
      };
      consider(player, true);
      if (allEnemies) for (const e of allEnemies) if (e !== this) consider(e, false);

      this._cachedTarget = target; this._cachedDist = dist;
      this._cachedHunt = hunt; this._cachedHuntDist = huntDist;

      if (target) {
        this._lastTargetPos = target.pos.clone();
        this.aggro = true;
        anyContact = true;
      } else if (hunt && huntDist < 75) {
        this._lastTargetPos = hunt.pos.clone();
        this.aggro = true;
        anyContact = true;
      }
    } else {
      anyContact = !!(this.aggro && this._lastTargetPos);
    }

    // Always have a target position to shoot at (last known or current)
    const shootTargetPos = target ? target.pos.clone().add(new THREE.Vector3(0, 1.6, 0))
      : (this._lastTargetPos ? this._lastTargetPos.clone().add(new THREE.Vector3(0, 1.6, 0)) : null);

    const suppressed = this.lastDamagedT < 1.3 && this.aggro;
    const huntPos = target ? target.pos : (hunt ? hunt.pos : this._lastTargetPos);
    const seenPos = huntPos || this.lastSeenTarget;

    // ===== STATE MACHINE =====
    let moveTarget = null;
    this.crouching = false;

    if (this.aggro && seenPos) {
      const dLast = seenPos.clone().sub(this.pos).length();

      if (suppressed && target) {
        this.state = 'suppressed';
        this.crouching = true;
        if (this.repathTimer <= 0 || !this.coverTarget) {
          this.coverTarget = this.nearestCover(this.pos, seenPos) || seenPos;
          this.repathTimer = 0.8;
        }
        moveTarget = this.coverTarget;
      } else if (huntPos && dLast < this._effRange + 8) {
        const wasCombat = this.state === 'combat';
        this.state = 'combat';
        if (!wasCombat) this.shootTimer = 0;
        this.strafeTimer -= dt;
        if (this.strafeTimer <= 0) { this.strafeDir *= -1; this.strafeTimer = 0.4 + Math.random() * 0.6; }
        const toDir = seenPos.clone().sub(this.pos).setY(0).normalize();
        const side = new THREE.Vector3(-toDir.z, 0, toDir.x).multiplyScalar(this.strafeDir);
        let desire = new THREE.Vector3();
        if (dLast > 18) desire.add(toDir);
        else if (dLast < 8) desire.sub(toDir);
        desire.addScaledVector(side, .8);
        moveTarget = this.pos.clone().addScaledVector(desire, 3);
      } else if (dLast > 1.5) {
        this.state = 'hunt';
        moveTarget = seenPos;
        if (dLast < 3) {
          this._lastTargetPos = null;
          if (!hunt) { this.aggro = false; this.patrolTarget = this.randomPatrolPoint(); }
        }
      } else {
        if (!hunt) { this.aggro = false; this._lastTargetPos = null; this.patrolTarget = this.randomPatrolPoint(); }
      }
    } else {
      this.state = 'patrol';
      if (this.patrolTarget.clone().sub(this.pos).setY(0).length() < 1.2)
        this.patrolTarget = this.randomPatrolPoint();
      if (allEnemies && Math.random() < 0.04) {
        let best = null, bestD = 1e9;
        for (const o of allEnemies) {
          if (o === this || !o.alive) continue;
          const d = this.pos.distanceTo(o.pos);
          if (d < bestD) { bestD = d; best = o; }
        }
        if (best && bestD < 60) {
          this.patrolTarget = best.pos.clone().add(new THREE.Vector3((Math.random() - .5) * 14, 0, (Math.random() - .5) * 14));
          if (this.world.colliderAt(this.patrolTarget.x, this.patrolTarget.z, 0.6)) this.patrolTarget = this.randomPatrolPoint();
        }
      }
      moveTarget = this.patrolTarget;
    }

    // ===== MOVEMENT WITH IMPROVED BUILDING AVOIDANCE =====
    if (moveTarget) {
      const dir = moveTarget.clone().sub(this.pos).setY(0);
      const dlen = dir.length();
      if (dlen > .1) {
        dir.divideScalar(dlen);

        // Separation from other bots
        if (allEnemies) {
          for (const o of allEnemies) {
            if (o === this || !o.alive) continue;
            const od = o.pos.clone().sub(this.pos).setY(0);
            const ol = od.length();
            if (ol > 0.001 && ol < 1.8) dir.addScaledVector(od.divideScalar(ol), (1.8 - ol) * 1.6);
          }
        }

        // Building avoidance with multi-angle probe
        const probeDist = this.state === 'patrol' ? 1.4 : 1.0;
        const probe = this.pos.clone().addScaledVector(dir.clone().normalize(), probeDist);
        let buildingBlock = this.world.colliderAt(probe.x, probe.z, 0.45);

        if (!buildingBlock) {
          // Also check slightly left/right to detect corners
          const leftCheck = new THREE.Vector3(-dir.z, 0, dir.x);
          const pl = this.pos.clone().addScaledVector(dir.clone().add(leftCheck).normalize(), probeDist);
          const pr = this.pos.clone().addScaledVector(dir.clone().sub(leftCheck).normalize(), probeDist);
          buildingBlock = this.world.colliderAt(pl.x, pl.z, 0.45) || this.world.colliderAt(pr.x, pr.z, 0.45);
        }

        if (buildingBlock) {
          // Multi-angle steering: try increasingly wider angles
          let found = false;
          for (let ang = 0.4; ang <= 2.0; ang += 0.35) {
            for (const sign of [1, -1]) {
              const steer = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(sign * ang);
              const tryDir = dir.clone().add(steer).normalize();
              const tryPos = this.pos.clone().addScaledVector(tryDir, probeDist);
              if (!this.world.colliderAt(tryPos.x, tryPos.z, 0.45)) {
                dir.copy(tryDir);
                found = true;
                break;
              }
            }
            if (found) break;
          }
          if (!found) {
            // All directions blocked: reverse
            dir.multiplyScalar(-1);
          }
        }

        dir.setY(0).normalize();
        const sp = this.state === 'patrol' ? this.speed * .55 : this.speed;
        const step = dir.clone().multiplyScalar(sp * dt);
        const before = this.pos.clone();
        this.tryMove(step);
        this.walkPhase += dt * sp * 2.4;

        // STUCK DETECTOR: if barely moved while wanting to, nudge hard then teleport
        const moved = this.pos.distanceTo(before);
        if (moved < sp * dt * 0.2) {
          this.stuckT = (this.stuckT || 0) + dt;
          if (this.stuckT > 0.15) {
            this.stuckT = 0;
            // Repath
            if (this.state === 'patrol' || !this.aggro) this.patrolTarget = this.randomPatrolPoint();
            else if (this._lastTargetPos) this._lastTargetPos = this.pos.clone().addScaledVector(dir, 8);
            // Hard nudge perpendicular to facing
            const side = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(Math.random() < .5 ? 2 : -2);
            this.tryMove(side.multiplyScalar(sp * dt * 3));
            // If still stuck — ESCAPE: teleport to nearest clear spot
              if (this.pos.distanceTo(before) < sp * dt * 0.01) {
                const esc = this._escapeToClear(this.pos, 2);
                if (esc) this.pos.copy(esc);
                else {
                  const fallback = new THREE.Vector3((Math.random() - .5) * 100, 0, (Math.random() - .5) * 100);
                  if (!this.world.colliderAt(fallback.x, fallback.z, 0.5)) this.pos.copy(fallback);
                }
              }
          }
        } else {
          this.stuckT = 0;
        }
      }
    }

    // ===== FACING =====
    let targetYaw = this.yaw;
    if (this.state === 'combat' && shootTargetPos) {
      const toT = shootTargetPos.clone().sub(myEye);
      targetYaw = Math.atan2(-toT.x, -toT.z);
    } else if (moveTarget) {
      const d = moveTarget.clone().sub(this.pos);
      if (d.lengthSq() > .2) targetYaw = Math.atan2(-d.x, -d.z);
    }
    let dy = targetYaw - this.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    this.yaw += dy * Math.min(dt * 7, 1);

    // Character state
    const isMoving = moveTarget && moveTarget.clone().sub(this.pos).setY(0).length() > 0.15;
    const enemySpeed = isMoving ? (this.state === 'patrol' ? 0.55 : 1.0) : 0;
    
    const cs = {
      x: this.pos.x, y: this.pos.y, z: this.pos.z,
      yaw: this.yaw, pitch: 0,
      crouch: this.crouching ? 1 : 0,
      aim: this.state === 'combat' ? 1 : 0,
      moveX: 0, moveZ: isMoving ? 1 : 0, sprint: 0, lean: 0,
      speed: enemySpeed, phase: this.walkPhase,
      weaponType: this.weaponType, airborne: 0, landDip: 0
    };
    this.char.setState(cs);

    if (this.hitFlash > 0) {
      this.hitFlash -= dt;
      this.group.traverse(o => { if (o.isMesh) o.material.emissive?.setHex(0x441100); });
    } else {
      this.group.traverse(o => { if (o.isMesh) o.material.emissive?.setHex(0x000000); });
    }

    // ===== SHOOTING =====
    this.shootTimer -= dt;
    const canFire = (this.state === 'combat') && target && this.shootTimer <= 0;
    if (canFire) {
      if (this.burstLeft <= 0) {
        this.burstLeft = 2 + (Math.random() * 4 | 0);
        this.shootTimer = 0.15 + Math.random() * 0.35;
      } else {
        this.burstLeft--;
        this.shootTimer = 0.08;
        const actualDist = target ? this.pos.distanceTo(target.pos) : 999;
        if (target._isPlayer) {
          this.fireAt(shootTargetPos, actualDist, effects, audio, onPlayerHit);
        } else {
          this.fireAt(shootTargetPos, actualDist, effects, audio, null, target);
        }
        if (this._onFire) this._onFire(this.pos, 50);
      }
    }
    return true;
  }

  tryMove(step) {
    const r = .38;
    for (const [dx, dz] of [[step.x, 0], [0, step.z]]) {
      if (dx === 0 && dz === 0) continue;
      const nx = this.pos.x + dx, nz = this.pos.z + dz;
      let blocked = false;
      const nearCols = this.world.grid
        ? this.world.grid.queryAABB(nx - r, nz - r, nx + r, nz + r)
        : this.world.colliders;
      for (const c of nearCols) {
        if (c.max.y < .3) continue;
        if (nx + r > c.min.x && nx - r < c.max.x && nz + r > c.min.z && nz - r < c.max.z && c.max.y > this.pos.y + .4) {
          blocked = true; break;
        }
      }
      if (!blocked) { this.pos.x = nx; this.pos.z = nz; }
    }
    const B = this.world.bounds;
    this.pos.x = Math.max(-B, Math.min(B, this.pos.x));
    this.pos.z = Math.max(-B, Math.min(B, this.pos.z));
  }

  fireAt(targetPos, dist, effects, audio, onPlayerHit, botTarget) {
    const muzzle = this.pos.clone().add(new THREE.Vector3(0, 1.35, 0));
    const dir = targetPos.clone().sub(muzzle).normalize();
    const err = (1 - this.accuracy) * (0.06 + (dist || 30) * 0.004);
    dir.x += (Math.random() - .5) * err * 2;
    dir.y += (Math.random() - .5) * err * 2;
    dir.z += (Math.random() - .5) * err * 2;
    dir.normalize();

    const hitPlayerDist = raySphere(muzzle, dir, targetPos, .5);
    const wHit = this.world.raycast(muzzle, dir, 80);
    const wDist = wHit ? wHit.dist : 80;

    if (hitPlayerDist !== null && hitPlayerDist < wDist) {
      const end = muzzle.clone().addScaledVector(dir, hitPlayerDist);
      effects.tracer(muzzle, end, 0xff6a50);
      if (botTarget && this._onHitBot) {
        this._onHitBot(this, botTarget, this.damage * (0.7 + Math.random() * .6));
      } else if (onPlayerHit) {
        onPlayerHit(this.damage * (0.7 + Math.random() * .6), this);
      }
    } else {
      const end = wHit ? wHit.point : muzzle.clone().addScaledVector(dir, 80);
      effects.tracer(muzzle, end, 0xff6a50);
      if (wHit) effects.impactDust(end, wHit.normal || new THREE.Vector3(0, 1, 0));
    }
    audio.enemyShot(dist || 30);
    effects.flashLight(muzzle, 0xff9050, 10, .05);
  }
}

function raySphere(o, d, c, r) {
  const oc = c.clone().sub(o);
  const t = oc.dot(d);
  if (t < 0) return null;
  const d2 = oc.lengthSq() - t * t;
  if (d2 > r * r) return null;
  return t - Math.sqrt(r * r - d2);
}

export class EnemyManager {
  constructor(scene, world, effects, audio, camera, hud, quality) {
    this.scene = scene; this.world = world;
    this.fx = effects; this.audio = audio; this.camera = camera; this.hud = hud;
    this.enemies = [];
    this._aiSkip = quality === 'ultra-low' ? 2 : quality === 'low' ? 1 : 0;
    this._aiFrame = 0;
    this.layer = document.createElement('div');
    this.layer.id = 'enemy-ui';
    (document.getElementById('app') || document.body).appendChild(this.layer);
    this.spawnPoints = world.spawnPoints && world.spawnPoints.length
      ? world.spawnPoints
      : [new THREE.Vector3(0, 0, 0)];
    this.playerTeam = -1; // -1 = hostile to all, 0+ = squad team
  }

  setPlayerTeam(team) {
    this.playerTeam = team;
    for (const e of this.enemies) {
      e.setPlayerTeam(team);
    }
  }

  spawnWave(count, wave, diff, opts) {
    opts = opts || {};
    for (let i = 0; i < count; i++) {
      const base = this.spawnPoints[(Math.random() * this.spawnPoints.length) | 0].clone();
      const p = base.clone();
      p.x += (Math.random() - .5) * 8; p.z += (Math.random() - .5) * 8;
      const e = new Enemy(this.scene, this.world, p, wave, diff, this._aiSkip > 0 ? 'ultra-low' : 'high');
      e.onDamaged = (amt, head, self) => this.spawnDamageNumber(amt, head, self);
      if (opts.team != null) e.team = opts.team;
      if (opts.name) e.name = opts.name;
      if (opts.look) Object.assign(e.char, opts.look);
      this.enemies.push(e);
    }
    for (let i = this.enemies.length - count; i < this.enemies.length; i++) {
      const j = (Math.random() * (i + 1)) | 0;
      const a = this.enemies[i], b = this.enemies[j];
      this.enemies[i] = b; this.enemies[j] = a;
    }
  }

  _screen(v) {
    const p = v.clone().project(this.camera);
    if (p.z > 1) return null;
    return { x: (p.x * 0.5 + 0.5) * innerWidth, y: (-p.y * 0.5 + 0.5) * innerHeight };
  }

  spawnDamageNumber(amt, head, e) {
    if (!this.layer) return;
    const el = document.createElement('div');
    el.className = 'dmg-num' + (head ? ' head' : '');
    el.textContent = Math.round(amt) + (head ? '!' : '');
    const s = this._screen(e.pos.clone().add(e.headOffset));
    if (s) { el.style.left = s.x + 'px'; el.style.top = s.y + 'px'; }
    this.layer.appendChild(el);
    setTimeout(() => el.remove(), 800);
  }

  aliveCount() { return this.enemies.filter(e => e.alive).length; }

  onBotKilled = null;

  alertBots(pos, range, player) {
    if (!player) return;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const d = e.pos.distanceTo(pos);
      if (d < range) {
        e.lastSeenTarget = player.pos.clone();
        e.aggro = true;
      }
    }
  }

  update(dt, player, onPlayerHit) {
    this._aiFrame++;
    if (this._aiSkip && this._aiFrame % (this._aiSkip + 1) !== 0) {
      for (let i = this.enemies.length - 1; i >= 0; i--) {
        const e = this.enemies[i];
        if (!e) continue;
        if (!e.alive) {
          e.update(dt, player, this.fx, this.audio, onPlayerHit, this.enemies);
          if (!e.alive && e.deathT >= 3) { this.scene.remove(e.group); if (e.barEl) e.barEl.remove(); this.enemies.splice(i, 1); }
        }
      }
      return;
    }
    this.intelT = (this.intelT ?? 6) - dt;
    const intel = this.intelT <= 0;
    if (intel) this.intelT = 4 + Math.random() * 2;
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      e.setPlayerTeam(this.playerTeam);
      if (intel && e.alive && player) {
        const distToPlayer = e.pos.distanceTo(player.pos);
        const noiseMag = 10 + distToPlayer * 0.15;
        const noise = new THREE.Vector3((Math.random() - .5) * noiseMag, 0, (Math.random() - .5) * noiseMag);
        e._lastTargetPos = player.pos.clone().add(noise);
        if (distToPlayer < 60) {
          e.lastSeenTarget = player.pos.clone();
        } else {
          e.lastSeenTarget = player.pos.clone().add(noise);
        }
        e.aggro = true;
      }
      e._onHitBot = (shooter, tgt, dmg) => {
        const died = tgt.takeDamage(dmg, false);
        if (died && this.onBotKilled) this.onBotKilled(shooter, tgt);
      };
      e._onFire = (pos, range) => { this.alertBots(pos, range, player); };
      const keep = e.update(dt, player, this.fx, this.audio, onPlayerHit, this.enemies);
      if (!keep) {
        this.scene.remove(e.group);
        if (e.barEl) e.barEl.remove();
        this.enemies.splice(i, 1);
        continue;
      }
      const s = this._screen(e.pos.clone().add(new THREE.Vector3(0, 1.95, 0)));
      if (!s || s.x < 0 || s.x > innerWidth || s.y < 0 || s.y > innerHeight) {
        if (e.barEl) e.barEl.style.display = 'none';
        continue;
      }
      if (!e.barEl) {
        e.barEl = document.createElement('div');
        e.barEl.className = 'enemy-bar';
        e.barEl.innerHTML = '<div class="fill"></div>';
        this.layer.appendChild(e.barEl);
      }
      e.barEl.style.display = 'block';
      e.barEl.style.left = s.x + 'px';
      e.barEl.style.top = s.y + 'px';
      const fill = e.barEl.firstChild;
      const frac = Math.max(0, e.hp / e.maxHp);
      fill.style.width = (frac * 100) + '%';
      fill.style.background = frac > 0.5 ? '#6dff5a' : frac > 0.25 ? '#ffd24a' : '#ff4a4a';
    }
  }

  clearAll() {
    for (const e of this.enemies) this.scene.remove(e.group);
    this.enemies.length = 0;
  }
}
