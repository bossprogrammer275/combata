# Vehicle sound engines

Vehicle sound engines are independent Web Audio modules. Each module preserves the
sound design of its authored prototype and consumes live telemetry from the game.

## Add another vehicle

1. Create a module in this folder, for example `newCarEngine.js`.
2. Export a factory with this contract:

```js
import { createSoundEngineTools } from './soundEngineTools.js';

export function createNewCarEngine({ ctx, destination, noiseBuffer }) {
  const { G, F, O, N, SH, burst, tone, target } =
    createSoundEngineTools(ctx, noiseBuffer);

  // Build this vehicle's original oscillator/filter/effect graph here.
  // Connect its local master gain to destination.

  return {
    start(telemetry, { coldStart } = {}) {},
    update(telemetry) {},
    stop() {},
    dispose() { /* stop long-running oscillators and looping noise sources */ },
    setMix(key, value) {},
    getState() {},
  };
}
```

3. Register the factory in `js/soundEngineGlobal.js` under the vehicle's
   `CAR_MODELS` kind.
4. Add a source/physics assertion to `tools/verify-vehicles.mjs` and a browser
   graph smoke test to `tools/verify-vehicle-visuals.mjs`.

## Shared telemetry

`VehicleSystem.getEngineAudioState()` supplies the live state:

- `rpm`, `motorRpm`, `gear`, `shiftTimer`, `shiftDirection`
- `throttle`, `engineLoad`, `driveDemand`, `regenLevel`, `boost`
- `revLimiter`, `braking`, `handbrake`
- `speed`, `speedKph`, `lateralSpeed`, `slipRatio`
- `interior`, `surface`, plus vehicle-specific option fields

The global manager creates one engine instance per registered vehicle kind,
reuses it across entries, fades it on exit, and routes it through the game's
master volume bus. Every module shares the game's AudioContext and two-second
noise buffer. The authored module remains responsible for its own sound graph.

## Current registrations

| Vehicle kind | Module | Authored design |
|---|---|---|
| `lambo` | `gallardoV10.js` | Gallardo naturally aspirated V10, exhaust/intake layers, e-gear transients |
| `bugatti` | `chironW16.js` | Chiron W16, turbo whistle, blow-off valve, crackle and tunnel reverb |
| `cybertruck` | `cybertruckTriMotor.js` | Cyberbeast motor orders, inverter, tyres, wind, body, warning tone and regen |
| `escalade` | `escaladeV8.js` | Vortec 6000 V8 crank/firing orders, intake/exhaust, four-speed shifts, transmission, tyres and wind |

The graph builders and one-shot helpers are in `soundEngineTools.js`.
