# Adding a New Vehicle to OPEN WORLD

This is the required checklist for every incoming car. Do not copy another vehicle's tuning blindly: measure and calibrate the model, then give it its own profile.

## 1. Put the model in the correct place

Store the model and its textures under:

```text
data/models/cars/<vehicle-folder>/
```

Prefer a self-contained GLB. For a GLTF with external buffers or textures, keep the folder structure intact and check every referenced file is included. Vehicle-local axes are +Y up, +Z forward and +X left; the loader applies a model's nose correction once at the root.

The model should use metres where possible, have its wheels touching the ground, and have a clear front direction. OPEN WORLD normalises the vehicle's longest horizontal body dimension using `targetLen`, so do not try to fix an incorrect length using non-uniform scale.

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

Add a separate entry to `CAR_PHYSICS`. The example below is a starting shape, not a tuning preset to reuse unchanged. Measure the front/rear track widths and tyre radii from the imported GLB; the loader checks them against this profile before spawning the car:

```js
mycar: {
  mass: 1450,
  drivetrain: 'rwd', // 'fwd', 'rwd' or 'awd'
  wheelbase: 2.65,
  trackFront: 1.58,
  trackRear: 1.58,
  wheelRadiusFront: 0.32,
  wheelRadiusRear: 0.32,
  weightFront: 0.50,
  centerOfMassHeight: 0.52,
  inertiaScale: 0.85,
  brakeBias: 0.60,
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
    maxAngleDeg: 450,   // interior steering wheel total lock-to-lock angle
    sign: 1,            // change to -1 if the wheel turns the wrong way
    response: 10,
  },
  steeringControl: {
    sensitivity: 1.0,   // driver input gain, not physical wheel angle
    range: 1.0,         // fraction of this car's calibrated safe road-wheel lock
    digitalHoldTime: 0.75, // seconds to build from a short tap to full requested range
    digitalHoldCurve: 1.6,  // bounded ease-in; sustained holds become progressively sharper
    deadzone: 0.02,
    returnResponse: 12,
  },
  // Physical road-wheel response remains separate and car-specific.
  steeringAngle: 0.5,  // maximum front tyre angle in radians
  handbrakeSteerAngle: 0.45,
  steeringResponse: 12,
  speedSteeringFalloff: 0.008,
  minSteeringScale: 0.4,
  // Add this vehicle's own braking, grip, suspension, drag,
  // anti-roll and drivetrain settings here.
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

Current calibrated starting points for the two registered vehicle assets:

| Vehicle | Interior camera height |
|---|---:|
| Lamborghini | 0.98 m |
| Tesla Cybertruck | 1.42 m |

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

OPEN WORLD uses two restrained, warm/cool fill lights only while the interior camera is active. They are intentionally low intensity. Do not increase them to compensate for missing cabin meshes: that just makes the interior look white and washed out.

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

### Mandatory wheel-detector screenshot calibration

**Do this for every incoming vehicle before accepting its four wheel pivots.** Do not use another car's wheel dimensions as a universal threshold. The Tesla Cybertruck's tyre/wheel assembly is larger and split across more GLB meshes than the sports-car asset, so its mesh-member grouping has to be evaluated against its own screenshots and measurements.

1. Register the new model in `CAR_MODELS` and add its vehicle key to the `configs` array in `tools/verify-vehicle-visuals.mjs` with its own target camera height and screenshot prefix.
2. Install Chromium once, then run the same real-model visual test used in CI:

   ```bash
   pnpm exec playwright install chromium
   node tools/verify-vehicle-visuals.mjs
   ```

3. Open the generated wheel screenshots under `artifacts/vehicle-visual-test/`. For every vehicle, the test captures:
   - `<vehicle>-wheel-detector-overview.png`: all four detected wheel groups outlined on the actual car.
   - `<vehicle>-wheel-front-left.png`, `-front-right.png`, `-rear-left.png`, and `-rear-right.png`: a close-up of each detected corner.
   - `<vehicle>-report.json`: measured wheel bounds, centres, selected mesh names, attached mesh counts, and detector limits.
4. Check that each coloured outline follows the tyre tread/sidewall and its rim/hub, not the fender, bumper, underbody or nearby suspension/body panel. Confirm that exactly one wheel is selected in each of the four corners and that every wheel's split meshes stay together.
5. If any tyre mesh is missing, use the report's candidate size, centre and rejection reason to identify which limit excluded it. Tune `wheelCandidateMaxSize`, `wheelMemberMaxSize`, `wheelMemberRadius` or `wheelMemberHeightTolerance` in `getWheelClassificationOptions(kind)` for that vehicle only. Do **not** raise the global threshold to accommodate a larger Tesla wheel; that can make body panels look like wheels on smaller cars.
6. Some models split the tread/sidewall into dozens or hundreds of tiny meshes. Do not rely only on 3D distance from the hub: inspect radial distance in the wheel plane and offset along the axle separately. Add a narrowly scoped fragment rule using wheel-plane radius, axle offset and a strict maximum fragment size. This catches circumference segments without admitting larger fender/body panels.
7. Re-run the visual test and inspect the new overview, all four close-ups and steered front-wheel screenshots. Confirm that the complete tyre circumference turns with the wheel. A stationary outline means the wheel grouping is still incomplete.

Measured reference from the current bundled models:

| Model | Detected tyre diameter (approx.) | Per-model wheel-member radius |
|---|---:|---:|
| Lamborghini | 0.66–0.70 m | 0.30 m |
| Tesla Cybertruck | 0.90–0.92 m | 0.45 m |

The Cybertruck's normalized selected wheel bounds are approximately **0.444 × 0.923 × 0.900 m**. Its four larger split tyre/rim components sit about **0.393–0.422 m** from each hub and use the model-specific **0.45 m** hub radius. The asset also has **120 small circumference fragments per wheel**. Their centres sit about **0.434–0.473 m** from the wheel centre in the wheel plane, with each fragment smaller than **0.16 m**. Attach these using a wheel-plane radial band (**0.88–1.12×** the measured wheel radius) and an axle-offset tolerance, rather than widening the 3D hub radius. Each Cybertruck wheel should therefore contain at least **132 meshes**: 12 hub/tyre pieces plus 120 tread fragments. The larger rear body/fender meshes stay excluded. Keep `wheelMemberMaxSize: 1.15` and `wheelMemberHeightTolerance: 1.05` as separate safeguards; do not raise generic limits for every vehicle.

The CI workflow uploads these temporary screenshots and reports as a one-day artifact. The local run writes them only to `artifacts/vehicle-visual-test/`; delete that folder when the review is complete.

## 6. Steering system, driver input, POV and animation

Steering is not one sensitivity number. Every vehicle must be calibrated as four connected layers:

1. **Driver input** — keyboard, gamepad, touch buttons or a virtual steering control.
2. **Steering control** — sensitivity, usable steering range, hold-duration curve, deadzone, smoothing and return-to-centre.
3. **Physical handling** — road-wheel lock, Ackermann geometry, tyre grip, yaw response, suspension and speed-dependent steering authority.
4. **Visual and camera feedback** — front wheel pivots, the interior steering wheel, the driver's hands when the rig supports them, and the first-person point of view (POV).

Keep the shared steering controller in the vehicle-control layer (currently `js/vehicle-steering.js` and `js/vehicles.js`). Put each car's calibrated values in its own `CAR_PHYSICS` profile. The steering controller must not be duplicated in individual sound files. The global sound manager may read the resolved steering, speed and slip telemetry for tyre audio, but audio must never drive or override vehicle steering.

### 6.1 Steering values must have separate jobs

Do not mix these measurements:

- **Sensitivity** (`steeringSensitivity`): how strongly the controller responds to the driver's requested input. It controls input gain/feel, not physical geometry.
- **Usable steering range** (`steeringRange`): the fraction of the car's calibrated safe road-wheel lock available to the current control. A value of 1.0 exposes the full calibrated range; lower values make the controls less aggressive. Clamp it to 0..1.
- **Road-wheel maximum angle** (`steeringAngle`): the physical maximum front-tyre angle in radians. This is tuned for the actual vehicle, wheelbase, track, tyres and handling. It must not be changed just because a player changes sensitivity.
- **Steering-wheel lock-to-lock angle** (`steeringWheel.maxAngleDeg`): the visible interior steering wheel's total rotation from full left to full right. It is not the road-wheel angle.
- **Steering response** (`steeringResponse`): how quickly the physical steering state follows the resolved command.
- **Return response** (`steeringReturnResponse`): how quickly the controls and visible wheel return to centre after release.
- **Speed shaping** (`speedSteeringFalloff` and `minSteeringScale`): how steering authority is reduced progressively at speed while preserving useful low-speed manoeuvring.
- **Handbrake steering** (`handbrakeSteerAngle`): a separate controlled behaviour. Do not silently add handbrake steering lock to normal cornering.

Track width is the measured distance between left and right wheel centres. It is a physical dimension, not a sensitivity or steering-range setting. Never alter wheelbase or track to make steering feel sharper.

A useful starting configuration shape is:

```js
steeringControl: {
  sensitivity: 1.0,
  range: 1.0,                // fraction of calibrated safe road-wheel lock
  digitalHoldTime: 0.75,     // seconds to build from a gentle tap to full request
  digitalHoldCurve: 1.6,     // bounded ease-in curve for keyboard / discrete buttons
  deadzone: 0.02,
  returnResponse: 12,
},
```

Treat these as per-vehicle starting values, not universal final tuning. A heavy pickup, a sports car and a hypercar should not automatically feel identical.

### 6.2 Short taps and long holds must feel different

Keyboard steering and discrete left/right buttons must be duration-aware:

- A short tap requests a small steering angle. It must not jump instantly to full lock.
- Holding the same direction progressively builds steering angle, making the turn sharper over the configured hold period.
- The hold curve must be smooth, bounded and frame-rate independent. Use elapsed hold time and `dt`; do not depend on keyboard auto-repeat.
- Once the requested steering range is reached, the value must plateau. Holding longer must never increase the angle beyond the selected range or the car's physical road-wheel limit.
- Releasing the key or button smoothly returns the requested angle to centre.
- Switching from left to right must pass through centre smoothly rather than snapping across.
- Reset hold timers when input is released, focus is lost, the game pauses, the player exits the vehicle, or the requested direction changes.
- Pressing throttle and steering together must remain supported. Steering logic must not block simultaneous drive inputs.

Tune `digitalHoldTime` and `digitalHoldCurve` per vehicle. A shorter hold time makes steering build faster; a longer one gives the driver finer control. A stronger ease-in curve keeps the first part of a press gentle and makes a sustained hold progressively sharper. Do not create unbounded accumulation or make the car spin harder simply because a key has been held for several seconds.

### 6.3 Analog steering must stay truly analog

Gamepad sticks and position-based touch/virtual-wheel controls already provide a continuous steering value:

- Map the live axis or pointer position directly to -1..1.
- Apply sensitivity, usable range and deadzone, then smooth the result.
- Do not apply the digital hold-duration ramp to an analog input. A small steady stick or drag angle must remain a small steady steering request for as long as it is held.
- After deadzone removal, remap the remaining range so full stick travel can still reach the selected steering limit.
- Clamp the final input and preserve the game's established convention: positive `right` input means a right turn.

All input methods must feed one shared, resolved steering command. Avoid separate calculations for keyboard physics, gamepad visuals, tyre angle and steering-wheel animation.

### 6.4 Physical handling and wheel geometry

- Calculate inner and outer front-wheel angles using Ackermann geometry from the measured wheelbase and front track. The inside front wheel must turn more sharply than the outside front wheel in either direction.
- Only the front axle steers by default. Rear-wheel steering is allowed only for a vehicle whose real configuration and model support it, with its own explicit low/high-speed tuning. Never enable four-wheel steering by default.
- Keep measured wheelbase, front/rear track and tyre radii tied to GLB wheel hardpoints. Do not move wheel meshes or fake steering by changing dimensions.
- Feed the same final clamped steering state into physics, wheel visuals, cockpit wheel animation and telemetry. The left and right tyres may have different Ackermann angles, but must share the same central steering request.
- At parking speeds, allow the vehicle's calibrated safe lock. As speed rises, reduce steering authority smoothly; do not use abrupt speed thresholds.
- Steering must work with tyre grip, lateral velocity, suspension, mass distribution, yaw damping and drivetrain load. Do not rotate the vehicle heading directly from input while bypassing tyre forces.
- Do not add automatic drifting, unexplained left/right yaw bias or unstable steering at maximum speed.
- Test forward and reverse steering against actual vehicle motion.

### 6.5 Animate the interior steering wheel

The steering wheel is a separate rig from the four road-wheel spinners. It must never be included in a tyre spinner or a whole-dashboard transform.

The runtime recognises named nodes such as `SteeringWheel`, `steering_wheel`, `steering-wheel` and `wheel_steering`. If names are generic or the rim is split across meshes, use Asset Lab's manual mesh selection and saved override:

1. Select the actual steering-wheel rim mesh.
2. Add only the spokes and hub that physically rotate with the rim. Do not include the dashboard, seats or fixed steering-column base.
3. Set the real pivot at the centre of the steering wheel.
4. Calibrate the rotation axis, left/right sign and total lock-to-lock angle.
5. Move the preview left and right and confirm that the correct assembly rotates without wobble, offset or clipping.
6. Save the model-specific override and verify it again in the running game.

The visible wheel must follow the final smoothed steering state, not raw keydown events. Its animation should have its own calibrated steering ratio and response, smoothly recentre after release, and stay synchronized with the front tyres. Steering rotates the wheel around its steering axis; travel distance spins the tyres. These are two different motions.

If the character model has a usable hand/arm rig, add restrained hand placement or IK so the driver's hands follow the steering wheel without sliding, stretching or clipping. Do not fake steering by rotating the entire player model. If the character rig cannot support reliable hand animation, keep the steering-wheel animation correct instead of adding visibly broken hand motion.

### 6.6 First-person POV and camera response

Test each car in both chase view and cockpit/POV view:

- Calibrate the driver's eye position, seat forward/back, side offset, look-ahead, pitch and FOV to that specific cabin.
- In POV, the driver must be able to see the road and a useful portion of the steering wheel/dashboard. The wheel must visibly turn in the correct direction and by the correct amount.
- Steering-wheel and camera updates must use the same resolved steering state as the physics. Do not make the wheel visibly lag far behind the road response.
- Cornering camera feedback, if used, must be subtle and derived from actual lateral acceleration or chassis roll. Do not fake turning by swinging the camera independently of the vehicle.
- Keep horizon movement and camera roll restrained. Do not add large screen shake or artificial horizon tilt during ordinary steering.
- Free-look must remain independent of steering. Mouse look must not be overwritten by steering input, and the camera must not snap back while the player is actively looking around.
- Verify POV while stationary, turning left/right, changing lanes, braking into a bend, accelerating out of a bend and reversing.

### 6.7 Steering acceptance tests for every car

Record the results for each vehicle:

1. Neutral input holds a straight line without unexplained yaw.
2. A short left/right tap causes a small correction, not instant full lock.
3. A longer hold progressively sharpens the turn, reaches a stable cap and never exceeds the calibrated road-wheel limit.
4. Releasing input smoothly recentres the steering control, front tyres and steering wheel.
5. Reversing from left to right passes through centre without snapping or a sudden yaw impulse.
6. A small analog stick/drag input remains a small, steady angle; no digital hold ramp is applied.
7. Left and right turns are mirrored, and the inner front tyre turns more than the outer tyre.
8. Steering authority reduces progressively with speed and remains predictable in the high-speed test.
9. The rear wheels remain straight unless the vehicle has an explicitly calibrated rear-steer system.
10. The cockpit steering wheel, front tyre angles and physical vehicle response agree in POV and chase views.
11. Free-look remains controllable during cornering, and camera feedback does not hide the road or destabilize the horizon.
12. The car remains stable during forward/reverse transitions and does not develop automatic drift or speed-induced steering oscillation.

## 7. Test before adding the car to the world

Run these checks after registering the model:

```bash
node tools/verify-vehicles.mjs
node tools/verify-collisions.mjs
node --check js/vehicles.js
node --check tools/asset-lab.js
```

The vehicle verification checks model dimensions, grounding, four wheel pivots, tyre attachment, collision boxes, profile mass/centre of mass, fixed 120 Hz stepping, a 60-second straight-line symmetry run, mirrored left/right turns, vehicle-specific physics and cockpit heights. It also checks an automatically detected steering-wheel pivot when one is available. If the model has no confidently named steering wheel, complete the manual Asset Lab rig and then test it in-game.

The GitHub Actions **Game physics verification** workflow also runs on pushes to `main`.

Use **F9** in-game to display the fitted chassis collider and four live suspension rays while calibrating. Only after these checks pass should the vehicle be added to a world spawn list. Do not modify `data/worlds/city-a.json` just to calibrate the model; car setup belongs in the model/profile and asset override layers.

## 8. Final acceptance checklist

- [ ] Model path, textures and licence/source are recorded.
- [ ] `CAR_MODELS` entry has the correct length and nose direction.
- [ ] Its own `CAR_PHYSICS` entry is tuned.
- [ ] Interior camera height is measured and unique to the vehicle.
- [ ] Cabin geometry is present and inspected; lighting is subtle.
- [ ] Four road-wheel pivots are correct and all tyre components move together.
- [ ] Steering wheel has a separate pivot, axis, lock-to-lock angle and direction.
- [ ] Sensitivity, usable steering range, hold duration/curve, deadzone and return response are tuned.
- [ ] Short taps, long digital holds and analog partial steering behave correctly.
- [ ] Ackermann, speed-sensitive steering and forward/reverse handling pass the steering tests.
- [ ] POV steering-wheel animation and camera response are calibrated and verified.
- [ ] Collision boxes do not include loose tyre or steering-wheel geometry.
- [ ] Vehicle verification and collision verification pass.
- [ ] Only then add a spawn entry to a world.
