import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NPC_MODELS, NPC_GLOBAL_CONFIG } from "../js/npc-config.js";
import { resolvePlayerAnimation, jumpStartOffset } from "../js/player-animation.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const model = NPC_MODELS.civilian_002;
assert.ok(model, "civilian_002 must be the main civilian");
assert.equal(NPC_GLOBAL_CONFIG.modelId, "civilian_002");
assert.ok(!model.inPlace.includes("jump"),
  "jump clip must retain its authored vertical lift; only the camera receives gameplay jump height");
assert.ok(fs.existsSync(path.join(root, model.modelUrl.replace("./", ""))), "canonical rigged model missing");

const manifest = JSON.parse(fs.readFileSync(path.join(root, model.manifestUrl.replace("./", "")), "utf8"));
assert.equal(manifest.id, "civilian_002");
assert.equal(manifest.status, "ready-for-game-integration");
const activeKeys = Object.keys(model.animations).sort();
const manifestKeys = Object.keys(manifest.animations || {}).filter((key) => key !== "riggedModel").sort();
assert.deepEqual(activeKeys, manifestKeys, "active animation config must match approved manifest clips");
for (const [key, url] of Object.entries(model.animations)) {
  const file = path.join(root, url.replace("./", ""));
  assert.ok(fs.existsSync(file), "missing animation " + key);
  assert.ok(fs.statSync(file).size > 1024, "animation file unexpectedly small: " + key);
}

const scene = JSON.parse(fs.readFileSync(path.join(root, "data/worlds/city-a.json"), "utf8"));
assert.equal(scene.disableAutoSpawns, true, "pedestrians must not re-enable combat spawns");
assert.ok(Array.isArray(scene.pedestrianRoutes) && scene.pedestrianRoutes.length);
for (const route of scene.pedestrianRoutes) {
  const road = scene.roads.find((item) => item.name === route.road);
  assert.ok(road && road.sidewalk, "route must reference a sidewalk road: " + route.road);
  assert.ok(route.sides.every((side) => side === -1 || side === 1));
}
const caps = NPC_GLOBAL_CONFIG.population.maxActive;
assert.ok(caps["ultra-low"] >= 1 && caps["ultra-low"] <= caps.low);
assert.ok(caps.low <= caps.medium && caps.medium <= caps.high && caps.high <= 8);
assert.ok(NPC_GLOBAL_CONFIG.physics.radius > 0 && NPC_GLOBAL_CONFIG.physics.height > 1);
assert.ok(NPC_GLOBAL_CONFIG.physics.mass > 0 && NPC_GLOBAL_CONFIG.physics.walkSpeed > 0);

for (const file of ["js/main.js", "js/character.js", "js/civilians.js", "js/npc-character.js", "js/world.js", "js/physics.js"]) {
  const source = fs.readFileSync(path.join(root, file), "utf8");
  assert.ok(!source.includes("data/models/npc/npc1/"), file + " still references old npc1 assets");
  assert.ok(!source.includes("data/models/npc/civilian_001/"), file + " still references old civilian_001 assets");
}

const playerCharacter = fs.readFileSync(path.join(root, "js/character.js"), "utf8");
assert.ok(playerCharacter.includes("MODEL.modelUrl"), "player/enemy character must load the configured civilian_002 rig");
assert.ok(!playerCharacter.includes("npc1/"), "player/enemy character still references the npc1 model");
const civilianRuntime = fs.readFileSync(path.join(root, "js/civilians.js"), "utf8");
for (const key of activeKeys) {
  assert.ok(civilianRuntime.includes('"' + key + '"'), "civilian behaviour must use approved clip: " + key);
}
const worldRuntime = fs.readFileSync(path.join(root, "js/world.js"), "utf8");
assert.ok(worldRuntime.includes("registerNpcInteractable"), "world must expose semantic interactable registration");
assert.ok(worldRuntime.includes("nearestNpcInteractable"), "world must expose nearby interactable queries");
assert.ok(civilianRuntime.includes("startConversation") && civilianRuntime.includes("nearestUsableObject"),
  "civilian runtime must support player dialogue and world-object use");
assert.ok(civilianRuntime.includes("updateSocial"), "civilian runtime must support NPC-to-NPC social behaviour");
assert.ok(civilianRuntime.includes("Math.atan2(-dx, -dz)"), "civilian look-at yaw must match the rig's 180-degree model correction");
assert.ok(civilianRuntime.includes("Math.atan2(-this.velocity.x, -this.velocity.z)"), "civilian locomotion yaw must face actual travel direction");
assert.ok(civilianRuntime.includes('if (this.ch.currentAnimation !== "walk") this.ch.play("walk", { loop: true });'),
  "civilian approach animation must not restart its walk clip every frame");


const playerRuntime = fs.readFileSync(path.join(root, "js/player.js"), "utf8");
const characterRuntime = fs.readFileSync(path.join(root, "js/character.js"), "utf8");
assert.ok(playerRuntime.includes("modelYawOffset: Math.PI"), "player must use the same 180-degree civilian_002 orientation as pedestrians");
assert.ok(playerRuntime.includes("jumpCameraHeight"),
  "jump should raise camera height separately from the gameplay capsule");
assert.ok(playerRuntime.includes("this.vel.y = 0;") && !playerRuntime.includes("this.vel.y = 8.0;"),
  "space jump must not add a second physical lift on top of the Mixamo jump clip");
assert.ok(characterRuntime.includes("modelYawOffset: Math.PI"), "enemy default yaw offset must remain explicit");
assert.ok(characterRuntime.includes("key === 'idle' ? 1 : 0"), "civilian_002 standing idle must be the initial player pose");
assert.ok(playerRuntime.includes("runThreshold: 0.62"), "normal-speed player movement must select the walk clip, not the run clip");
assert.ok(playerRuntime.includes("hipWeaponPose: false"), "player idle and locomotion clips must retain their natural arm poses");
assert.ok(playerRuntime.includes("const facingX = this._animationVelocityX"),
  "player facing must follow collision-resolved travel rather than requested keys");
assert.ok(characterRuntime.includes("if (this.appearance.hipWeaponPose === false && !this._pendingWeaponPose.aiming) return;"),
  "player hip-fire arm correction must not override idle or locomotion poses");
assert.ok(characterRuntime.includes("resolvePlayerAnimation(state, this._poseMode || 'idle')"), "player animation must use one latched state resolver");
assert.ok(characterRuntime.includes("jumpStartOffset(next.getClip().duration)"), "jump must skip its crouch anticipation frames");
assert.ok(characterRuntime.includes("const poseBlend = desired === 'jump' ? 1 : blend"), "jump must not blend against a competing locomotion cycle");
assert.ok(characterRuntime.includes("next.setEffectiveWeight(0)"), "resetting a selected clip must not restore it at full weight before crossfade");
assert.ok(playerRuntime.includes("groundSpeed: hs"), "player rig must receive measured horizontal movement");
assert.ok(playerRuntime.includes("this.physics && this.physics._playerBody ? -1.0 : 0"),
  "Rapier player must keep a downward ground probe while standing still");
assert.ok(playerRuntime.includes("(this.pos.x - frameStartX) / animationDt"), "player animation speed must come from collision-resolved displacement");
assert.equal(resolvePlayerAnimation({ groundSpeed: 0, moveX: 1, speed: 1 }, "idle"), "idle",
  "key intent alone must not start a walk cycle when the player is blocked");
assert.equal(resolvePlayerAnimation({ groundSpeed: 0.5 }, "idle"), "walk");
assert.equal(resolvePlayerAnimation({ groundSpeed: 3.2 }, "walk"), "run");
assert.equal(resolvePlayerAnimation({ groundSpeed: 2.95 }, "run"), "run",
  "run hysteresis must retain the run clip while speed dips slightly");
assert.equal(resolvePlayerAnimation({ groundSpeed: 2.7 }, "run"), "walk",
  "run hysteresis must return to walk below its exit threshold");
assert.equal(resolvePlayerAnimation({ groundSpeed: 4.2, sprint: 1 }, "run"), "sprint");
assert.equal(resolvePlayerAnimation({ groundSpeed: 4.2, airborne: 1 }, "sprint"), "jump");
assert.equal(resolvePlayerAnimation({ groundSpeed: 0.1 }, "walk"), "idle");
assert.equal(resolvePlayerAnimation({ moveZ: 1, speed: 0.55 }, "idle"), "walk",
  "shared enemy rigs must retain their normalized-speed animation contract");
assert.equal(resolvePlayerAnimation({ moveZ: 1, speed: 1 }, "walk"), "run",
  "shared enemy rigs must still reach their run clip");
assert.equal(jumpStartOffset(1), 0.18);
assert.equal(jumpStartOffset(0.5), 0.1);
assert.ok(characterRuntime.includes("const blend = 1 - Math.exp"), "animation blending must be frame-rate independent");
assert.ok(characterRuntime.includes("action.setLoop(oneShot ? THREE.LoopOnce : THREE.LoopRepeat"), "jump must be a one-shot clip, not a repeated loop");
assert.ok(playerRuntime.includes("syncCharacter(dt = 1 / 60)"), "player must pass frame time into animation blending");

assert.ok(characterRuntime.includes("setRestPose()"), "Character must expose a deterministic idle reset for spawn/respawn");
assert.ok(characterRuntime.includes("action.setEffectiveWeight(name === 'idle' ? 1 : 0)"),
  "spawn pose reset must leave idle as the only weighted clip");
assert.ok(characterRuntime.includes("if (this._forceRestPose) this.setRestPose()"),
  "an idle reset requested before FBX loading must apply after the rig builds");

assert.ok(characterRuntime.includes("const desired = animated.clone().multiply(offset)"),
  "weapon pose must be additive over the real Mixamo arm animation");
assert.ok(characterRuntime.includes("new THREE.Euler(pose.faL || 0, 0, 0)"),
  "weapon forearm pose must interpret its scalar bend angle correctly");
assert.ok(characterRuntime.includes("leftShoulder") && characterRuntime.includes("rightShoulder"),
  "weapon pose must include shoulder articulation");

const main = fs.readFileSync(path.join(root, "js/main.js"), "utf8");
const worldRuntime = fs.readFileSync(path.join(root, "js/world.js"), "utf8");
const htmlRuntime = fs.readFileSync(path.join(root, "index.html"), "utf8");
assert.ok(!main.includes("npc1/Walking.fbx"), "legacy NPC prefetch is still active");
assert.ok(worldRuntime.includes("this.buildLighting(quality);\n    // buildSky() has a low-cost ultra-low fallback. Always call it"),
  "ultra-low graphics must still initialize a visible sky background");
assert.ok(worldRuntime.includes("new THREE.Color(0x83b8d4)"),
  "ultra-low sky must not use the default black renderer clear");
assert.ok(main.includes("this.player.char?.setRestPose?.()"),
  "spawn and respawn must reset all animation weights to a clean idle pose");
assert.ok((main.match(/this\.player\.char\?\.setRestPose\?\.\(\)/g) || []).length >= 2,
  "both spawn and respawn must clear leftover jump/crouch blending");
assert.ok(!main.includes("const dp = document.getElementById('device-prompt')"),
  "missile device prompt must not be shown unconditionally in free roam");
assert.ok(!htmlRuntime.includes('id="device-prompt"'),
  "stale always-on missile device hint must be removed from the HUD");
assert.ok(main.includes("!driving && this.world.atmosphere) ? 'block' : 'none'"),
  "F8 weather control must be hidden when the low-end renderer has no atmosphere system");
assert.ok(main.includes("const crouchKeys = this._crouchKeys || (this._crouchKeys = new Set())"),
  "crouch input must track each held key independently");
assert.ok(main.includes("I.crouch = crouchKeys.size > 0"),
  "releasing one crouch key must not clear another held crouch key");
assert.ok(main.includes("crouchKeys.clear()"),
  "pause/blur must clear stuck crouch input");
assert.ok(main.includes("this.world.groundHeightAt(s.x, s.z)"),
  "player must spawn at the support surface instead of falling from a fixed Y offset");
console.log("NPC verification passed: civilian_002, " + activeKeys.length + " approved clips, authored sidewalk routes and physics/population config.");
