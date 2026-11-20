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
**Current stage:** `npc_core_001` is wired into the player, enemy and civilian character paths. Base-rig visual verification and advanced animation/contact validation remain open.  
**Not in scope yet:** Story mode, missions, narrative campaign, cutscene system, quest chains or a large production city.

**Current NPC animation state (November 20, 2026):** 28 FBXs are inventoried and wired through `npc_core_001`. The legacy `civilian_001`, `civilian_002` and `npc1` model folders have been deleted. Section 4 and the NPC-core manifest remain authoritative; browser verification is still pending.

---

## 0. Handoff notes for the next chat — read first

- The user wants execution, not another broad lecture or a long list of manual tasks. Inspect the repository, make the requested changes and report exactly what changed.
- Do not call the game **Strike Command**. Its current name is **Open World**. The repository/folder is still named `combata`.
- The active architecture is the independent `js/npc-system/` layer. `js/character.js` is the player/enemy adapter; `js/civilians.js` retains movement/population logic but instantiates the new `NpcInstance` runtime.
- `npc_core_001` is the **only active humanoid model**. The `civilian_001`, `civilian_002` and `npc1` asset folders, plus `js/npc-character.js` and `js/npc-config.js`, have been removed. Do not recreate or import them.
- `tools/new-npc.md` is explicitly marked as a deprecated historical guide. Do not follow its old `civilian_002` instructions.
- `npc_core_001` is now the shared model source for player, enemies and civilians. The loader checks its skinned mesh, bone hierarchy, bounds and idle take at runtime. The base rig has not yet passed visual/browser verification.
- Civilian, worker, aggressive and police are switchable configurations over `npc_core_001`. F10 cycles the nearest civilian through these profiles without reloading the world.
- The MakeHuman source model and 28 NPC-core animation FBXs are present and wired through the shared loader. Section 4 and `data/models/npc/npc_core_001/manifest.json` define the active downloads. Full runtime binding validation remains open.
- A new generation launcher has been added:
  - `tools/character-pipeline/generate-npc-core.ps1`
  - `tools/character-pipeline/generate-npc-core.bat`
  - It defaults to `npc_core_001` and leaves generated files uncommitted/unpushed. Its original requested animation list is historical only; use the actual 28-file inventory mapped in Section 4.
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
- The unified asset calibrator in Section 8A is now being implemented. `tools/asset-calibrator.mjs` runs the existing collision generator as an internal scan stage and writes versioned `*_calibration.json` sidecars. `js/asset-calibration.js`, `js/world.js`, `js/physics.js` and `js/vehicles.js` consume the approved metadata for world collision/surfaces, bridge diagnostics, player/NPC seat anchors and vehicle entry/exit anchors. Curved/sloped connections and unapproved interactions remain review-only; browser/runtime validation is still pending.
- The test world is a laboratory for validating gameplay, not a production city. Build the systems and test map first. Start the full city only after the core test gates pass.
- The target development machine has 4 GB RAM. Share model geometry/material/texture and animation clip caches where possible. Do not eagerly load every high-cost asset or duplicate every animation mixer/asset buffer unnecessarily.
- The user uses a local GitHub auto-sync workflow. Work directly on `main` when repository edits are requested. Preserve existing work and do not force-push, rewrite history or silently overwrite large binaries.
- Do not claim that an FBX animation or GLB was generated unless the actual file exists and has been verified. `Idle.fbx` remains a base-rig candidate until the browser lab confirms its mesh, skeleton, materials and idle take.

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

The initial independent runtime is now present:

```text
js/npc-system/
  core-assets.js
  profile-registry.js
  animation-controller.js
  npc-instance.js

data/models/npc/npc_core_001/
  manifest.json
  npc_core_001_source.obj
  npc_core_001.mhm
  animations/
  textures/
```

`js/character.js` is retained only as the player/enemy adapter; the active model and clip loading are owned by `js/npc-system/`. `js/civilians.js` retains population movement and interaction orchestration but creates `NpcInstance` objects from the new runtime. The obsolete model-specific runtime modules have been deleted.

### Profile layer responsibilities

- [x] Load one shared `npc_core_001` candidate rig, validate skinned-mesh/skeleton/bounds/idle structure at runtime and normalize the model to 1.74m (visual verification still pending).
- [x] Resolve downloaded animation files by stable keys from the NPC-core manifest; share the base rig and animation clip cache.
- [x] Switch civilian/worker/aggressive/police profile configurations at runtime; F10 cycles the nearest NPC.
- [x] Drive player/enemy locomotion, crouch, rifle aim, idle-only reload and physics-owned jump states from the downloaded core clips.
- [ ] Blend lower-body locomotion with upper-body aiming layers; current aim clips are full-body.
- [x] Enforce action request cancellation, crossfades, one-shot completion handling and entry restrictions for idle-only jump/reload.
- [x] Connect rifle aim/run selection and reload locking to player weapon state; non-rifle weapons do not borrow rifle poses.
- [x] Connect civilian seat interaction to seat/exit anchors and Rapier kinematic NPC positioning.
- [ ] Connect vehicle doors/seats and entry/exit animation anchors.
- [x] Add a standalone `npc-lab.html` base-rig/clip inspector; the full in-game NPC Lab panel remains pending.
- [x] Fail clearly when a core rig or selected animation is missing; browser validation is still pending.

### Initial switchable gameplay profiles

These are lightweight gameplay configurations over the new core model and animation library, not separate story characters:

- **Civilian (current clips):** normal movement, seat-anchor sitting, waving, hit reaction, knockdown and vehicle interaction where the clips pass preview.
- **Worker (current clips):** normal movement, seat-anchor sitting, waving and basic hit/knockdown reactions. No work-idle or carry animation is currently downloaded.
- **Aggressive (current clips):** punch, block, hit reaction, knockdown and rifle aim/movement. Kick and dodge clips are not present.
- **Police (current clips):** patrol using normal locomotion, rifle aim/walk/run and idle-only reload. Gunplay is a preview candidate; radio, take-cover and restraint clips are not present.

The same profile selector must allow adding more profiles later. For the initial test, one base rig is enough. Model/appearance variants can be generated after the common rig and animation library are proven.

### In-game NPC Lab

Required functions:

- Select `npc_core_001`.
- Spawn one test character at a fixed test marker.
- Switch between the gameplay profiles without reloading the map.
- Select and preview every available animation clip.
- Trigger actions from buttons/keys and inspect the resulting pose.
- Test rifle grip, aim and idle-only reload. Preview `Gunplay.fbx` before enabling firing animation; no pistol animation support.
- Test seat-anchor snapping, seated idle and exit-anchor placement; no sit/stand transition clips.
- Test vehicle enter/exit and door operation.
- Test obstacle climbing, ladder ascent, hard landing, knockdown and seat/vehicle interactions. Reverse ladder descent is experimental; vault/mantle/ledge actions must remain marked unavailable.
- Display missing animation clips and missing asset anchors.
- Remove the test character and reset the scene.
- Show the current model ID, selected profile, current animation and current interaction target.

Do not make this a story interface. It is a development/test tool.

---

## 3. NPC core model and rig generation

### First character

- [x] Generate the `npc_core_001` source folder and preserve the MakeHuman project, source OBJ/MTL and textures.
- [x] Delete the obsolete `civilian_001`, `civilian_002` and `npc1` asset folders; `npc_core_001` is the sole active humanoid asset folder.
- [x] Use MakeHuman for the source character and outfit.
- [x] Export and retain the source OBJ/MTL and texture set.
- [ ] Open `/npc-lab.html` and verify that the 20.5 MB `Idle.fbx` candidate is a skinned Mixamo base rig with all 15 required body landmarks (hips, spine, head, arms, forearms, hands, upper/lower legs and feet); file size alone is not proof.
- [ ] Verify all 28 FBXs bind to the same skeleton.
- [x] Record the base-rig candidate, 1.74m target height, 28-file inventory and first-pass motion measurements in the manifest.
- [x] Normalize model bounds and feet-to-ground origin in the runtime loader (visual confirmation pending).
- [ ] Confirm body proportions, exact capsule fit and key joints in the browser lab.
- [x] Add runtime checks for skinned mesh, bone hierarchy, valid bounds and playable idle take.
- [x] Preserve the MakeHuman project, source OBJ/MTL, textures, downloaded clips and manifest.

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

- [x] MakeHuman project file, source OBJ/MTL and texture dependencies exist in `npc_core_001` (opening the source project in MakeHuman still needs local confirmation).
- [ ] Verify that `Idle.fbx` contains the skinned Mixamo base mesh and skeleton.
- [x] Manifest contains the base-rig candidate and all 28 successfully downloaded animation files.
- [x] Missing clips are explicitly listed; no missing clip is represented by a placeholder.
- [ ] Verify every downloaded clip against the same base skeleton in the browser lab.
- [x] First-pass durations, root translation notes and controller-owned root-motion rules are recorded.
- [x] No duplicate copies of these FBXs remain in legacy NPC folders.

---

## 4. Downloaded gameplay animation library — current source of truth

**Current inventory:** 28 FBX files are present in `data/models/npc/npc_core_001/animations/`. The manifest stores the complete filename/size inventory and stable runtime keys. The `civilian_001`, `civilian_002` and `npc1` asset folders have been deleted; do not recreate or import their animation files.

### A. Locomotion

| Runtime key | Downloaded file | Use |
|---|---|---|
| `idle` | `Idle.fbx` | Standing idle. At 20.5 MB, this is also the likely skinned base-character FBX; confirm mesh, skin, skeleton and idle take before treating it as the canonical rig. |
| `walk` | `Walking.fbx` | Normal unarmed walk. 1.033 s, 32 keys; Hips Tz 0.01–1.97 raw FBX units. |
| `walk_aim` | `Walking (1).fbx` | Walking while aiming, as confirmed by the user. 1.367 s, 42 keys; Hips Tz 0–1.46. |
| `run` | `Running.fbx` | Normal running cycle. 0.700 s, 22 keys; Hips Tz 0.01–3.55. |
| `rifle_run` | `Rifle Run.fbx` | Run with rifle posture. 0.733 s, 23 keys; Hips Tz 0–2.48. |
| `sprint` | `Sprint.fbx` | Fast sprint cycle. 0.533 s, 17 keys; Hips Tz 0.01–3.51. |

These are raw FBX scene units, not metres. Confirm FBX unit scale, character height and forward axis before deriving world speed. The controller must not apply its own movement and the same FBX root displacement simultaneously.

### B. Crouch and rifle aiming

| Runtime key | Downloaded file | Use |
|---|---|---|
| `crouch_idle` | `Crouching Idle.fbx` | Stationary crouch. 2.5 s; hips remain low with nearly no root travel. |
| `crouch_walk` | `Crouched Walking.fbx` | Normal crouch walk. 1.033 s, 32 keys. |
| `crouch_walk_aim` | `Crouch Walking.fbx` | Crouch walking while aiming, as confirmed by the user. 1.167 s, 36 keys. |
| `rifle_aim_idle` | `Rifle Aiming Idle.fbx` | Standing rifle-aim idle. Root is effectively stationary. |
| `crouch_aim_idle` | `Idle Crouching Aiming.fbx` | Crouched rifle-aim idle. Root is effectively stationary. |

**Weapon animation scope is rifle-only.** There is no pistol-specific aim, fire or reload animation in this inventory. Do not map rifle animations onto pistols or claim pistol animation support.

### C. Reload, jump and landing

- `reload_idle` → `Reloading.fbx`, 3.3 s / 100 keys. **Standing idle only.** Start only from a standing idle state. Lock walking, running, sprinting, crouching and aiming until reloading completes.
- `jump_idle` → `Jumping.fbx`, 1.233 s / 38 keys. **Idle-only jump.** Physics owns takeoff, gravity, apex, falling and landing. Do not apply FBX root translation on top of the physics trajectory.
- `hard_landing` → `Hard Landing.fbx`, 2.5 s / 76 keys. Select based on actual fall velocity, align impact with collision contact, and adapt the root path to actual fall height.

### D. Obstacle climbing and ladders

**`Climbing.fbx` is for climbing an obstacle slightly taller than the character and landing on top. It is not the ladder clip.**

- 3.833 s / 116 keys.
- First-pass Hips range: Ty 1.32–3.28 and Tz -0.56–0.42 raw FBX units.
- Use the calibrated obstacle's approach, hand-plant/top-edge, top-surface and landing anchors. Track both hands, pelvis and feet throughout the animation. Warp the motion to the measured obstacle, keep collision safe, and hand physics back only after landing. No teleporting to the top.

**`Climbing Ladder.fbx` is for ladder elements only.**

- 0.767 s / 24 keys; first-pass Hips Ty 1.90–2.44.
- Use ladder rung spacing plus left/right hand and foot anchors to drive the climb.
- No ladder-down clip was found. Reverse the same clip as a descent experiment, but do not mark it supported until hand/foot contact remains correct on every rung and top/bottom transitions are tested.

No downloaded vault, mantle, ledge-hang, shimmy or drop clip is present.

### E. Sitting and ordinary interactions

- `sit_idle` → `Sitting Idle.fbx`, 4.3 s.
- There is **no sit-down or chair stand-up animation** in the active set. When the character chooses a seat, reserve it, align facing and snap pelvis/body directly to the calibrated seat anchor, then play `sit_idle`. When leaving, move to a clear seat-exit anchor and restore movement. Do not use `Standing Up.fbx` as a chair transition.
- `Waving.fbx` is the current ordinary interaction clip.
- `Standing Up.fbx` is unassigned until preview confirms whether it is a knocked-down recovery action.

### F. Combat and reactions

| Runtime key | Downloaded file | Use |
|---|---|---|
| `punch` | `Punching.fbx` | 1.0 s / 31 keys. Determine the hit window from actual fist/contact frames, not animation start. |
| `block` | `Block.fbx` | 2.867 s / 87 keys. Defensive action. |
| `hit_reaction` | `Hit Reaction.fbx` | 1.6 s / 49 keys. Match reaction direction and timing to physics impulse. |
| `knocked_down` | `Knocked Down.fbx` | 2.8 s / 85 keys. Full fall-to-ground action, distinct from death. Hips ranges: Tx -0.80–0.07, Ty 0.15–1.03, Tz -1.76–0.04 raw units. Control root motion and capsule/collision handoff. |
| `death_candidate` | `Dying.fbx` | Present (4.333 s); preview the entire motion before final assignment. |
| `gunplay_candidate` | `Gunplay.fbx` | Very short (0.2 s / 7 keys). Preview to identify its exact motion before assigning a rifle fire/recoil event. Not a pistol animation. |

No kick or dodge clip was downloaded.

### G. Vehicle interactions

- `enter_vehicle` → `Entering Car.fbx`, 5.467 s. Match approach, door-handle reach, step-in path and seat target to vehicle anchors.
- `exit_vehicle` → `Exiting Car.fbx`, 5.8 s. Align to door and exit anchors; restore physics after feet are grounded.
- `vehicle_driver_idle` → `Driving.fbx`, 5.0 s. Anchor the character to the driver seat while vehicle physics moves the car.
- Door movement is controlled by the vehicle's door mesh, hinge pivot and calibrated open/closed transforms.

### H. Motion capture and physics rules

The first FBX binary pass measured animation-stack durations, available key counts, Hips translation ranges and moving-bone ranges for sampled clips. Multiple locomotion/combat files share the Mixamo `mixamorig:` layout (54 animated bone nodes, 315 curves and 159 bone-channel tracks in inspected samples). This confirms the sampled layout, not successful runtime binding of every clip.

- Record actual root, pelvis, hand and foot positions across every keyframe before finalising movement speeds, contact windows or traversal forces. The manifest currently stores first-pass measurements; the FBXs remain the complete motion source.
- Controller-owned locomotion must be in-place or use a deliberate root-motion mode, never both controller movement and duplicate FBX root translation.
- Jump is idle-only and physics-driven. Reload is standing-idle-only. Sitting is seat-anchor snapping.
- Obstacle climb and ladder ascent/descent must be checked frame-by-frame against calibrated handholds, footholds, rungs, edges, platform heights and collision geometry.
- Knockdown and hard landing need explicit physics/capsule handoff. Do not let animation root motion move a physics body invisibly.
- Measure actual punch contact, landing contact, grip, foot plant, reload hand movement and vehicle entry/exit phases. Do not infer contact timing from clip duration.

### Current unavailable actions

No pistol animation set or reload, dedicated ladder-down clip, crouch-running-aim, kick, dodge, chair sit-down/stand-up transition, draw/holster, vault, mantle, ledge-hang, ledge-shimmy or drop clip. Treat these as unavailable. Do not import an old NPC clip or register a placeholder.


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

- [ ] Equip/holster may be tested as non-animated state changes only; no draw/holster clip is currently available.
- [ ] Hold at hip.
- [ ] Aim while standing.
- [ ] Walk while aiming.
- [ ] Crouch aim and crouch-walk aim are available; crouch-running-aim is not downloaded.
- [ ] Preview `Gunplay.fbx` first; no confirmed firing/recoil clip is assigned yet.
- [ ] No dedicated crouched-fire clip is present; validate the available crouch-aim pose separately.
- [ ] Reload rifle only from standing idle; reject reload while moving, crouched or aiming.
- [ ] Pistol reload/animation is unavailable and outside current scope.
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
- [ ] No sit-down animation key; seat by snapping to the calibrated seat anchor.
- [ ] Sitting idle animation key.
- [ ] No chair stand-up animation key; exit using the seat-exit anchor.
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
- [ ] Reserve the seat, snap pelvis/orientation to the calibrated seat anchor, then play `Sitting Idle.fbx` directly; no sit-down transition.
- [ ] Move from the seat anchor to a clear seat-exit anchor; no chair stand-up transition.
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
- [ ] Test ladder descent by reverse playback of `Climbing Ladder.fbx`; accept only after every rung hand/foot contact is validated.
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


## 8A. Unified automatic asset-calibration system — implementation contract

**Status:** First implementation and a working review/save UI are committed to `main`. The sidecar pipeline now feeds world colliders, imported road/bridge triangle surfaces, reviewed tyre-surface routes, and accepted player/NPC/vehicle interaction anchors. Representative asset runs and in-game physics validation are still open. Keep unreviewed guesses out of gameplay-active metadata.

### Goal

Build one automatic asset-calibration pipeline that scans imported world assets, merges the existing collision-generation workflow into that same pipeline, detects useful gameplay geometry/interactions, and writes structured calibration metadata the game engine can read directly. This must not become a second, disconnected collision generator: collision generation/profile selection is one stage of the unified calibrator.

### A. Unified scan pipeline

1. **Asset intake:** identify source model, format, node hierarchy, meshes, materials, dependencies and existing collision sidecars.
2. **Transform/scale inspection:** inspect local/world transforms, bounds, dimensions, origin, ground offset, forward/up axes and likely unit scale. Report suspicious scale/orientation; do not destructively rescale the source asset.
3. **Geometry analysis:** inspect connected components, bounds, normals, thickness, repeated geometry, symmetry, openings, planar surfaces and candidate pivots/anchors.
4. **Collision integration:** run the existing collision workflow as an internal stage. Reuse and improve its asset-specific collision-profile selection rather than maintaining two competing systems.
5. **Semantic detection:** identify candidate doors, stairs, platforms, ladders, climbable walls/ledges, seats, handles, walkable/driveable surfaces, roads, bridges, vehicle parts and other interaction geometry.
6. **Gameplay parameter generation:** convert detections into structured properties the engine/runtime consumes.
7. **Confidence/review:** label results with confidence and explain uncertain detections. Ambiguous detections must be reviewable in the editor, not silently accepted.
8. **Validation/export:** validate dimensions, transforms, collider coverage, anchors, road connections and references, then write a versioned sidecar without modifying the original model.

### B. Merge with the existing collision workflow

- [ ] Locate and document the current collision-generation scripts, profile rules, output format and existing sidecar files before changing anything.
- [ ] Make the existing collision process an internal stage of the unified calibrator, not a separate manual pipeline.
- [ ] Preserve current asset-specific collision-profile logic and improve it where scans reveal bad dimensions or unsuitable shapes.
- [ ] Support appropriate collider types: box, capsule, convex hull, compound and static triangle mesh where justified.
- [ ] Detect when an asset needs multiple collider components instead of one oversized solid collider.
- [ ] Preserve dedicated rules for roads, ground/surface meshes, bridges, poles, lights, signs, vegetation, fences, dedicated kits and other special categories.
- [ ] Never apply generic solid collision blindly to roads, bridge decks, poles, vegetation or assets requiring specialised profiles.
- [ ] Keep render geometry and collision geometry separate where that improves performance or physical correctness.
- [ ] Record collider source, shape, dimensions, local transform, collision layer/mask, static/dynamic status and simplification.
- [ ] Preserve source assets and supporting files. Calibration output must be reversible and must not overwrite original geometry.
- [ ] Provide a comparison report between old collision results and unified-calibrator results to identify regressions.

### C. Door and movable-panel detection

Inspect node names, hierarchy, connected mesh components, geometry separation, symmetry and likely hinge edges.

For each detected door/panel, attempt to generate:

- [ ] Node and mesh/component references.
- [ ] Category: vehicle door, building/interior door, gate, hatch, shutter or other panel.
- [ ] Closed local transform.
- [ ] Candidate hinge/pivot position and hinge axis.
- [ ] Open direction and candidate open angle/range.
- [ ] Bounds, thickness and approximate dimensions.
- [ ] Handle/interaction point, approach point and character hand-contact point where geometry supports detection.
- [ ] Closed-state collision and a safe open-state collision strategy.
- [ ] Parent/body relationship and whether the panel is independently movable.
- [ ] Confidence score and editor-review flag when hinge/opening direction is uncertain.

A door-looking shape merged into one static building mesh must not be treated as a working animated door automatically. Flag it for mesh separation or editor correction. Do not invent a hinge pivot without geometric evidence.

### D. Stair, step and platform detection

Identify repeated stair treads/risers and separate landing/platform geometry. Also detect standalone steps, ramps, raised walkways and platform edges.

For each stair flight/platform, attempt to calculate:

- [ ] Bounds and local orientation.
- [ ] Number of visible steps.
- [ ] Average and per-step riser height.
- [ ] Tread depth and usable width.
- [ ] Total rise and horizontal run.
- [ ] Slope/grade and direction of travel.
- [ ] Bottom/top entry points.
- [ ] Intermediate landing positions and elevations.
- [ ] Walkable surface polygons or collision references.
- [ ] Side clearance, head clearance and rail/obstruction information where detectable.
- [ ] Classification: normal walkable stair, steep stair, ramp, ladder-like traversal object or decorative/non-walkable mesh.

Generate engine-required parameters such as walkable surfaces, step-height limits, tread/riser measurements, slope limits, landing elevations, traversal direction and collision references. Exported field names must match the runtime contract; do not create metadata the engine never reads. Stairs and landings must be distinct usable surfaces where needed. Do not represent an entire stair flight as one invisible solid block that prevents walking up it.

### E. Imported road and bridge profile detection

The calibrator must recognise imported road assets and complete bridge models as driveable/connected infrastructure, not just generic static props. A bridge GLB/GLTF may contain a road deck, approach ramps, rails, piers, support beams and separate collision pieces in one hierarchy.

For each candidate road/bridge asset, inspect and attempt to classify:

- [ ] Driveable road/deck surface mesh or surface region.
- [ ] Road shoulders, sidewalks, curbs and pedestrian walkways.
- [ ] Bridge deck, deck thickness and underside.
- [ ] Entry and exit transitions/ramps at both ends.
- [ ] Road lane count, lane widths, lane direction and approximate centreline where geometry permits.
- [ ] Road width, usable driveable width and shoulder width.
- [ ] Start/end connection positions, endpoint heights, forward tangents and connection directions.
- [ ] Surface slope, longitudinal grade, crossfall/camber and banking.
- [ ] Bridge span, approach length, deck elevation and measurable clearance beneath the bridge.
- [ ] Expansion joints, seams, gaps and discontinuities that could affect vehicles.
- [ ] Side barriers, guardrails, kerbs and collision boundaries.
- [ ] Piers, columns, foundations, beams and support structures as separate non-driveable collision components.
- [ ] Tunnel/underpass clearance and overhead obstructions where present.
- [ ] Road material candidates and physics tags for tyre grip, rolling resistance, wet response and audio.
- [ ] Vehicle and pedestrian collision surfaces separately where required.
- [ ] Road-surface continuity across the deck and both approach transitions.

Generate an engine-readable road/bridge profile containing measured dimensions and connection data. At minimum it should carry:

- Driveable deck/component references and separate support/barrier component references.
- Driveable surface boundary/polygon.
- Road centreline or sampled centreline points.
- Road width and lane/shoulder metadata where detectable.
- Start/end connection sockets with local position, elevation, tangent/forward direction and width.
- Deck height, grade, camber/crossfall and transition measurements.
- Collision references for deck, barriers, supports and underside.
- Surface material/physics tags.
- Clearance data, confidence scores and warnings.

**Connection requirement:** the engine/editor must connect an imported bridge deck to individually authored roads or other imported road assets without a visible height step, gap, sideways offset or abrupt grade change. Use endpoint measurements and tangents to validate alignment. Do not assume the bridge model origin is at the road start or its local forward axis is correct.

**Do not flatten the bridge into one generic collider.** The deck must be driveable; barriers must appropriately block vehicles; piers/supports must collide as structural obstacles without blocking the deck. If the deck is merged with other geometry and cannot be reliably separated, flag it for editor correction or source-mesh separation.

Support imported bridge models as well as simpler road segments, junctions, ramps, overpasses and underpasses. This does not replace the individually authored road/ground workflow; it makes imported road infrastructure measurable and compatible with it.

### F. Player-aware climbability and traversal requirements

Climbability must be evaluated against the dimensions/capabilities of the selected player/NPC profile, not simply labelled climbable for everyone.

For each candidate obstacle inspect:

- [ ] Height, width, thickness and shape.
- [ ] Top-edge/ledge position and usable handhold area.
- [ ] Candidate handholds and footholds.
- [ ] Approach space and take-off position.
- [ ] Far-side landing area and clearance.
- [ ] Overhead/head clearance and nearby collision obstruction.
- [ ] Supported action: low vault, medium vault, high mantle, ladder climb, ledge hang, shimmy, pull-up or not traversable.
- [ ] Whether required animation keys and traversal anchors exist for the current rig.

The calibration output must provide measurable requirements, not just a yes/no flag:

- Obstacle height and traversal category.
- Minimum player capability required for the action.
- Maximum supported obstacle height for that action/profile.
- Required standing reach and/or jump reach where relevant.
- Required animation/action capability (vault, mantle, ladder climb, ledge pull-up).
- Required approach, hand-contact, foothold and landing anchors.
- Reason when traversal is not safe/supported.

Use profile capability data such as character height, capsule height/radius, standing reach, jump reach, vault limit, mantle limit and climb capability. Character height alone is not enough: reach, animation capability, collision clearance and landing space also matter. At runtime, compare the selected player/NPC profile with calibrated requirements, choose the highest valid traversal action, or reject traversal cleanly. Keep thresholds configurable per profile, not one universal climb height.

### G. Other geometry and gameplay properties

- [ ] **Scale/placement:** model bounds, dimensions, unit scale, ground contact, origin, forward/up axes and suspicious offsets.
- [ ] **Walkable surfaces:** floors, roofs, sidewalks, bridge decks, ramps, platforms and terrain; surface normal, slope, boundary and walkability.
- [ ] **Steps/curbs:** height, width, step-up suitability and collision response.
- [ ] **Ladders:** plane, rung spacing, mount point, climb path, top-out point, bottom dismount point and direction.
- [ ] **Ledges:** hangable edge, handhold path, shimmy range, pull-up position and drop/landing point.
- [ ] **Fences/walls:** height, thickness, top edge, material/category, vault/mantle suitability and far-side landing clearance.
- [ ] **Platforms/fire escapes:** elevation, walkable area, stair/ladder connections, rails, entry/exit points and connected traversal routes.
- [ ] **Seats/benches:** seat surface, height/depth, facing, approach point, pelvis anchor, foot clearance and stand/exit point.
- [ ] **Vehicle components:** body, doors, hinges, wheels, wheel axes/radius, seats, steering wheel, entry/exit points and ground clearance.
- [ ] **Interaction points:** handles, hand-contact points, switches, controls, grips, ladders, seat anchors and useful local-space anchors.
- [ ] **Obstacles/cover:** waist-height/full-height cover candidates, thickness, safe approach positions and collision coverage.
- [ ] **Material/physics classification:** candidate surface tags for grip, friction, sound and footsteps. Uncertain labels must be reviewable; visual colour alone is insufficient evidence.
- [ ] **Clearance/navigation:** doorway dimensions, corridor clearance, headroom, narrow passages, blocked paths and usable approach/exit zones.
- [ ] **Collision quality:** holes, missing regions, excess collider volume, bad normals, thin surfaces, disconnected components and collision meshes outside render bounds.
- [ ] **Special categories:** vegetation, poles, wires, signs, props, glass, fences and decorative meshes receive category-appropriate collision and interaction treatment.

### H. Calibration data contract

Export a versioned, engine-readable sidecar per source asset or logical asset. Its path/name must be deterministic and resolvable by the asset registry and editor.

The result should include:

- [ ] Schema/calibrator version and stable asset ID.
- [ ] Source path/hash, scan date and scan status.
- [ ] Local bounds, dimensions, origin, scale and axis convention.
- [ ] Detected nodes/components and semantic roles.
- [ ] Collision profiles and collider component definitions.
- [ ] Door/panel definitions and hinge/open-state data.
- [ ] Stair/step/platform measurements and walkable-surface references.
- [ ] Road/bridge profiles, driveable regions, endpoints, centreline and connection measurements.
- [ ] Ladder, ledge, fence and traversal definitions.
- [ ] Seat and general interaction anchors.
- [ ] Vehicle part/wheel references where available.
- [ ] Surface/material/physics tags.
- [ ] Player/NPC capability requirements and supported traversal ranges.
- [ ] Confidence values, warnings, unsupported detections and required manual reviews.
- [ ] Manual overrides that survive a rescan when the source asset has not changed.

The engine consumes the profile directly. Runtime must not rescan raw geometry every time an asset spawns.

### I. Map editor integration

The map editor is the review/correction surface for generated calibration data:

- [ ] Show per-asset status: not scanned, scanning, calibrated, needs review or failed.
- [ ] Run/re-run calibration for one asset or a batch.
- [ ] Preview generated collision shapes over the original model.
- [ ] Toggle render mesh, collision mesh, bounds, axes, component IDs and detected semantic parts.
- [ ] Preview door hinges, swing axes, closed/open positions and collision changes.
- [ ] Preview stair treads, risers, landings, walkable surfaces and dimensions.
- [ ] Preview road/bridge driveable deck, lanes, centreline, endpoints, tangents, approaches, supports, barriers and underpass clearance.
- [ ] Preview road/bridge alignment against other road assets and authored road geometry.
- [ ] Preview ladder rungs, ledge anchors, handholds, footholds, vault/mantle points and landing zones.
- [ ] Show minimum/maximum obstacle capability requirements.
- [ ] Select a player/NPC profile or capability preset and preview whether that character can traverse an object.
- [ ] Show the exact reason a traversal or road connection is accepted/rejected.
- [ ] Edit/add/remove/reposition generated anchors and semantic classifications.
- [ ] Correct road endpoint positions, tangents, width, grade and connection data.
- [ ] Correct collider type, dimensions, local transform and collision category.
- [ ] Preserve manual overrides on rescan unless the source asset changed and the override is explicitly invalidated.
- [ ] Compare before/after calibration and restore a previous result.
- [ ] Save corrected metadata in the same engine-readable schema; editor-only data must not be the only copy.

### J. Calibration validation and safety gates

- [ ] Scan representative buildings, vehicles, chairs, stairs, ladders, fences, props, road pieces, imported bridges, ground meshes, poles and vegetation before batch calibration.
- [ ] Validate against known reference dimensions and the 1m test cube.
- [ ] Test collision contact in the actual physics engine, not only in a viewer.
- [ ] Test door operation against detected hinges and nearby geometry.
- [ ] Walk stairs and onto platforms without invisible blocking volumes.
- [ ] Test player-aware vault/mantle/climb decisions with multiple capability profiles.
- [ ] Test ladder/ledge anchors against the actual animation rig and clips.
- [ ] Drive across imported bridges in both directions at low and normal speed; test approach entry, deck continuity and exit transition.
- [ ] Verify vehicles do not catch on bridge joints, collider seams, invisible supports or abrupt deck-height changes.
- [ ] Verify bridge barriers prevent falling without blocking/narrowing the usable deck.
- [ ] Verify road profiles connect correctly to authored roads and other imported road assets.
- [ ] Verify colliders, interaction anchors and road sockets remain aligned after asset rotation, scale and placement.
- [ ] Verify runtime reads generated parameters rather than recomputing different values.
- [ ] Keep uncertain detections reviewable and source assets/old collision sidecars recoverable until new results pass.

### K. Completion criteria

The unified calibrator is ready for production use only when it scans representative assets, reuses the existing collision workflow, produces correct engine-readable collision/interaction metadata, detects doors and stairs, measures imported road/bridge profiles and endpoints, calculates player-profile traversal requirements, exposes uncertainty in the editor and passes runtime tests without damaging source assets.

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
- [ ] Unified asset-calibrator status, scan and review panel.
- [ ] Collision/component preview and semantic-detection correction tools.
- [ ] Door hinge, stair/platform, road/bridge and player-aware traversal calibration views.
- [ ] Interaction-anchor editor.
- [ ] Road/bridge endpoint, tangent, width, grade and connection editor.
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

- [ ] Civilian preset: idle, walk/run/sprint, route movement, seat-anchor sit, wave, hit reaction, knockdown and vehicle entry/exit after preview. Phone/fear/flee clips are unavailable.
- [ ] Worker preset: idle, short routes, seat-anchor sit, wave and basic hit/knockdown reactions. Work-idle/carry clips are unavailable.
- [ ] Aggressive preset: approach, punch, block, hit reaction, knockdown, pursue and stop. Kick/dodge clips are unavailable.
- [ ] Police preset: patrol, chase, rifle aim/walk/run and standing-idle rifle reload. Gunplay remains a preview candidate; radio/take-cover/restrain clips are unavailable.
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

- [x] Generate the `npc_core_001` MakeHuman source project, source OBJ/MTL and textures.
- [x] Inventory and map all 28 downloaded animation FBXs in the manifest.
- [x] Add the standalone browser inspector at `npc-lab.html` with base-rig and per-clip diagnostics.
- [x] Wire the shared `npc_core_001` loader into the live player, enemy and civilian consumers.
- [x] Remove the obsolete `civilian_001`, `civilian_002` and `npc1` model folders, plus `js/npc-character.js` and `js/npc-config.js`.
- [ ] Open `/npc-lab.html` and verify that `Idle.fbx` contains the skinned humanoid mesh, Mixamo skeleton, materials and playable idle take.
- [ ] Preview every current FBX and confirm full track binding against the same base skeleton.

### Phase 2 — New NPC profile/animation runtime

- [x] Build the independent `js/npc-system/` profile registry and `NpcInstance` runtime.
- [x] Load/cache one base-rig candidate and lazily cache clips by stable manifest keys.
- [x] Add action control, crossfades, request cancellation and one-shot completion handling.
- [x] Add civilian/worker/aggressive/police profile definitions and an in-game F10 profile cycle for the nearest NPC.
- [x] Migrate the player/enemy renderer and civilian population to `npc_core_001`.
- [ ] Validate movement, crouch, jump, rifle aim and combat animation visually in-game.

### Phase 3 — Weapon connection

- [ ] Define calibrated weapon sockets, hand grips, sight and muzzle metadata.
- [ ] Calibrate current procedural weapon meshes and attachment points.
- [x] Connect rifle aim/walk/run clips and the 3.3-second standing-idle-only reload clip to player weapon state.
- [x] Prevent non-rifle weapon classes from borrowing rifle aim/reload animation poses.
- [ ] Preview `Gunplay.fbx` before assigning it as a firing/recoil action; no pistol, draw or holster animation is available.
- [ ] Test first-person and third-person hand, sight, muzzle and weapon alignment.

### Phase 4 — Object/seat interactions

- [ ] Define a reusable asset-local interaction-anchor contract for chairs, benches and props.
- [x] Add Rapier kinematic NPC anchor positioning and connect civilian seat snapping to `Sitting Idle.fbx`; no sit-down/stand-up clips are used.
- [ ] Calibrate actual chair/bench sit and exit anchors in the game world.
- [ ] Validate approach, occupancy, exit clearance and physics restoration in-game.

### Phase 5 — Vehicle doors and entry/exit

- [ ] Inspect vehicle GLB hierarchies and identify usable door/seat bones or meshes.
- [ ] Calibrate door hinge pivots and open/closed transforms.
- [ ] Add driver/passenger seat, handle, approach and exit anchors.
- [ ] Connect `Entering Car.fbx`, `Exiting Car.fbx` and `Driving.fbx` to calibrated vehicle anchors.
- [ ] Test entry/exit, door states and seat alignment on every current vehicle model.

### Phase 6 — Traversal system

- [ ] Add ladder/fence/wall/ledge geometry metadata and traversal anchors.
- [ ] Connect `Climbing.fbx` to obstacle top-out/landing anchors and `Climbing Ladder.fbx` to ladder ascent.
- [ ] Validate reverse ladder playback for descent only after hand/foot contact checks; it remains experimental.
- [ ] Align the complete character motion to geometry anchors and measured obstacle/ladder dimensions.
- [ ] Verify physics handoff, no teleporting, floating or collision traps.

### Phase 6A — Unified asset calibration (implementation in progress; asset/runtime validation pending)

**Implemented first pass; no representative sidecars or in-game physics tests have been run yet.**

- [x] Add the unified CLI entry point: `tools/asset-calibrator.mjs`.
- [x] Reuse `tools/process-glbs.js` as the internal collision scan stage instead of maintaining a disconnected collision generator.
- [x] Extend the scan stage to read GLB and local-resource glTF, return stable node keys/component bounds, and omit explicitly classified driveable meshes from solid-box generation.
- [x] Emit versioned `*_calibration.json` sidecars with source SHA-256, raw bounds, collision boxes, semantic components, road/bridge profiles, traversal candidates, interaction contracts and vehicle diagnostics.
- [x] Add initial recognition for trusted bridge-kit sections, Road Pack modules, sidewalk components, the known street-road asphalt mesh, and candidate doors/panels, seats, stairs, ladders, ledges, barriers and vehicle parts. Name/shape guesses remain review-only.
- [x] Keep imported road/bridge deck meshes separate from solid boxes and register their original triangles as static Rapier surface colliders.
- [x] Add a review/save panel to `tools/asset-review.html/js`: calibrated component selector, component/anchor JSON editing, collision and road-profile overlays, component acceptance, connection editing and explicit sidecar save.
- [x] Add source-hash-guarded GET/POST calibration endpoints in `server.js`. They only read/write sidecars beside GLB/glTF files under the approved model roots; source assets remain read-only.
- [x] Keep scan-owned collision exclusions locked in the review UI and server validation. A newly detected mesh cannot be made driveable while its original solid collider remains in the sidecar.
- [x] Add sidecar integrity checks for node references, collision boxes, runtime surface references, interaction anchors, approved routes and bridge sections.
- [x] Add reviewed road/bridge socket profiles to the vehicle tyre-surface sampler. Accepted straight routes use their reviewed endpoints; curved/sloped/ramp routes require at least three reviewed centreline points. The route list follows streaming chunk load/unload.
- [x] Feed calibrated road/bridge friction hints into Rapier's static triangle-surface registration.
- [x] Pass accepted NPC seat approach/pelvis/facing/exit anchors into the world interactable registry.
- [x] Pass accepted building-door hinge/axis/handle metadata into building door records. Actual panel rotation and open/closed collision switching remain unfinished.
- [x] Pass accepted vehicle occupant/entry/exit anchors into player vehicle interactions. Keep the existing wheel detector and dynamic chassis collision authoritative; vehicle-door hinge data is diagnostic only until door motion is implemented.
- [x] Add unit-test coverage for trusted bridge/Road Pack/street-road classifications, curve/ramp policy, unknown road geometry, and NPC/vehicle anchor contracts.
- [ ] Run `pnpm test:asset-calibration` and fix any failing cases.
- [ ] Generate, validate and visually review sidecars for the modular bridge kit, Road Pack, street-road asset, sidewalk pack, representative building/prop assets and all current vehicle GLBs/GLTFs.
- [ ] Compare generated unified collision boxes against existing `*_col.json` sidecars and actual world behaviour before migrating or replacing any legacy sidecar.
- [ ] Complete scale/origin/up-axis inference using trustworthy reference dimensions. Do not auto-rescale assets with unknown source units.
- [ ] Add geometry-based door pivot detection, movable-panel rotation and safe open/closed collision states for buildings and vehicles.
- [ ] Add stairs/step/riser/platform measurements and generate walkable tread/landing surfaces where the source requires them.
- [ ] Add robust automatic road/bridge centreline extraction, crossfall/camber, seam/grade checks and connection fitting. The current review UI accepts manual corrections; it does not infer complex curves from raw geometry.
- [ ] Connect calibrated traversal requirements to a real player/NPC traversal state machine and the downloaded climb/ladder animation clips. Current `Player._startClimb` still performs instant movement; do not enable calibrated traversal against it.
- [ ] Preserve and test accepted interaction, traversal and bridge-socket overrides across rescans of an unchanged source hash.
- [ ] Run browser/in-game tests for player collision, NPC seat snapping, door apertures, vehicle occupant/exit placement, imported road tyre grip, bridge support contact, deck contact and all approach/deck/exit transitions.
- [ ] Do not mark Phase 6A complete or replace the existing collision workflow until sidecar, visual-review and runtime-physics gates all pass.

**Current commands**

```bash
pnpm calibrate:asset -- data/models/assets/others/modular_bridge__low_poly__game_ready_/scene.gltf
pnpm validate:asset-calibration -- data/models/assets/others/modular_bridge__low_poly__game_ready_/scene.gltf
pnpm test:asset-calibration
pnpm dev
```

The calibrator writes `scene_calibration.json` beside the source glTF and does not rewrite the model. The test command, calibrator and save API are committed, but they have not been executed against the actual asset files or game runtime in this session.

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
- [ ] The 28 current FBXs are inventoried and mapped in Section 4 and the manifest. Pistol, draw/holster, kick/dodge, ladder-down, vault/mantle/ledge and chair-transition clips are explicitly unavailable; idle-only reload/jump and seat-snapping rules are enforced.
- [ ] NPC profiles can be switched in-game.
- [ ] Every registered animation is compatible with the rig.
- [ ] Weapons align with hands, aim direction and muzzle.
- [ ] Reload events align with magazine/weapon meshes.
- [ ] Chairs align to seat anchors.
- [ ] Vehicle doors have calibrated pivots and open/close correctly.
- [ ] Vehicle entry/exit aligns with door, seat and exit anchors.
- [ ] Obstacle climbing and ladder ascent use calibrated geometry anchors; ladder descent reverse playback remains experimental until contact-tested. No teleport shortcuts.
- [ ] The unified calibrator integrates the existing collision workflow and emits valid engine-readable asset profiles.
- [ ] Door hinges, stair/platform geometry and player-aware traversal requirements are detected or explicitly flagged for editor review.
- [ ] Imported bridge/road profiles expose a correct driveable deck, supports/barriers, endpoint connections and smooth vehicle transitions.
- [ ] Calibration results remain correct after asset placement transforms and are validated in runtime physics.
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
2. Treat `npc_core_001` as the only active humanoid asset; do not recreate the deleted legacy model folders or runtime modules.
3. Inspect the current GitHub `main` branch and actual files before editing.
4. Continue Phase 6A from its first unchecked item: run `pnpm test:asset-calibration`, generate and validate sidecars for the bridge kit, Road Pack, street-road, sidewalks, representative buildings/props and current vehicle assets, then inspect them in `/tools/asset-review.html`.
5. Next implement actual door swing/open-state collision and the player/NPC traversal state machine that consumes the calibrated obstacle/ladder anchors and available NPC-core clips. Then run the map/browser physics tests for road grip, bridge support/deck/approach transitions, NPC seating, player collision and vehicle entry/exit. Do not mark any of those runtime gates complete until observed in-game.
6. Keep NPC base-rig/animation verification open until its browser tests pass.
6. Keep the scope on the core NPC/player foundation and compact test world. No story-mode work until the user changes scope.

**This file is the durable project handoff. Update its checkboxes and notes as work is completed.**
