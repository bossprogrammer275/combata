# Open World City — 3D Asset & World Building Guide

This guide details how to build and import real **GLB/GLTF models** into the open-world game, ensure they integrate seamlessly with the collision and physics engines, and author custom city maps in `data/worlds/*.json`.

---

## 1. Pipeline Overview

Procedural JavaScript mesh generators are deprecated. All buildings, props, environmental structures, and vehicles are loaded as industry-standard `.glb` / `.gltf` assets.

### Core Architecture
- **Rendering**: Three.js PBR (`MeshStandardMaterial` / `MeshPhysicalMaterial`) with automatic environment map reflections and dynamic time-of-day atmospheric lighting.
- **Raycasting & LOS**: `three-mesh-bvh` provides mesh-accurate BVH acceleration for weapon hitscans, bullet penetration, camera occlusion avoidance, and line-of-sight checks.
- **Movement Colliders**: Solid AABBs are indexed for player, civilian and vehicle movement; climbable fences are both physical obstacles and interaction targets.
- **Physics**: Rapier 3D (WASM) handles the player's character controller, static-world collision and dynamic vehicle chassis. Cars use mass-bearing rigid bodies, CCD, ground raycasts at the four GLB wheel pivots, spring/damper suspension impulses, wheel-contact throttle/braking and per-wheel lateral tyre forces. Chassis pitch and roll are dynamic, with a tuned recovery assist. The model is still simplified: wheels are suspension/force points rather than separate rigid bodies, and full gearboxes, differentials and engine torque curves are not implemented.
- **Vehicle handling**: each car has its own mass, drivetrain, acceleration, braking, top speed, steering angle, tyre grip, handbrake grip, suspension and stability tune. The GLB's forward-axis correction is kept separate from the actual travel heading so imported cars accelerate in the direction their nose points.
- **Collision selection**: valid GLB `col_*` proxies first; dedicated tree/lamp and explicit per-world `collisionSize`/`collisionH` overrides next; otherwise the runtime uses the sibling `*_col.json` manifest, then purpose-built fallbacks (including split building walls with doorway openings).
- **Road collision**: road, sidewalk and curb strips keep oriented footprints. Their large world-space AABBs are only broad-phase bounds; player movement, nearby-object checks and raycasts test the real rotated strip so empty corners do not become invisible walls.
- **Vehicle collision**: the chassis is a dynamic Rapier body with wheel clearance; wheel contact rays exclude their own chassis. The game keeps a swept-AABB controller as fallback if Rapier initialization fails.

---

### In-game vehicle profiles

These are gameplay tuning values, not claims about exact real-world performance. Units are metres, seconds and kilograms.

| Profile | Mass | Drive | Acceleration tune | Speed cap | Handling focus |
|---|---:|---|---:|---:|---|
| Lambo | 1,480 kg | Rear-wheel drive | 12.5 m/s² | 64 m/s (about 230 km/h) | Fast response, stronger rear grip, loose handbrake |
| Cybertruck | 3,009 kg | All-wheel drive | EV motor torque map | 50 m/s (180 km/h) | Heavy EV, single-speed reduction, regenerative lift-off braking |

Controls in the current game: **W/Up** throttle, **S/Down** brake/reverse, **A/D** or **Left/Right** steering, **Space** handbrake, and **E** to enter or exit.

### New vehicle onboarding

Use [`tools/new-car.md`](./tools/new-car.md) for the required incoming-car checklist. The Asset Lab at `/tools/asset-lab.html` can load a new model from `/data/models/cars/`, tune its per-car interior camera, assign and preview a separate steering-wheel pivot, and save per-asset overrides. A 450° steering-wheel value is lock-to-lock (±225° from centre), not a 450° rotation each way.

Driver camera heights are vehicle-specific and measured from tyre/road ground: Lamborghini 0.98 m, Cybertruck 1.42 m, and the temporary Bugatti profile 1.04 m. Do not reuse one interior camera height across different vehicle classes. Press **Esc** in-game to open the pause menu, then choose **Cockpit Adjustments** for per-vehicle viewpoint position and resting look-angle controls. Adjustments persist locally for each vehicle type.

Cabin illumination is deliberately subtle. It can lift dark materials but cannot replace missing dashboard, steering-wheel, seat or console geometry in a GLB.

## 2. GLB Model Authoring Specifications

### Coordinate System & Scale
- **Unit**: 1 unit = 1 meter.
- **Axes**: `+Y` is Up, `+X` is East / Right, `-Z` is North / Forward.
- **Origin (Pivot)**: Model pivot should be placed at the **horizontal center** and at the **ground level** (`Y = 0`). The game engine automatically calculates bounding boxes and snaps the lowest vertex to `Y = 0` (or `Y = elevation`).

### Height Normalization (`targetH`)
The loader normalizes any imported model's height using `targetH` in `city-a.json`:
```json
{
  "url": "./data/models/assets/low_poly_skyscraper.glb",
  "x": -100,
  "z": -100,
  "ry": 0,
  "targetH": 42,
  "building": true
}
```
If `targetH` is set to `42`, the engine scales the entire model proportionally so its vertical height is exactly 42 meters.

---

### Special Mesh Naming Conventions

When exporting models from Blender, 3ds Max, or Maya, use specific mesh prefixes to enable game engine features:

| Mesh Prefix / Pattern | Purpose | Engine Behavior |
| :--- | :--- | :--- |
| `col_*` | **Collision Proxy Mesh** | Hidden from rendering. Its world-space bounds become solid movement/physics AABBs. Keep each proxy simple and name the mesh or a parent node with the prefix. |
| `door_*` | **Doorway / Portal Marker** | Marker bounds define entrances and portal direction. A wall-collider fallback leaves a walkable opening. Keep one marker per doorway. |
| `stairs_*` | **Stair Surface** | Horizontal tread surfaces get walkable step colliders when no stair-specific proxy or collision manifest is available. |
| `floor_*` | **Interior Floor Slab** | Creates a thin walkable slab when a sidecar manifest is not supplying the model collision. |
| `window_*` | **Glass / Fenestration** | Excluded from collision-manifest generation and mesh raycast BVHs; wall/proxy collision still blocks movement. |
| `room_<n>_marker` | **Room Marker** | Records a named room marker on the building. It is not a physical collider. |
| `trim_*`, `sign_*`, `awning_*`, `roof_detail_*` | **Visual Accents** | Excluded from collision-manifest cells and mesh raycast BVHs. |

---

### Collision & Interaction Types

#### 1. Solid Buildings (`building: true`)
```json
{
  "url": "./data/models/assets/low_poly_urban_building/scene.gltf",
  "tags": ["structural", "urban"],
  "x": -70,
  "z": -100,
  "ry": 1.57,
  "targetH": 14,
  "building": true
}
```
- Building collision can come from usable `col_*` proxies, an explicit per-world `collisionSize`/`collisionH` override, or a sibling `*_col.json` sidecar. If none supplies usable collision, the engine creates segmented perimeter walls rather than a solid box.
- Scans nested child nodes for `door_*` markers and leaves a walkable opening in fallback wall colliders.
- Registers visible structural meshes into `three-mesh-bvh` for raycasts. Collision-only proxies, room/door markers and visual accents are excluded.

#### 2. Climbable Walls & Fences (`climbable: true`)
```json
{
  "url": "./data/models/assets/Fence Section by Jarlan Perez - 1lOFMI3Pg8v.glb",
  "x": -55,
  "z": -85,
  "ry": 0,
  "targetH": 1.5,
  "climbable": true,
  "type": "fence"
}
```
- Registers into the climbable collision registry.
- When the player approaches and presses `[Z]`, the vaulting/climbing animation triggers.

#### 3. Low Barriers with Custom Collision (`collisionH`)
```json
{
  "url": "./data/models/assets/concrete_road_barrier_photoscanned.glb",
  "x": -22,
  "z": -18,
  "ry": 0,
  "targetH": 1.1,
  "collisionH": 0.8
}
```
- Restricts physical collision box to `0.8m` high so players can shoot over it while remaining in cover.

---

## 3. World Building Guide (`data/worlds/*.json`)

City layouts are defined in clean JSON format. Example: `data/worlds/city-a.json`.

### Schema Reference

```json
{
  "id": "city-a",
  "name": "Ilorin — Innovation District",
  "version": 2,
  "bounds": 220,
  "startPoint": { "x": 0, "z": 45, "yaw": 3.14159 },
  "ground": { "size": 1200, "color": "0x252a24" },
  "roads": [...],
  "glbAssets": [...],
  "vehicles": [...],
  "spawns": [...],
  "cover": [...],
  "loot": [...],
  "named": [...],
  "transit": [...]
}
```

### 1. Roads (`roads`)
Draws asphalt ribbons with raised curbs and sidewalks:
- `points`: Array of `[x, z]` coordinates.
- `w`: Road width (e.g. `12` for primary boulevards, `10` for secondary streets, `8` for service lanes).
- `sidewalk`: `true` enables elevated sidewalk pavement and curbs.
- `smooth`: `true` applies Catmull-Rom spline smoothing to corner points.

### 2. Vehicle Spawns (`vehicles`)
```json
{ "x": -15, "z": -40, "ry": 1.57, "kind": "lambo" },
{ "x": 15, "z": -40, "ry": 1.57, "kind": "cybertruck" }
```
- Supports `"lambo"` and `"cybertruck"`.
- `ry`: Heading angle in radians (e.g. `0` = North, `1.57` = East, `3.14` = South, `4.71` = West).

### 3. World Activity & Navigation
- **`spawns`**: `[[x, z], ...]`. Enemy wave and free-roam spawn locations.
- **`cover`**: `[[x, z], ...]`. Optional cover locations used by character AI for navigation and scene interactions.
- **`loot`**: `[[x, z], ...]`. Spawns collectible ammo, integrity, or coin crates.
- **`named`**: `{ "x": 0, "z": 0, "name": "DISTRICT NAME", "color": "#4ac08a" }`. Minimap and full-screen map district labels.
- **`transit`**: `{ "x": 0, "z": 36, "name": "Station Name" }`. Fast-travel network destinations accessible via `[T]`.

---

## 4. Model Pre-Processing Tool

To generate precomputed collision manifests for complex models:
```bash
node tools/process-glbs.js data/models/assets/your_model.glb
```
This utility analyses mesh triangles and outputs `your_model_col.json` beside the source model. The runtime automatically requests that sibling file when it exists, applies the same `targetH`/`scale`, `x`/`z`, `elevation` and `ry` transform as the visual model, and injects the boxes into both the AABB index and Rapier static collision. The generator skips `col_*`, `door_*`, `window_*`, room markers and visual-only accents. Its grid-cell test checks triangle/rectangle overlap instead of treating every triangle's full XZ bounding rectangle as solid.

---

## 5. Running the Project

Start the local server:
```bash
node server.js
```
Open your browser to:
- Free-roam Game: `http://localhost:8000/index.html`
- 3D Map Editor: `http://localhost:8000/map-editor.html`

### Collision verification

Run the vehicle/physics smoke test and syntax checks:
```bash
node tools/verify-vehicles.mjs
node --check js/world.js
node --check js/physics.js
node --check js/bvh-collision.js
node --check js/player.js
node --check js/vehicles.js
node --check tools/process-glbs.js
```

To create collision sidecars for assets, run `node tools/process-glbs.js data/models/assets/your_model.glb`. Commit the generated `your_model_col.json` beside the GLB for the runtime to load it.
