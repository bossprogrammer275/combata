// Global router for authored vehicle sound engines.
// Each car's oscillator/filter design lives in its own reusable module. This
// class owns the shared AudioContext routing and selects the matching module.
import { createGallardoV10Engine } from './vehicle-sounds/gallardoV10.js';
import { createChironW16Engine } from './vehicle-sounds/chironW16.js';
import { createCybertruckTriMotorEngine } from './vehicle-sounds/cybertruckTriMotor.js';

export const VEHICLE_SOUND_ENGINES = Object.freeze({
  lambo: createGallardoV10Engine,
  bugatti: createChironW16Engine,
  cybertruck: createCybertruckTriMotorEngine,
});

export class SoundEngineGlobal {
  constructor({ ctx, destination, noiseBuffer }) {
    if (!ctx || !destination || !noiseBuffer) {
      throw new Error('[SoundEngineGlobal] AudioContext, destination and noise buffer are required');
    }
    this.ctx = ctx;
    this.destination = destination;
    this.noiseBuffer = noiseBuffer;
    this.modules = new Map();
    this.startedVehicles = new WeakSet();
    this.active = null;
    this.activeKind = null;
    this.activeVehicle = null;
  }

  _getModule(kind) {
    if (this.modules.has(kind)) return this.modules.get(kind);
    const factory = VEHICLE_SOUND_ENGINES[kind];
    if (!factory) {
      console.warn('[SoundEngineGlobal] No vehicle sound engine registered for:', kind);
      return null;
    }
    const engine = factory({
      ctx: this.ctx,
      destination: this.destination,
      noiseBuffer: this.noiseBuffer,
    });
    this.modules.set(kind, engine);
    return engine;
  }

  update(vehicle, telemetry = {}) {
    if (!vehicle || !vehicle.kind || !telemetry) {
      this.stop();
      return false;
    }
    const kind = vehicle.kind;
    if (this.activeVehicle !== vehicle || this.activeKind !== kind) {
      if (this.active) this.active.stop();
      const engine = this._getModule(kind);
      if (!engine) {
        this.active = null;
        this.activeKind = null;
        this.activeVehicle = null;
        return false;
      }
      const coldStart = !this.startedVehicles.has(vehicle);
      engine.start(telemetry, { coldStart });
      this.startedVehicles.add(vehicle);
      this.active = engine;
      this.activeKind = kind;
      this.activeVehicle = vehicle;
    }
    this.active.update(telemetry);
    return true;
  }

  stop() {
    if (this.active) this.active.stop();
    this.active = null;
    this.activeKind = null;
    this.activeVehicle = null;
  }

  setMix(kind, key, value) {
    const engine = this.modules.get(kind);
    return engine ? engine.setMix?.(key, value) ?? false : false;
  }

  setWarningTone(enabled) {
    const engine = this.modules.get('cybertruck');
    return engine?.setWarningTone?.(enabled) ?? false;
  }

  setEnvironment(kind, environment) {
    const engine = this.modules.get(kind);
    return engine?.setEnvironment?.(environment) ?? false;
  }

  getActiveState() {
    return this.active?.getState?.() || null;
  }

  dispose() {
    this.stop();
    for (const engine of this.modules.values()) engine.stop?.();
    this.modules.clear();
  }
}

export default SoundEngineGlobal;
