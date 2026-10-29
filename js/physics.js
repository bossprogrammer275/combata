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

  // Kinematic body driven directly by the arcade driving code (position set every
  // frame via setNextKinematicTranslation/Rotation, which is only valid on
  // kinematic bodies — a dynamic body silently ignores those calls).
  // Colliders are model-fitted cuboids in vehicle-local space so the physics
  // shell matches the visible car instead of a generic fixed-size box.
  createVehicleBody(x, y, z, yaw = 0, boxes = null) {
    if (!RAPIER || !this.world) return null;

    const rigidBodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased()
      .setTranslation(x, y, z);
    const rigidBody = this.world.createRigidBody(rigidBodyDesc);

    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0));
    rigidBody.setNextKinematicRotation({ x: q.x, y: q.y, z: q.z, w: q.w });

    const list = (boxes && boxes.length ? boxes : [{
      min: { x: -1.05, y: 0, z: -2.35 }, max: { x: 1.05, y: 1.2, z: 2.35 },
    }]);
    for (const b of list) {
      const hx = (b.max.x - b.min.x) / 2;
      const hy = (b.max.y - b.min.y) / 2;
      const hz = (b.max.z - b.min.z) / 2;
      if (!(hx > 0.001 && hy > 0.001 && hz > 0.001)) continue;
      const cd = RAPIER.ColliderDesc.cuboid(hx, hy, hz)
        .setTranslation((b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2, (b.min.z + b.max.z) / 2)
        .setFriction(0.5)
        .setRestitution(0.1);
      this.world.createCollider(cd, rigidBody);
    }

    this._vehicleBodies.set(rigidBody.handle, rigidBody);
    return rigidBody;
  }

  updateVehicleBody(rigidBody, x, y, z, yaw = 0) {
    if (!rigidBody) return;
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw || 0, 0));
    rigidBody.setNextKinematicTranslation({ x, y, z });
    rigidBody.setNextKinematicRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
  }

  removeVehicleBody(rigidBody) {
    if (!rigidBody || !this.world) return;
    this.world.removeRigidBody(rigidBody);
    this._vehicleBodies.delete(rigidBody.handle);
  }

  // ===== RAYCASTING =====

  castRay(origin, dir, maxDist) {
    if (!this.world) return null;

    const ray = new RAPIER.Ray(origin, dir);
    ray.maxDist = maxDist;

    const hit = this.world.castRay(ray, true);
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
