// Global router for authored vehicle sound engines.
// Each car's oscillator/filter design lives in its own reusable module. This
// class owns the shared AudioContext routing and selects the matching module.
import { createGallardoV10Engine } from './vehicle-sounds/gallardoV10.js';
import { createChironW16Engine } from './vehicle-sounds/chironW16.js';
import { createCybertruckTriMotorEngine } from './vehicle-sounds/cybertruckTriMotor.js';
import { createEscaladeV8Engine } from './vehicle-sounds/escaladeV8.js';

export const VEHICLE_SOUND_ENGINES = Object.freeze({
  lambo: createGallardoV10Engine,
  bugatti: createChironW16Engine,
  cybertruck: createCybertruckTriMotorEngine,
  escalade: createEscaladeV8Engine,
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
    this.mixProfiles = new Map();
    this.environments = new Map();
    this.warningToneEnabled = true;
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
    const mix = this.mixProfiles.get(kind);
    if (mix) for (const [key, value] of Object.entries(mix)) engine.setMix?.(key, value);
    if (kind === 'cybertruck') engine.setWarningTone?.(this.warningToneEnabled);
    if (this.environments.has(kind)) engine.setEnvironment?.(this.environments.get(kind));
    this.modules.set(kind, engine);
    return engine;
  }

  _releaseActive() {
    if (this.active) {
      const kind = this.activeKind;
      this.active.stop();
      this.active.dispose?.();
      if (kind) this.modules.delete(kind);
    }
    this.active = null;
    this.activeKind = null;
    this.activeVehicle = null;
  }

  update(vehicle, telemetry = {}) {
    if (!vehicle || !vehicle.kind || !telemetry) {
      this.stop();
      return false;
    }
    const kind = vehicle.kind;
    if (this.activeVehicle !== vehicle || this.activeKind !== kind) {
      this._releaseActive();
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
    this._releaseActive();
  }

  setMix(kind, key, value) {
    const profile = this.mixProfiles.get(kind) || {};
    profile[key] = value;
    this.mixProfiles.set(kind, profile);
    const engine = this.modules.get(kind);
    if (engine) engine.setMix?.(key, value);
    return true;
  }

  setWarningTone(enabled) {
    this.warningToneEnabled = !!enabled;
    const engine = this.modules.get('cybertruck');
    if (engine) engine.setWarningTone?.(this.warningToneEnabled);
    return true;
  }

  setEnvironment(kind, environment) {
    this.environments.set(kind, environment);
    const engine = this.modules.get(kind);
    if (engine) engine.setEnvironment?.(environment);
    return true;
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
