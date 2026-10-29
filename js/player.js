// Player: pointer-lock third-person controller with capsule-vs-AABB collision.
// Physics/collision live here; the visible body is a procedural `Character` rig
// (see character.js) driven by getState(). This same state object is what remote
// multiplayer players will receive later, so the body language stays identical.
import * as THREE from 'three';
import { Character } from './character.js';

export class Player {
  constructor(camera, world, audio, physics = null) {
    this.camera = camera;
    this.world = world;
    this.audio = audio;
    this.physics = physics;
    this.pos = new THREE.Vector3(0, 0, 30);      // feet position
    this.vel = new THREE.Vector3();
    if (this.physics) {
      this.physics.createPlayerBody(this.pos.x, this.pos.y, this.pos.z);
    }
    this.yaw = 0;
    this.pitch = 0;
    this.eyeStand = 1.66;
    this.eyeCrouch = 1.05;
    this.eye = this.eyeStand;
    this.radius = 0.42;
    this.height = 1.8;
    this.onGround = true;
    this.crouched = false;
    this.sprinting = false;
    this.sensitivity = 1;
    this.baseSpeed = 2.8;
    this.sprintMult = 1.9;
    this.crouchMult = 0.55;
    this.bobPhase = 0;
    this.bobAmp = 0;
    this.stepTimer = 0;
    this.fovBase = 75;
    this.fovKick = 0;      // sprint adds, ADS subtracts (set by weapons)
    this.landDip = 0;
    this.keys = {};
    this.climbing = false;
    this.climbTarget = null;
    this.stairClimbing = false;
    this._prevGroundY = 0;
    this._stairTimer = 0;
    this._climbPhase = null;
    this._climbT = 0;
    this._climbCol = null;
    this._climbStart = null;
    this._climbWallNormal = null;
    this._portalCooldown = 0;
    this.nearPortal = null;
    this.insideBuilding = false;
    // ---- third-person procedural body ----
    // shirt/pants colors are swappable via the [ and ] keys (CLOTHES palette).
    this.clothesPalette = [
      [0.40, 0.55, 0.45], [0.55, 0.20, 0.22], [0.20, 0.30, 0.55], [0.55, 0.45, 0.20],
      [0.35, 0.35, 0.38], [0.20, 0.50, 0.50], [0.50, 0.25, 0.50], [0.30, 0.45, 0.25],
    ];
    this.colorIndex = 0;
    this.appearance = {
      skin: [0.82, 0.62, 0.48], pants: [0.20, 0.22, 0.30], shirt: this.clothesPalette[0],
      boots: [0.14, 0.12, 0.10], vest: [0.28, 0.32, 0.22], cap: [0.20, 0.22, 0.26],
      showCap: false, pack: true, helmet: false, weaponTint: [0.18, 0.18, 0.20],
    };
    this.char = new Character(this.appearance);
    this.phase = 0;          // walk-cycle phase, advanced by movement
    this.aimAmount = 0;      // smoothed aim pose blend
    this.skydive = false;    // true while falling from the plane (parachute)
    this.canopy = 0;         // 0..1 parachute deployment
    this.freefallV = 0;
    this.parachute = null;   // THREE.Group canopy, built by main when dropping
    this.leanAmount = 0;     // smoothed strafe/cover lean
    this.bodyYaw = this.yaw; // visual facing of the mesh (turns to move/aim, NOT to look)
    this.weaponType = 'rifle'; // updated from WeaponSystem each frame
    this.firstPerson = false;  // V toggles third <-> first person
  }

  // networkable description of this character (also fed to the local rig).
  // Remote players in MP will be built from the same shape.
  getState() {
    const hs = Math.hypot(this.vel.x, this.vel.z);
    const speed = Math.min(1, hs / (this.baseSpeed * this.sprintMult));
    return {
      x: this.pos.x, y: this.pos.y, z: this.pos.z,
      yaw: this.bodyYaw, pitch: this.pitch,
      crouch: this.crouched ? 1 : 0,
      aim: this.aimAmount,
      aimYaw: this._aimYaw || 0,
      moveX: this._moveX || 0, moveZ: this._moveZ || 0,
      sprint: this.sprinting ? 1 : 0,
      lean: this.leanAmount,
      speed,
      phase: this.phase,
      weaponType: this.weaponType || 'rifle',
      airborne: !this.onGround ? 1 : 0,
      landDip: this.landDip,
      skydive: this.skydive ? 1 : 0,
      canopy: this.canopy || 0,
      climbing: this.climbing ? 1 : 0,
      stairClimb: this.stairClimbing ? 1 : 0,
    };
  }

  // copy physics transform + pose onto the visible rig — FBX-only, no procedural fallback
  syncCharacter() {
    this.char.setState(this.getState());
  }

  // swap clothing/headgear appearance and rebuild the visible rig in place,
  // preserving position + yaw so the change is seamless.
  setAppearance(appearance) {
    Object.assign(this.appearance, appearance);
    this.char.setAppearance(this.appearance);
    if (this.char.setFirstPerson) this.char.setFirstPerson(this.firstPerson);
    else this.char.root.visible = !this.firstPerson;
  }

  // apply the persistent profile's equipped cosmetics — FBX model ignores cloth colors, only weapon/outfit matters
  applyProfile(profile) {
    const eq = profile.data.equipped;
    const palette = this.clothesPalette;
    const color = palette[eq.clothColor % palette.length];
    this.colorIndex = eq.clothColor;
    // FBX has baked textures — outfit tint not rebuild, just keep weapon sync
    this.setAppearance({
      outfit: eq.outfit,
      weaponType: this.weaponType,
      showCap: !!eq.cap, glasses: !!eq.glasses,
    });
  }

  onMouseMove(dx, dy) {
    const s = 0.0021 * this.sensitivity;
    this.yaw -= dx * s;
    this.pitch -= dy * s;
    this.pitch = Math.max(-1.53, Math.min(1.53, this.pitch));
  }

  // Physics for the drop: free-fall first (arms up, fast), then parachute glide.
  // Horizontal steering uses the movement keys; landing zeroes velocity.
  updateSkydive(dt, k) {
    const targetCanopy = (k.jump || k.crouch) ? 1 : 0;
    this.canopy += (targetCanopy - this.canopy) * Math.min(dt * 2.5, 1);
    const deployed = this.canopy > 0.6;

    // gravity / drag
    if (!deployed) {
      this.freefallV += 22 * dt;             // accelerate downward
      this.freefallV = Math.min(this.freefallV, 55); // free-fall terminal
    } else {
      this.freefallV += (3.2 - this.freefallV) * Math.min(dt * 3, 1); // parachute terminal
    }
    this.vel.y = -this.freefallV;

    // horizontal steering (slower while canopy open for a glide feel)
    const steer = deployed ? 9 : 4;
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    let mx = k.forward * (-sin) + k.right * cos;
    let mz = k.forward * (-cos) + k.right * (-sin);
    const len = Math.hypot(mx, mz) || 1; mx /= len; mz /= len;
    const moving = (k.forward || k.right) ? 1 : 0;
    this._moveX = moving ? mx * 0.6 : 0;
    this._moveZ = moving ? mz * 0.6 : 0;
    this.vel.x += (mx * moving * steer - this.vel.x) * Math.min(dt * 3, 1);
    this.vel.z += (mz * moving * steer - this.vel.z) * Math.min(dt * 3, 1);

    this.pos.x += this.vel.x * dt;
    this.pos.y += this.vel.y * dt;
    this.pos.z += this.vel.z * dt;

    if (this.pos.y <= 0) {
      this.pos.y = 0; this.vel.set(0, 0, 0);
      this.skydive = false; this.canopy = 0; this.freefallV = 0;
      this.onGround = true;
      this.landDip = 0.16;
      if (this.physics) this.physics.setPlayerPosition(this.pos.x, this.pos.y, this.pos.z);
      if (this._onLand) this._onLand();
    }
  }

  // feed skydive info to the visible rig (arms up in free-fall, relaxed under canopy)
  _skydiveState() {
    const s = this.getState();
    s.skydive = this.skydive ? 1 : 0;
    s.canopy = this.canopy;
    s.moveX = this._moveX || 0; s.moveZ = this._moveZ || 0;
    this.char.setState(s);
  }

  update(dt, input) {
    const k = input;

    // ---- SKYDIVE / PARACHUTE BRANCH (drop from the plane) ----
    if (this.skydive) {
      this.updateSkydive(dt, k);
      // camera follows the falling body
      if (this.firstPerson) {
        const eyeY = this.pos.y + 1.5;
        this.camera.position.set(this.pos.x, eyeY, this.pos.z);
        this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
      } else {
        const headY = this.pos.y + 1.4;
        const cy = Math.cos(this.pitch), sy = Math.sin(this.pitch);
        const fwdX = -Math.sin(this.yaw) * cy, fwdZ = -Math.cos(this.yaw) * cy, fwdY = sy;
        const origin = new THREE.Vector3(this.pos.x, headY, this.pos.z);
        const camPos = origin.clone().addScaledVector(new THREE.Vector3(-fwdX, -fwdY, -fwdZ), 7).addScaledVector(new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw)), 1.5);
        camPos.y += 1.5;
        this.camera.position.copy(camPos);
        this.camera.lookAt(this.pos.x + fwdX * 3, headY + fwdY * 3, this.pos.z + fwdZ * 3);
      }
      this.syncCharacter();
      this._skydiveState();
      if (this.char.update) this.char.update(dt);
      return;
    }

    // ---- CLIMB STATE MACHINE — all user controls disabled during climb ----
    if (this._climbPhase) {
      this.handleClimb(dt, k);
      const headY = this.pos.y + 1.55;
      const origin = new THREE.Vector3(this.pos.x, headY, this.pos.z);
      const boom = 4.4;
      const camPos = origin.clone().add(new THREE.Vector3(0, 1.5, boom));
      this.camera.position.lerp(camPos, Math.min(1, dt * 6));
      this.camera.lookAt(this.pos.x, headY + 0.3, this.pos.z);
      this.syncCharacter();
      if (this.char.update) this.char.update(dt);
      return;
    }

    this.crouched = !!k.crouch;
    const rawMoving = (k.forward !== 0 || k.right !== 0) ? 1 : 0;
    this.sprinting = !!(k.sprint && rawMoving && !this.crouched);

    // Crouching = stationary: no walk, no run, only aim/shoot
    if (this.crouched) {
      this.vel.x *= 0.85;
      this.vel.z *= 0.85;
    }
    const speed = this.crouched ? 0 : this.baseSpeed * (this.sprinting ? this.sprintMult : 1);
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const fwd = this.crouched ? 0 : k.forward;
    const rgt = this.crouched ? 0 : k.right;
    const moving = (fwd !== 0 || rgt !== 0) ? 1 : 0;
    let mx = fwd * (-sin) + rgt * cos;
    let mz = fwd * (-cos) + rgt * (-sin);
    const len = Math.hypot(mx, mz) || 1;
    mx /= len; mz /= len;
    this._moveX = (moving ? mx : 0);
    this._moveZ = (moving ? mz : 0);

    // desired horizontal velocity (camera-relative direction * speed)
    const dirX = mx * moving, dirZ = mz * moving;
    const targetVX = dirX * speed, targetVZ = dirZ * speed;
    // accelerate current velocity toward target
    const accel = this.onGround ? (this.sprinting ? 80 : 60) : 14;
    // Exponential response is stable across 30/60/144 Hz and avoids abrupt
    // velocity snaps when a frame stalls.
    const accelK = 1 - Math.exp(-accel * Math.min(dt, 0.05));
    this.vel.x += (targetVX - this.vel.x) * accelK;
    this.vel.z += (targetVZ - this.vel.z) * accelK;
    // clamp horizontal speed
    const hs = Math.hypot(this.vel.x, this.vel.z);
    if (hs > speed) { this.vel.x *= speed / hs; this.vel.z *= speed / hs; }

    // gravity & jump — tuned for a game-like arc (not earth-realistic)
    if (!this.climbing) {
      this.vel.y -= 16 * dt;
      if (k.jump && this.onGround) {
        this.vel.y = 8.0; this.onGround = false; this.audio.jump();
      }

      // integrate with axis-separated collision
      if (this.physics && this.physics._playerBody) {
        // Use Rapier character controller for movement
        const wasAir = !this.onGround;
        const result = this.physics.movePlayer(
          this.vel.x * dt,
          this.vel.y * dt,
          this.vel.z * dt
        );
        // Update position from physics
        this.pos.copy(result.position);
        this.onGround = result.ground;
        if (wasAir && this.onGround) { this.landDip = Math.min(Math.abs(this.vel.y) * 0.008 + .04, .18); this.audio.footstep(); }
      } else {
        // Substep axis-separated movement. At a long frame, a single 0.3-0.4m
        // move could cross a thin wall before the AABB test ever saw overlap.
        const dx = this.vel.x * dt, dy = this.vel.y * dt, dz = this.vel.z * dt;
        const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) / 0.18));
        const sx = dx / steps, sy = dy / steps, sz = dz / steps;
        const wasAir = !this.onGround;
        for (let i = 0; i < steps; i++) {
          this.moveAxis(sx, 0, 0);
          this.moveAxis(0, 0, sz);
          this.moveAxis(0, sy, 0);
        }
        if (wasAir && this.onGround) { this.landDip = Math.min(Math.abs(this.vel.y) * 0.008 + .04, .18); this.audio.footstep(); }
      }
    } else {
      this.moveAxis(0, this.vel.y * dt, 0);
    }

    // world bounds — but allow stepping outside when inside an enterable building's
    // interior volume (so you can walk out the door without getting clamped to the wall)
    const B = this.world.bounds;
    if (!this.world.insideInterior(this.pos)) {
      this.pos.x = Math.max(-B, Math.min(B, this.pos.x));
      this.pos.z = Math.max(-B, Math.min(B, this.pos.z));
    }
    if (this.pos.y < 0) { this.pos.y = 0; this.vel.y = 0; this.onGround = true; }

    // Staircase detection: if we stepped up while on ground and moving, we're on stairs
    if (this.onGround && moving && !this.climbing) {
      const yDelta = this.pos.y - this._prevGroundY;
      if (yDelta > 0.03) {
        this.stairClimbing = true;
        this._stairTimer = 0.3;
      }
    }
    if (this._stairTimer > 0) {
      this._stairTimer -= dt;
      if (this._stairTimer <= 0 || !this.onGround) {
        this.stairClimbing = false;
      }
    }
    if (this.onGround) this._prevGroundY = this.pos.y;

    // portal detection — press F to enter/exit building (checked before climb)
    if (this._portalCooldown > 0) this._portalCooldown -= dt;
    this.nearPortal = null;
    if (this.world.nearestPortal && this.onGround && !this.skydive && !this._climbPhase) {
      const p = this.world.nearestPortal(this.pos, 1.8);
      if (p && this._portalCooldown <= 0) {
        this.nearPortal = p;
        if (k.climb) {
          this.pos.copy(p.target);
          this.vel.set(0, 0, 0);
          this.onGround = true;
          this.insideBuilding = (p.type === 'enter');
          this._portalCooldown = 0.5;
          this.nearPortal = null;
          if (this.physics) this.physics.setPlayerPosition(this.pos.x, this.pos.y, this.pos.z);
          return;
        }
      }
    }

    // climb trigger — GTA-style: press F to start climbing, then all controls are disabled
    if (k.climb && this.onGround && !this.skydive && !this._climbPhase && !this.nearPortal) {
      // First check explicit climbable objects (fences, etc.)
      let c = this.world.climbableAt(this.pos, this.radius + 1.5);
      // Then check any wall within reach via ray forward
      if (!c) c = this.world.findClimbWall(this.pos, this.yaw, 1.8, 0.5, 2.8);
      if (c) { this._startClimb(c); return; }
    }

    // eye height & head bob
    const targetEye = this.crouched ? this.eyeCrouch : this.eyeStand;
    this.eye += (targetEye - this.eye) * Math.min(dt * 10, 1);
    this.landDip = Math.max(0, this.landDip - dt * .6);
    const speedRatio = hs / this.baseSpeed;
    this.bobAmp += ((moving && this.onGround ? speedRatio : 0) - this.bobAmp) * Math.min(dt * 8, 1);
    this.bobPhase += dt * (this.sprinting ? 13 : 9) * Math.max(speedRatio, .01) * (moving ? 1 : 0);

    // footsteps
    if (moving && this.onGround) {
      this.stepTimer -= dt * (this.sprinting ? 1.6 : 1);
      if (this.stepTimer <= 0) { this.audio.footstep(); this.stepTimer = .42; }
    }

    // ---- body pose state (smoothed, networkable) ----
    // walk-cycle phase advances with ground speed (only when actually moving)
    const groundSpeed = Math.hypot(this.vel.x, this.vel.z);
    if (moving) this.phase += dt * (this.sprinting ? 11 : 7.5) * Math.min(1, groundSpeed / (this.baseSpeed * 0.6) + 0.2);
    // aim blend from ADS; lean from strafe intent
    const targetAim = (k.ads || k.fire) ? 1 : 0;
    this.aimAmount += (targetAim - this.aimAmount) * Math.min(dt * 10, 1);
    const targetLean = moving ? Math.max(-1, Math.min(1, this._moveX * 1.4)) : 0;
    this.leanAmount += (targetLean - this.leanAmount) * Math.min(dt * 8, 1);

    // ---- body facing: the mesh turns to MOVE direction, never to the look
    // camera. So looking around only orbits the camera; the player stays put. ----
    // When AIMING while STANDING STILL we turn the whole body to face the look
    // direction (over-the-shoulder 3rd person) so the gun lines up on target.
    // But while WALKING or RUNNING the body keeps facing the MOVE direction — it
    // must NOT snap to the camera. The upper spine still twists toward the aim via
    // the layered bone blend in character.js (aimYaw), so the gun tracks targets.
    let faceYaw = this.bodyYaw;
    if (this.climbing && this._climbCol && this._climbWallNormal) {
      if (this._climbPhase === 'drop' || this._climbPhase === 'over') {
        faceYaw = Math.atan2(this._climbWallNormal.x, this._climbWallNormal.z);
      } else {
        const ccx = (this._climbCol.min.x + this._climbCol.max.x) / 2;
        const ccz = (this._climbCol.min.z + this._climbCol.max.z) / 2;
        faceYaw = Math.atan2(-(ccx - this.pos.x), -(ccz - this.pos.z));
      }
    } else if (this.aimAmount > 0.5 && !moving) {
      faceYaw = this.yaw;
    } else if (moving) {
      if (Math.hypot(this._moveX, this._moveZ) > 0.01) {
        faceYaw = Math.atan2(-this._moveX, -this._moveZ);
      }
    }
    let dy = faceYaw - this.bodyYaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    this.bodyYaw += dy * Math.min(dt * 12, 1);

    // aim offset: how far the camera look direction is from the body's facing.
    // Character uses this to twist the upper spine/head toward the sight line.
    let aimOff = this.yaw - this.bodyYaw;
    while (aimOff > Math.PI) aimOff -= Math.PI * 2;
    while (aimOff < -Math.PI) aimOff += Math.PI * 2;
    this._aimYaw = aimOff;

    // push the pose onto the visible rig
    this.syncCharacter();
    if (this.char.update) this.char.update(dt);

    if (this.firstPerson) {
      // ---- first-person: camera at the eyes, no visible body ----
      const eyeY = this.pos.y + (this.crouched ? this.eyeCrouch : this.eyeStand) - this.landDip;
      this.camera.position.set(this.pos.x, eyeY, this.pos.z);
      this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    } else {
      // ---- third-person camera ----
      const headY = this.pos.y + (this.crouched ? 1.25 : 1.55) - this.landDip;
      const cy = Math.cos(this.pitch), sy = Math.sin(this.pitch);
      // forward (look) direction on the ground, and the right vector
      const fwdX = -Math.sin(this.yaw) * cy;
      const fwdZ = -Math.cos(this.yaw) * cy;
      const fwdY = sy;
      const rightX = Math.cos(this.yaw);
      const rightZ = -Math.sin(this.yaw);

      // When AIMING: pull in close and slide to the SIDE of the head (over-the-
      // shoulder), so the player lines up opponents like an over-shoulder 3rd
      // person. When hip/looking: a relaxed behind-the-back orbit.
      const boom = 4.4 - this.aimAmount * 2.6;
      const side = this.aimAmount * 0.9;           // lateral shoulder offset when aiming
      const origin = new THREE.Vector3(this.pos.x, headY, this.pos.z);
      const toCam = new THREE.Vector3(-fwdX, -fwdY, -fwdZ);
      let camPos = origin.clone()
        .addScaledVector(toCam, boom)
        .addScaledVector(new THREE.Vector3(rightX, 0, rightZ), side);
      camPos.y += side * 0.3;

      // ---- BVH-accelerated camera wall avoidance ----
      // Cast a ray from the head (origin) toward the desired camera position.
      // If any collider is hit along the way, pull the camera to just before that hit.
      const rayDir = camPos.clone().sub(origin);
      const rayLen = rayDir.length();
      if (rayLen > 0.01) {
        rayDir.divideScalar(rayLen);
        const hit = this.world.bvhWorld
          ? this.world.bvhWorld.raycast(origin, rayDir, rayLen)
          : null;
        if (hit && hit.dist > 0.1) {
          camPos = origin.clone().addScaledVector(rayDir, Math.max(0.8, hit.dist - 0.3));
        }
      }
      this.camera.position.copy(camPos);
      // aim slightly past the shoulder so the gun/man lines up with the target
      this.camera.lookAt(this.pos.x + fwdX * 3, headY + fwdY * 3 + 0.1, this.pos.z + fwdZ * 3);
    }

    // FOV
    const targetFov = this.fovBase + (this.sprinting ? 6 : 0) + this.fovKick;
    if (Math.abs(this.camera.fov - targetFov) > .01) {
      this.camera.fov += (targetFov - this.camera.fov) * Math.min(dt * 12, 1);
      this.camera.updateProjectionMatrix();
    }
  }

  handleClimb(dt, k) {
    // Instant climb (no animation state machine) — nothing to update here.
    return false;
  }

  _startClimb(c) {
    // Instant action — no climb animation.
    if (c.type === 'fence') {
      // Fence: teleport straight to the other side.
      this._crossFence(c);
    } else {
      // Wall/crate/building: pull straight up onto the top.
      this.pos.y = c.max.y + 0.02;
      this.vel.set(0, 0, 0);
      this.onGround = true;
    }
    if (this.physics) this.physics.setPlayerPosition(this.pos.x, this.pos.y, this.pos.z);
  }

  _crossFence(c) {
    const w = c.max.x - c.min.x;
    const d = c.max.z - c.min.z;
    const cz = (c.min.z + c.max.z) / 2;
    const cx = (c.min.x + c.max.x) / 2;
    if (d <= w) {
      const side = this.pos.z >= cz ? 1 : -1;
      this.pos.z = (side > 0 ? c.max.z : c.min.z) + side * (this.radius + 0.2);
    } else {
      const side = this.pos.x >= cx ? 1 : -1;
      this.pos.x = (side > 0 ? c.max.x : c.min.x) + side * (this.radius + 0.2);
    }
    this.pos.y = Math.max(this.pos.y, c.min.y);
    this.vel.set(0, 0, 0);
    this.onGround = true;
  }

  nearestClimbable() {
    if (!this.world) return null;
    // Check explicit climbable objects first
    const c = this.world.climbableAt(this.pos, this.radius + 1.5);
    if (c) return c;
    // GTA-style: check any wall within reach via ray forward
    return this.world.findClimbWall(this.pos, this.yaw, 1.8, 0.5, 2.8);
  }

  // nearest walkable rooftop within reach of the player (for the "press Y" prompt)
  nearestRoof() {
    let best = null, bestD = 1e9;
    for (const r of this.world.roofAccess) {
      const dx = this.pos.x - r.x, dz = this.pos.z - r.z;
      if (Math.abs(dx) > r.rx + 4 || Math.abs(dz) > r.rz + 4) continue;
      const d = Math.hypot(dx, dz);
      if (d < bestD) { bestD = d; best = r; }
    }
    return best;
  }

  // teleport onto the roof (used by the "press Y" prompt)
  goToRoof(r) {
    if (!r) return;
    this.pos.set(r.x, r.y, r.z);
    this.vel.set(0, 0, 0);
    this.onGround = true;
    if (this.physics) this.physics.setPlayerPosition(this.pos.x, this.pos.y, this.pos.z);
  }

  moveAxis(dx, dy, dz) {
    this.pos.x += dx; this.pos.y += dy; this.pos.z += dz;
    const r = this.radius;
    const feet = this.pos.y, head = this.pos.y + (this.crouched ? 1.25 : this.height);
    let landedOnCollider = false;
    const moveR = r + 0.5;
    const moveCandidates = this.world.bvhWorld
      ? this.world.bvhWorld.queryAABB(this.pos.x - moveR, this.pos.z - moveR, this.pos.x + moveR, this.pos.z + moveR)
      : this.world.colliders;
    for (const c of moveCandidates) {
      if (this.pos.x + r <= c.min.x || this.pos.x - r >= c.max.x) continue;
      if (this.pos.z + r <= c.min.z || this.pos.z - r >= c.max.z) continue;
      // Road/sidewalk collision AABBs are only broad-phase bounds. An actual
      // diagonal ribbon is much narrower than its enclosing world rectangle;
      // ignore the false-positive corners for movement and step-up resolution.
      if (c.type === 'road_surface' && c.orientedBox) {
        const o = c.orientedBox;
        const dx = this.pos.x - o.center.x, dz = this.pos.z - o.center.z;
        const cs = Math.cos(o.yaw), sn = Math.sin(o.yaw);
        const lx = dx * cs - dz * sn, lz = dx * sn + dz * cs;
        const cx = THREE.MathUtils.clamp(lx, -o.halfExtents.x, o.halfExtents.x);
        const cz = THREE.MathUtils.clamp(lz, -o.halfExtents.z, o.halfExtents.z);
        // Exact circle-vs-rounded-rectangle overlap. Expanding both axes by r
        // creates square corner regions that feel like invisible road-edge walls.
        if ((lx - cx) ** 2 + (lz - cz) ** 2 > r * r) continue;
      }
      if (head <= c.min.y || feet >= c.max.y) continue;
      // Interior AABBs must remain solid. The old "skip every collider inside
      // the room volume" rule made invisible internal walls and props ghostlike.
      // Exterior walls now have real doorway gaps, so no global interior bypass
      // is needed here.
      // step-up: low cover / stair treads. We snap feet onto the top of the step so the
      // player walks up smoothly WITHOUT needing the mantle (climb) key.
      if (dy === 0 && c.max.y - feet <= 1.2 && this.onGround) {
        this.pos.y = c.max.y; this.vel.y = 0; this.onGround = true; landedOnCollider = true; continue;
      }
      if (dx > 0) this.pos.x = c.min.x - r; else if (dx < 0) this.pos.x = c.max.x + r;
      if (dz > 0) this.pos.z = c.min.z - r; else if (dz < 0) this.pos.z = c.max.z + r;
      if (dy < 0) { this.pos.y = c.max.y; this.vel.y = 0; this.onGround = true; landedOnCollider = true; }
      else if (dy > 0) { this.pos.y = c.min.y - this.height; this.vel.y = 0; }
    }
    // Only mark airborne if we were moving vertically AND didn't land on any collider.
    // This fixes the bug where landing on elevated surfaces (rooftops, crates) was
    // immediately overridden back to airborne, causing jitter.
    if (dy !== 0 && !landedOnCollider) {
      if (this.pos.y > 0.01) this.onGround = false;
    }
    // ground-plane floor
    if (this.pos.y <= 0 && this.vel.y <= 0) { this.pos.y = 0; this.vel.y = 0; this.onGround = true; }
  }

  get eyePos() {
    return new THREE.Vector3(this.pos.x, this.pos.y + this.eye, this.pos.z);
  }
}
