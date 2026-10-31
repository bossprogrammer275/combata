import * as THREE from "./lib/three.module.js";
import { NpcCharacter, preloadNpcBase, preloadNpcAnimations } from "./npc-character.js";
import { NPC_GLOBAL_CONFIG as C, NPC_DEFAULT_ROUTES } from "./npc-config.js";

const P = C.physics;
const POP = C.population;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const angleDelta = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

function routePoints(road, side) {
  const src = (road.points || []).map(p => ({ x: +p[0], z: +p[1], y: Number.isFinite(p[2]) ? +p[2] : 0 }));
  if (src.length < 2) return [];
  const offset = (Number(road.w) || 12) / 2 + 1.2;
  const out = [];
  for (let i = 0; i < src.length - 1; i++) {
    const a = src[i], b = src[i + 1], dx = b.x - a.x, dz = b.z - a.z;
    const length = Math.hypot(dx, dz);
    if (length < 0.1) continue;
    const nx = -dz / length, nz = dx / length, steps = Math.max(1, Math.ceil(length / 7));
    for (let j = 0; j < steps; j++) {
      const t = j / steps;
      out.push({ x: a.x + dx * t + nx * offset * side, y: Math.max(0, a.y + (b.y - a.y) * t) + 0.12, z: a.z + dz * t + nz * offset * side });
    }
  }
  const a = src[src.length - 2], b = src[src.length - 1];
  const dx = b.x - a.x, dz = b.z - a.z, length = Math.hypot(dx, dz) || 1;
  out.push({ x: b.x - dz / length * offset * side, y: Math.max(0, b.y) + 0.12, z: b.z + dx / length * offset * side });
  return out;
}

export class Civilian {
  constructor(manager, route, index, point) {
    this.manager = manager;
    this.scene = manager.scene;
    this.world = manager.world;
    this.modelId = "civilian_002";
    this.name = "Civilian 002";
    this.route = route;
    this.routeIndex = index;
    this.pos = new THREE.Vector3(point.x, point.y, point.z);
    this.velocity = new THREE.Vector3();
    this.desired = new THREE.Vector3();
    this.yaw = 0;
    this.alive = true;
    this.civilian = true;
    this.hp = 55;
    this.deathT = 0;
    this.state = "idle";
    this.idleT = 1 + Math.random() * 2;
    this.fleeT = 0;
    this.fleeFromPos = null;
    this.interactionT = 0;
    this.interactionPhase = "";
    this.interactionLine = "";
    this.fearT = 0;
    this.jumpT = 0;
    this.activity = "";
    this.activityT = 0;
    this.activityObject = null;
    this.activityTarget = null;
    this.socialPartner = null;
    this.phoneCooldown = 7 + Math.random() * 14;
    this.ch = new NpcCharacter(C.modelId);
    this.root = this.ch.root;
    this.root.name = "civilian_002";
    this.root.position.copy(this.pos);
    this.root.rotation.y = Math.PI;
    this.scene.add(this.root);
    this.headOffset = new THREE.Vector3(0, P.headHeight, 0);
    this.chestOffset = new THREE.Vector3(0, P.chestHeight, 0);
    this.body = manager.physics?.createNpcController(this.pos.x, this.pos.y, this.pos.z, {
      radius: P.radius, height: P.height, stepHeight: P.stepHeight
    }) || null;
    this.ready = this.ch.ready.then(() => this.ch.play("idle"));
  }

  _releaseObject() {
    if (this.activityObject?.reservedBy === this) this.activityObject.reservedBy = null;
    this.activityObject = null;
    this.activityTarget = null;
  }

  fleeFrom(source, radius = P.fleeRadius) {
    if (!this.alive || !source || this.pos.distanceTo(source) > radius) return;
    if (this.fleeT <= 0) this.fleeFromPos = source.clone();
    this._releaseObject();
    this.interactionT = 0;
    this.manager.endSocial(this);
    this.fleeT = Math.max(this.fleeT, P.fleeSeconds);
    this.fearT = 0;
    this.state = "flee";
    this.activity = "";
    this.ch.play("run", { loop: true });
  }

  greet(player) {
    if (!this.alive || this.fleeT > 0) return null;
    this._releaseObject();
    this.manager.endSocial(this);
    this.activity = "";
    this.activityT = 0;
    this.interactionT = C.interaction.duration;
    this.interactionPhase = "wave";
    this.interactionLine = C.interaction.lines[(Math.random() * C.interaction.lines.length) | 0];
    this.face(player.pos);
    this.state = "talk";
    this.ch.play("wave", { loop: false });
    return this.interactionLine;
  }

  face(position) {
    const dx = position.x - this.pos.x, dz = position.z - this.pos.z;
    if (dx * dx + dz * dz < 0.001) return;
    this.yaw += angleDelta(this.yaw, Math.atan2(dx, dz)) * 0.25;
  }

  raycastHit(origin, direction, maxDistance) {
    const parts = [
      { p: this.pos.clone().add(this.headOffset), r: 0.21, head: true },
      { p: this.pos.clone().add(this.chestOffset), r: 0.38, head: false },
      { p: this.pos.clone().add(new THREE.Vector3(0, 0.48, 0)), r: 0.31, head: false }
    ];
    let best = null;
    for (const part of parts) {
      const oc = part.p.clone().sub(origin);
      const t = oc.dot(direction);
      if (t < 0 || t > maxDistance) continue;
      const d2 = oc.lengthSq() - t * t;
      if (d2 > part.r * part.r) continue;
      const distance = Math.max(0, t - Math.sqrt(part.r * part.r - d2));
      if (!best || distance < best.dist) best = { dist: distance, head: part.head };
    }
    return best;
  }

  takeDamage(amount) {
    if (!this.alive) return false;
    this.hp -= Math.max(0, Number(amount) || 0);
    if (this.hp <= 0) {
      this.alive = false;
      this.deathT = 0;
      this.state = "dead";
      this.velocity.set(0, 0, 0);
      this._releaseObject();
      this.manager.endSocial(this);
      this.ch.play("fall_death", { loop: false });
      this.manager.onCasualty?.(this);
      return true;
    }
    this.fleeFrom(this.manager.lastDamageSource || this.manager.playerPosition(), 22);
    return false;
  }

  avoidVehicles() {
    let panic = false;
    this.vehicleSource = null;
    for (const vehicle of this.manager.vehicles?.vehicles || []) {
      if (!vehicle?.pos) continue;
      const dx = this.pos.x - vehicle.pos.x, dz = this.pos.z - vehicle.pos.z;
      const distance = Math.hypot(dx, dz);
      if (distance < 0.01) continue;
      const half = vehicle.bodyBox
        ? Math.max(vehicle.bodyBox.max.x - vehicle.bodyBox.min.x, vehicle.bodyBox.max.z - vehicle.bodyBox.min.z) / 2
        : 2.5;
      const moving = Math.abs(vehicle.speed || 0) > P.vehiclePanicSpeed;
      const edge = half + P.radius + 0.7;
      if (distance < edge + 3) {
        this.desired.add(new THREE.Vector3(dx / distance, 0, dz / distance)
          .multiplyScalar(clamp((edge + 3 - distance) / 3, 0, 1) * (moving ? 2.2 : 1)));
      }
      if (moving && distance < P.vehiclePanicDistance + half) {
        panic = true;
        this.vehicleSource = vehicle.pos;
        if (distance < edge + 0.9 && this.jumpT <= 0) {
          this.jumpT = 0.72;
          this.ch.play("jump", { loop: false });
        }
      }
    }
    return panic;
  }

  startObjectActivity(object) {
    if (!object || object.reservedBy && object.reservedBy !== this) return false;
    const sourcePosition = object.approachPosition || object.position;
    const position = sourcePosition?.clone ? sourcePosition.clone() : null;
    if (!position) return false;
    object.reservedBy = this;
    this.activityObject = object;
    this.activityTarget = position;
    this.activity = "approach";
    this.activityT = 12;
    this.state = "walk";
    return true;
  }

  _move(dt, desired, targetY) {
    const response = desired.lengthSq() > this.velocity.lengthSq() ? P.acceleration : P.braking;
    this.velocity.lerp(desired, 1 - Math.exp(-response * dt));
    if (desired.lengthSq() < 0.001) this.velocity.multiplyScalar(Math.exp(-P.groundFriction * dt));
    const dx = this.velocity.x * dt;
    const dz = this.velocity.z * dt;
    const dy = clamp(targetY - this.pos.y, -P.stepHeight, P.stepHeight);
    const moved = this.body ? this.manager.physics.moveNpcController(this.body, dx, dy, dz) : null;
    let collided = false;
    if (moved?.position) {
      this.pos.copy(moved.position);
    } else {
      const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / P.collisionSubstep));
      for (let i = 0; i < steps; i++) {
        const x = this.pos.x + dx / steps, z = this.pos.z + dz / steps;
        if (this.world.colliderAt(x, z, P.radius)) {
          collided = true;
          this.velocity.multiplyScalar(0.12);
          break;
        }
        this.pos.x = x;
        this.pos.z = z;
      }
      this.pos.y += (targetY - this.pos.y) * (1 - Math.exp(-8 * dt));
    }
    return { speed: Math.hypot(this.velocity.x, this.velocity.z), collided };
  }

  _finishActivity() {
    this._releaseObject();
    this.activity = "";
    this.activityT = 0;
    this.state = "idle";
    this.idleT = 1 + Math.random() * 3;
    this.ch.play("idle", { loop: true });
  }

  _updateActivity(dt, player) {
    if (!this.activity) return false;
    if (this.activity === "approach" && this.activityTarget) {
      const delta = this.activityTarget.clone().sub(this.pos);
      delta.y = 0;
      const distance = delta.length();
      if (distance < 0.65) {
        this.velocity.set(0, 0, 0);
        this.pos.copy(this.activityTarget);
        this.root.position.copy(this.pos);
        this.face(this.activityObject?.position || this.activityTarget);
        const kind = this.activityObject?.kind;
        if (kind === "seat") {
          this.activity = "sitDown";
          this.activityT = 1.15;
          this.ch.play("sit_down", { loop: false });
        } else {
          this.activity = "using";
          this.activityT = kind === "phone" ? 4.2 : 3.4;
          this.ch.play(kind === "phone" ? "phone" : "talk", { loop: true });
        }
      } else {
        const desired = delta.normalize().multiplyScalar(P.walkSpeed);
        const moved = this._move(dt, desired, this.pos.y);
        if (moved.speed > 0.1) this.yaw += angleDelta(this.yaw, Math.atan2(this.velocity.x, this.velocity.z)) * (1 - Math.exp(-P.turnResponse * dt));
        this.root.position.copy(this.pos);
        this.root.rotation.y = this.yaw + Math.PI;
        this.ch.play("walk", { loop: true });
      }
      this.activityT -= dt;
      if (this.activityT <= 0 && this.activity === "approach") this._finishActivity();
      this.ch.update(dt);
      return true;
    }
    this.activityT -= dt;
    if (this.activity === "sitDown" && this.activityT <= 0) {
      this.activity = "seated";
      this.activityT = 6 + Math.random() * 10;
      this.ch.play("sit_idle", { loop: true });
    } else if (this.activity === "seated" && this.activityT <= 0) {
      this.activity = "standing";
      this.activityT = 1.1;
      this.ch.play("get_up", { loop: false });
    } else if (this.activity === "standing" && this.activityT <= 0) {
      this._finishActivity();
    } else if (this.activity === "using" && this.activityT <= 0) {
      this._finishActivity();
    } else if (this.activity === "social" && this.activityT <= 0) {
      this.manager.endSocial(this);
    }
    if (this.activity === "social" && this.socialPartner) this.face(this.socialPartner.pos);
    else if (player) this.face(player.pos);
    this.root.position.copy(this.pos);
    this.root.rotation.y = this.yaw + Math.PI;
    this.ch.update(dt);
    return true;
  }

  update(dt, context = {}) {
    const d = Math.min(Math.max(dt, 0), 0.05);
    if (!this.alive) {
      this.deathT += d;
      this.ch.update(d);
      return this.deathT >= POP.keepDeadSeconds;
    }
    const player = context.player;
    const playerDistance = player ? this.pos.distanceTo(player.pos) : Infinity;

    if (context.aiming && player && playerDistance < P.aimPanicRadius && this.fleeT <= 0 && this.fearT <= 0) {
      this.fearT = 0.55;
      this.state = "fear";
      this.ch.play("crouch_idle", { loop: true });
    }
    if (this.fearT > 0) {
      this.fearT = Math.max(0, this.fearT - d);
      if (this.fearT <= 0 && player) {
        this.fleeT = P.fleeSeconds;
        this.fleeFromPos = player.pos.clone();
        this.activity = "crouchEscape";
        this.activityT = 0.9;
        this.ch.play("crouch_walk", { loop: true });
      }
      this.face(player?.pos || this.pos);
      this.root.position.copy(this.pos);
      this.root.rotation.y = this.yaw + Math.PI;
      this.ch.update(d);
      return false;
    }

    if ((context.gunshot && playerDistance < P.gunshotPanicRadius) && this.fleeT <= 0) this.fleeFrom(player.pos, P.gunshotPanicRadius);
    this.desired.set(0, 0, 0);
    const vehiclePanic = this.avoidVehicles();
    if (vehiclePanic && this.fleeT <= 0) this.fleeFrom(this.vehicleSource || player?.pos || this.pos, P.vehiclePanicDistance + 5);
    if (this.interactionT > 0 && this.fleeT <= 0 && player) {
      this.interactionT -= d;
      this.face(player.pos);
      if (this.interactionPhase === "wave" && this.interactionT < C.interaction.duration - C.interaction.waveSeconds) {
        this.interactionPhase = "talk";
        this.ch.play("talk", { loop: true });
      }
      if (this.interactionT <= 0) {
        this.interactionPhase = "";
        this.state = "idle";
        this.ch.play("idle", { loop: true });
      }
      this.root.position.copy(this.pos);
      this.root.rotation.y = this.yaw + Math.PI;
      this.ch.update(d);
      return false;
    }

    if (this.activity === "crouchEscape") {
      this.activityT -= d;
      const away = this.pos.clone().sub(this.fleeFromPos || this.pos);
      away.y = 0;
      if (away.lengthSq() > 0.001) this.desired.copy(away.normalize()).multiplyScalar(1.4);
      const moved = this._move(d, this.desired, this.pos.y);
      this.desired.set(0, 0, 0);
      if (this.activityT <= 0) {
        this.activity = "";
        this.ch.play("run", { loop: true });
      }
      this.root.position.copy(this.pos);
      this.root.rotation.y = this.yaw + Math.PI;
      this.ch.update(d);
      return false;
    }

    if (this._updateActivity(d, player)) return false;

    const onFire = (this.world.reactiveObjects || []).find(o =>
      o.burning && o.mesh?.position && this.pos.distanceTo(o.mesh.position) < P.explosionPanicRadius
    );
    if (onFire && this.fleeT <= 0) this.fleeFrom(onFire.mesh.position, P.explosionPanicRadius);

    if (this.fleeT > 0) {
      this.fleeT = Math.max(0, this.fleeT - d);
      const away = this.fleeFromPos ? this.pos.clone().sub(this.fleeFromPos) : new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
      away.y = 0;
      if (away.lengthSq() < 0.001) away.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
      this.desired.copy(away.normalize()).multiplyScalar(P.fleeSpeed);
      this.state = "flee";
    } else {
      this.idleT -= d;
      const target = this.route?.[this.routeIndex % (this.route?.length || 1)];
      if (this.idleT <= 0 && target) {
        let dx = target.x - this.pos.x, dz = target.z - this.pos.z;
        if (Math.hypot(dx, dz) < C.behaviour.routeArrivalDistance) this.routeIndex = (this.routeIndex + 1) % this.route.length;
        const next = this.route[this.routeIndex % this.route.length];
        dx = next.x - this.pos.x;
        dz = next.z - this.pos.z;
        const length = Math.hypot(dx, dz);
        if (length > 0.1) {
          this.desired.set(dx / length, 0, dz / length).multiplyScalar(P.walkSpeed);
          this.state = "walk";
        } else this.state = "idle";
      } else this.state = "idle";
    }

    for (const other of this.manager.list) {
      if (other === this || !other.alive) continue;
      const dx = this.pos.x - other.pos.x, dz = this.pos.z - other.pos.z, distance = Math.hypot(dx, dz);
      if (distance > 0.01 && distance < P.personalSpace) {
        const strength = (P.personalSpace - distance) / P.personalSpace;
        this.desired.x += dx / distance * strength;
        this.desired.z += dz / distance * strength;
      }
    }
    if (player && playerDistance < P.playerAvoidanceRadius && playerDistance > 0.05 && this.fleeT <= 0) {
      this.desired.add(new THREE.Vector3(this.pos.x - player.pos.x, 0, this.pos.z - player.pos.z)
        .normalize().multiplyScalar((P.playerAvoidanceRadius - playerDistance) * 1.5));
    }

    // Civilians use nearby authored seat/phone/shop objects as routine destinations.
    if (this.fleeT <= 0 && this.state === "idle" && this.idleT <= 0 && Math.random() < d * 0.12) {
      const object = this.manager.nearestUsableObject(this.pos, 22);
      if (object) this.startObjectActivity(object);
    }
    if (this.fleeT <= 0 && this.state === "idle") {
      this.phoneCooldown -= d;
      if (this.phoneCooldown <= 0 && Math.random() < d * 0.5) {
        this.activity = "using";
        this.activityT = 3.5 + Math.random() * 2;
        this.ch.play("phone", { loop: true });
        this.phoneCooldown = 22 + Math.random() * 24;
      }
    }

    const cap = this.fleeT > 0 ? P.fleeSpeed : (this.state === "walk" ? P.walkSpeed : 0);
    if (this.desired.lengthSq() > cap * cap) this.desired.setLength(cap);
    const routeY = this.route?.[this.routeIndex]?.y ?? this.pos.y;
    const moved = this._move(d, this.desired, routeY);
    if (moved.collided && this.fleeT > 0 && this.activity !== "crouchEscape") {
      this.ch.play("crouch_walk", { loop: true });
    }

    if (moved.speed > 0.12) this.yaw += angleDelta(this.yaw, Math.atan2(this.velocity.x, this.velocity.z)) * (1 - Math.exp(-P.turnResponse * d));
    else if (player && playerDistance < C.behaviour.lookAtPlayerDistance) this.face(player.pos);
    this.root.position.copy(this.pos);
    this.root.rotation.y = this.yaw + Math.PI;

    const animation = this.jumpT > 0 ? "jump"
      : this.fleeT > 0 ? (moved.speed >= P.sprintSpeed * 0.92 ? "sprint" : (this.ch.currentAnimation === "crouch_walk" && moved.collided ? "crouch_walk" : "run"))
        : moved.speed > 0.25 ? (this.state === "walk" ? "walk" : (moved.speed > P.runSpeed ? "run" : "walk")) : "idle";
    this.jumpT = Math.max(0, this.jumpT - d);
    if (animation !== this.ch.currentAnimation && !["wave", "talk", "fall_death", "phone", "sit_down", "sit_idle", "get_up"].includes(this.ch.currentAnimation)) {
      this.ch.play(animation, { loop: animation !== "jump" });
    }
    if (moved.speed > 0.1 && ["walk", "run", "sprint"].includes(animation)) {
      const reference = animation === "sprint" ? P.sprintSpeed : animation === "run" ? P.runSpeed : P.walkSpeed;
      this.ch.setTimeScale(moved.speed / reference);
    }
    this.ch.update(d);
    return false;
  }

  dispose() {
    this._releaseObject();
    this.manager.physics?.removeNpcController(this.body);
    this.body = null;
    this.ch.dispose();
  }
}

export class Civilians {
  constructor(scene, world, options = {}) {
    this.scene = scene;
    this.world = world;
    this.physics = options.physics || null;
    this.vehicles = options.vehicles || null;
    this.player = options.player || null;
    this.quality = options.quality || "medium";
    this.hud = options.hud || null;
    this.list = [];
    this.routes = [];
    this.onCasualty = null;
    this.spawnTimer = 0;
    this.lastDamageSource = null;
    this.ui = null;
    this.prompt = null;
    this.dialoguePanel = null;
    this.dialogueText = null;
    this.dialogueActions = null;
    this.currentConversation = null;
    this.ready = this.initialize().catch(error => {
      this.loadError = error;
      console.error("[NPC] civilian_002 initialization failed.", error);
      this.setPrompt("", false);
      return this;
    });
  }

  async initialize() {
    await preloadNpcBase(C.modelId);
    // Load every real clip from civilian_002's manifest, not only locomotion.
    await preloadNpcAnimations(C.modelId);
    this.buildRoutes();
    this.createUi();
    this.populateInitial();
    console.info("[NPC] civilian_002 population ready: " + this.list.length);
    return this;
  }

  buildRoutes() {
    const definitions = Array.isArray(this.world.sceneData?.pedestrianRoutes)
      ? this.world.sceneData.pedestrianRoutes : NPC_DEFAULT_ROUTES;
    const roads = this.world.sceneData?.roads || [];
    this.routes = [];
    for (const definition of definitions) {
      const road = roads.find(r => r.name === definition.road);
      if (!road?.sidewalk) continue;
      for (const side of definition.sides || [1]) {
        const points = routePoints(road, Number(side) < 0 ? -1 : 1);
        if (points.length > 1) this.routes.push({ id: definition.road + ":" + side, points });
      }
    }
    if (!this.routes.length) console.warn("[NPC] No authored sidewalk routes found.");
  }

  createUi() {
    if (typeof document === "undefined" || this.ui) return;
    const root = document.createElement("div");
    root.id = "npc-interaction-ui";
    root.style.cssText = "position:fixed;left:50%;bottom:10%;transform:translateX(-50%);z-index:45;display:none;width:min(92vw,440px);padding:12px 14px;border:1px solid rgba(255,255,255,.2);border-radius:10px;background:rgba(8,12,16,.9);backdrop-filter:blur(12px);color:#f4f5f6;font:500 13px/1.45 system-ui,sans-serif;text-align:left;pointer-events:auto;";
    const prompt = document.createElement("div");
    prompt.style.cssText = "text-align:center;font-weight:700;letter-spacing:.04em;";
    const panel = document.createElement("div");
    panel.style.cssText = "display:none;";
    const text = document.createElement("div");
    text.style.cssText = "margin:4px 0 10px;";
    const actions = document.createElement("div");
    actions.style.cssText = "display:flex;gap:7px;flex-wrap:wrap;justify-content:center;";
    panel.append(text, actions);
    root.append(prompt, panel);
    document.body.appendChild(root);
    this.ui = root;
    this.prompt = prompt;
    this.dialoguePanel = panel;
    this.dialogueText = text;
    this.dialogueActions = actions;
  }

  setPrompt(text, visible = true) {
    if (!this.prompt || !this.ui) return;
    this.prompt.textContent = text;
    this.prompt.style.display = visible ? "block" : "none";
    if (!this.currentConversation) this.ui.style.display = visible ? "block" : "none";
  }

  showDialogue(text, choices) {
    if (!this.ui) return;
    this.ui.style.display = "block";
    this.prompt.style.display = "none";
    this.dialoguePanel.style.display = "block";
    this.dialogueText.textContent = text;
    this.dialogueActions.replaceChildren();
    for (const choice of choices) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = choice.label;
      button.style.cssText = "border:1px solid rgba(255,255,255,.24);border-radius:7px;padding:7px 10px;background:rgba(255,255,255,.08);color:#fff;font:600 12px system-ui;cursor:pointer;";
      button.addEventListener("click", choice.onClick);
      this.dialogueActions.appendChild(button);
    }
  }

  closeConversation() {
    this.currentConversation = null;
    if (this.dialoguePanel) this.dialoguePanel.style.display = "none";
    this.setPrompt("", false);
  }

  startConversation(npc) {
    if (!npc || !npc.alive) return false;
    const opening = npc.greet(this.player);
    if (!opening) return false;
    this.currentConversation = npc;
    const choices = [
      { label: "Ask for directions", onClick: () => this.chooseDialogue(0) },
      { label: "Ask about the city", onClick: () => this.chooseDialogue(1) },
      { label: "Goodbye", onClick: () => this.chooseDialogue(2) }
    ];
    this.showDialogue(opening, choices);
    return true;
  }

  chooseDialogue(index) {
    const npc = this.currentConversation;
    if (!npc || !npc.alive) return this.closeConversation();
    if (index === 2) {
      this.closeConversation();
      npc.interactionT = 0;
      npc.interactionPhase = "";
      npc.state = "idle";
      npc.ch.play("idle", { loop: true });
      return;
    }
    let answer;
    if (index === 0) {
      const locations = this.world.namedLocations || [];
      const nearest = locations.slice().sort((a, b) =>
        Math.hypot(a.x - npc.pos.x, a.z - npc.pos.z) - Math.hypot(b.x - npc.pos.x, b.z - npc.pos.z)
      )[0];
      answer = nearest
        ? "The nearest landmark is " + nearest.name + ". Keep to the main road and watch the junctions."
        : "Stay on the main road and follow the signs. That is the easiest way around here.";
    } else {
      answer = ["The city is growing fast. New shops and roads keep showing up.",
        "Traffic gets busy around the main avenues, especially later in the day.",
        "People here are friendly. Just ask when you need help."][(Math.random() * 3) | 0];
    }
    npc.interactionT = 2.7;
    npc.interactionPhase = "talk";
    npc.ch.play("talk", { loop: true });
    this.showDialogue(answer, [
      { label: "Ask something else", onClick: () => this.showDialogue("Anything else you want to know?", [
        { label: "Directions", onClick: () => this.chooseDialogue(0) },
        { label: "About the city", onClick: () => this.chooseDialogue(1) },
        { label: "Goodbye", onClick: () => this.chooseDialogue(2) }
      ]) },
      { label: "Goodbye", onClick: () => this.chooseDialogue(2) }
    ]);
  }

  limit() { return POP.maxActive[this.quality] || POP.maxActive.medium; }

  locations() {
    const points = [];
    for (const route of this.routes) {
      for (let i = 0; i < route.points.length; i += 2) points.push({ route, index: i, point: route.points[i] });
    }
    return points;
  }

  populateInitial() {
    const origin = this.world.startPoint || { x: 0, z: 0 };
    const items = this.locations().sort((a, b) =>
      Math.hypot(a.point.x - origin.x, a.point.z - origin.z) - Math.hypot(b.point.x - origin.x, b.point.z - origin.z)
    );
    const selected = [];
    for (const item of items) {
      if (selected.length >= this.limit()) break;
      if (Math.hypot(item.point.x - origin.x, item.point.z - origin.z) > POP.spawnRadius) continue;
      if (selected.some(p => Math.hypot(p.point.x - item.point.x, p.point.z - item.point.z) < POP.minSpawnSeparation)) continue;
      if (!this.world.colliderAt(item.point.x, item.point.z, P.radius)) selected.push(item);
    }
    for (const item of selected) this.spawnAt(item);
  }

  spawnAt(item) {
    const npc = new Civilian(this, item.route, item.index, item.point);
    npc.ready.catch(error => console.error("[NPC] Civilian 002 instance failed.", error));
    this.list.push(npc);
    return npc;
  }

  trySpawnNearPlayer() {
    if (!this.player || !this.routes.length) return;
    const x = this.player.pos.x, z = this.player.pos.z;
    const nearby = this.locations().filter(item => Math.hypot(item.point.x - x, item.point.z - z) < POP.spawnRadius);
    for (let i = 0; i < Math.min(POP.maxSpawnAttempts, nearby.length); i++) {
      const item = nearby[(Math.random() * nearby.length) | 0];
      if (this.world.colliderAt(item.point.x, item.point.z, P.radius)) continue;
      if (this.list.some(npc => npc.alive && Math.hypot(npc.pos.x - item.point.x, npc.pos.z - item.point.z) < POP.minSpawnSeparation)) continue;
      this.spawnAt(item);
      return;
    }
  }

  playerPosition() { return this.player?.pos || new THREE.Vector3(); }

  nearest(position = this.playerPosition(), maxDistance = P.interactionLookRadius) {
    let best = null, distance = maxDistance;
    for (const npc of this.list) {
      if (!npc.alive || npc.fleeT > 0) continue;
      const d = Math.hypot(npc.pos.x - position.x, npc.pos.z - position.z);
      if (d < distance) { best = npc; distance = d; }
    }
    return best ? { civilian: best, distance } : null;
  }

  nearestUsableObject(position, maxDistance = 20) {
    const objects = this.world.npcInteractables || [];
    let best = null, bestDistance = maxDistance;
    for (const object of objects) {
      if (!object?.mesh?.visible || object.reservedBy || !object.position) continue;
      if (!["seat", "phone", "counter", "vending", "atm"].includes(object.kind)) continue;
      object.mesh.updateWorldMatrix(true, false);
      object.mesh.getWorldPosition(object.position);
      const distance = Math.hypot(object.position.x - position.x, object.position.z - position.z);
      if (distance < bestDistance) { best = object; bestDistance = distance; }
    }
    return best;
  }

  endSocial(npc) {
    const partner = npc?.socialPartner;
    if (partner) {
      partner.socialPartner = null;
      partner.activity = "";
      partner.activityT = 0;
      partner.state = "idle";
      partner.ch.play("idle", { loop: true });
    }
    if (npc) {
      npc.socialPartner = null;
      npc.activity = "";
      npc.activityT = 0;
      npc.state = "idle";
      npc.ch.play("idle", { loop: true });
    }
  }

  updateSocial(dt) {
    const active = this.list.filter(npc => npc.alive && !npc.fleeT && !npc.activity && !npc.interactionT && npc.state === "idle");
    for (let i = 0; i < active.length; i++) {
      const a = active[i];
      if (a.socialPartner || Math.random() > dt * 0.025) continue;
      const b = active.slice(i + 1).find(other => !other.socialPartner && a.pos.distanceTo(other.pos) < 2.4);
      if (!b) continue;
      a.socialPartner = b;
      b.socialPartner = a;
      a.activity = b.activity = "social";
      a.activityT = b.activityT = 3.5 + Math.random() * 2;
      a.state = b.state = "talk";
      a.face(b.pos);
      b.face(a.pos);
      a.ch.play("talk", { loop: true });
      b.ch.play("talk", { loop: true });
      break;
    }
  }

  tryInteract(player = this.player) {
    if (!player) return false;
    if (this.currentConversation) {
      this.closeConversation();
      return true;
    }
    const nearby = this.nearest(player.pos, P.interactionRadius);
    if (nearby) return this.startConversation(nearby.civilian);
    const object = this.world.nearestNpcInteractable?.(player.pos, 2.4);
    if (object) {
      if (typeof object.onPlayerInteract === "function") object.onPlayerInteract(player, this);
      else this.hud?.toast?.("INTERACTED: " + (object.label || object.kind.toUpperCase()));
      return true;
    }
    return false;
  }

  fleeFrom(position, radius = P.fleeRadius) {
    this.lastDamageSource = position.clone ? position.clone() : new THREE.Vector3(position.x, 0, position.z);
    for (const npc of this.list) npc.fleeFrom(position, radius);
  }

  resetPopulation() {
    this.closeConversation();
    for (const npc of this.list) npc.dispose();
    this.list.length = 0;
    this.populateInitial();
  }

  update(dt, context = {}) {
    if (!this.routes.length) return;
    this.player = context.player || this.player;
    this.vehicles = context.vehicles || this.vehicles;
    const player = this.player;
    const playerPosition = player?.pos || new THREE.Vector3();
    const keep = [];
    let nearestNpc = null, nearestNpcDistance = P.interactionLookRadius;
    for (const npc of this.list) {
      const distance = player ? npc.pos.distanceTo(playerPosition) : Infinity;
      if (npc.alive && distance > POP.despawnRadius) { npc.dispose(); continue; }
      if (npc.alive && distance <= POP.activeRadius) {
        npc.update(dt, { player, aiming: !!context.aiming, gunshot: !!context.gunshot, camera: context.camera });
      } else if (!npc.alive && npc.update(dt, {})) {
        npc.dispose();
        continue;
      }
      if (npc.alive && distance < nearestNpcDistance) {
        nearestNpc = npc;
        nearestNpcDistance = distance;
      }
      keep.push(npc);
    }
    this.list = keep;
    this.updateSocial(dt);
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0 && this.list.filter(npc => npc.alive).length < this.limit()) {
      this.spawnTimer = POP.spawnInterval;
      this.trySpawnNearPlayer();
    }

    if (!this.currentConversation) {
      const object = this.world.nearestNpcInteractable?.(playerPosition, P.interactionLookRadius);
      if (nearestNpc && nearestNpcDistance < P.interactionRadius) {
        this.setPrompt("E  TALK TO CIVILIAN 002", true);
      } else if (object && object.distance < P.interactionRadius) {
        this.setPrompt("E  USE " + (object.label || object.kind.toUpperCase()), true);
      } else {
        this.setPrompt("", false);
      }
    }
    if (this.currentConversation && (!this.currentConversation.alive ||
        this.currentConversation.pos.distanceTo(playerPosition) > P.interactionLookRadius)) this.closeConversation();
  }

  alive() { return this.list.filter(npc => npc.alive); }

  dispose() {
    this.closeConversation();
    for (const npc of this.list) npc.dispose();
    this.list.length = 0;
    this.ui?.remove();
    this.ui = null;
  }
}
