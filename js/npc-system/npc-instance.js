import * as THREE from 'three';
import { loadNpcCoreBase, cloneNpcCoreModel, preloadNpcCoreAnimations } from './core-assets.js';
import { NPC_PROFILES, NPC_SYSTEM_CONFIG } from './profile-registry.js';
import { NpcAnimationController } from './animation-controller.js';

export async function preloadNpcBase() {
  return loadNpcCoreBase();
}
export async function preloadNpcAnimations(_modelId, keys = ['idle','walk','run','sprint','crouch_idle','crouch_walk','wave']) {
  return preloadNpcCoreAnimations(keys);
}

export class NpcInstance {
  constructor(profileId = NPC_SYSTEM_CONFIG.defaultProfile) {
    this.profile = NPC_PROFILES[profileId] || NPC_PROFILES[NPC_SYSTEM_CONFIG.defaultProfile];
    this.modelId = this.profile.modelId;
    this.root = new THREE.Group();
    this.root.name = 'NPC_' + this.profile.id + '_' + this.modelId;
    this.model = null;
    this.mixer = null;
    this.animation = null;
    this.ready = this._build();
  }
  async _build() {
    const base = await loadNpcCoreBase();
    this.model = cloneNpcCoreModel(base);
    this.root.add(this.model);
    this.mixer = new THREE.AnimationMixer(this.model);
    this.animation = new NpcAnimationController(this.mixer, this.model, {
      fadeSeconds: NPC_SYSTEM_CONFIG.animation.defaultFadeSeconds
    });
    await this.animation.play('idle', { loop: true });
    return this;
  }
  get currentAnimation() {
    return this.animation?.requestedAnimation || this.animation?.currentAnimation || '';
  }
  async play(key, options = {}) {
    await this.ready;
    const aliases = { fall_death: 'death_candidate', jump: 'jump_idle', crouch: 'crouch_idle',
      crouchWalk: 'crouch_walk', sitIdle: 'sit_idle', get_up: 'knockdown_recovery_candidate' };
    const normalized = aliases[key] || key;
    const basic = ['idle','walk','run','sprint','crouch_idle','crouch_walk','sit_idle','wave','death_candidate','jump_idle','knocked_down','obstacle_climb','ladder_climb_up'];
    if (!this.profile.allowedActions.includes(normalized) && !basic.includes(normalized)) return false;
    return this.animation.play(normalized, options);
  }
  setTimeScale(value) { this.animation?.setTimeScale(value); }
  setProfile(profileId) {
    const next = NPC_PROFILES[profileId];
    if (!next) return false;
    this.profile = next;
    this.root.name = 'NPC_' + next.id + '_' + this.modelId;
    this.animation?.setProfileFade(NPC_SYSTEM_CONFIG.animation.defaultFadeSeconds);
    if (!next.allowedActions.includes(this.currentAnimation)) this.play('idle', { loop: true });
    return true;
  }
  update(dt) { this.animation?.update(dt); }
  dispose() {
    this.animation?.dispose();
    // Instance materials are unique; the base mesh geometry and textures are shared.
    this.model?.traverse((node) => {
      if (!node.material) return;
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      materials.forEach((material) => material?.dispose?.());
    });
    this.root.removeFromParent();
    this.model = null;
    this.mixer = null;
  }
}
