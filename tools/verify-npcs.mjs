import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolvePlayerAnimation } from "../js/player-animation.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const exists = (relative) => fs.existsSync(path.join(root, relative));
const manifest = JSON.parse(read("data/models/npc/npc_core_001/manifest.json"));
const core = read("js/npc-system/core-assets.js");
const controller = read("js/npc-system/animation-controller.js");
const profiles = read("js/npc-system/profile-registry.js");
const instance = read("js/npc-system/npc-instance.js");
const character = read("js/character.js");
const civilians = read("js/civilians.js");
const player = read("js/player.js");
const weapons = read("js/weapons.js");
const physics = read("js/physics.js");
const main = read("js/main.js");

assert.equal(manifest.schemaVersion, 2);
assert.equal(manifest.fileInventory.length, 28, "the active set must contain exactly the downloaded 28 FBXs");
assert.ok(exists(manifest.baseRig.candidateFile), "npc_core_001 base-rig candidate is missing");
for (const entry of manifest.fileInventory) {
  const relative = entry.file;
  assert.ok(exists(relative), "missing downloaded NPC-core FBX: " + relative);
  assert.ok(fs.statSync(path.join(root, relative)).size > 1024, "NPC-core FBX is unexpectedly small: " + relative);
}
assert.equal(manifest.animations.walk_aim.file.split("/").pop(), "Walking (1).fbx");
assert.equal(manifest.animations.crouch_walk_aim.file.split("/").pop(), "Crouch Walking.fbx");
assert.equal(manifest.animations.crouch_walk.file.split("/").pop(), "Crouched Walking.fbx");
assert.equal(manifest.animations.reload_idle.file.split("/").pop(), "Reloading.fbx");
assert.equal(manifest.animations.jump_idle.file.split("/").pop(), "Jumping.fbx");
assert.equal(manifest.animations.obstacle_climb.file.split("/").pop(), "Climbing.fbx");
assert.equal(manifest.animations.ladder_climb_up.file.split("/").pop(), "Climbing Ladder.fbx");
assert.equal(manifest.animations.knocked_down.file.split("/").pop(), "Knocked Down.fbx");

for (const folder of ["civilian_001", "civilian_002", "npc1"]) {
  assert.ok(!exists("data/models/npc/" + folder), "obsolete NPC model folder still exists: " + folder);
}
assert.ok(!exists("js/npc-character.js"), "legacy NPC character runtime remains");
assert.ok(!exists("js/npc-config.js"), "legacy NPC config remains");

assert.ok(core.includes("loadNpcCoreBase") && core.includes("cloneNpcCoreModel"));
assert.ok(core.includes("manifest.baseRig?.candidateFile"));
assert.ok(core.includes("stripControllerRootTranslation"));
assert.ok(core.includes("NPC_CORE_TARGET_HEIGHT = 1.74"));
assert.ok(controller.includes("addEventListener('finished'"));
assert.ok(controller.includes("jump_idle") && controller.includes("reload_idle"));
assert.ok(profiles.includes("civilian:") && profiles.includes("worker:") && profiles.includes("aggressive:") && profiles.includes("police:"));
assert.ok(instance.includes("export class NpcInstance") && instance.includes("setProfile(profileId)"));
assert.ok(character.includes("./npc-system/core-assets.js"));
assert.ok(character.includes("loadNpcCoreBase") && character.includes("walk_aim") && character.includes("reload_idle"));
assert.ok(character.includes("this.weaponType !== 'rifle'"), "non-rifle actions must not borrow rifle arm poses");
assert.ok(civilians.includes("new NpcInstance(C.defaultProfile)"), "live civilian population must use npc_core_001");
assert.ok(civilians.includes("_snapToAnchor") && civilians.includes("sit_idle"));
assert.ok(!civilians.includes('.ch.play("talk"') && !civilians.includes('.ch.play("phone"'));
assert.ok(!civilians.includes('.ch.play("sit_down"') && !civilians.includes('.ch.play("get_up"'));
assert.ok(physics.includes("setNpcControllerPosition"), "seat snapping must update the NPC kinematic controller");
assert.ok(player.includes("setReloading(enabled)") && player.includes("reloadLocked"));
assert.ok(player.includes("jumpFromIdle"));
assert.ok(weapons.includes("this.startReload(game)"));
assert.ok(weapons.includes("d.id === 'rifle' ? 3.3 : d.reloadTime"));
assert.ok(weapons.includes("game.player.weaponType = d.id"));
assert.ok(main.includes("this.weapons.startReload(this)"));
assert.ok(main.includes("LOADING VEHICLES & NPC CORE"));

for (const source of [character, civilians, player, main, profiles, instance]) {
  assert.ok(!source.includes("civilian_001/") && !source.includes("civilian_002/") && !source.includes("npc1/"),
    "a live NPC consumer still points at a deleted legacy model directory");
}

assert.equal(resolvePlayerAnimation({ groundSpeed: 0, aim: 1, weaponType: "rifle" }, "idle"), "rifle_aim_idle");
assert.equal(resolvePlayerAnimation({ groundSpeed: 0, aim: 1, weaponType: "pistol" }, "idle"), "idle",
  "pistol must not borrow a rifle animation");
assert.equal(resolvePlayerAnimation({ groundSpeed: 0.8, aim: 1, weaponType: "rifle" }, "idle"), "walk_aim");
assert.equal(resolvePlayerAnimation({ groundSpeed: 3.4, aim: 1, weaponType: "rifle" }, "walk_aim"), "rifle_run");
assert.equal(resolvePlayerAnimation({ groundSpeed: 0, crouch: 1, aim: 1, weaponType: "rifle" }, "idle"), "crouch_aim_idle");
assert.equal(resolvePlayerAnimation({ groundSpeed: 0.8, crouch: 1, aim: 1, weaponType: "rifle" }, "idle"), "crouch_walk_aim");
assert.equal(resolvePlayerAnimation({ groundSpeed: 0, reloading: 1 }, "idle"), "reload_idle");
assert.equal(resolvePlayerAnimation({ groundSpeed: 1.1, reloading: 1 }, "walk"), "walk",
  "reload must not start while moving");
assert.equal(resolvePlayerAnimation({ groundSpeed: 0, airborne: 1, jumpFromIdle: 1 }, "idle"), "jump_idle");
assert.equal(resolvePlayerAnimation({ groundSpeed: 1.5, airborne: 1, jumpFromIdle: 0 }, "run"), "run",
  "a moving jump must not borrow the idle-only jump clip");
assert.equal(resolvePlayerAnimation({ groundSpeed: 0 }, "walk"), "idle");
assert.equal(resolvePlayerAnimation({ groundSpeed: 0.5 }, "idle"), "walk");
assert.equal(resolvePlayerAnimation({ groundSpeed: 3.2 }, "walk"), "run");
assert.equal(resolvePlayerAnimation({ groundSpeed: 4.2, sprint: 1 }, "run"), "sprint");

const scene = JSON.parse(read("data/worlds/city-a.json"));
assert.ok(scene && typeof scene === "object", "existing city map must remain intact");

console.log("NPC core verification passed: 28 current FBXs, npc_core_001-only model folders, live player/enemy/civilian wiring, rifle-only animation selection, idle-only reload and jump, and seat-anchor physics integration.");
