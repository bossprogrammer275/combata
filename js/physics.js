// Physics engine wrapper around Rapier.js (WASM).
// Provides: world simulation, character controller, vehicle controller, raycasting.
import * as THREE from 'three';

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
    const pending = colliders.filter(source => source?.min && source?.max && !source.physicsCollider);
    if (!pending.length) return 0;
    // A single fixed body can own thousands of static cuboids. One rigid body
    // per box made detailed collision manifests needlessly expensive.
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    let count = 0;
    for (const source of pending) {
      const min = source.min, max = source.max;
      const hx = (max.x - min.x) / 2;
      const hy = (max.y - min.y) / 2;
      const hz = (max.z - min.z) / 2;
      if (![hx, hy, hz].every(Number.isFinite) || hx <= 0.001 || hy <= 0.001 || hz <= 0.001) continue;
      const cx = (min.x + max.x) / 2;
      const cy = (min.y + max.y) / 2;
      const cz = (min.z + max.z) / 2;
      const desc = RAPIER.ColliderDesc.cuboid(hx, hy, hz)
        .setTranslation(cx, cy, cz)
        .setFriction(0.8)
        .setRestitution(0);
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
        .setAngularDamping(0.85)
        .setCcdEnabled(true)
        .enabledRotations(false, true, false)
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
        .setRestitution(0.025);
      this.world.createCollider(cd, body);
      created++;
    }
    body._openWorldDynamic = dynamic;
    body._openWorldCenterY = dynamic ? centerY : 0;
    body._openWorldGroundY = y;
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
    const yaw = new THREE.Euler().setFromQuaternion(q, 'YXZ').y;
    const forward = { x: -Math.sin(yaw), z: -Math.cos(yaw) };
    const right = { x: Math.cos(yaw), z: -Math.sin(yaw) };
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

    // ---- Four raycast suspension struts ----
    // Wheel positions/radii are measured from the actual GLB rig. Cast from a
    // chassis hardpoint, then apply spring-damper impulses at that hardpoint;
    // the chassis no longer rests on a flat box pressed against the road.
    const restLength = 0.22;
    const travel = 0.18;
    const springRate = 32000;
    const springDamping = 3400;
    const wheelStates = [];
    const rayHits = [];
    const bodyCenterY = body._openWorldCenterY || 0;
    const gravityLoadPerWheel = mass * 9.81 / Math.max(1, wheelSpecs.length);

    for (const wheel of wheelSpecs) {
      const lx = wheel.x || 0;
      const lz = wheel.z || 0;
      const localHardpointY = (wheel.y || 0) - bodyCenterY + restLength;
      // Three.js yaw convention: local +X/+Z rotates around world Y.
      const hardpoint = {
        x: translation.x + lx * Math.cos(yaw) + lz * Math.sin(yaw),
        y: translation.y + localHardpointY,
        z: translation.z - lx * Math.sin(yaw) + lz * Math.cos(yaw),
      };
      const radius = THREE.MathUtils.clamp(wheel.radius || 0.32, 0.18, 0.5);
      const maxRay = radius + restLength + travel;
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

      if (!hit || !hit.normal || hit.normal.y < 0.45) {
        wheelStates.push({ contact: false, offset: -travel, front: !!wheel.front });
        rayHits.push(null);
        continue;
      }
      const suspensionLength = hit.timeOfImpact - radius;
      if (suspensionLength < -0.04 || suspensionLength > restLength + travel) {
        wheelStates.push({ contact: false, offset: -travel, front: !!wheel.front });
        rayHits.push(null);
        continue;
      }

      const compression = THREE.MathUtils.clamp(restLength - suspensionLength, -travel * 0.55, travel);
      const anchorVerticalSpeed = velocity.y;
      const springForce = THREE.MathUtils.clamp(
        gravityLoadPerWheel + springRate * compression - springDamping * anchorVerticalSpeed,
        0,
        gravityLoadPerWheel * 1.85,
      );
      if (springForce > 0) {
        body.applyImpulseAtPoint(
          { x: 0, y: springForce * dt, z: 0 },
          hardpoint,
          true,
        );
      }
      const contactPoint = {
        x: hardpoint.x,
        y: hardpoint.y - hit.timeOfImpact,
        z: hardpoint.z,
      };
      const state = {
        contact: true,
        offset: THREE.MathUtils.clamp(restLength - suspensionLength, -travel * 0.55, travel),
        compression,
        suspensionLength,
        normal: { x: hit.normal.x, y: hit.normal.y, z: hit.normal.z },
        point: contactPoint,
        hardpoint,
        radius,
        front: !!wheel.front,
      };
      wheelStates.push(state);
      rayHits.push(state);
    }
    body._openWorldWheelStates = wheelStates;

    // Longitudinal engine/brake forces go through grounded wheel contacts. If
    // every wheel is airborne, throttle cannot magically accelerate the car.
    let driveAcceleration = 0;
    let brakeAcceleration = 0;
    if (throttle > 0.01) {
      const powerFade = THREE.MathUtils.clamp(1 - Math.max(0, forwardSpeed) / 48 * 0.72, 0.18, 1);
      driveAcceleration = forwardSpeed < -0.8 ? 9 * throttle : 7.2 * throttle * powerFade;
    } else if (throttle < -0.01) {
      if (Math.abs(forwardSpeed) > 1.0 && Math.sign(forwardSpeed) !== Math.sign(throttle)) {
        brakeAcceleration = 11 * Math.abs(throttle);
      } else if (Math.abs(forwardSpeed) > 1.0 && Math.sign(forwardSpeed) === Math.sign(throttle)) {
        // The reverse key also acts as a brake when the car is still going forward.
        brakeAcceleration = 11 * Math.abs(throttle);
      } else {
        driveAcceleration = -3.8 * Math.abs(throttle);
      }
    }

    const grounded = wheelStates.map((state, index) => state.contact ? index : -1).filter(index => index >= 0);
    const driveWheels = grounded.filter(index => !wheelSpecs[index].front);
    const powered = driveWheels.length ? driveWheels : grounded;
    const applyWheelImpulse = (indices, ix, iz, strength) => {
      if (!indices.length || Math.abs(strength) < 1e-5) return;
      const perWheelImpulse = strength * mass * dt / indices.length;
      for (const index of indices) {
        const state = wheelStates[index];
        if (!state?.contact) continue;
        body.applyImpulseAtPoint(
          { x: ix * perWheelImpulse, y: 0, z: iz * perWheelImpulse },
          state.point,
          true,
        );
      }
    };
    if (wheelSpecs.length && grounded.length) {
      applyWheelImpulse(powered, forward.x, forward.z, driveAcceleration);
      if (brakeAcceleration > 0) {
        const brakeSign = forwardSpeed === 0 ? 0 : -Math.sign(forwardSpeed);
        applyWheelImpulse(grounded, forward.x * brakeSign, forward.z * brakeSign, brakeAcceleration);
      }
      if (handbrake && Math.abs(forwardSpeed) > 0.2) {
        const rear = grounded.filter(index => !wheelSpecs[index].front);
        const brakeWheels = rear.length ? rear : grounded;
        const brakeSign = -Math.sign(forwardSpeed);
        applyWheelImpulse(brakeWheels, forward.x * brakeSign, forward.z * brakeSign, 5.5);
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

    // Aerodynamic/rolling drag acts horizontally but never applies an upward
    // magic force. It slows coasting without stealing the suspension response.
    if (Math.abs(throttle) < 0.02 && horizontalSpeed > 0.05) {
      const dragRate = 0.11 + horizontalSpeed * 0.0018;
      body.applyImpulse({
        x: -velocity.x * mass * (1 - Math.exp(-dragRate * dt)),
        y: 0,
        z: -velocity.z * mass * (1 - Math.exp(-dragRate * dt)),
      }, true);
    }

    // Per-wheel tire forces are applied at the contact patch so front steering
    // naturally creates yaw torque. A handbrake lowers rear grip; it does not
    // turn the whole vehicle instantly like the previous arcade yaw controller.
    const wheelAngle = steer * (handbrake ? 0.45 : 0.28);
    if (wheelSpecs.length && grounded.length) {
      for (const index of grounded) {
        const wheel = wheelSpecs[index];
        const state = wheelStates[index];
        const wheelYaw = yaw - (wheel.front ? wheelAngle : 0);
        const wheelRight = { x: Math.cos(wheelYaw), z: -Math.sin(wheelYaw) };
        const rx = state.point.x - translation.x;
        const rz = state.point.z - translation.z;
        const pointVX = velocity.x + angular.y * rz;
        const pointVZ = velocity.z - angular.y * rx;
        const lateralAtWheel = pointVX * wheelRight.x + pointVZ * wheelRight.z;
        const gripRate = handbrake && !wheel.front ? 0.9 : (wheel.front ? 7.0 : 9.0);
        const lateralImpulse = -lateralAtWheel * (mass / grounded.length) * (1 - Math.exp(-gripRate * dt));
        body.applyImpulseAtPoint(
          { x: wheelRight.x * lateralImpulse, y: 0, z: wheelRight.z * lateralImpulse },
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
      const maxForward = 40, maxReverse = 9;
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
