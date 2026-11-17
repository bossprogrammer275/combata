# Open World City — 3D Asset & World Building Guide

This guide details how to build and import real **GLB/GLTF models** into the open-world game, ensure they integrate seamlessly with the collision and physics engines, and author custom city maps in `data/worlds/*.json`.

---

## 1. Pipeline Overview

Procedural JavaScript mesh generators are deprecated. All buildings, props, environmental structures, and vehicles are loaded as industry-standard `.glb` / `.gltf` assets.

### Core Architecture
- **Rendering**: Three.js PBR (`MeshStandardMaterial` / `MeshPhysicalMaterial`) with automatic environment map reflections and dynamic time-of-day atmospheric lighting.
- **Raycasting & LOS**: `three-mesh-bvh` provides mesh-accurate BVH acceleration for weapon hitscans, bullet penetration, camera occlusion avoidance, and line-of-sight checks.
- **Movement Colliders**: Solid AABBs are indexed for player, civilian and vehicle movement; climbable fences are both physical obstacles and interaction targets.
- **Physics**: Rapier 3D (WASM) handles the player's character controller, static-world collision and dynamic vehicle chassis. Vehicle bodies use profile-defined mass, centre of mass and inertia, zero-density chassis colliders, CCD, and a fixed 120 Hz solver with render interpolation. Each GLB supplies the four measured wheel hardpoints and tyre radii; raycast suspension, axle-specific springs/dampers, anti-roll transfer, tyre forces, brake bias and per-wheel contact loads drive the chassis. The simulation remains a practical open-world approximation: tyres are suspension/force points rather than independent rigid bodies.
- **Vehicle handling**: each car has its own mass, drivetrain, acceleration, braking, top speed, steering angle, tyre grip, handbrake grip, suspension and stability tune. The GLB's forward-axis correction is kept separate from the actual travel heading so imported cars accelerate in the direction their nose points.
- **Collision selection**: valid GLB `col_*` proxies first; dedicated tree/lamp and explicit per-world `collisionSize`/`collisionH` overrides next; otherwise the runtime uses the sibling `*_col.json` manifest, then purpose-built fallbacks (including split building walls with doorway openings).
- **Road collision**: road, sidewalk and curb strips keep oriented footprints. Their large world-space AABBs are only broad-phase bounds; player movement, nearby-object checks and raycasts test the real rotated strip so empty corners do not become invisible walls.
- **Vehicle collision**: the chassis is a dynamic Rapier body with wheel clearance; wheel contact rays exclude their own chassis. The game keeps a swept-AABB controller as fallback if Rapier initialization fails.

---

### In-game vehicle profiles

These are gameplay tuning values, not claims about exact real-world performance. Units are metres, seconds and kilograms.

| Profile | Mass | Drive | Acceleration tune | Speed cap | Handling focus |
|---|---:|---|---:|---:|---|
| Lambo-class sports car | 1,620 kg | Rear-wheel drive | 13.8 m/s² | 90.3 m/s (about 325 km/h) | Rear-biased weight distribution, DCT and controlled oversteer |
| Cybertruck | 3,150 kg | All-wheel drive | EV motor torque map | 50 m/s (180 km/h) | Heavy EV, single-speed reduction and regenerative lift-off braking |

Controls in the current game: **W/Up** throttle, **S/Down** brake/reverse, **A/D** or **Left/Right** steering, **Space** handbrake, and **E** to enter or exit.

### New vehicle onboarding

Use [`tools/new-car.md`](./tools/new-car.md) for the required incoming-car checklist. The Asset Lab at `/tools/asset-lab.html` can load a new model from `/data/models/cars/`, tune its per-car interior camera, assign and preview a separate steering-wheel pivot, and save per-asset overrides. A 450° steering-wheel value is lock-to-lock (±225° from centre), not a 450° rotation each way.

Driver camera heights are vehicle-specific and measured from tyre/road ground: Lamborghini 0.98 m and Cybertruck 1.42 m. Do not reuse one interior camera height across different vehicle classes. Press **Esc** in-game to open the pause menu, then choose **Cockpit Adjustments** for per-vehicle viewpoint position and resting look-angle controls. Adjustments persist locally for each vehicle type.

Cabin illumination is deliberately subtle. It can lift dark materials but cannot replace missing dashboard, steering-wheel, seat or console geometry in a GLB.

## Vehicle coordinate convention

Vehicle-local coordinates are **+Y up, +Z forward and +X left**. The right side is -X. This is the vehicle asset convention; general city/environment assets retain the world-model convention documented below. The player controls continue to use D/Right for a right turn. The model's nose-axis correction is applied once at the vehicle root; wheel classification, tyre rigs, physics hardpoints and cockpit placement must use the same measured model-local geometry.

Each registered vehicle has one model entry and one physics profile. The GLB supplies its wheel positions and tyre radii; the profile supplies mass, weight distribution, centre of mass, inertia scale, suspension, braking, grip and powertrain tuning. The loader checks the four-corner layout against those values and refuses mismatched or incomplete models. It does not replace broken assets with a placeholder box car.

The physics debug overlay is available in-game with **F9** (the existing F8 control remains time-of-day). It draws the fitted chassis collision box and the four live suspension rays.

## 2. GLB Model Authoring Specifications

### Coordinate System & Scale

The **game world always uses metres**. Imported source files are not guaranteed to use metres: some marketplace models are authored in centimetres, millimetres, decimetres, or arbitrary scene units. Never assume a raw GLB dimension is already a metre measurement.

- **Runtime unit**: 1 world unit = 1 metre.
- **Axes**: `+Y` is Up, `+X` is East / Right, `-Z` is North / Forward.
- **Origin**: the preferred asset pivot is the horizontal centre at ground level. The loader can centre building footprints and snap the lowest point to `Y = 0` or the authored elevation.
- **Source-unit conversion**: set `unitScale` when a model is used without a target fit. Use `1` for metres, `0.01` for centimetres, `0.001` for millimetres and `0.1` for decimetres.

### Height Normalization (`targetH`)

`targetH` is always the **final height in metres**, not a raw source-unit value. The loader measures the imported model, applies its source-unit conversion and proportionally fits the model to the requested final metric height. The same cumulative transform is applied to collision sidecars and doorway bounds.

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

This model will be exactly 42 metres tall in the world. A centimetre-authored model can still use `targetH: 42`; the runtime fits it in metric space instead of treating its raw centimetre values as metres. Use `unitScale` to state the source convention explicitly when the model has no target fit or when its raw scale is needed by another tool.

### Vehicle Metric Scale (`targetLen`)

Vehicle `targetLen` values in `js/vehicles.js` are also final metres. The car loader measures the imported **body** length, normalizes the model to that value, then extracts the four wheel hardpoints, wheel radii, chassis collision and cockpit offsets from the normalized model. Vehicle physics profiles use metres, seconds and kilograms. Never copy raw Sketchfab dimensions directly into wheelbase, track, tyre radius, camera height or collision values.

The vehicle verification suite checks each loaded car's final body length, centred origin, ground contact and four-wheel geometry.

`getWorldKitScalePlan` and `getWorldKitLengthScalePlan` are the shared normalization paths. A supplied `targetH` or `targetLen` fits the raw model dimensions directly to final metres, without first assuming the download was authored in metres. `unitScale` is applied when source units are explicitly known or when an asset has no target fit. Vehicle hardpoints, wheel radii, collision bounds and cockpit offsets are measured only after this normalization, so centimetre-scale source geometry cannot leak into metre-based physics.

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

Downloaded marketplace assets do not all follow these naming rules. Do **not** rename or destructively rewrite a good source model just to force the convention. World Kit supplies per-asset metadata for assets that lack authoring markers:

- Real `door_*` meshes are used directly as doorway markers.
- Named entrance groups (for example the Innovation Hub's `entrance-doors-portal`) are measured as one imported doorway assembly.
- Assets with no usable door group receive a per-asset metric doorway marker. This leaves the corresponding gap in fallback building-wall collision and registers an enter/exit portal.
- Door handles and decorative hardware are not treated as separate portals.
- `col_*` meshes remain preferred for exact collision. Buildings without them use the registered collision sidecar when one exists, otherwise segmented perimeter-wall collision with the authored doorway openings. This avoids a single solid box sealing every room.

For older downloaded buildings that have no usable native markers, the runtime adds hidden `door_auto_*` marker meshes and a hidden `col_auto_building_shell` InstancedMesh to the loaded clone. The matching wall AABBs are generated from the same unrotated, scaled local footprint and preserve each doorway gap after the building is rotated into the city. This is non-destructive: the original marketplace GLB/glTF and its visible geometry are not rewritten. The City A preview verifies doorway and collision coverage for every placed building.

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
- Scans nested `door_*` meshes, registered imported entrance groups and per-asset doorway metadata. Fallback wall collision leaves the matching walkable opening and registers an enter/exit portal.
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

### Bridge component assemblies

The downloaded modular bridge is extracted into its real curved spans, straight spans, short spans and abutments. Assemblies are authored in `bridgeAssemblies` in `city-a.json`. Each piece uses dimensionless `scaleX`/`scaleY`/`scaleZ`, and `deckY` is the required absolute top-of-road height in metres. The runtime measures the imported piece's own road-deck offset and derives its placement from `deckY`; the exact placed road mesh is also registered for Rapier collision. Use imported bridge modules for suitable spans, procedural geometry only for ramps, custom piers, retaining transitions and invisible physics proxies. Do not guess the bridge deck offset or treat centimetres as metres.

## 4. Model Pre-Processing Tool

To generate precomputed collision manifests for complex models:
```bash
node tools/process-glbs.js data/models/assets/your_model.glb
```
This utility analyses mesh triangles and outputs `your_model_col.json` beside the source model. The runtime automatically requests that sibling file when it exists, applies the same `targetH`/`scale`, `x`/`z`, `elevation` and `ry` transform as the visual model, and injects the boxes into both the AABB index and Rapier static collision. The generator skips `col_*`, `door_*`, `window_*`, room markers and visual-only accents. Its grid-cell test checks triangle/rectangle overlap instead of treating every triangle's full XZ bounding rectangle as solid.

---

## Graphics profiles

The renderer exposes **Ultra**, **High**, **Medium**, **Low** and **Ultra Low**. Ultra is enabled only for a WebGL2 device with large texture/renderbuffer limits and a recognised modern GPU; the renderer falls back to High when those checks are not met. High uses multisampled rendering, ACES tone mapping, soft directional shadows and PBR environment reflections. Ultra uses a post-processing chain with GTAO contact shading, restrained bloom, SMAA edge smoothing, higher-resolution shadows and stronger anisotropic texture filtering. Dynamic render resolution reduces the internal render size when frame time exceeds the selected target and restores detail gradually when there is GPU headroom.

Changing the graphics tier reloads the world so its atmosphere, materials, texture filtering and asset-loading budget are rebuilt together. GLB decode concurrency and background prefetch worker count are capped on devices reporting 4 GB or less.

The renderer can improve lighting, edge quality, reflections and texture clarity, but it cannot add missing geometry to a low-detail source model. A genuinely photorealistic city still needs higher-detail building, vehicle, street and vegetation assets, plus authored lower-detail LOD variants for distant placement.

## 5. Running the Project

Start the local server:
```bash
node server.js
```
Open your browser to:
- Free-roam Game: `http://localhost:8000/index.html`
- 3D Map Editor: `http://localhost:8000/map-editor.html`

### Collision verification

Run the vehicle/physics smoke test (including the 60-second straight-line and mirrored-turn symmetry tests) and syntax checks:
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
