import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NPC_MODELS, NPC_GLOBAL_CONFIG } from "../js/npc-config.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const model = NPC_MODELS.civilian_002;
assert.ok(model, "civilian_002 must be the main civilian");
assert.equal(NPC_GLOBAL_CONFIG.modelId, "civilian_002");
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

const main = fs.readFileSync(path.join(root, "js/main.js"), "utf8");
assert.ok(!main.includes("npc1/Walking.fbx"), "legacy NPC prefetch is still active");
console.log("NPC verification passed: civilian_002, " + activeKeys.length + " approved clips, authored sidewalk routes and physics/population config.");
