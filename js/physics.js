// Physics engine wrapper around Rapier.js (WASM).
// Provides: world simulation, character controller, vehicle controller, raycasting.
import * as THREE from 'three';
import { ackermannSteerAngle } from './vehicle-steering.js';

let RAPIER = null; // Rapier WASM module (high-level API)

export class Physics {
  constructor() {
    this.world = null;
    this.gravity = { x: 0, y: -9.81, z: 0 };
    this._stepCount = 0;
    this._eventQueue = null;
    this._queryPipeline = null;
    this._rigidBodySet = null;
    this._colliderSet = null;
    this._playerBody = null;
    this._playerCollider = null;
    this._playerController = null;
    this._vehicleBodies = new Map();
    this._staticBatchBodies = [];
  }

  static async init() {
    if (RAPIER) return RAPIER;
    const mod = await import('./lib/rapier.es.js');
    const initFn = mod.init || mod.default;
    if (!initFn) throw new Error('Rapier init function not found in module exports');
    const wasmUrl = new URL('./lib/rapier_wasm3d_bg.wasm', import.meta.url);
    await initFn(wasmUrl);
    RAPIER = mod;
    console.log('[Physics] Rapier WASM initialized, version:', RAPIER.version());
    return RAPIER;
  }

  createWorld() {
    if (!RAPIER) throw new Error('Physics.init() must be called first');
    this.world = new RAPIER.World(this.gravity);
    this._eventQueue = new RAPIER.EventQueue(true);
    this._rigidBodySet = this.world.bodies;
    this._colliderSet = this.world.colliders;
    return this.world;
  }

  step(dt) {
    if (!this.world) return;
    // Kinematic player/vehicle controllers submit a new target each render
    // frame, so Rapier must step every frame. Bound the timestep after stalls
    // instead of accumulating fixed steps that would overwrite kinematic targets.
    this.world.timestep = Math.min(Math.max(dt || 1 / 60, 1 / 240), 1 / 30);
    this.world.step(this._eventQueue);
    this._stepCount++;
  }

  // ===== COLLIDER REGISTRATION =====

  registerStaticAABB(min, max, userData = null) {
    const hx = (max.x - min.x) / 2;
    const hy = (max.y - min.y) / 2;
    const hz = (max.z - min.z) / 2;
    if (hx <= 0.001 || hy <= 0.001 || hz <= 0.001) return null;

    const cx = (min.x + max.x) / 2;
    const cy = (min.y + max.y) / 2;
    const cz = (min.z + max.z) / 2;

    const rigidBodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(cx, cy, cz);
    const rigidBody = this.world.createRigidBody(rigidBodyDesc);
    const colliderDesc = RAPIER.ColliderDesc.cuboid(hx, hy, hz);
    const collider = this.world.createCollider(colliderDesc, rigidBody);

    return { handle: collider.handle, min, max, userData, rigidBody, _collider: collider };
  }

  registerStaticBatch(colliders) {
    if (!this.world || !Array.isArray(colliders) || !colliders.length) return 0;
    // Avoid registering the same source twice when a world reloads or a
    // collision manifest is re-injected after initial physics setup.
    const pending = colliders.filter(source => source?.min && source?.max
      && !source.surfaceOnly && source.type !== 'road_surface' && !source.physicsCollider);
    if (!pending.length) return 0;
    // A single fixed body can own thousands of static cuboids. One rigid body
    // per box made detailed collision manifests needlessly expensive.
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    let count = 0;
    for (const source of pending) {
      const min = source.min, max = source.max;
      const oriented = source.orientedBox || null;
      const hx = oriented ? oriented.halfExtents.x : (max.x - min.x) / 2;
      const hy = oriented ? oriented.halfExtents.y : (max.y - min.y) / 2;
      const hz = oriented ? oriented.halfExtents.z : (max.z - min.z) / 2;
      if (![hx, hy, hz].every(Number.isFinite) || hx <= 0.001 || hy <= 0.001 || hz <= 0.001) continue;
      const cx = oriented ? oriented.center.x : (min.x + max.x) / 2;
      const cy = oriented ? oriented.center.y : (min.y + max.y) / 2;
      const cz = oriented ? oriented.center.z : (min.z + max.z) / 2;
      const desc = RAPIER.ColliderDesc.cuboid(hx, hy, hz)
        .setTranslation(cx, cy, cz)
        .setFriction(source.type === 'road_surface' ? 0.72 : 0.8)
        .setRestitution(0);
      if (oriented) {
        const halfYaw = oriented.yaw / 2;
        desc.setRotation({ x: 0, y: Math.sin(halfYaw), z: 0, w: Math.cos(halfYaw) });
      }
      const collider = this.world.createCollider(desc, body);
      source.physicsCollider = {
        handle: collider.handle, min, max, userData: source,
        rigidBody: body, _collider: collider, _sharedStaticBatch: true,
      };
      count++;
    }
    if (!count) this.world.removeRigidBody(body);
    else this._staticBatchBodies.push(body);
    console.log(`[Physics] Registered ${count} static colliders in ${count ? 1 : 0} fixed batch body`);
    return count;
  }

  // Register merged visual road ribbons as static triangle surfaces. Unlike thin
  // cuboid strips, these have no vertical edge faces. One collider per rendered
  // surface mesh also avoids a pile of overlapping segment boxes at junctions.
  registerStaticRoadMeshes(surfaces = []) {
    if (!this.world || !Array.isArray(surfaces) || !surfaces.length) return 0;
    const pending = surfaces.filter(s => s?.geometry?.attributes?.position && !s.physicsCollider);
    if (!pending.length) return 0;
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    let count = 0;
    for (const source of pending) {
      const attr = source.geometry.attributes.position;
      const vertices = new Float32Array(attr.count * 3);
      for (let i = 0; i < attr.count; i++) {
        vertices[i * 3] = attr.getX(i);
        vertices[i * 3 + 1] = attr.getY(i);
        vertices[i * 3 + 2] = attr.getZ(i);
      }
      const sourceIndex = source.geometry.index;
      if (!sourceIndex && attr.count % 3 !== 0) continue;
      const indices = sourceIndex
        ? Uint32Array.from(sourceIndex.array)
        : Uint32Array.from({ length: attr.count }, (_, i) => i);
      if (indices.length < 3) continue;
      const friction = source.kind === 'road' ? 0.72 : source.kind === 'sidewalk' ? 0.82 : 0.76;
      const desc = RAPIER.ColliderDesc.trimesh(vertices, indices)
        .setFriction(friction)
        .setRestitution(0);
      const collider = this.world.createCollider(desc, body);
      source.physicsCollider = {
        handle: collider.handle, userData: source,
        rigidBody: body, _collider: collider, _sharedStaticBatch: true,
      };
      count++;
    }
    if (!count) this.world.removeRigidBody(body);
    else this._staticBatchBodies.push(body);
    console.log(`[Physics] Registered ${count} exact road-surface triangle meshes`);
    return count;
  }

  removeCollider(entry) {
    if (!entry || !this.world) return;
    if (entry._sharedStaticBatch && entry._collider) {
      // Remove only this collider. Removing its shared body would delete every
      // static wall and prop in the city.
      this.world.removeCollider(entry._collider, true);
      if (entry.userData?.physicsCollider === entry) entry.userData.physicsCollider = null;
      return;
    }
    if (entry.rigidBody) this.world.removeRigidBody(entry.rigidBody);
  }

  addGroundPlane() {
    if (!RAPIER || !this.world) return;
    const rb = RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.5, 0);
    const body = this.world.createRigidBody(rb);
    const cd = RAPIER.ColliderDesc.cuboid(5000, 0.5, 5000);
    this.world.createCollider(cd, body);
    console.log('[Physics] Ground plane added');
  }

  // ===== PLAYER CHARACTER CONTROLLER =====

  createPlayerBody(x, y, z) {
    if (this._playerBody) {
      this.world.removeRigidBody(this._playerBody);
    }

    const rigidBodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased()
      .setTranslation(x, y, z)
      .enabledRotations(false, false, false);
    this._playerBody = this.world.createRigidBody(rigidBodyDesc);

    // Capsule: half-height 0.49, radius 0.42 → total height ~1.8m.
    // The body origin is the player's FEET, so the collider is lifted by half
    // the capsule height (0.49 + 0.42 = 0.91m). Without this offset the whole
    // capsule sits below the feet and the character floats ~0.9m in the air.
    const colliderDesc = RAPIER.ColliderDesc.capsule(0.49, 0.42)
      .setTranslation(0, 0.91, 0)
      .setFriction(0.0)
      .setRestitution(0.0);
    this._playerCollider = this.world.createCollider(colliderDesc, this._playerBody);

    // Create character controller via world (correct API)
    this._playerController = this.world.createCharacterController(0.01);
    this._playerController.enableAutostep(0.6, 0.5, true);
    this._playerController.enableSnapToGround(0.5);
    this._playerController.setApplyImpulsesToDynamicBodies(false);

    return this._playerBody;
  }

  // Move the player using the character controller.
  // Uses computeColliderMovement with the player's collider handle.
  movePlayer(dx, dy, dz) {
    if (!this._playerBody || !this._playerController || !this._playerCollider) {
      return { ground: false, position: new THREE.Vector3(), movement: new THREE.Vector3() };
    }

    const desiredTranslation = { x: dx, y: dy, z: dz };

    // computeColliderMovement takes the collider to move, and the desired delta
    this._playerController.computeColliderMovement(
      this._playerCollider,
      desiredTranslation,
    );

    const correctedMovement = this._playerController.computedMovement();
    const grounded = this._playerController.computedGrounded();
    const pos = this._playerBody.translation();

    const result = {
      x: pos.x + correctedMovement.x,
      y: pos.y + correctedMovement.y,
      z: pos.z + correctedMovement.z,
    };

    this._playerBody.setNextKinematicTranslation(result);

    return {
      ground: grounded,
      position: new THREE.Vector3(result.x, result.y, result.z),
      movement: new THREE.Vector3(correctedMovement.x, correctedMovement.y, correctedMovement.z),
    };
  }

  setPlayerCollisionEnabled(enabled) {
    if (!this._playerCollider) return;
    this._playerCollider.setEnabled(!!enabled);
  }

  setPlayerPosition(x, y, z) {
    if (!this._playerBody) return;
    this._playerBody.setNextKinematicTranslation({ x, y, z });
  }

  getPlayerPosition() {
    if (!this._playerBody) return new THREE.Vector3();
    const t = this._playerBody.translation();
    return new THREE.Vector3(t.x, t.y, t.z);
  }

  isPlayerOnGround() {
    return this._playerController ? this._playerController.computedGrounded() : true;
  }

  // ===== VEHICLE =====

  // Dynamic Rapier chassis. Collision boxes are model-local and the body origin
  // is moved to the chassis centre so yaw rotates around the correct point.
  createVehicleBody(x, y, z, yaw = 0, boxes = null, options = {}) {
    if (!RAPIER || !this.world) return null;
    const list = (boxes && boxes.length ? boxes : [{
      min: { x: -1.05, y: 0, z: -2.35 }, max: { x: 1.05, y: 1.2, z: 2.35 },
    }]);
    const minY = Math.min(...list.map(b => b.min.y));
    const maxY = Math.max(...list.map(b => b.max.y));
    const centerY = Number.isFinite(options.centerY) ? options.centerY : (minY + maxY) * 0.5;
    const dynamic = options.dynamic !== false;
    let desc;
    if (dynamic) {
      desc = RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(x, y + centerY, z)
        .setLinearDamping(0.08)
        .setAngularDamping(options.angularDamping ?? 0.95)
        .setCcdEnabled(true)
        // Allow chassis pitch and roll as well as yaw. The four suspension
        // struts now act at rotated hardpoints, so impacts/curbs can lean the car.
        .enabledRotations(true, true, true)
        .setCanSleep(false)
        .setAdditionalMass(options.mass || 1450);
    } else {
      desc = RAPIER.RigidBodyDesc.kinematicPositionBased()
        .setTranslation(x, y, z);
    }
    const body = this.world.createRigidBody(desc);
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0));
    if (dynamic) body.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
    else body.setNextKinematicRotation({ x: q.x, y: q.y, z: q.z, w: q.w });

    let created = 0;
    for (const b of list) {
      const hx = (b.max.x - b.min.x) / 2;
      const hy = (b.max.y - b.min.y) / 2;
      const hz = (b.max.z - b.min.z) / 2;
      if (![hx, hy, hz].every(Number.isFinite) || hx <= 0.025 || hy <= 0.025 || hz <= 0.025) continue;
      const cd = RAPIER.ColliderDesc.cuboid(hx, hy, hz)
        .setTranslation(
          (b.min.x + b.max.x) / 2,
          (b.min.y + b.max.y) / 2 - (dynamic ? centerY : 0),
          (b.min.z + b.max.z) / 2,
        )
        // Low chassis-contact friction avoids a full-width box sticking to
        // the ground. Lateral tyre grip is applied explicitly in controls.
        .setFriction(dynamic ? 0.12 : 0.95)
        .setRestitution(0);
      this.world.createCollider(cd, body);
      created++;
    }
    body._openWorldDynamic = dynamic;
    body._openWorldCenterY = dynamic ? centerY : 0;
    body._openWorldGroundY = y;
    body._openWorldYawOffset = options.yawOffset || 0;
    body._openWorldTuning = options.tuning || {};
    body._openWorldColliderCount = created;
    this._vehicleBodies.set(body.handle, body);
    return body;
  }

  // Apply throttle, braking and lateral tyre grip as impulses on the dynamic
  // chassis. Steering is expressed as a bounded yaw-rate target, but translation
  // and all collisions remain under Rapier's rigid-body solver.
  applyVehicleControls(body, controls = {}) {
    if (!body || !this.world || !body._openWorldDynamic) return null;
    const dt = Math.min(Math.max(controls.dt || 1 / 60, 0), 1 / 30);
    if (dt <= 0) return null;

    const translation = body.translation();
    const rotation = body.rotation();
    const q = new THREE.Quaternion(rotation.x, rotation.y, rotation.z, rotation.w);
    // bodyYaw rotates the imported GLB. Remove its axis correction to derive
    // gameplay heading; use the rotated chassis axes for hardpoints, and project
    // the nose/right vectors onto the road plane for throttle and tire forces.
    const yawOffset = body._openWorldYawOffset || 0;
    const bodyYaw = new THREE.Euler().setFromQuaternion(q, 'YXZ').y;
    const yaw = bodyYaw - yawOffset;
    const forwardV = new THREE.Vector3(0, 0, -Math.cos(yawOffset)).applyQuaternion(q);
    forwardV.y = 0;
    if (forwardV.lengthSq() < 1e-8) forwardV.set(-Math.sin(yaw), 0, -Math.cos(yaw));
    forwardV.normalize();
    // The GLBs use a +Z nose and a PI model correction, so local +X is
    // not always gameplay-right. Derive right from forward x world-up.
    const rightV = forwardV.clone().cross(new THREE.Vector3(0, 1, 0));
    if (rightV.lengthSq() < 1e-8) rightV.set(Math.cos(yaw), 0, -Math.sin(yaw));
    rightV.normalize();
    const forward = { x: forwardV.x, z: forwardV.z };
    const right = { x: rightV.x, z: rightV.z };
    const velocity = body.linvel();
    const angular = body.angvel();
    let forwardSpeed = velocity.x * forward.x + velocity.z * forward.z;
    let lateralSpeed = velocity.x * right.x + velocity.z * right.z;
    let horizontalSpeed = Math.hypot(velocity.x, velocity.z);
    const mass = Math.max(600, body.mass());
    const throttle = THREE.MathUtils.clamp(controls.throttle || 0, -1, 1);
    const steer = THREE.MathUtils.clamp(controls.steer || 0, -1, 1);
    const handbrake = !!controls.handbrake;
    const wheelSpecs = Array.isArray(controls.wheels) ? controls.wheels : [];
    const tune = controls.tuning || body._openWorldTuning || {};
    const downforceCoefficient = tune.downforceCoefficient ?? 0.25;
    const maxDownforce = mass * 9.81 * (tune.maxDownforceG ?? 0.2);
    const downforce = Math.min(maxDownforce, downforceCoefficient * horizontalSpeed * horizontalSpeed);
    const aeroLoadPerWheel = wheelSpecs.length ? downforce / wheelSpecs.length : 0;

    // ---- Four raycast suspension struts ----
    // Spring, damper, ride-height and tire tuning are per vehicle model.
    const restLength = tune.suspensionRestLength ?? 0.22;
    const travel = tune.suspensionTravel ?? 0.18;
    const springRate = tune.springRate ?? 32000;
    const springDamping = tune.springDamping ?? 3400;
    const springDampingRelaxation = tune.springDampingRelaxation ?? springDamping * 0.78;
    const suspensionResponse = tune.suspensionResponse ?? 28;
    const wheelStates = [];
    const rayHits = [];
    const supportCache = body._openWorldWheelSupportCache || (body._openWorldWheelSupportCache = []);
    const bodyCenterY = body._openWorldCenterY || 0;
    const gravityLoadPerWheel = (mass * 9.81 / Math.max(1, wheelSpecs.length)) + aeroLoadPerWheel;

    for (let wheelIndex = 0; wheelIndex < wheelSpecs.length; wheelIndex++) {
      const wheel = wheelSpecs[wheelIndex];
      const lx = wheel.x || 0;
      const lz = wheel.z || 0;
      const localHardpointY = (wheel.y || 0) - bodyCenterY + restLength;
      // Wheel hardpoints follow the complete body quaternion, including pitch
      // and roll, instead of assuming the chassis stays perfectly upright.
      const localOffset = new THREE.Vector3(lx, localHardpointY, lz).applyQuaternion(q);
      const hardpoint = {
        x: translation.x + localOffset.x,
        y: translation.y + localOffset.y,
        z: translation.z + localOffset.z,
      };
      const radius = THREE.MathUtils.clamp(wheel.radius || 0.32, 0.18, 0.5);
      const maxRay = radius + restLength + travel;
      const maxCompression = Math.max(travel * 0.55, radius * 1.25);
      const ray = new RAPIER.Ray(hardpoint, { x: 0, y: -1, z: 0 });
      let hit = null;
      try {
        hit = this.world.castRayAndGetNormal
          ? this.world.castRayAndGetNormal(ray, maxRay, true, undefined, undefined, null, body)
          : this.world.castRay(ray, maxRay, true, undefined, undefined, null, body);
      } catch (error) {
        // Preserve vehicle controls if a Rapier build doesn't expose the normal variant.
        hit = this.world.castRay(ray, maxRay, true, undefined, undefined, null, body);
      }

      // At a curb/road-mesh seam a ray can hit a vertical fragment first.
      // Ignore that single obstruction and retry for the drivable surface below.
      if (hit && (!hit.normal || hit.normal.y < 0.45) && hit.collider && this.world.castRayAndGetNormal) {
        try {
          const obstruction = hit.collider;
          const alternate = this.world.castRayAndGetNormal(
            ray, maxRay, true, undefined, undefined, obstruction, body,
          );
          if (alternate) hit = alternate;
        } catch {}
      }

      // Keep a valid support plane for one missed frame only, and only when the
      // tyre is still within 35cm of its previous support. This filters single
      // ray misses at road edges without letting a car float over real gaps.
      if (!hit || !hit.normal || hit.normal.y < 0.45) {
        const cached = supportCache[wheelIndex];
        if (cached && cached.age < 1
          && Math.hypot(hardpoint.x - cached.hardpoint.x, hardpoint.z - cached.hardpoint.z) < Math.max(0.35, horizontalSpeed * dt * 1.35)
          && Math.abs(hardpoint.y - cached.hardpoint.y) < 0.16) {
          const timeOfImpact = hardpoint.y - cached.pointY;
          const suspensionLength = timeOfImpact - radius;
          if (suspensionLength >= -maxCompression && suspensionLength <= restLength + travel) {
            hit = {
              timeOfImpact,
              normal: cached.normal,
              _openWorldGrace: true,
            };
            cached.age += 1;
          }
        }
      }

      if (!hit || !hit.normal || hit.normal.y < 0.45) {
        if (supportCache[wheelIndex]) supportCache[wheelIndex].age += 1;
        wheelStates.push({ contact: false, offset: -travel, front: !!wheel.front });
        rayHits.push(null);
        continue;
      }
      const suspensionLength = hit.timeOfImpact - radius;
      // A ramp transition or a low initial chassis pose can put the hub below the
      // tyre-radius plane. Keep a valid ground ray as a deeply compressed strut;
      // dropping all wheel forces here lets the chassis settle onto its collider
      // and visually bury the car in the floor.
      // Give the ray enough recovery range to lift a car whose collider has started
      // resting on the ground. Applied spring travel remains bounded below.
      if (suspensionLength < -maxCompression || suspensionLength > restLength + travel) {
        wheelStates.push({ contact: false, offset: -travel, front: !!wheel.front });
        rayHits.push(null);
        continue;
      }

      const targetCompression = THREE.MathUtils.clamp(restLength - suspensionLength, -maxCompression, travel);
      const cachedSupport = supportCache[wheelIndex];
      const compressionBlend = 1 - Math.exp(-suspensionResponse * dt);
      const compression = Number.isFinite(cachedSupport?.compressionFiltered)
        ? cachedSupport.compressionFiltered
          + (targetCompression - cachedSupport.compressionFiltered) * compressionBlend
        : targetCompression;
      const hardpointX = hardpoint.x - translation.x;
      const hardpointY = hardpoint.y - translation.y;
      const hardpointZ = hardpoint.z - translation.z;
      let contactNormal = new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z).normalize();
      if (cachedSupport?.normal && !hit._openWorldGrace) {
        const previousNormal = new THREE.Vector3(
          cachedSupport.normal.x, cachedSupport.normal.y, cachedSupport.normal.z,
        ).normalize();
        if (previousNormal.dot(contactNormal) > 0.72) {
          contactNormal = previousNormal.lerp(contactNormal, 1 - Math.exp(-24 * dt)).normalize();
        }
      }
      // Damping uses the complete velocity at the strut mount projected onto
      // the road normal. This is stable on ramps and when the chassis pitches.
      const anchorVX = velocity.x + angular.y * hardpointZ - angular.z * hardpointY;
      const anchorVY = velocity.y + angular.z * hardpointX - angular.x * hardpointZ;
      const anchorVZ = velocity.z + angular.x * hardpointY - angular.y * hardpointX;
      const anchorNormalSpeed = anchorVX * contactNormal.x
        + anchorVY * contactNormal.y + anchorVZ * contactNormal.z;
      const damping = anchorNormalSpeed < 0 ? springDamping : springDampingRelaxation;
      const normalBaseLoad = gravityLoadPerWheel / Math.max(0.55, contactNormal.y);
      const springForce = THREE.MathUtils.clamp(
        normalBaseLoad + springRate * compression - damping * anchorNormalSpeed,
        0,
        normalBaseLoad * 1.75,
      );
      if (springForce > 0) {
        body.applyImpulseAtPoint(
          {
            x: contactNormal.x * springForce * dt,
            y: contactNormal.y * springForce * dt,
            z: contactNormal.z * springForce * dt,
          },
          hardpoint,
          true,
        );
      }
      const contactPoint = {
        x: hardpoint.x,
        y: hardpoint.y - hit.timeOfImpact,
        z: hardpoint.z,
      };
      if (!hit._openWorldGrace) {
        supportCache[wheelIndex] = {
          pointY: contactPoint.y,
          hardpoint: { x: hardpoint.x, y: hardpoint.y, z: hardpoint.z },
          normal: { x: contactNormal.x, y: contactNormal.y, z: contactNormal.z },
          compressionFiltered: compression,
          age: 0,
        };
      } else if (supportCache[wheelIndex]) {
        supportCache[wheelIndex].compressionFiltered = compression;
      }
      let surface = null;
      if (typeof controls.surfaceAt === 'function') {
        try { surface = controls.surfaceAt(contactPoint.x, contactPoint.z, contactPoint.y); } catch {}
      }
      if (!surface) surface = { surface: 'asphalt', grip: 1, rollingDrag: 1, speedLimitMultiplier: 1 };
      const state = {
        contact: true,
        offset: THREE.MathUtils.clamp(compression, -travel, travel),
        compression,
        suspensionLength,
        normal: { x: contactNormal.x, y: contactNormal.y, z: contactNormal.z },
        point: contactPoint,
        hardpoint,
        radius,
        normalLoad: springForce,
        surface,
        front: !!wheel.front,
      };
      wheelStates.push(state);
      rayHits.push(state);
    }
    // Anti-roll bars transfer load across each axle. Without this, a hard loop
    // applies all cornering force at the tyre contact patches and can roll the
    // sprung mass until the inside tyres visibly lift.
    const antiRollStiffness = tune.antiRollStiffness ?? 22000;
    const antiRollLimit = mass * 9.81 * 0.12;
    for (const frontAxle of [true, false]) {
      let left = -1, right = -1;
      for (let i = 0; i < wheelSpecs.length; i++) {
        const wheel = wheelSpecs[i];
        if (!!wheel.front !== frontAxle || !wheelStates[i]?.contact) continue;
        if (wheel.x < 0) left = i;
        else if (wheel.x > 0) right = i;
      }
      if (left < 0 || right < 0) continue;
      const compressionDifference = (wheelStates[left].compression || 0)
        - (wheelStates[right].compression || 0);
      const transferForce = THREE.MathUtils.clamp(
        compressionDifference * antiRollStiffness,
        -antiRollLimit,
        antiRollLimit,
      );
      if (Math.abs(transferForce) < 1) continue;
      // Apply the balancing couple to the chassis: reduce the force on
      // the more-compressed side and add it on the more-extended side.
      body.applyImpulseAtPoint(
        { x: 0, y: -transferForce * dt, z: 0 },
        wheelStates[left].hardpoint,
        true,
      );
      body.applyImpulseAtPoint(
        { x: 0, y: transferForce * dt, z: 0 },
        wheelStates[right].hardpoint,
        true,
      );
    }
    body._openWorldWheelStates = wheelStates;
    const grounded = wheelStates.map((state, index) => state.contact ? index : -1).filter(index => index >= 0);
    const meanSurface = (key, fallback = 1) => grounded.length
      ? grounded.reduce((sum, index) => sum + (Number.isFinite(wheelStates[index].surface?.[key]) ? wheelStates[index].surface[key] : fallback), 0) / grounded.length
      : fallback;
    const surfaceSpeedMultiplier = THREE.MathUtils.clamp(meanSurface('speedLimitMultiplier', 1), 0.35, 1.05);
    const surfaceRollingDrag = THREE.MathUtils.clamp(meanSurface('rollingDrag', 1), 0.4, 2.5);

    // Aero load is passed through the suspension springs to increase tyre normal
    // force at speed; applying the matching downward impulse keeps it grounded.
    if (downforce > 0 && grounded.length >= 1) {
      body.applyImpulse({ x: 0, y: -downforce * dt, z: 0 }, true);
    }

    // Longitudinal engine/brake forces go through grounded wheel contacts. If
    // every wheel is airborne, throttle cannot magically accelerate the car.
    let driveAcceleration = 0;
    let brakeAcceleration = 0;
    const maxForward = (tune.maxSpeed ?? 40) * surfaceSpeedMultiplier;
    const engineAcceleration = tune.engineAcceleration ?? 7.2;
    const reverseAcceleration = tune.reverseAcceleration ?? 3.8;
    const serviceBrake = tune.brakeAcceleration ?? 11;
    if (throttle > 0.01) {
      if (forwardSpeed < -0.8) {
        // W while rolling backwards is a brake command until speed is low.
        brakeAcceleration = serviceBrake * throttle;
      } else {
        const powerFade = THREE.MathUtils.clamp(1 - Math.max(0, forwardSpeed) / maxForward * 0.72, 0.18, 1);
        driveAcceleration = engineAcceleration * throttle * powerFade;
      }
    } else if (throttle < -0.01) {
      if (forwardSpeed > 0.8) {
        // S brakes forward travel, but must never brake a car already reversing.
        brakeAcceleration = serviceBrake * Math.abs(throttle);
      } else {
        driveAcceleration = -reverseAcceleration * Math.abs(throttle);
      }
    }

    const driveWheels = grounded.filter(index => !wheelSpecs[index].front);
    const frontDriveWheels = grounded.filter(index => wheelSpecs[index].front);
    const rearDriveWheels = grounded.filter(index => !wheelSpecs[index].front);
    const powered = tune.drivetrain === 'awd' ? grounded : (rearDriveWheels.length ? rearDriveWheels : grounded);
    const longitudinalImpulseByWheel = new Array(wheelSpecs.length).fill(0);
    const applyWheelImpulse = (indices, ix, iz, strength, gripBudget = 1) => {
      if (!indices.length || Math.abs(strength) < 1e-5) return;
      const requestedImpulse = strength * mass * dt / indices.length;
      const mu = tune.tireFriction ?? 1.2;
      for (const index of indices) {
        const state = wheelStates[index];
        if (!state?.contact) continue;
        // Reserve part of the tyre's friction circle for lateral force: full
        // engine torque must not make steering disappear on AWD cars.
        const surfaceGrip = THREE.MathUtils.clamp(state.surface?.grip ?? 1, 0.2, 1.4);
        const maxImpulse = Math.max(0, state.normalLoad || 0) * mu * surfaceGrip * dt
          * THREE.MathUtils.clamp(gripBudget, 0.2, 1);
        const wheelImpulse = THREE.MathUtils.clamp(requestedImpulse, -maxImpulse, maxImpulse);
        longitudinalImpulseByWheel[index] += Math.abs(wheelImpulse);
        body.applyImpulseAtPoint(
          { x: ix * wheelImpulse, y: 0, z: iz * wheelImpulse },
          state.point,
          true,
        );
      }
    };
    if (wheelSpecs.length && grounded.length) {
      if (tune.drivetrain === 'awd' && frontDriveWheels.length && rearDriveWheels.length) {
        const frontBias = THREE.MathUtils.clamp(tune.frontDriveBias ?? 0.5, 0.25, 0.75);
        applyWheelImpulse(frontDriveWheels, forward.x, forward.z, driveAcceleration * frontBias, tune.driveGripUsageLimit ?? 0.76);
        applyWheelImpulse(rearDriveWheels, forward.x, forward.z, driveAcceleration * (1 - frontBias), tune.driveGripUsageLimit ?? 0.76);
      } else {
        applyWheelImpulse(powered, forward.x, forward.z, driveAcceleration, tune.driveGripUsageLimit ?? 0.76);
      }
      if (brakeAcceleration > 0) {
        const brakeSign = forwardSpeed === 0 ? 0 : -Math.sign(forwardSpeed);
        applyWheelImpulse(grounded, forward.x * brakeSign, forward.z * brakeSign, brakeAcceleration, tune.brakingGripUsageLimit ?? 0.92);
      }
      if (handbrake && Math.abs(forwardSpeed) > 0.2) {
        const rear = grounded.filter(index => !wheelSpecs[index].front);
        const brakeWheels = rear.length ? rear : grounded;
        const brakeSign = -Math.sign(forwardSpeed);
        applyWheelImpulse(brakeWheels, forward.x * brakeSign, forward.z * brakeSign, 5.5, tune.handbrakeGripUsageLimit ?? 0.82);
      }
    } else if (!wheelSpecs.length) {
      // Compatibility path for simple test bodies/vehicles without wheel rigs.
      const acceleration = driveAcceleration - brakeAcceleration * Math.sign(forwardSpeed || 1);
      body.applyImpulse({
        x: forward.x * acceleration * mass * dt,
        y: 0,
        z: forward.z * acceleration * mass * dt,
      }, true);
      if (handbrake && Math.abs(forwardSpeed) > 0.2) {
        const brakeImpulse = -forwardSpeed * mass * (1 - Math.exp(-3.2 * dt));
        body.applyImpulse({ x: forward.x * brakeImpulse, y: 0, z: forward.z * brakeImpulse }, true);
      }
    }

    // Aerodynamic drag acts even under throttle; rolling resistance is amplified
    // on loose terrain. The drag impulse is bounded so it cannot reverse a car.
    if (horizontalSpeed > 0.03) {
      const dragArea = tune.aeroDragArea ?? 0.95; // Cd*A, m²
      const aeroDragForce = 0.5 * 1.225 * dragArea * horizontalSpeed * horizontalSpeed;
      const rollingResistance = (tune.rollingResistance ?? 0.014) * surfaceRollingDrag;
      const rollingForce = mass * 9.81 * rollingResistance;
      const dragImpulse = Math.min(mass * horizontalSpeed, (aeroDragForce + rollingForce) * dt);
      body.applyImpulse({
        x: -velocity.x / horizontalSpeed * dragImpulse,
        y: 0,
        z: -velocity.z / horizontalSpeed * dragImpulse,
      }, true);
    }

    // Per-wheel tire forces are applied at the contact patch so front steering
    // naturally creates yaw torque. A handbrake lowers rear grip; it does not
    // turn the whole vehicle instantly like the previous arcade yaw controller.
    const steeringFalloff = tune.speedSteeringFalloff ?? 0.008;
    const minSteeringScale = tune.minSteeringScale ?? 0.4;
    const steeringScale = THREE.MathUtils.clamp(1 - horizontalSpeed * steeringFalloff, minSteeringScale, 1);
    const wheelAngle = steer * (handbrake
      ? (tune.handbrakeSteerAngle ?? 0.42)
      : (tune.steeringAngle ?? 0.28)) * steeringScale;
    const modelRightSign = Math.cos(yawOffset) >= 0 ? 1 : -1;
    const wheelSteerAngles = wheelSpecs.map(wheel => wheel.front
      ? ackermannSteerAngle(wheelAngle, wheel.x || 0, wheelSpecs, tune.wheelbase ?? 2.7, modelRightSign)
      : 0);
    body._openWorldSteerAngles = wheelSteerAngles;
    if (wheelSpecs.length && grounded.length) {
      for (const index of grounded) {
        const wheel = wheelSpecs[index];
        const state = wheelStates[index];
        const wheelForwardV = forwardV.clone();
        if (wheel.front) {
          wheelForwardV.applyAxisAngle(new THREE.Vector3(0, 1, 0), -(wheelSteerAngles[index] || 0));
        }
        wheelForwardV.y = 0;
        if (wheelForwardV.lengthSq() < 1e-8) wheelForwardV.set(forward.x, 0, forward.z);
        wheelForwardV.normalize();
        const wheelRightV = wheelForwardV.clone().cross(new THREE.Vector3(0, 1, 0)).normalize();
        const rx = state.point.x - translation.x;
        const ry = state.point.y - translation.y;
        const rz = state.point.z - translation.z;
        const pointVX = velocity.x + angular.y * rz - angular.z * ry;
        const pointVY = velocity.y + angular.z * rx - angular.x * rz;
        const pointVZ = velocity.z + angular.x * ry - angular.y * rx;
        const pointVelocity = new THREE.Vector3(pointVX, pointVY, pointVZ);
        const wheelLongSpeed = pointVelocity.dot(wheelForwardV);
        const wheelLateralSpeed = pointVelocity.dot(wheelRightV);
        const slipAngle = Math.atan2(wheelLateralSpeed, Math.max(tune.lowSpeedCorneringReference ?? 4.0, Math.abs(wheelLongSpeed)));
        const corneringStiffness = wheel.front
          ? (tune.frontCorneringStiffness ?? 60000)
          : (tune.rearCorneringStiffness ?? 68000);
        const handbrakeRear = handbrake && !wheel.front;
        const rearCorneringScale = handbrakeRear ? (tune.handbrakeRearGrip ?? 0.7) : 1;
        const surfaceGrip = THREE.MathUtils.clamp(state.surface?.grip ?? 1, 0.2, 1.4);
        const tireMu = tune.tireFriction ?? 1.2;
        const cornerMu = handbrakeRear ? (tune.handbrakeRearFriction ?? 0.55) : tireMu;
        const normalImpulse = Math.max(0, state.normalLoad || 0) * tireMu * surfaceGrip * dt;
        const usedLongitudinal = Math.min(normalImpulse, longitudinalImpulseByWheel[index] || 0);
        const combinedGripScale = normalImpulse > 1e-6
          ? Math.sqrt(Math.max(0, 1 - (usedLongitudinal / normalImpulse) ** 2))
          : 0;
        // A brush-style slip-angle response: small slip produces proportional
        // cornering force, while the friction circle limits large slides.
        const lateralForce = -corneringStiffness * slipAngle * rearCorneringScale;
        const maxLateralImpulse = Math.max(0, state.normalLoad || 0)
          * cornerMu * surfaceGrip * dt * combinedGripScale;
        const lateralImpulse = THREE.MathUtils.clamp(
          lateralForce * dt, -maxLateralImpulse, maxLateralImpulse,
        );
        body.applyImpulseAtPoint(
          { x: wheelRightV.x * lateralImpulse, y: wheelRightV.y * lateralImpulse, z: wheelRightV.z * lateralImpulse },
          state.point,
          true,
        );
      }
    } else {
      const gripRate = handbrake ? 0.9 : 8.5;
      const lateralImpulse = -lateralSpeed * mass * (1 - Math.exp(-gripRate * dt));
      body.applyImpulse({ x: right.x * lateralImpulse, y: 0, z: right.z * lateralImpulse }, true);
    }

    if (wheelSpecs.length && grounded.length) {
      // Cap speed by reducing drive/braking impulse rather than teleporting or
      // clamping the rigid body's velocity. Tire forces still govern turning.
      const maxReverse = tune.maxReverseSpeed ?? 9;
      if (forwardSpeed > maxForward) {
        const impulse = -(forwardSpeed - maxForward) * mass * Math.min(1, dt * 3.5);
        body.applyImpulse({ x: forward.x * impulse, y: 0, z: forward.z * impulse }, true);
      } else if (forwardSpeed < -maxReverse) {
        const impulse = (-maxReverse - forwardSpeed) * mass * Math.min(1, dt * 3.5);
        body.applyImpulse({ x: forward.x * impulse, y: 0, z: forward.z * impulse }, true);
      }
    } else if (!wheelSpecs.length) {
      const wheelAngleRate = Math.abs(forwardSpeed) > 0.25
        ? THREE.MathUtils.clamp(-(forwardSpeed / 2.8) * Math.tan(wheelAngle), -1.0, 1.0)
        : 0;
      const steeringResponse = 1 - Math.exp(-(handbrake ? 3.2 : 5.5) * dt);
      body.setAngvel({
        x: angular.x,
        y: angular.y + (wheelAngleRate - angular.y) * steeringResponse,
        z: angular.z,
      }, true);
    }

    // A gentle upright assist keeps this arcade/open-world controller fun
    // and recoverable, while still allowing chassis pitch and roll over bumps.
    // Spring/damper struts handle heave; this only corrects excessive tilt.
    const chassisUp = new THREE.Vector3(0, 1, 0).applyQuaternion(q).normalize();
    const uprightError = chassisUp.clone().cross(new THREE.Vector3(0, 1, 0));
    const uprightStrength = tune.uprightStrength ?? 4.0;
    const uprightDamping = tune.uprightDamping ?? 3.0;
    const inertiaScale = tune.uprightInertiaScale ?? 1.8;
    const torqueScale = mass * inertiaScale * dt;
    body.applyTorqueImpulse({
      x: (uprightError.x * uprightStrength - angular.x * uprightDamping) * torqueScale,
      y: 0,
      z: (uprightError.z * uprightStrength - angular.z * uprightDamping) * torqueScale,
    }, true);

    return {
      yaw, forwardSpeed, lateralSpeed, horizontalSpeed,
      wheelContacts: grounded.length, wheelStates,
    };
  }

  updateVehicleBody(body, x, y, z, yaw = 0) {
    if (!body) return;
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw || 0, 0));
    if (body._openWorldDynamic) {
      const centerY = body._openWorldCenterY || 0;
      body.setTranslation({ x, y: y + centerY, z }, true);
      body.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
      body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      body._openWorldGroundY = y;
    } else {
      body.setNextKinematicTranslation({ x, y, z });
      body.setNextKinematicRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
    }
  }

  removeVehicleBody(body) {
    if (!body || !this.world) return;
    this.world.removeRigidBody(body);
    this._vehicleBodies.delete(body.handle);
  }

  // ===== RAYCASTING =====

  castRay(origin, dir, maxDist) {
    if (!this.world) return null;

    const ray = new RAPIER.Ray(origin, dir);
    // Rapier 0.14 expects maxToi and solid as separate positional arguments.
    // Passing only (ray, true) silently casts a one-unit ray and omits normals.
    const hit = this.world.castRayAndGetNormal
      ? this.world.castRayAndGetNormal(ray, maxDist, true)
      : this.world.castRay(ray, maxDist, true);
    if (!hit) return null;

    return {
      dist: hit.timeOfImpact,
      point: new THREE.Vector3(
        origin.x + dir.x * hit.timeOfImpact,
        origin.y + dir.y * hit.timeOfImpact,
        origin.z + dir.z * hit.timeOfImpact,
      ),
      normal: new THREE.Vector3(hit.normal?.x || 0, hit.normal?.y || 1, hit.normal?.z || 0),
    };
  }

  castRayDown(x, y, z, maxDist = 50) {
    return this.castRay({ x, y, z }, { x: 0, y: -1, z: 0 }, maxDist);
  }

  // ===== SHAPES CAST =====

  // Sweep a box shape along a direction to detect collisions
  castBox(position, rotation, halfExtents, direction, maxDist) {
    if (!this.world) return null;

    try {
      const shape = new RAPIER.Cuboid(halfExtents.x, halfExtents.y, halfExtents.z);
      const pos = { x: position.x, y: position.y, z: position.z };
      const rot = rotation || { x: 0, y: 0, z: 0, w: 1 };
      const dir = { x: direction.x, y: direction.y, z: direction.z };
      const filter = new RAPIER.QueryFilter();

      const hit = this.world.castShape(
        pos,
        rot,
        shape,
        dir,
        maxDist,
        filter,
      );

      if (!hit) return null;
      return {
        timeOfImpact: hit.timeOfImpact,
        normal: hit.normal || { x: 0, y: 1, z: 0 },
      };
    } catch (e) {
      // castShape may not be available on World — fall back to raycast
      const origin = { x: position.x, y: position.y, z: position.z };
      const ray = new RAPIER.Ray(origin, direction);
      ray.maxDist = maxDist;
      const hit = this.world.castRay(ray, true);
      if (!hit) return null;
      return {
        timeOfImpact: hit.timeOfImpact,
        normal: hit.normal || { x: 0, y: 1, z: 0 },
      };
    }
  }

  // ===== CLEANUP =====

  destroy() {
    if (this.world) {
      this.world.free();
      this.world = null;
    }
    this._playerBody = null;
    this._playerCollider = null;
    this._playerController = null;
    this._vehicleBodies.clear();
    this._eventQueue = null;
  }
}

let _instance = null;
export function getPhysics() {
  if (!_instance) _instance = new Physics();
  return _instance;
}
