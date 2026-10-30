# Adding a New Vehicle to STRIKE COMMAND

This is the required checklist for every incoming car. Do not copy another vehicle's tuning blindly: measure and calibrate the model, then give it its own profile.

## 1. Put the model in the correct place

Store the model and its textures under:

```text
data/models/cars/<vehicle-folder>/
```

Prefer a self-contained GLB. For a GLTF with external buffers or textures, keep the folder structure intact and check every referenced file is included.

The model should use metres where possible, have its wheels touching the ground, and have a clear front direction. STRIKE COMMAND normalises the vehicle's longest horizontal body dimension using `targetLen`, so do not try to fix an incorrect length using non-uniform scale.

## 2. Register the model and its physics profile

Add a unique key to `CAR_MODELS` in `js/vehicles.js`:

```js
mycar: {
  url: './data/models/cars/mycar/scene.glb',
  targetLen: 4.6,  // measured body length in metres
  color: 0x334455,
  nose: 1,          // +1 if the model nose is local +Z; -1 if local -Z
},
```

Add a separate entry to `CAR_PHYSICS`. The example below is a starting shape, not a tuning preset to reuse unchanged:

```js
mycar: {
  mass: 1450,
  drivetrain: 'rwd', // 'fwd', 'rwd' or 'awd'
  wheelbase: 2.65,
  powertrain: {
    type: 'dct',     // use 'ev' for a single-speed electric vehicle
    gearRatios: [3.1, 2.2, 1.6, 1.2, 0.95, 0.78],
    finalDrive: 3.4,
    wheelRadius: 0.33,
    idleRpm: 850,
    redline: 7000,
    upshiftRpm: 6700,
    downshiftRpm: 2300,
    shiftTime: 0.16,
    peakTorqueNm: 500,
    maxAcceleration: 10.5,
    torqueCurve: [[850, 260], [2000, 380], [4000, 500], [6000, 460], [7000, 400]],
  },
  interiorCamera: {
    height: 1.08,
    forward: 0.20,
    side: 0,
    lookAhead: 18,
    pitch: 0,
    fov: 82,
  },
  steeringWheel: {
    axis: 'x',          // or 'y', 'z'; use Asset Lab's Auto option to infer
    maxAngleDeg: 450,   // total lock-to-lock angle, not degrees per side
    sign: 1,            // change to -1 if the wheel turns the wrong way
    response: 10,
  },
  // Add this vehicle's own braking, grip, suspension, drag,
  // steering response, anti-roll and drivetrain settings here.
},
```

Set a real vehicle-specific mass, drivetrain, powertrain and tyre/suspension tune. An EV profile needs its motor torque/power curve and regenerative braking. A combustion profile needs its engine torque curve, gear ratios, final drive and shift behaviour.

## 3. Calibrate the driver's interior camera

Open the game, press **F6** to open Asset Lab, or visit `/tools/asset-lab.html` directly.

Use the **Load car** field to paste a model path, for example:

```text
/data/models/cars/mycar/scene.glb
```

The interior camera's `height` is the driver's eye height measured up from the vehicle's ground/tyre contact level. It is not the roof height and must not be shared between cars with different ride heights and cabin proportions. Asset Lab fits the preview vehicle to the **Target body length** field before showing Cabin view, so adjust that length first; then tune eye height and seat offsets in the fitted model space.

Current calibrated starting points:

| Vehicle | Interior camera height |
|---|---:|
| Lamborghini | 0.98 m |
| Tesla Cybertruck | 1.42 m |
| Bugatti profile | 1.04 m |

The Lamborghini is a low sports-car cabin. The Cybertruck has a taller pickup cabin, so its camera is deliberately 0.40 m higher than the Lamborghini. Keep these values separate.

In Asset Lab, use **Cabin view** and tune:

- Height: eye position above the road.
- Forward: seat position along the car's length.
- Side: driver offset from the vehicle centreline.
- Look-ahead: distance toward the windscreen.
- Pitch and FOV: view angle and lens.

Save the override. Runtime loads the saved per-model camera profile. A saved override takes precedence over the default in `CAR_PHYSICS`.

For in-game fine tuning, enter the vehicle, press **Esc → COCKPIT ADJUSTMENTS**, and adjust Forward/Backward, Height, Left/Right, Look Up/Down and Look Left/Right. These values are saved per vehicle type in the player's local settings and are applied on top of the model's calibrated base profile. **V** still switches between chase and cockpit view. Reset This Vehicle restores that vehicle's calibrated defaults.

The in-game position sliders move the virtual driver viewpoint. They do not deform or physically translate a seat mesh in the GLB; model geometry must be edited separately when the actual seat needs repositioning.

## 4. Cabin geometry and lighting

A camera and a light cannot create a missing interior. The GLB itself needs real cabin geometry if the driver is expected to see a detailed steering wheel, dashboard, display, seats, centre console, pedals, door cards and windscreen framing.

STRIKE COMMAND uses two restrained, warm/cool fill lights only while the interior camera is active. They are intentionally low intensity. Do not increase them to compensate for missing cabin meshes: that just makes the interior look white and washed out.

Inspect the actual cabin in Asset Lab. If the model has no usable interior, source or author an interior mesh and integrate it with the body model before tuning the light.

## 5. Find and animate the four road wheels

The game builds four separate road-wheel rigs from the GLB meshes. The detector looks for tyre-like dimensions, low placement and positions near the vehicle's outer left/right edges. It also rejects meshes whose node hierarchy identifies steering, dashboard, cockpit, seats, instruments, pedals or interior pieces.

Check all four detected wheel pivots:

- One at each corner, not at the vehicle centreline.
- Correct tyre radius and axle orientation.
- Tyre, rim and hub components move together.
- Only the front axle steers; rear wheels do not gain steering angles.
- Wheel spin follows vehicle travel distance and each tyre's measured radius.

Do not loosen the detector's rules just to force four results. If a model has unusual wheel naming or split geometry, correct the asset hierarchy or add a vehicle-specific classification rule and verify it against the real model.

## 6. Find and animate the steering wheel

The steering wheel is **not** one of the four road wheels. It must have a separate pivot and must never be placed inside a tyre spinner.

### Automatic detection

The runtime recognises clearly named nodes such as:

- `SteeringWheel`
- `steering_wheel`
- `steering-wheel`
- `wheel_steering`

The detector uses the complete node hierarchy and keeps the steering assembly out of the road-wheel classifier.

### Manual calibration in Asset Lab

Some GLBs use generic names such as `Object_37` or split the rim, spokes and hub across several unnamed meshes.

1. Select the car and inspect the mesh list.
2. Choose the actual steering-wheel rim mesh, then press **Use selected mesh**.
3. Add separate spokes or hub meshes with **Add selected part**. Do not add the dashboard or steering column unless they are physically part of the rotating wheel assembly.
4. Select the pivot axis. For a normal upright steering wheel, the axis is usually the vehicle's left-to-right axis. Use **Auto** if the wheel's thinnest dimension identifies that axis correctly.
5. Set the lock-to-lock rotation. 450° means ±225° from centre; tune to the source vehicle and model scale.
6. Move the preview slider left and right. Check that only the steering wheel assembly rotates around its hub.
7. Set **Rotation direction** to Reverse if left/right steering is inverted.
8. Save overrides.

The saved configuration is attached to that model's path in `data/asset-overrides.json`. The game builds a pivot around the selected mesh bounds and animates it from the smoothed steering input. Its movement is independent from tyre spin and front-wheel Ackermann steering.

If the preview rotates the wrong part, clear the rig and select the correct mesh. Do not animate the whole dashboard parent.

## 7. Test before adding the car to the world

Run these checks after registering the model:

```bash
node tools/verify-vehicles.mjs
node tools/verify-collisions.mjs
node --check js/vehicles.js
node --check tools/asset-lab.js
```

The vehicle verification checks model dimensions, grounding, four wheel pivots, tyre attachment, collision boxes, vehicle-specific physics and the individual interior-camera heights. It also checks an automatically detected steering-wheel pivot when one is available. If the model has no confidently named steering wheel, complete the manual Asset Lab rig and then test it in-game.

The GitHub Actions **Game physics verification** workflow also runs on pushes to `main`.

Only after these checks pass should the vehicle be added to a world spawn list. Do not modify `data/worlds/city-a.json` just to calibrate the model; car setup belongs in the model/profile and asset override layers.

## 8. Final acceptance checklist

- [ ] Model path, textures and licence/source are recorded.
- [ ] `CAR_MODELS` entry has the correct length and nose direction.
- [ ] Its own `CAR_PHYSICS` entry is tuned.
- [ ] Interior camera height is measured and unique to the vehicle.
- [ ] Cabin geometry is present and inspected; lighting is subtle.
- [ ] Four road-wheel pivots are correct and all tyre components move together.
- [ ] Steering wheel has a separate pivot, axis, lock-to-lock angle and direction.
- [ ] Collision boxes do not include loose tyre or steering-wheel geometry.
- [ ] Vehicle verification and collision verification pass.
- [ ] Only then add a spawn entry to a world.
