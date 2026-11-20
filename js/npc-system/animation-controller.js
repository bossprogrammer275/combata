import * as THREE from 'three';
import { loadNpcCoreClip, resolveNpcAnimationKey } from './core-assets.js';

const LOOPING = new Set(['idle','walk','walk_aim','run','rifle_run','sprint','ladder_climb_up','crouch_idle',
  'crouch_walk','crouch_walk_aim','rifle_aim_idle','crouch_aim_idle','sit_idle','vehicle_driver_idle']);

export class NpcAnimationController {
  constructor(mixer, root, options = {}) {
    this.mixer = mixer;
    this.root = root;
    this.fadeSeconds = Number.isFinite(options.fadeSeconds) ? options.fadeSeconds : 0.18;
    this.actions = new Map();
    this.currentAction = null;
    this.currentAnimation = '';
    this.requestedAnimation = '';
    this.requestId = 0;
    this.disposed = false;
    this.autoReturnActions = new Set([
      'wave', 'jump_idle', 'reload_idle', 'hard_landing',
      'hit_reaction', 'punch', 'block', 'obstacle_climb', 'knockdown_recovery_candidate'
    ]);
    this._onFinished = (event) => {
      if (this.disposed || event.action !== this.currentAction) return;
      if (this.autoReturnActions.has(this.currentAnimation)) {
        this.play('idle', { loop: true });
      }
    };
    this.mixer.addEventListener('finished', this._onFinished);
  }

  async play(requestedKey, options = {}) {
    const key = resolveNpcAnimationKey(requestedKey);
    if (!key || this.disposed) return false;
    if (key === 'jump_idle' && this.currentAnimation !== 'idle' && options.fromIdle !== true) return false;
    if (key === 'reload_idle' && options.standingIdle !== true) return false;
    if (this.currentAnimation === key && options.restart !== true) return true;
    if (this.requestedAnimation === key && options.restart !== true) return true;
    const requestId = ++this.requestId;
    this.requestedAnimation = key;
    let clip;
    try { clip = await loadNpcCoreClip(key); }
    catch (error) {
      if (requestId === this.requestId) this.requestedAnimation = '';
      console.warn('[NPC Core] Could not load animation ' + key, error);
      return false;
    }
    if (this.disposed || requestId !== this.requestId) return false;
    let action = this.actions.get(key);
    if (!action) {
      action = this.mixer.clipAction(clip, this.root);
      this.actions.set(key, action);
    }
    const previous = this.currentAction;
    action.reset();
    action.enabled = true;
    const loop = options.loop ?? LOOPING.has(key);
    action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
    action.clampWhenFinished = !loop;
    action.setEffectiveWeight(1);
    const scale = Number.isFinite(options.timeScale) ? options.timeScale : 1;
    action.setEffectiveTimeScale(key === 'ladder_climb_down_experiment' ? -Math.abs(scale) : scale);
    if (key === 'ladder_climb_down_experiment') action.time = clip.duration;
    else if (Number.isFinite(options.startAt)) action.time = THREE.MathUtils.clamp(options.startAt, 0, clip.duration);
    if (previous && previous !== action) previous.crossFadeTo(action, Math.max(0, options.fade ?? this.fadeSeconds), false);
    action.play();
    this.currentAction = action;
    this.currentAnimation = key;
    this.requestedAnimation = key;
    return true;
  }

  setTimeScale(value) {
    if (this.currentAction) this.currentAction.setEffectiveTimeScale(THREE.MathUtils.clamp(value, 0.2, 2));
  }
  setProfileFade(value) {
    if (Number.isFinite(value)) this.fadeSeconds = THREE.MathUtils.clamp(value, 0, 1);
  }
  update(dt) {
    if (!this.disposed && this.mixer && dt > 0) this.mixer.update(Math.min(dt, 0.05));
  }
  stop() {
    this.requestId++;
    this.requestedAnimation = '';
    this.currentAnimation = '';
    this.currentAction = null;
    this.mixer?.stopAllAction();
  }
  dispose() {
    if (this.mixer && this._onFinished) this.mixer.removeEventListener('finished', this._onFinished);
    this.disposed = true;
    this.stop();
    this.actions.clear();
    this.mixer = null;
    this.root = null;
  }
}
