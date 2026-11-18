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

The capture runner loads the actual file through the project's Three.js GLTFLoader, calculates its source bounds and saves five views:

- `iso`: overall shape and assembly.
- `front`: front-facing proportions.
- `side`: height, length and silhouette.
- `top`: footprint, width and orientation.
- `collision`: generated `col_*` proxy meshes without the visual meshes.

Each image includes physical reference objects beside the model: a **1.8 m human**, **1.0 m × 2.1 m doorway**, **1 m cube**, **10 m pole**, axis marker and metre grid.

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
```

The assistant must open and visually inspect these saved images, not rely only on the JSON dimensions. Inspect the overall model, its front/side/top proportions, the ground contact, the origin/orientation, separate subcomponents and the collision view. For a compound pack, inspect each relevant component separately before treating it as a reusable kit.

The capture report labels every raw model as **unverified**. It does not auto-correct scale. After inspection, compare at least one axis against a trusted physical reference: a documented product dimension, a known real object in an authoritative photo, a measured source component, or confirmed creator metadata. Record the reference and its source in the calibration result.

If no reliable physical dimension exists, keep the measurement as *unverified*, state the plausible range, and do not silently set a permanent scale correction. Ask for a source/reference only when the decision cannot be grounded from the available model and evidence.

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
node js/utils/make-collision.js <model.glb> --mode solid --replace --rename
node js/utils/make-collision.js <model.glb> --mode shell --replace
```

Use `solid` for ordinary building/prop collision and `shell` only where a thin surface is the correct physical representation (vehicle body shell, for example). The converter supports GLB and glTF entry files; small assets are supported too. For glTF output, retain its generated `.bin` beside the `.gltf`.

**Important safeguards:**

- Check for existing `col_*`, `door_*`, `floor_*` and `stairs_*` nodes before replacing anything. Do not remove intentional authored proxies or named gameplay markers accidentally.
- Do not generate solid collision for road surfaces, foliage, modular bridge kits, modular road kits or visual-only pieces.
- Buildings must retain a clear walk-in aperture. The default converter excludes `door_*) geometry from solid collision.
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
- [ ] All five saved calibration images exist and have been visually inspected.
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
