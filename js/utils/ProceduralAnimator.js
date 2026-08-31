// ProceduralAnimator.js — converted from npc codes (pure JS)
import * as THREE from 'three';

export class ProceduralAnimator {
  constructor(rig) {
    this.rig = rig;
    this.mode = 'idle';
    this.ikTarget = new THREE.Vector3(0.35, 1.35, 0.35);
    this.ikLeftTarget = new THREE.Vector3(-0.35, 1.35, 0.35);
    this.ikEnabled = false;
    this.breathingEnabled = true;
    this.swayEnabled = true;
    this.walkSpeed = 1.0;
    this.clock = new THREE.Clock();
    this.walkPhase = 0;
  }

  updateRig(rig) {
    this.rig = rig;
  }

  update(delta) {
    const dt = delta !== undefined ? delta : this.clock.getDelta();
    const t = this.clock.getElapsedTime();
    this.resetPose();
    switch (this.mode) {
      case 'tpose':
        break;
      case 'idle':
        this.applyIdleBreathing(t);
        break;
      case 'walk':
        this.walkPhase += dt * 3.5 * this.walkSpeed;
        this.applyWalkCycle(this.walkPhase);
        this.applyIdleBreathing(t * 0.5);
        break;
      case 'run':
        this.walkPhase += dt * 6.5 * this.walkSpeed;
        this.applyRunCycle(this.walkPhase);
        break;
      case 'combat':
        this.applyCombatStance(t);
        break;
      case 'reach_ik':
        this.applyIdleBreathing(t);
        this.solveArmIK('Right', this.ikTarget);
        break;
    }
    if (this.ikEnabled && this.mode !== 'reach_ik') {
      this.solveArmIK('Right', this.ikTarget);
    }
  }

  resetPose() {
    this.rig.boneList.forEach(b => {
      b.rotation.set(0, 0, 0);
      b.scale.set(1, 1, 1);
    });
  }

  applyIdleBreathing(t) {
    const { bones, mesh, morphDictionary } = this.rig;
    if (this.breathingEnabled) {
      const breathFreq = 1.6;
      const breathSine = Math.sin(t * breathFreq);
      const breathExpand = 1.0 + 0.02 * breathSine;
      if (bones.Spine2) {
        bones.Spine2.scale.set(breathExpand, 1.0 + 0.01 * breathSine, breathExpand);
        bones.Spine2.rotation.x = 0.02 + 0.015 * breathSine;
      }
      if (morphDictionary && morphDictionary['ChestBreath'] !== undefined && mesh.morphTargetInfluences) {
        mesh.morphTargetInfluences[morphDictionary['ChestBreath']] = THREE.MathUtils.clamp((breathSine + 1.0) * 0.5, 0, 1);
      }
    }
    if (this.swayEnabled) {
      const swayX = Math.sin(t * 0.6) * 0.02;
      const headSaccadeX = Math.sin(t * 1.2) * 0.025;
      const headSaccadeY = Math.cos(t * 0.9) * 0.035;
      if (bones.Neck) {
        bones.Neck.rotation.x = swayX;
        bones.Neck.rotation.y = headSaccadeY * 0.4;
      }
      if (bones.Head) {
        bones.Head.rotation.x = headSaccadeX;
        bones.Head.rotation.y = headSaccadeY * 0.6;
      }
      if (bones.Clavicle_L) bones.Clavicle_L.rotation.z = -0.08;
      if (bones.UpperArm_L) {
        bones.UpperArm_L.rotation.z = -1.25 + Math.sin(t * 0.8) * 0.015;
        bones.UpperArm_L.rotation.x = 0.08;
      }
      if (bones.Forearm_L) bones.Forearm_L.rotation.z = -0.2;
      if (bones.Clavicle_R) bones.Clavicle_R.rotation.z = 0.08;
      if (bones.UpperArm_R) {
        bones.UpperArm_R.rotation.z = 1.25 - Math.sin(t * 0.8) * 0.015;
        bones.UpperArm_R.rotation.x = 0.08;
      }
      if (bones.Forearm_R) bones.Forearm_R.rotation.z = 0.2;
    }
  }

  applyWalkCycle(phase) {
    const { bones } = this.rig;
    const bounce = Math.abs(Math.sin(phase)) * 0.03;
    const hipSway = Math.sin(phase) * 0.06;
    if (bones.Pelvis) {
      bones.Pelvis.position.y = (this.rig.proportions.legLength * 0.88 * this.rig.proportions.height) - bounce;
      bones.Pelvis.rotation.y = hipSway;
      bones.Pelvis.rotation.z = -Math.sin(phase) * 0.03;
    }
    if (bones.Spine1) bones.Spine1.rotation.y = -hipSway * 0.6;
    if (bones.Spine2) {
      bones.Spine2.rotation.y = -hipSway * 0.4;
      bones.Spine2.rotation.x = 0.04;
    }
    const legLPhase = phase;
    const thighLAngle = Math.sin(legLPhase) * 0.55;
    const calfLAngle = thighLAngle < 0 ? Math.max(0, -Math.sin(legLPhase) * 1.0) : 0.06;
    if (bones.Thigh_L) bones.Thigh_L.rotation.x = thighLAngle;
    if (bones.Calf_L) bones.Calf_L.rotation.x = calfLAngle;
    if (bones.Foot_L) bones.Foot_L.rotation.x = -thighLAngle * 0.4 - calfLAngle * 0.3;
    const legRPhase = phase + Math.PI;
    const thighRAngle = Math.sin(legRPhase) * 0.55;
    const calfRAngle = thighRAngle < 0 ? Math.max(0, -Math.sin(legRPhase) * 1.0) : 0.06;
    if (bones.Thigh_R) bones.Thigh_R.rotation.x = thighRAngle;
    if (bones.Calf_R) bones.Calf_R.rotation.x = calfRAngle;
    if (bones.Foot_R) bones.Foot_R.rotation.x = -thighRAngle * 0.4 - calfRAngle * 0.3;
    const armSwingL = Math.sin(legRPhase) * 0.45;
    const armSwingR = Math.sin(legLPhase) * 0.45;
    if (bones.UpperArm_L) {
      bones.UpperArm_L.rotation.z = -1.25;
      bones.UpperArm_L.rotation.x = armSwingL;
    }
    if (bones.Forearm_L) {
      bones.Forearm_L.rotation.z = -0.2;
      bones.Forearm_L.rotation.x = Math.max(0.1, -armSwingL * 0.4);
    }
    if (bones.UpperArm_R) {
      bones.UpperArm_R.rotation.z = 1.25;
      bones.UpperArm_R.rotation.x = armSwingR;
    }
    if (bones.Forearm_R) {
      bones.Forearm_R.rotation.z = 0.2;
      bones.Forearm_R.rotation.x = Math.max(0.1, -armSwingR * 0.4);
    }
  }

  applyRunCycle(phase) {
    const { bones } = this.rig;
    const bounce = Math.abs(Math.sin(phase)) * 0.06;
    const forwardLean = 0.18;
    if (bones.Pelvis) {
      bones.Pelvis.position.y = (this.rig.proportions.legLength * 0.88 * this.rig.proportions.height) - bounce + 0.03;
      bones.Pelvis.rotation.x = forwardLean * 0.5;
    }
    if (bones.Spine2) {
      bones.Spine2.rotation.x = forwardLean;
    }
    const legLPhase = phase;
    const thighLAngle = Math.sin(legLPhase) * 0.90;
    const calfLAngle = thighLAngle < 0 ? Math.max(0, -Math.sin(legLPhase) * 1.5) : 0.15;
    if (bones.Thigh_L) bones.Thigh_L.rotation.x = thighLAngle;
    if (bones.Calf_L) bones.Calf_L.rotation.x = calfLAngle;
    if (bones.Foot_L) bones.Foot_L.rotation.x = -thighLAngle * 0.5;
    const legRPhase = phase + Math.PI;
    const thighRAngle = Math.sin(legRPhase) * 0.90;
    const calfRAngle = thighRAngle < 0 ? Math.max(0, -Math.sin(legRPhase) * 1.5) : 0.15;
    if (bones.Thigh_R) bones.Thigh_R.rotation.x = thighRAngle;
    if (bones.Calf_R) bones.Calf_R.rotation.x = calfRAngle;
    if (bones.Foot_R) bones.Foot_R.rotation.x = -thighRAngle * 0.5;
    const armSwingL = Math.sin(legRPhase) * 0.85;
    const armSwingR = Math.sin(legLPhase) * 0.85;
    if (bones.UpperArm_L) {
      bones.UpperArm_L.rotation.z = -1.15;
      bones.UpperArm_L.rotation.x = armSwingL;
    }
    if (bones.Forearm_L) {
      bones.Forearm_L.rotation.z = -0.3;
      bones.Forearm_L.rotation.x = 0.75;
    }
    if (bones.UpperArm_R) {
      bones.UpperArm_R.rotation.z = 1.15;
      bones.UpperArm_R.rotation.x = armSwingR;
    }
    if (bones.Forearm_R) {
      bones.Forearm_R.rotation.z = 0.3;
      bones.Forearm_R.rotation.x = 0.75;
    }
  }

  applyCombatStance(t) {
    const { bones } = this.rig;
    if (bones.Pelvis) {
      bones.Pelvis.position.y = (this.rig.proportions.legLength * 0.88 * this.rig.proportions.height) - 0.06;
      bones.Pelvis.rotation.y = 0.3;
    }
    if (bones.Thigh_L) {
      bones.Thigh_L.rotation.x = 0.35;
      bones.Thigh_L.rotation.y = 0.15;
    }
    if (bones.Calf_L) bones.Calf_L.rotation.x = 0.45;
    if (bones.Thigh_R) {
      bones.Thigh_R.rotation.x = -0.25;
      bones.Thigh_R.rotation.y = -0.25;
    }
    if (bones.Calf_R) bones.Calf_R.rotation.x = 0.35;
    if (bones.UpperArm_R) {
      bones.UpperArm_R.rotation.x = 1.1 + Math.sin(t * 2) * 0.02;
      bones.UpperArm_R.rotation.y = -0.35;
      bones.UpperArm_R.rotation.z = 0.55;
    }
    if (bones.Forearm_R) {
      bones.Forearm_R.rotation.x = 1.3;
      bones.Forearm_R.rotation.z = 0.7;
    }
    if (bones.UpperArm_L) {
      bones.UpperArm_L.rotation.x = 1.3 + Math.cos(t * 2) * 0.02;
      bones.UpperArm_L.rotation.y = 0.35;
      bones.UpperArm_L.rotation.z = -0.55;
    }
    if (bones.Forearm_L) {
      bones.Forearm_L.rotation.x = 1.2;
      bones.Forearm_L.rotation.z = -0.7;
    }
  }

  solveArmIK(side, targetPos) {
    const isRight = side === 'Right';
    const upperBone = isRight ? this.rig.bones.UpperArm_R : this.rig.bones.UpperArm_L;
    const foreBone = isRight ? this.rig.bones.Forearm_R : this.rig.bones.Forearm_L;
    const handBone = isRight ? this.rig.bones.Hand_R : this.rig.bones.Hand_L;
    const headBone = this.rig.bones.Head;
    if (!upperBone || !foreBone || !handBone) return;
    const upperLen = 0.36 * this.rig.proportions.armLength * this.rig.proportions.height;
    const foreLen = 0.34 * this.rig.proportions.armLength * this.rig.proportions.height;
    const shoulderWorld = new THREE.Vector3();
    upperBone.getWorldPosition(shoulderWorld);
    const targetDir = new THREE.Vector3().subVectors(targetPos, shoulderWorld);
    const distToTarget = THREE.MathUtils.clamp(targetDir.length(), 0.05, upperLen + foreLen - 0.005);
    const cosElbow = (upperLen * upperLen + foreLen * foreLen - distToTarget * distToTarget) / (2 * upperLen * foreLen);
    const elbowAngle = Math.PI - Math.acos(THREE.MathUtils.clamp(cosElbow, -1, 1));
    const cosShoulder = (upperLen * upperLen + distToTarget * distToTarget - foreLen * foreLen) / (2 * upperLen * distToTarget);
    const shoulderAngle = Math.acos(THREE.MathUtils.clamp(cosShoulder, -1, 1));
    targetDir.normalize();
    const lookTarget = new THREE.Vector3().addVectors(shoulderWorld, targetDir);
    upperBone.lookAt(lookTarget);
    if (isRight) {
      upperBone.rotateZ(shoulderAngle);
      foreBone.rotation.set(0, 0, elbowAngle);
    } else {
      upperBone.rotateZ(-shoulderAngle);
      foreBone.rotation.set(0, 0, -elbowAngle);
    }
    if (headBone) {
      const headWorld = new THREE.Vector3();
      headBone.getWorldPosition(headWorld);
      const lookVector = new THREE.Vector3().subVectors(targetPos, headWorld).normalize();
      headBone.rotation.y = THREE.MathUtils.clamp(Math.atan2(lookVector.x, lookVector.z) * 0.5, -0.6, 0.6);
      headBone.rotation.x = THREE.MathUtils.clamp(-Math.asin(lookVector.y) * 0.4, -0.4, 0.4);
    }
  }
}
