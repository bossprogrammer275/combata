# Asset Registration & Calibration

This is the permanent intake procedure for every new model added to **OPEN WORLD**. It is also the hand-off record for the next model we are about to add. A model is not considered registered just because its GLB/glTF has been copied into `data/models/`.

## Operating rule

- **World scale:** 1 Three.js world unit = 1 metre.
- **Calibration is an internal assistant task.** The assistant loads the model, saves the rendered evidence images, opens and inspects those images, measures the model and records the decision. Do not make the user operate an asset-inspection UI to do this work.
- **Do not guess scale.** Raw GLB/glTF bounds are measurements, not proof that the model is physically correct. glTF uses metres by convention, but incorrectly scaled exports still exist.
- **Do not distort proportions.** Scale corrections are uniform. Never stretch a model independently on X/Y/Z to make it fit.
- **Keep the original.** Before modifying/replacing an existing asset, copy the unmodified source and its complete supporting files into `data/models/_archive/originals/` using the same relative path.

## 1. New model intake

For every incoming model, record:

| Field | Required information |
|---|---|
| Source file | Exact `.glb` or `.gltf` entry path |
| Supporting files | Referenced `.bin`, textures, and any other external resources |
| Source / creator | Download page or original author |
| Licence | Licence name and required attribution |
| Intended category | Building, residential, road, bridge kit, vehicle, vegetation, infrastructure, furniture, or prop |
| Intended use | Exact world feature or vehicle slot that needs it |
| Known real dimension | One trustworthy physical dimension and its source, when available |
| Collision behaviour | Building shell, ordinary solid prop, pole, tree trunk, road contact surface, bridge component, vehicle chassis, or no collision |

Place ordinary world assets under `data/models/assets/<category>/`. Place vehicles under `data/models/cars/<vehicle-folder>/`. Keep a GLTF's relative folder structure intact. Do not flatten a `scene.gltf` folder: its buffer and texture URIs may depend on that structure.

Keep the original source files unchanged until the calibration and collision decisions have been recorded. If the downloaded asset has a `license.txt`, keep it alongside the model.

## 2. Assistant-side visual calibration

Use the automated capture tool. This is not a manual inspection app.

Capture the complete library:

```bash
node tools/capture-asset-calibration.mjs
```

Capture only the new model:

```bash
node tools/capture-asset-calibration.mjs data/models/assets/<category>/<model-folder>/scene.gltf
```

The capture runner loads the actual file through the project's Three.js GLTFLoader, calculates its source bounds and saves six views:

- `iso`: overall shape and assembly.
- `front`: front-facing proportions.
- `side`: height, length and silhouette.
- `top`: footprint, width and orientation.
- `collision`: generated `col_*` proxy meshes without the visual meshes.
- `scale`: the full 10 m measuring pole, shown separately so it does not make small props impossible to inspect in the main views.

Main views include a **1.8 m human**, **1.0 m × 2.1 m doorway**, **1 m cube**, axis marker and metre grid. The **10 m pole** is included in the separate `scale` view so it does not dominate the main framing.

Outputs are saved to:

```text
artifacts/asset-calibration/
  report.json
  gallery.html
  previews/
    <model>-iso.png
    <model>-front.png
    <model>-side.png
    <model>-top.png
    <model>-collision.png
    <model>-scale.png
```

The assistant must open and visually inspect these saved images, not rely only on the JSON dimensions. Inspect the overall model, its front/side/top proportions, the ground contact, the origin/orientation, separate subcomponents and the collision view. For a compound pack, inspect each relevant component separately before treating it as a reusable kit.

The capture report labels every raw model as **unverified**. It does not auto-correct scale. After inspection, compare at least one axis against a trusted physical reference: a documented product dimension, a known real object in an authoritative photo, a measured source component, or confirmed creator metadata. Record the reference and its source in the calibration result.

If no reliable physical dimension exists, keep the measurement as *unverified*, state the plausible range, and do not silently set a permanent scale correction. Ask for a source/reference only when the decision cannot be grounded from the available model and evidence.

## Verified component-kit baseline

The existing library was visually rendered with `node tools/verify-asset-review.mjs` on 18 November 2026: **53/53 world-asset entry points rendered**, with no browser errors or failed requests. That review excludes vehicles and the standalone root `data/models/assets/road.glb`; use `capture-asset-calibration.mjs` for the full assets-and-cars intake.

The saved component captures confirm the following. These are already registered systems; do not create duplicate generic prefab maps for them.

### Modular bridge

The bridge is a genuine ten-mesh kit, not one indivisible model. Its dedicated registration and extraction are in `js/world-bridge-kit.js`, and `js/world.js` assembles those prefabs through `_spawnBridgeAssemblies()`.

| Reusable section | Concrete structure mesh | Separate road/deck mesh | Type |
|---|---|---|---|
| `bridge-curve-main` | `Object_4` | `Object_5` | Main curved span |
| `bridge-straight-span` | `Object_7` | `Object_8` | Straight span |
| `bridge-pier-starter` | `Object_10` | `Object_11` | Short pier starter |
| `bridge-curve-return` | `Object_13` | `Object_14` | Return curve |
| `bridge-end-ramp` | `Object_16` | `Object_17` | Sloped end/ramp |

The structure and deck must stay separate: structure is concrete/support geometry; deck is the road surface. The extractor anchors the support footings at the foundation datum and checks the deck height against the kit's **2.068 m** standard. The existing bridge verification script checks all five section types and all ten independent prefabs. The full source pack is approximately **46.436 × 2.861 × 37.034 source units**; these whole-pack bounds are not a placement scale recommendation.

### Road Pack

The Road Pack is six separate modules, already described by `WORLD_KIT_ROAD_PACK_PARTS` in `js/world-kit.js`: two short straight marking variants, two long straight variants, and two curved-corner variants. Keep those existing IDs and the existing 10× horizontal conversion. The long straight source panel is about **0.426 × 2.987 units**, resulting in roughly **4.26 m × 29.87 m** after the documented factor. Collision remains assigned to the actual assembled road surfaces, not a solid box around the whole pack.

### Sidewalk pack

The Sidewalks GLTF has **30 individually renderable mesh nodes**. The images show reusable square slabs, worn/broken slabs, long pavement strips, curb pieces, driveway aprons and inside/outside corner pieces. The current `WORLD_KIT_SIDEWALK_COMPONENTS` map already names 17 important semantic pieces. Do not interpret the 30 mesh count as 30 unique finished prefabs: retain small supporting/detail meshes inside their authored parent structure unless a separate reusable gameplay part is justified.

### Street-road source

The Street Road GLTF has four mesh nodes. The visual/component captures show two asphalt road surfaces and two side-texture meshes. The runtime already recognises `Two_lane_road` surface names and excludes `side_texture` meshes from road physics. Do not register the side textures as drivable road surfaces.

### Scale-review flags from the existing library

Raw dimensions below are **source units**, not verified metres. They are evidence for prioritising a reference check, not permission to multiply or divide the model:

| Existing asset | Captured source bounds (W × H × D) | Review flag |
|---|---:|---|
| Car workshop | 2100.001 × 797.555 × 3922.451 | Very large raw extents; inspect source/export units and outliers |
| School building | 2287.643 × 1057.281 × 2281.103 | Very large raw extents; compare to known storeys/door |
| Freeway streetlight | 43.690 × 1084.515 × 170.482 | Extreme height/footprint; inspect hierarchy and source units |
| Low-poly street food cart | 1140.925 × 1035.494 × 421.818 | Implausible for a cart if interpreted directly as metres |
| Nigeria duplex | 0.982 × 0.866 × 0.767 | Very small raw bounds; confirm whether model is intentionally authored at sub-metre scale |
| Industrial warehouse | 0.265 × 0.085 × 0.097 | Very small raw bounds; verify before relying on a target-height fit |
| Tree low-poly | 1752.412 × 2470.546 × 1795.874 | Extreme raw extents; inspect outlier nodes and source-unit metadata |

These flags can be explained by model units, nested scale transforms, stray geometry, or an asset-specific convention. Measure the actual scene bounds and inspect the images before deciding which explanation applies. The runtime may already fit a placement with `targetH`; do not make a second correction until that placement's result and the model itself have been checked.

## 3. Scale decision

Use the existing World Kit scale pipeline in `js/world-kit.js`:

- `targetH` is the intended final **height in metres** for a world asset. It is suitable when the world design calls for a fixed physical height and the model proportions are already credible.
- `unitScale` is a source-unit conversion multiplier. Use it only when the source unit is known (for example, centimetres to metres = `0.01`).
- `scale` is a placement multiplier. Do not use it to hide an unverified source-unit problem.
- For vehicles, `targetLen` is the calibrated final **length in metres**. Vehicle setup is separate; follow `tools/new-car.md`.

The runtime's `getWorldKitScalePlan()` applies the final scale consistently to the visible model and collision dimensions. A uniform root edit may be used for a carefully documented one-off correction, but it must not replace the registry's normal scale plan.

Record the following for every calibrated model:

```text
Raw bounds:        width × height × depth (source units)
Known reference:   axis + physical metres + evidence/source
Calibration factor: uniform factor, or 1.0 when already correct
Final dimensions:  width × height × depth (metres)
Orientation:       +Y up; record front direction where relevant
Ground contact:    grounded / pivot offset required / needs model repair
Status:            verified / approximate / unverified / rejected
```

## 4. Register an ordinary world asset

Add one entry to the `definitions` array in `js/world-kit.js`. The current tuple has eight fields:

```js
[
  'category/model-folder/scene.gltf', // path relative to data/models/assets/
  'unique-asset-id',                  // stable kebab-case ID
  'category',                         // building, residential, infrastructure, etc.
  'role',                             // shop, school, bridge kit, chair, streetlight...
  'mode',                             // atomic or compound
  'meshPolicy',                       // preserve-source-scene unless a kit needs semantic parts
  'collisionProfile',                 // see collision rules below
  'review',                           // pending-visual until screenshots are inspected
]
```

Example only; replace every value with the actual new model's information:

```js
['others/new_market_stall/scene.gltf', 'new-market-stall', 'street-prop', 'market-stall', 'compound', 'preserve-source-scene', 'solid-prop', 'pending-visual'],
```

Do not invent a semantic part map. If the model is a kit (bridge, road pack, modular sidewalk, fence sections), inspect each mesh and register only real reusable parts in the relevant `WORLD_KIT_..._PARTS` map. Keep the source geometry and node hierarchy intact unless a specific, tested reason requires a change.

After the screenshot review, update `review` from `pending-visual` to the truthful completed state. Never label a model `manifest-inspected` or `rendered-preview-verified` until that work has actually happened.

## 5. Choose collision behaviour deliberately

The runtime uses the registered `collisionProfile`; do not rely on vague filename matching.

| Profile | Use it for | Runtime behaviour |
|---|---|---|
| `building-shell` | Buildings with normal walls and openings | Generated/embedded wall proxies, preserving doorway gaps |
| `building-shell-with-doorway` | Buildings whose entrance needs explicit doorway treatment | Building collision plus authored or registered doorway handling |
| `solid-prop` | Barriers, furniture, containers, stalls and ordinary solid props | Solid collision bounds or usable `col_*` proxies |
| `trunk-only` | Trees and palms | Trunk-sized gameplay collider; foliage is not solid |
| `pole-proxy` | Streetlights and utility poles | Narrow pole collider |
| `road-surface` | Actual drivable road surfaces only | Road-contact geometry enters the road physics batch |
| `no-collision` | Visual-only assets or modular kits whose pieces are handled separately | No automatic solid collider |

For generated embedded collision meshes, inspect the asset first and then use the self-contained converter in `js/utils/make-collision.js`:

```bash
node js/utils/make-collision.js <building.glb> --mode solid --replace --rename
node js/utils/make-collision.js <ordinary-prop.glb> --profile small-prop --replace
node js/utils/make-collision.js <fence.glb> --profile fence --target-height 2 --replace
node js/utils/make-collision.js <streetlight.gltf> --profile pole --target-height 8 --replace
node js/utils/make-collision.js <vehicle.gltf> --mode shell --replace
```

The voxeliser uses independent X/Y/Z cell sizes. It keeps at least 16 cells across each non-zero model axis by default, so narrow poles, rails and thin parts do not disappear just because the model is tall or long. `--profile small-prop` raises detail for small solid assets; `--profile fence` selects thin surface collision and raises the grid detail; `--profile pole` or `--profile trunk` creates one narrow, full-height upright proxy instead of filling the lamp head or foliage. The pole default is 0.35 m wide and the trunk default is 0.5 m; `--pole-width` overrides either value.

Use `solid` for ordinary building/prop collision and `shell` only where a thin surface is the correct physical representation (fence rails or a vehicle body shell, for example). The converter supports GLB and glTF entry files; for glTF output, retain its generated `.bin` beside the `.gltf`. Supply a verified `--target-height` or `--scale` when the source unit is not metres; do not treat an unverified raw model height as a physical dimension.

**Important safeguards:**

- Check for existing `col_*`, `door_*`, `floor_*` and `stairs_*` nodes before replacing anything. Do not remove intentional authored proxies or named gameplay markers accidentally.
- Do not generate solid collision for road surfaces, foliage, modular bridge kits, modular road kits or visual-only pieces.
- Buildings must retain a clear walk-in aperture. The default converter excludes `door_*` geometry from solid collision.
- A tree uses trunk-only collision. A lamp uses a pole proxy. Do not make their entire visual bounds solid.
- Vehicle handling is configured separately in `js/vehicles.js` and Rapier. Do not treat the imported render mesh as the car's complete dynamic physics setup.
- If a sidecar `*_col.json` is used instead of embedded proxies, add its exact URL to `WORLD_KIT_COLLISION_SIDECARS` in `js/world-kit.js`. The current world loader recognises embedded `col_*` meshes directly.

After any collision generation, run the capture tool again and inspect the `collision` screenshot. Check for filled doorways, floating boxes, huge single blocks, missing floors, and collision on decorative details.

## 6. Place the asset in the world

Registration and placement are separate. A World Kit definition makes the asset recognisable; it does not automatically place it in the city.

For a city asset, add a deliberate entry to the appropriate `assets` list in `data/worlds/city-a.json` (or the relevant world JSON). Use the exact model path, position, yaw and calibrated size. Buildings normally use `building: true` and an explicit `targetH` in metres. Props should use a realistic `targetH` or an evidenced `unitScale`. Do not place the new asset until the scale, ground contact and collision profile are settled.

For an actual landmark, compare its shape against reference photographs of the real place before approving it. The generic mannequin/doorway references confirm scale; they do not validate architectural likeness.

## 7. Vehicle registration is a separate path

For a new car:

1. Store it under `data/models/cars/<vehicle-folder>/`.
2. Capture and inspect the same calibration screenshots.
3. Measure body length, ride height, wheelbase, track widths, tyre radii and wheel centres from the imported GLB.
4. Add the key to `CAR_MODELS` and its unique measured baseline to `CAR_PHYSICS` in `js/vehicles.js`.
5. Add the new vehicle to `tools/verify-vehicle-visuals.mjs` so the CI screenshots and wheel reports include it.
6. Inspect exterior, cabin, four wheel close-ups, steered front-wheel images and wheel grouping report.
7. Follow the detailed registration checklist in `tools/new-car.md`.

Never copy another vehicle's wheel dimensions, camera height or suspension values as if they were measurements for the new model.

## 8. Verification before calling it registered

- [ ] Original source and required support files are present; original is archived before any destructive processing.
- [ ] Creator/source and licence are recorded; add/update `ASSET_CREDITS.md` when attribution is required.
- [ ] All six saved calibration images exist and have been visually inspected; compound-kit component captures are also checked where applicable.
- [ ] Mesh names, separate components, orientation, footprint and ground contact are understood.
- [ ] At least one physical dimension is supported by a trusted reference, or the model is explicitly marked unverified.
- [ ] Any scale correction is uniform and recorded; final dimensions are in metres.
- [ ] World Kit definition is added with a truthful review state and collision profile.
- [ ] Collision capture has been inspected; doors/roads/foliage/kit parts retain their intended behaviour.
- [ ] City placement or vehicle registration is added separately.
- [ ] Runtime, world-kit and relevant physics/vehicle checks pass.

A new model becomes **registered** only after these checks. If it is awaiting trustworthy physical dimensions, it can be catalogued as **unverified**, but it must not be presented as calibrated.

## Current intake note

The next new model is part of this workflow. Its exact source file/path and reference dimensions have not yet been supplied in this registration record, so no scale or category is pre-assumed. When the model arrives, run the single-file capture command first, inspect the saved views, then complete its World Kit or vehicle registration and world placement.
