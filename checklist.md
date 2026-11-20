# Open World — Core Gameplay & Test-World Checklist

> **Project handoff / source of truth**
>
> Read this file before changing NPCs, character animation, weapon handling, vehicle entry, doors, chairs, traversal, world surfaces, the map editor or the test map.
>
> This file records the decisions made in the November 20, 2026 planning conversation. It is deliberately written so a fresh ChatGPT conversation can continue without asking the user to repeat the scope or decisions.
>
> When a previous chat summary or an old guide conflicts with this file, follow this file and the user's newest direct instruction.

**Game:** Open World  
**Repository:** `bossprogrammer275/combata`  
**Branch:** `main`  
**Current stage:** Core gameplay systems and one test environment  
**Not in scope yet:** Story mode, missions, narrative campaign, cutscene system, quest chains or a large production city.

---

## 0. Handoff notes for the next chat — read first

- The user wants execution, not another broad lecture or a long list of manual tasks. Inspect the repository, make the requested changes and report exactly what changed.
- Do not call the game **Strike Command**. Its current name is **Open World**. The repository/folder is still named `combata`.
- The user has explicitly rejected simply extending the current NPC/asset architecture. Build a **new NPC profile and animation layer**. Do not keep adding special cases to the existing `NPC_GLOBAL_CONFIG`, `NPC_MODELS`, `NpcCharacter`, `Civilians` and `character.js` implementation.
- Existing code and assets may be inspected or used as source/reference material, but they are not the design authority for the new layer. Do not overwrite `civilian_002`, `civilian_001` or the legacy `npc1` folder.
- The old guide `tools/new-npc.md` was read. It documents the current `civilian_002` implementation and its 14 registered clips. It is a historical reference, **not the specification for the new NPC system**.
- The first new character is `npc_core_001`. Generate one good, correctly scaled, fully rigged base humanoid first. It will be the shared test character for player/NPC animation, weapon, chair, traversal and vehicle interaction testing.
- Gameplay profiles (civilian, worker, aggressive, police, etc.) are switchable configurations over the new NPC layer. Do not generate a separate story character for every behaviour at this stage.
- The user will run the MakeHuman/Mixamo generation pipeline locally on their Windows PC. The assistant must provide and maintain the generation script, then integrate and validate the resulting model/animation files after the user has run it.
- A new generation launcher has been added:
  - `tools/character-pipeline/generate-npc-core.ps1`
  - `tools/character-pipeline/generate-npc-core.bat`
  - It defaults to `npc_core_001`, uses the existing MakeHuman + Mixamo pipeline, requests the new gameplay animation set and leaves generated files uncommitted/unpushed.
- `tools/character-pipeline/animate_civilian.py` now has expanded animation search jobs for the new gameplay actions. It still requires the user to preview/approve the Mixamo result for each requested clip. A clip skipped or unavailable in Mixamo must be recorded as missing; never invent a clip or register a placeholder.
- The local submodules and virtual environments are not stored in Git:
  - `tools/makehuman-core`
  - `tools/mixamo-mcp`
  - `tools/makehuman-core/.venv/Scripts/python.exe`
  - `tools/mixamo-mcp/.venv/Scripts/python.exe`
  The user already has an established local pipeline workflow. Do not casually replace it or ask them to rebuild it. If the launcher reports a missing dependency, give the exact missing path and fix only that dependency.
- Current weapon viewmodels in `js/weapons.js` are procedurally built in JavaScript, not loaded from a dedicated `data/models/weapons` GLB directory. The new character animation system must still define weapon attachment/hand/grip/muzzle/reload contracts so imported or calibrated weapon models can connect later.
- The user wants the map `data/worlds/test.json` created and made the default map. Keep `city-a.json` intact.
- The test map must represent every unique available world/vehicle asset once where practical, not duplicate the same model all over the scene. Asset dependencies, textures, collision sidecars and animation clips are not separate world placements.
- World geometry direction: individually authored road/ground/surface geometry rather than relying on reusable completed road/ground modules. Reusable material definitions, profile schemas, collision algorithms, editing tools and runtime batching are still allowed.
- The test world is a laboratory for validating gameplay, not a production city. Build the systems and test map first. Start the full city only after the core test gates pass.
- The target development machine has 4 GB RAM. Share model geometry/material/texture and animation clip caches where possible. Do not eagerly load every high-cost asset or duplicate every animation mixer/asset buffer unnecessarily.
- The user uses a local GitHub auto-sync workflow. Work directly on `main` when repository edits are requested. Preserve existing work and do not force-push, rewrite history or silently overwrite large binaries.
- Do not claim that an FBX animation or GLB was generated unless the actual file exists and has been verified.

---

## 1. Current scope and priorities

### Current objective

Build the **main gameplay character/NPC foundation** and test it in a compact world:

1. One reliable humanoid rig.
2. A complete gameplay animation library.
3. A new profile-based NPC runtime that can switch profiles in-game.
4. Animation/weapon alignment and event timing.
5. Chair/prop interaction anchors.
6. Vehicle door, seat and entry/exit calibration.
7. Traversal anchors for ladders, fences, walls, ledges and rooftops.
8. A compact `test.json` environment that tests the whole system.
9. Ground, road, collision, surface-material, vehicle and NPC validation.

### Explicitly not doing now

- No story campaign.
- No missions or mission scripting.
- No quest/dialogue narrative system.
- No cutscene or cinematic story pipeline.
- No production-sized city.
- No mass population of unique NPCs before the core rig and profiles work.
- No replacing all existing content just for visual variety.

---

## 2. New NPC profile layer — separate architecture

### Required direction

Create a clean layer independent of the existing NPC implementation. Suggested layout:

```text
js/npc-system/
  profile-registry.js
  npc-instance.js
  animation-controller.js
  animation-layers.js
  interaction-router.js
  weapon-binding.js
  vehicle-binding.js
  npc-lab.js

data/npc-profiles/
  profiles.json
  animation-library.json
  interaction-contracts.json

data/models/npc/npc_core_001/
  manifest.json
  npc_core_001_rigged.fbx
  npc_core_001_source.obj
  npc_core_001.mhm
  animations/
  textures/
```

Names may be refined during implementation, but keep the new layer isolated. Do not place new systems as special-case code inside the old `Civilians` or `NpcCharacter` classes.

### Profile layer responsibilities

- Load a character model and its skeleton definition.
- Resolve the animation library by stable clip keys.
- Switch gameplay profiles at runtime without reloading the world.
- Control locomotion, crouching, aiming, combat, interaction and traversal states.
- Blend lower-body locomotion with upper-body aiming/weapon actions where compatible.
- Enforce action priority, transitions, cancellation and interruption.
- Connect character actions to weapon models, vehicle doors/seats, chairs and world-object anchors.
- Expose a debug/NPC Lab panel for spawning, switching and previewing profiles/animations.
- Report missing clips, invalid skeleton mappings and missing interaction anchors.

### Initial switchable gameplay profiles

These are lightweight gameplay configurations over the new core model and animation library, not separate story characters:

- **Civilian:** normal movement, conversations, phone, sitting, fear, flee and basic reactions.
- **Worker:** work idle, carrying/using props, sitting, standing and basic reactions.
- **Aggressive:** unarmed punch/kick/block/dodge, weapon handling, hit reactions and pursuit.
- **Police:** patrol/idle, radio, aim/shoot, chase, take-cover and arrest/hold actions.

The same profile selector must allow adding more profiles later. For the initial test, one base rig is enough. Model/appearance variants can be generated after the common rig and animation library are proven.

### In-game NPC Lab

Required functions:

- Select `npc_core_001`.
- Spawn one test character at a fixed test marker.
- Switch between the gameplay profiles without reloading the map.
- Select and preview every available animation clip.
- Trigger actions from buttons/keys and inspect the resulting pose.
- Switch weapon type and test grip/aim/reload/fire.
- Test chair sit/stand interaction.
- Test vehicle enter/exit and door operation.
- Test ladder, vault, mantle, ledge and landing sequences.
- Display missing animation clips and missing asset anchors.
- Remove the test character and reset the scene.
- Show the current model ID, selected profile, current animation and current interaction target.

Do not make this a story interface. It is a development/test tool.

---

## 3. NPC core model and rig generation

### First character

- [ ] Generate `npc_core_001` in a new folder.
- [ ] Keep `civilian_001` and `civilian_002` untouched.
- [ ] Use MakeHuman for the source character and outfit.
- [ ] Export correctly oriented Y-up OBJ/MTL/textures.
- [ ] Use Mixamo auto-rigging for the base humanoid.
- [ ] Use one common skeleton for the full animation set.
- [ ] Record exact model height, scale, forward axis, ground origin and skeleton/bone names in the manifest.
- [ ] Confirm feet sit on ground at model origin.
- [ ] Confirm full body proportions and capsule measurements.
- [ ] Verify the rig has working hips, spine, head, both arms, both hands, both legs and feet.
- [ ] Verify the generated FBX loads in the game's FBX loader.
- [ ] Preserve MakeHuman project, source OBJ/MTL, textures, rigged FBX, animation FBXs and manifest.

### Generation workflow

Run from the repository root:

```powershell
.\tools\character-pipeline\generate-npc-core.ps1
```

Optional source-only generation:

```powershell
.\tools\character-pipeline\generate-npc-core.ps1 -BuildOnly
```

Resume the Mixamo stage using the saved MakeHuman project:

```powershell
.\tools\character-pipeline\generate-npc-core.ps1 -Resume
```

The launcher intentionally uses `-NoCommit -NoPush`. Inspect the generated character and manifest before committing or syncing the large binary assets.

### Generation acceptance

- [ ] MakeHuman project exists and opens.
- [ ] Y-up OBJ and MTL exist.
- [ ] Texture dependencies are copied locally.
- [ ] Mixamo rigged base FBX exists.
- [ ] Manifest contains the rigged model and every successfully downloaded clip.
- [ ] No missing clip is silently represented by a placeholder.
- [ ] Every clip is tested against the same generated skeleton.
- [ ] Animation roots and in-place settings are recorded.
- [ ] FBX files are not unnecessarily duplicated in multiple folders.

---

## 4. Required gameplay animation library

The animation system must be driven by stable keys rather than hardcoded Mixamo display names. Mixamo clip names/IDs belong in the generated manifest; runtime uses the stable keys below.

### A. Normal movement

- [ ] `idle`
- [ ] `walk`
- [ ] `run`
- [ ] `sprint`
- [ ] `turn_left` / `turn_right` or an equivalent turning solution
- [ ] `start_walk` / `stop_walk` where a suitable clip exists

### B. Crouch movement and aiming

- [ ] `crouch_idle`
- [ ] `crouch_walk`
- [ ] `crouch_run`
- [ ] `aim_idle`
- [ ] `aim_walk`
- [ ] `aim_shoot`
- [ ] `crouch_aim`
- [ ] `crouch_walk_aim`
- [ ] `crouch_run_aim`

Aiming must not break the lower-body movement. Use compatible full-body clips or upper-body animation layers/masks. Weapon muzzle direction must match the character's actual aim direction.

### C. Jump and falling

- [ ] `jump_up`
- [ ] `jump_down` / falling loop
- [ ] `land`
- [ ] Optional hard-landing / stumble reaction

The game controller owns physical movement and collision. Animation timing must be aligned with takeoff, apex and landing; do not teleport the character to fake the jump.

### D. Climbing and traversal

- [ ] `climb_mount`
- [ ] `climb_up`
- [ ] `climb_down`
- [ ] `climb_top_out`
- [ ] `vault_low`
- [ ] `vault_medium`
- [ ] `mantle_high`
- [ ] `ledge_hang`
- [ ] `ledge_shimmy`
- [ ] `ledge_pull_up`
- [ ] `drop_from_ledge`

Ladder and ledge movement must be parameterised by actual asset anchors and measured geometry. A 3m ladder and an 8m ladder must use the same traversal logic at different distances/speeds. The body must align to handholds/footholds. No instant teleporting over fences or onto rooftops.

### E. Sitting and ordinary prop interactions

- [ ] `sit_down`
- [ ] `sit_idle`
- [ ] `stand_up`
- [ ] `talk`
- [ ] `wave`
- [ ] `phone`
- [ ] `look_around`
- [ ] `work_idle`
- [ ] Optional pick-up/carry/set-down actions

Chair/bench interactions must align the character's pelvis, feet, body orientation and seat height with a calibrated seat anchor. The character must not float, intersect the chair or sit backwards.

### F. Unarmed combat and reactions

- [ ] `punch`
- [ ] `kick`
- [ ] `block`
- [ ] `dodge`
- [ ] `hit_reaction`
- [ ] `fear_reaction`
- [ ] `flee_run`
- [ ] `fall_death`
- [ ] `get_up`

Combat hit events must have clear timing windows. Punch/kick hit detection should line up with the contact frame, not the start of the animation.

### G. Weapon handling

- [ ] `weapon_draw`
- [ ] `weapon_holster`
- [ ] `aim_idle`
- [ ] `aim_walk`
- [ ] `aim_shoot`
- [ ] `reload_rifle`
- [ ] `reload_pistol`
- [ ] Add weapon-specific reload/fire/aim clips only where a real suitable clip exists.

Weapon model connection contract:

- [ ] Right-hand grip socket.
- [ ] Left-hand support/grip socket.
- [ ] Weapon root/pivot and calibrated local transform.
- [ ] Muzzle/fire origin.
- [ ] Sight/optic alignment point.
- [ ] Trigger-hand placement.
- [ ] Magazine location and removal/insertion direction.
- [ ] Bolt/slide interaction point where relevant.
- [ ] Weapon-specific hand pose and aim offsets.
- [ ] Fire/recoil event marker.
- [ ] Reload event markers: magazine out, magazine in, bolt/slide action, reload finished.
- [ ] Weapon switching must transition through draw/holster states.
- [ ] Shooting direction must agree with the weapon muzzle and aim pose.
- [ ] Third-person weapon must be attached to the character hand, not only to the camera.

Initial weapon categories to test: pistol, rifle/assault rifle, SMG, shotgun, DMR/sniper and heavy/launcher where supported. Do not create a different animation set for each weapon if a shared compatible rig/pose can cover it.

**Current inventory note:** `js/weapons.js` currently constructs weapon viewmodels procedurally with JavaScript mesh-builder functions. A dedicated GLB weapon-model folder was not found in the repository tree during this audit. The new weapon-binding layer must be able to calibrate the current meshes and later support imported weapon GLBs through the same socket/profile contract.

### H. Vehicle interaction animations

- [ ] `enter_vehicle`
- [ ] `exit_vehicle`
- [ ] `vehicle_idle` / seated driver pose
- [ ] Door reach/open motion where a suitable clip is available.
- [ ] Door close motion where a suitable clip is available.
- [ ] Driver and passenger entry/exit variants if needed.

Vehicle-door movement itself is a **vehicle mesh animation**, not just a character animation. See Section 7.

### Animation processing and runtime acceptance

- [ ] Every registered clip physically exists.
- [ ] Every clip uses the same compatible skeleton as `npc_core_001`.
- [ ] Bone names/tracks bind correctly.
- [ ] Locomotion root motion is in-place where the game controller owns world movement.
- [ ] Traversal clips are calibrated to anchor-driven movement.
- [ ] Foot sliding, ground contact, knee bends and hand placement are inspected.
- [ ] Animation start/end poses are compatible with transitions.
- [ ] Crossfades do not cause body snaps.
- [ ] Action priority/interruption works (e.g. hit reaction interrupts idle, not an irreversible transition).
- [ ] Missing clips are shown in NPC Lab and do not crash runtime.
- [ ] Clips are cached once; each character gets its own mixer/skeleton instance.
- [ ] Low-memory settings do not preload the entire library unnecessarily.

---

## 5. Weapon model ↔ character animation integration

The character and weapon must be treated as one calibrated interaction, not two independent objects.

### Weapon profile data

Each weapon model/profile should define:

- [ ] Model path or mesh reference.
- [ ] Weapon category and compatible animation set.
- [ ] Root/pivot location.
- [ ] Right-hand grip transform.
- [ ] Left-hand support transform.
- [ ] Muzzle transform.
- [ ] Sights/optic transform.
- [ ] Magazine transform and reload direction.
- [ ] Trigger position.
- [ ] Weapon length/scale.
- [ ] Aim offset for the character hand/arm pose.
- [ ] First-person and third-person transforms where they differ.
- [ ] Fire and reload event times.

### Test requirements

- [ ] Equip and holster.
- [ ] Hold at hip.
- [ ] Aim while standing.
- [ ] Walk while aiming.
- [ ] Crouch, crouch-walk and crouch-run while aiming.
- [ ] Fire while standing and moving.
- [ ] Fire while crouched.
- [ ] Reload rifle.
- [ ] Reload pistol.
- [ ] Switch weapons.
- [ ] Confirm the left hand does not float away from the weapon.
- [ ] Confirm the muzzle points along the aim direction.
- [ ] Confirm the muzzle flash/fire origin is at the muzzle, not the camera.
- [ ] Confirm no weapon/body clipping during transitions.
- [ ] Verify first-person and third-person poses separately.

---

## 6. Chair, seat and ordinary world-object interactions

World assets need interaction metadata so character animations line up with their geometry.

### Chair/bench/seat profile

Each seat needs:

- [ ] Object-local approach point.
- [ ] Seat anchor position.
- [ ] Seat facing direction.
- [ ] Seat height and depth.
- [ ] Pelvis alignment target.
- [ ] Foot placement/clearance target where needed.
- [ ] Sit-down animation key.
- [ ] Sitting idle animation key.
- [ ] Stand-up animation key.
- [ ] Exit/stand position.
- [ ] Collision state and reservation/occupancy state.

### General interaction anchors

Allow asset profiles to define named local-space points such as:

- `approach`
- `interact`
- `hand_left`
- `hand_right`
- `foot_left`
- `foot_right`
- `seat`
- `seat_exit`
- `top_out`
- `landing`
- `door_handle`
- `grip`
- `hinge`
- `muzzle`

Anchors are stored relative to the asset/model, so rotation and placement in the map do not invalidate them. Do not hardcode per-instance world coordinates in the character controller.

### Test requirements

- [ ] Approach a chair.
- [ ] Align body and facing with its seat anchor.
- [ ] Play sit-down and blend into sit idle.
- [ ] Stand up and move clear of the chair.
- [ ] Test different chair/bench heights.
- [ ] Test seat interactions on different ground elevations.
- [ ] Ensure two NPCs cannot reserve the same seat simultaneously.

---

## 7. Vehicle mesh calibration, doors and entering/exiting

This is a required part of the character system, not a later cosmetic detail.

### Vehicle model inspection and editing

For every vehicle GLB/GLTF used in the test world:

- [ ] Inspect the node hierarchy.
- [ ] Identify body, doors, windows, seats, steering wheel, wheels and interior.
- [ ] Identify each door mesh and its hinge edge.
- [ ] Correct door mesh pivot/origin to the actual hinge line where necessary.
- [ ] Preserve original mesh geometry/materials and any source assets before destructive edits.
- [ ] Export/update GLB while preserving textures, hierarchy and transforms.
- [ ] Record model scale and vehicle coordinate convention.
- [ ] Verify doors open outward in the correct direction.
- [ ] Verify doors close exactly to their original closed transform.
- [ ] Verify left/right and front/rear doors independently.
- [ ] Verify doors do not swing through wheels, ground or nearby geometry.
- [ ] Update collision when a door opens/closes, or use an appropriate animated collision representation.

### Vehicle interaction profile

Each vehicle should define:

- [ ] Driver door hinge and pivot.
- [ ] Passenger door hinge and pivot.
- [ ] Rear door hinges where applicable.
- [ ] Closed/open door transforms or calibrated hinge axis and angle.
- [ ] Door handle interaction point.
- [ ] Driver approach point.
- [ ] Passenger approach point.
- [ ] Driver seat anchor.
- [ ] Passenger seat anchors.
- [ ] Character hand-to-door contact point.
- [ ] Character foot/step-in point.
- [ ] Enter target transform.
- [ ] Exit target transform.
- [ ] Steering wheel grip positions.
- [ ] Pedal/feet pose reference.
- [ ] Door open duration, close duration and collision state.
- [ ] Vehicle-specific animation adjustments.

### Entry/exit sequence

1. Find the correct door and interaction side.
2. Move the character to the calibrated approach point.
3. Align facing and hand with the door handle.
4. Open the correct door mesh around its hinge.
5. Play the entry animation.
6. Move/align the character into the seat anchor.
7. Transfer control to the vehicle and attach the character to the seat transform.
8. Close the door using its calibrated mesh transform.
9. On exit, open door, align character, move to the exit anchor, dismount and close door.
10. Restore player/NPC movement control and collision.

### Test requirements

- [ ] Test driver entry and exit in every vehicle model.
- [ ] Test passenger entry/exit where seats exist.
- [ ] Test doors opening/closing independently.
- [ ] Test entry when another vehicle/object is close.
- [ ] Test exiting while stationary.
- [ ] Test exiting while moving slowly if supported.
- [ ] Verify character hands touch the handle and feet land correctly.
- [ ] Verify character is not left inside the car after exit.
- [ ] Verify vehicle and character collision states do not trap either object.

Current vehicle models to audit: Bugatti Chiron, Lamborghini model, Cadillac Escalade and Tesla Cybertruck. Do not assume all four have identical doors, seat positions or pivots.

---

## 8. Traversal assets and animation anchors

The map/editor/runtime must support asset-specific handholds, footholds and landing points.

### Ladder profile

- [ ] Bottom approach point.
- [ ] Mount/grab point.
- [ ] Left/right hand anchor for rungs.
- [ ] Left/right foot anchor for rungs.
- [ ] Rung spacing.
- [ ] Ladder plane and facing normal.
- [ ] Climb-up path.
- [ ] Climb-down path.
- [ ] Top-out platform point.
- [ ] Bottom dismount point.
- [ ] Ladder length in metres.

### Fence/wall profile

- [ ] Obstacle height and thickness.
- [ ] Approach point.
- [ ] Takeoff point.
- [ ] Hand-plant/top-edge point.
- [ ] Far-side landing point.
- [ ] Allowed traversal type: low vault, medium vault, high mantle or blocked.
- [ ] Collision and clearance.

### Building/ledge profile

- [ ] Window/balcony ledges.
- [ ] Roof edges and roof access.
- [ ] Fire escape ladders/stairs/platforms.
- [ ] Drainpipes if deliberately climbable.
- [ ] Ledge hang and shimmy path.
- [ ] Connected traversal graph between ground, ledges, balconies and rooftops.
- [ ] Drop/landing positions.

### Runtime rules

- [ ] Detect actual obstacle height from geometry/anchors.
- [ ] Choose a compatible traversal action.
- [ ] Align character facing and contact points.
- [ ] Use animation warping/anchor alignment so different heights do not cause floating or clipping.
- [ ] Move the character through a controlled traversal path.
- [ ] Preserve collision safety during animation.
- [ ] Restore physics/control cleanly at the end.
- [ ] No teleport-based fence crossing or instant building-roof climb.

### Additional traversal assets to obtain or author

- [ ] Wall ladders, long ladders and caged roof ladders.
- [ ] Fire escape stairs, landings and rails.
- [ ] Scaffolding frames, planks and platforms.
- [ ] Dumpster suitable for vaulting.
- [ ] Multiple fence heights/materials.
- [ ] Low, medium and high wall sections.
- [ ] Drainpipes and roof access hatches.
- [ ] Additional balcony/window/ledge pieces.
- [ ] Pallets, barrels and stackable warehouse obstacles.
- [ ] Breakable window panels and glass fragments.

Author simple calibration geometry directly when a downloaded model is unnecessary.

---

## 9. New test map and world foundation

### New map

- [ ] Create `data/worlds/test.json`.
- [ ] Make `test.json` the default scene when no explicit `?scene=` parameter is supplied.
- [ ] Preserve `city-a.json` and continue allowing `?scene=city-a.json`.
- [ ] Set a reliable spawn point near the NPC/interaction testing area.
- [ ] Keep test map data separate from the production city.
- [ ] Add a clear name/version and streaming configuration.
- [ ] Validate the map through the editor and in-game runtime.

### No-duplicate asset placement

Place each unique existing model once where practical. Do not fill the test map by repeating the same source model. Models with dependencies, textures, collision files or animation files are not additional placements. A reusable surface material is not a duplicate world asset.

### Test map zones

- [ ] Main road strip with lane markings, sidewalks, curbs, parking, junctions and a short ramp/bridge transition.
- [ ] Building cluster: shop/office, mid-rise with rooftop access, warehouse and residential/mixed-use.
- [ ] Backlot with fences, crates, dumpster, walls, ladders and vault/mantle sequences.
- [ ] NPC plaza with 4–6 test slots, safe route bounds and simple pedestrian paths.
- [ ] Vehicle loop and parking/entry/exit area.
- [ ] Surface-material test area.
- [ ] Height/scale reference wall with 1m increments and a 1m reference cube.
- [ ] Asset inspection placements for the remaining unique models.

### Scale rules

- [ ] 1 engine unit = 1 metre.
- [ ] Character target height around 1.74–1.80m; capsule matches.
- [ ] Door target height around 2.0–2.1m; width around 0.9–1.0m.
- [ ] Typical car around 4.5m long, 1.8m wide and 1.5m high (vehicle profiles use measured actual model dimensions).
- [ ] Sidewalk curb around 0.15m.
- [ ] Low vault height around 0.9–1.1m.
- [ ] Medium mantle height around 1.4–1.8m.
- [ ] Higher obstacles require ladder or a dedicated climb profile.
- [ ] Check every imported model against the reference mannequin/cube.

### Streaming/performance

- [ ] Keep the test block around 150–250m across.
- [ ] Fit it within one 256m streaming cell where coordinates allow; otherwise deliberately use a small, understood number of adjacent cells.
- [ ] Do not confuse placing all unique assets with loading all maximum-resolution assets simultaneously.
- [ ] Keep asset/texture/clip concurrency conservative for 4GB systems.
- [ ] Check memory, first-entry stalls, asset disposal and streaming boundaries.

---

## 10. Individually authored road/ground/surface layer and map editor

The user wants the world surfaces authored individually rather than assembled from reusable finished road/ground modules.

### Geometry authoring

- [ ] Surface mesh category for ground, road, sidewalk, curb, junction, bridge deck, ramp, roof and platform geometry.
- [ ] Polygon vertex placement in 2D.
- [ ] Height/elevation per vertex.
- [ ] Triangulation and mesh preview.
- [ ] Vertex/edge/face selection and editing.
- [ ] Snap/merge shared vertices.
- [ ] Extrude/split/triangulate geometry.
- [ ] Preserve clean connected geometry at road junctions and bridge transitions.
- [ ] Export actual mesh geometry to map JSON.
- [ ] Runtime batches by material/chunk; do not create one draw call per triangle.

### Material/physics tags

- [ ] Asphalt.
- [ ] Smooth concrete.
- [ ] Rough concrete.
- [ ] Brick/pavers.
- [ ] Gravel.
- [ ] Sand.
- [ ] Dirt.
- [ ] Grass.
- [ ] Mud.
- [ ] Wood.
- [ ] Metal.
- [ ] Glass.
- [ ] Tile.
- [ ] Wet asphalt.
- [ ] Rooftop material.

Each surface type supplies rendering material, collision/physics properties, vehicle grip and audio/footstep tag.

### Runtime integration

- [ ] Build BufferGeometry from authored vertices/indices.
- [ ] Compute normals/bounds and validate winding.
- [ ] Use actual mesh collision or a proper static trimesh.
- [ ] Support fast triangle queries/BVH.
- [ ] Make ground height queries sample actual authored geometry.
- [ ] Make vehicle surface detection resolve actual triangle/material tags.
- [ ] Stream authored surfaces by their bounds.
- [ ] Keep old city rendering path available until the new test world is validated, but do not base the new test map on the old road/ground assembly.

### Map editor additions

- [ ] Surface mesh tool.
- [ ] Vertex/edge/face editor.
- [ ] Material/physics painter.
- [ ] Collision visualiser.
- [ ] Asset profile editor.
- [ ] Interaction-anchor editor.
- [ ] Traversal graph editor.
- [ ] Vehicle door/seat calibration view.
- [ ] Chair/prop anchor editor.
- [ ] Animation preview against the selected asset/anchor.
- [ ] Unique-asset inventory showing placed and missing models.

---

## 11. Sound and feedback required for gameplay tests

- [ ] Footsteps by material: concrete, metal, dirt, gravel, wood, tile and glass.
- [ ] Body impact and landing sounds.
- [ ] Punch/kick/block hit sounds.
- [ ] Weapon handling, fire, reload and weapon-switch sounds.
- [ ] Ladder/climbing/ledge-grab sounds.
- [ ] Vault/mantle/landing sounds.
- [ ] Chair/bench and prop interaction sounds.
- [ ] Door open/close/handle sounds.
- [ ] Vehicle door sounds.
- [ ] Vehicle collision categories: light hit, heavy impact, scrape and crash.
- [ ] Crate, dumpster, fence and glass impact/break sounds.
- [ ] 3D positional audio, with modest random pitch/volume variation.
- [ ] Each interaction produces appropriate animation, sound, camera and controller feedback.

---

## 12. NPC behaviour profiles for testing (not story content)

- [ ] Civilian preset: idle, route movement, phone, sit, greet, avoid vehicles, fear and flee.
- [ ] Worker preset: stationary/short route, work idle, interact with chair/counter/prop, greet and react.
- [ ] Aggressive preset: approach, threaten, punch/kick/block/dodge, hit reaction, pursue and stop.
- [ ] Police preset: patrol, radio, alert, chase, aim/shoot, take cover and restrain.
- [ ] Runtime profile switching without world reload.
- [ ] Each profile uses the same movement/animation/interaction contracts where possible.
- [ ] NPCs cannot walk outside the test region.
- [ ] NPCs respect walls, obstacles, ladders, seats and vehicle collision.
- [ ] NPC population cap stays conservative on low-memory graphics settings.
- [ ] Test 4 NPCs first; expand to 6 only after stable.

---

## 13. Implementation order

Do not try to build the entire checklist in one patch. Keep each phase testable and commit-sized.

### Phase 1 — New NPC asset generation

- [ ] User runs `generate-npc-core.ps1` locally.
- [ ] Confirm `npc_core_001` source/rigged files exist.
- [ ] Inspect manifest and list clips actually downloaded.
- [ ] Fix failed/invalid clips before runtime integration.

### Phase 2 — New NPC profile/animation runtime

- [ ] Build independent profile registry and character instance.
- [ ] Load/cache rig and animation clips.
- [ ] Add animation state machine/layers and action priorities.
- [ ] Add profile switching and NPC Lab.
- [ ] Validate base movement/crouch/jump/aim/combat animations.

### Phase 3 — Weapon connection

- [ ] Define weapon sockets/metadata.
- [ ] Calibrate current procedural weapon meshes and attachment points.
- [ ] Connect aim, shoot, reload, draw and holster actions.
- [ ] Test both first-person and third-person alignment.

### Phase 4 — Object/seat interactions

- [ ] Add asset-local anchor contract.
- [ ] Calibrate chairs/benches and sit/stand actions.
- [ ] Validate object approach, occupancy and exit.

### Phase 5 — Vehicle doors and entry/exit

- [ ] Inspect vehicle GLB hierarchies.
- [ ] Edit/calibrate door hinge pivots.
- [ ] Add seat/handle/approach/exit anchors.
- [ ] Connect enter/exit animations and door states.
- [ ] Test each current vehicle model.

### Phase 6 — Traversal system

- [ ] Add ladder/fence/wall/ledge metadata.
- [ ] Connect mount/climb/top-out/vault/mantle/drop animations.
- [ ] Use geometry-driven distances and anchor alignment.
- [ ] Verify no teleporting, floating or collision traps.

### Phase 7 — Test world and surface engine

- [ ] Create `test.json`.
- [ ] Implement individually authored ground/road/surface geometry.
- [ ] Populate each unique existing asset once.
- [ ] Add missing traversal pieces.
- [ ] Set `test.json` as default.
- [ ] Verify scale, collisions, materials, streaming and vehicles.

### Phase 8 — Full gameplay validation

- [ ] NPC profiles and animation transitions.
- [ ] Gun/weapon alignment and reload/fire events.
- [ ] Chairs/props.
- [ ] Vehicle doors/entry/exit.
- [ ] Ladder/fence/ledge traversal.
- [ ] Surface and collision responses.
- [ ] Sound and feedback.
- [ ] Performance on the target low-memory PC.

### Phase 9 — Production city only after test gates pass

- [ ] Freeze stable core contracts.
- [ ] Reuse the tested editor/runtime/profile systems.
- [ ] Start the real city only after the test world passes.

---

## 14. Final acceptance gates

The core gameplay/test stage is not complete until:

- [ ] `npc_core_001` is a correctly scaled, grounded, working humanoid rig.
- [ ] The required movement, crouch, jump, aim, shoot, reload, combat, sit, climb and vehicle clips exist or are explicitly marked unavailable with a replacement decision.
- [ ] NPC profiles can be switched in-game.
- [ ] Every registered animation is compatible with the rig.
- [ ] Weapons align with hands, aim direction and muzzle.
- [ ] Reload events align with magazine/weapon meshes.
- [ ] Chairs align to seat anchors.
- [ ] Vehicle doors have calibrated pivots and open/close correctly.
- [ ] Vehicle entry/exit aligns with door, seat and exit anchors.
- [ ] Ladders, fences and ledges use real geometry anchors and no teleport shortcuts.
- [ ] Test map is `test.json` and is the default.
- [ ] Unique assets are represented without needless duplicates.
- [ ] Authored ground/road/surface meshes collide and report correct material tags.
- [ ] Vehicle handling and footsteps respond to the actual surface.
- [ ] NPCs and vehicles remain within the test area.
- [ ] No unacceptable first-entry or streaming stalls on the target machine.
- [ ] Existing `city-a.json` and legacy assets remain recoverable.

---

## 15. What to do when continuing in a new chat

1. Read this entire `checklist.md` first.
2. Read `tools/character-pipeline/README.md`, `tools/new-npc.md` and the new `tools/character-pipeline/generate-npc-core.ps1` only for pipeline context. Remember that `tools/new-npc.md` describes the old `civilian_002` system.
3. Inspect the current GitHub `main` branch and the actual latest files before editing. Do not assume the code is still at the state described in an old chat.
4. Check whether the user has run the NPC generation script. Inspect the actual `npc_core_001/manifest.json` and available FBX files before wiring animation keys.
5. Continue from the first unchecked item in the current phase. Do not restart the whole plan or ask the user to repeat these requirements.
6. Do not claim missing assets/clips are complete. Record the exact missing items and continue with what is available.
7. Keep the current scope focused on the main gameplay character/NPC system and test environment. No story-mode work until the user changes scope.

**This file is the durable project handoff. Update its checkboxes and notes as work is completed.**
