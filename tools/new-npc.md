# Adding an NPC to STRIKE COMMAND

This is the NPC equivalent of \`tools/new-car.md\`. Every production pedestrian, worker or guard must use this asset/config/physics pipeline. NPC meshes are authored assets, not procedural runtime geometry.

## 1. Character asset layout

Store each character under:

\`\`\`text
data/models/npc/<character-id>/
  manifest.json
  <character-id>_rigged.fbx
  animations/
  textures/
\`\`\`

The canonical civilian is \`civilian_002\`. The MakeHuman project, Mixamo rigged FBX, textures, source OBJ/MTL and downloaded clips are retained under that directory. The runtime model is \`civilian_002_rigged.fbx\`.

MakeHuman and Mixamo are offline authoring tools, not game runtime dependencies. MakeHuman creates the person, clothing and textures; Mixamo supplies the humanoid rig and approved animation clips.

## 2. Register the model and clips

Register the character in \`NPC_MODELS\` in \`js/npc-config.js\`. Only list animation files that physically exist and have an approved entry in the character manifest.

The current civilian_002 animation set is: idle, walk, run, sprint, jump, crouch idle, crouch walk, talk, phone, sit idle, fall/death, get up, wave and sit down.

Unapproved slots such as hit reaction, fear reaction, look around, work idle, stand up and flee run are deliberately absent. Do not add placeholders or runtime references until their FBXs have been downloaded, inspected and registered.

Download locomotion clips in-place. The game owns movement and collision; animation root motion must not move the NPC independently of its controller.

## 3. Skeleton and animation acceptance

Every animation assigned to a model must target that model's same Mixamo skeleton.

1. Load the rigged model and verify its humanoid skeleton.
2. Load each clip on a test clone of that model.
3. Verify hips, spine, head, arms, hands, legs and feet bind without missing tracks.
4. Inspect idle-to-walk, walk-to-run, run-to-idle and talk-to-idle crossfades.
5. Verify in-place root translation, foot contact, foot sliding, knee bend, shoulder rotation, hand placement and clothing clipping.
6. Keep one independent skeleton and AnimationMixer per live NPC. Share cached model geometry, textures and materials.

The runtime caches the source FBX and preloads all 14 approved clips once. Every live NPC gets its own skeleton and AnimationMixer while sharing the cached geometry, materials and textures.

## 4. Global movement and physics

Shared settings live in \`NPC_GLOBAL_CONFIG\` in \`js/npc-config.js\`. Distances are metres, speeds are metres/second and mass is kilograms.

Each civilian uses a kinematic Rapier capsule controller with configured height, radius, autostep and snap-to-ground. Ground acceleration, braking, friction, turn response, obstacle collision, neighbour separation and traffic clearance are centralised in the global NPC physics profile.

Do not tune shared movement by editing individual behaviour classes. Add a model-specific override only when a character's proportions or animation style require it.

## 5. World routes and reactions

Author routes in the world JSON using \`pedestrianRoutes\`. Each route references an existing road with \`sidewalk: true\` and chooses one or both sides. Route placement derives from that road's width and the sidewalk centre offset.

Pedestrian routes are separate from combat spawn points. The city can keep \`disableAutoSpawns: true\`; adding civilians must not re-enable enemy spawns.

The current runtime supports sidewalk route following, idle pauses, city-geometry collision, pedestrian separation, player yielding, directional weapon-aim reactions, gunshot panic, moving-car avoidance and jump evasion, fire/explosion panic, raycast hit capsules, damage/death, NPC-to-NPC conversations, civilian phone routines, and player dialogue with choices. All 14 approved clips are wired into these behaviours: idle, walk, run, sprint, jump, crouch idle, crouch walk, talk, phone, sit idle, fall/death, get up, wave and sit down.


## 6. World-object interaction tags

Imported GLB nodes can expose civilian-use points. The runtime recognises names such as \`bench_*\`, \`chair_*\`, \`sofa_*\`, \`phone_*\`, \`atm_*\`, \`vending_*\`, \`counter_*\`, \`workstation_*\`, \`shop_*\` and \`shelter_*\`.

For anything custom, export glTF node extras in this shape:

\`\`\`json
{
  "npcInteractable": {
    "kind": "seat",
    "label": "Bus stop bench",
    "approachOffset": { "x": 0, "y": 0, "z": 1.2 },
    "sitOffset": { "x": 0, "y": 0, "z": 0.15 }
  }
}
\`\`\`

Offsets are in the tagged node's local coordinates. Supported use kinds include seat, phone, ATM, vending, counter, workstation, shop, shelter and custom props. Civilians reserve usable objects, approach them, perform the matching activity and release them when finished. The player can also press E near a registered object. Do not mark collision proxy meshes as interactable.

## 7. Population and performance

Population caps, spawn/despawn radii, active radius, update distance and physics are centralised in \`NPC_GLOBAL_CONFIG\`.

Current caps are deliberately conservative for low-memory PCs: ultra-low 1, low 2, medium 4 and high 6. The runtime shares one cached base model, gives each NPC its own skeleton/mixer, loads clips lazily and limits updates by distance. Do not prefetch every animation at boot or spawn from \`world.spawnPoints\`.

## 8. Verification

Run:

\`\`\`bash
node --check js/npc-config.js
node --check js/npc-character.js
node --check js/civilians.js
node --check js/physics.js
node --check js/main.js
node tools/verify-npcs.mjs
\`\`\`

The verifier checks model and clip paths, manifest agreement, authored sidewalk route references, quality caps and the absence of removed legacy NPC references.

## 9. Acceptance checklist

- [ ] Model source, manifest, textures and licence/source are recorded.
- [ ] Model height, grounding and forward direction are verified.
- [ ] Every animation exists, is approved and binds to the canonical skeleton.
- [ ] In-place locomotion has no independent root drift.
- [ ] Idle, walk, run, talk, wave and death transitions are inspected.
- [ ] Physics capsule matches the visible body and clears sidewalks.
- [ ] NPC avoids world geometry, pedestrians and moving vehicles.
- [ ] Dialogue choices, NPC-to-NPC conversations, phone, seat, object, aiming, gunfire, explosion and casualty behaviour are tested.
- [ ] Pedestrian routes are authored separately from combat spawns.
- [ ] Quality caps and lazy loading are verified.
