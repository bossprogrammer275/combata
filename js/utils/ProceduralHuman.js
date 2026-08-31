// ProceduralHuman.js — converted from npc codes (pure JS, no TS)
import * as THREE from 'three';

export const DEFAULT_PROPORTIONS = {
  height: 1.0,
  headScale: 1.0,
  shoulderWidth: 1.0,
  chestBulk: 1.0,
  waistWidth: 1.0,
  armLength: 1.0,
  legLength: 1.0,
  muscleDefinition: 0.5,
  skinTone: '#d9a785',
  roughness: 0.55,
  subsurface: 0.75,
};

function createProceduralSkinTexture() {
  const size = 512;
  const diffCanvas = document.createElement('canvas');
  diffCanvas.width = size;
  diffCanvas.height = size;
  const diffCtx = diffCanvas.getContext('2d');
  diffCtx.fillStyle = '#ffffff';
  diffCtx.fillRect(0, 0, size, size);
  const imgData = diffCtx.getImageData(0, 0, size, size);
  const data = imgData.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const noise1 = Math.sin(x * 0.18) * Math.cos(y * 0.18) * 10;
      const noise2 = (Math.random() - 0.5) * 8;
      const v = Math.max(0, Math.min(255, 246 + noise1 + noise2));
      data[idx] = v;
      data[idx + 1] = Math.max(0, v - 6);
      data[idx + 2] = Math.max(0, v - 12);
      data[idx + 3] = 255;
    }
  }
  diffCtx.putImageData(imgData, 0, 0);

  const normCanvas = document.createElement('canvas');
  normCanvas.width = size;
  normCanvas.height = size;
  const normCtx = normCanvas.getContext('2d');
  const normData = normCtx.createImageData(size, size);
  const nData = normData.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const nx = 128 + Math.round((Math.random() - 0.5) * 24 + Math.sin(x * 0.5) * 6);
      const ny = 128 + Math.round((Math.random() - 0.5) * 24 + Math.cos(y * 0.5) * 6);
      const nz = 245;
      nData[idx] = nx;
      nData[idx + 1] = ny;
      nData[idx + 2] = nz;
      nData[idx + 3] = 255;
    }
  }
  normCtx.putImageData(normData, 0, 0);

  const diffTex = new THREE.CanvasTexture(diffCanvas);
  diffTex.wrapS = THREE.RepeatWrapping;
  diffTex.wrapT = THREE.RepeatWrapping;
  diffTex.repeat.set(4, 4);

  const normTex = new THREE.CanvasTexture(normCanvas);
  normTex.wrapS = THREE.RepeatWrapping;
  normTex.wrapT = THREE.RepeatWrapping;
  normTex.repeat.set(8, 8);

  return { diffuse: diffTex, normal: normTex };
}

export function buildProceduralHuman(props = DEFAULT_PROPORTIONS) {
  props = Object.assign({}, DEFAULT_PROPORTIONS, props);
  const H = props.height;
  const legLen = 0.88 * props.legLength * H;
  const thighLen = legLen * 0.52;
  const calfLen = legLen * 0.48;
  const pelvisY = legLen;
  const spine1Len = 0.22 * H;
  const spine2Len = 0.26 * H;
  const neckLen = 0.12 * H;
  const headLen = 0.22 * props.headScale * H;
  const shoulderOffset = 0.20 * props.shoulderWidth;
  const armLen = 0.70 * props.armLength * H;
  const upperArmLen = armLen * 0.52;
  const forearmLen = armLen * 0.48;
  const hipOffset = 0.11 * props.waistWidth;

  const pelvis = new THREE.Bone();
  pelvis.name = 'Pelvis';
  pelvis.position.set(0, pelvisY, 0);

  const spine1 = new THREE.Bone();
  spine1.name = 'Spine1';
  spine1.position.set(0, spine1Len, 0);
  pelvis.add(spine1);

  const spine2 = new THREE.Bone();
  spine2.name = 'Spine2';
  spine2.position.set(0, spine2Len, 0);
  spine1.add(spine2);

  const neck = new THREE.Bone();
  neck.name = 'Neck';
  neck.position.set(0, neckLen, 0);
  spine2.add(neck);

  const head = new THREE.Bone();
  head.name = 'Head';
  head.position.set(0, headLen, 0);
  neck.add(head);

  const clavicleL = new THREE.Bone();
  clavicleL.name = 'Clavicle_L';
  clavicleL.position.set(shoulderOffset * 0.35, 0.02, 0);
  spine2.add(clavicleL);

  const upperArmL = new THREE.Bone();
  upperArmL.name = 'UpperArm_L';
  upperArmL.position.set(shoulderOffset * 0.65, 0, 0);
  clavicleL.add(upperArmL);

  const forearmL = new THREE.Bone();
  forearmL.name = 'Forearm_L';
  forearmL.position.set(upperArmLen, 0, 0);
  upperArmL.add(forearmL);

  const handL = new THREE.Bone();
  handL.name = 'Hand_L';
  handL.position.set(forearmLen, 0, 0);
  forearmL.add(handL);

  const clavicleR = new THREE.Bone();
  clavicleR.name = 'Clavicle_R';
  clavicleR.position.set(-shoulderOffset * 0.35, 0.02, 0);
  spine2.add(clavicleR);

  const upperArmR = new THREE.Bone();
  upperArmR.name = 'UpperArm_R';
  upperArmR.position.set(-shoulderOffset * 0.65, 0, 0);
  clavicleR.add(upperArmR);

  const forearmR = new THREE.Bone();
  forearmR.name = 'Forearm_R';
  forearmR.position.set(-upperArmLen, 0, 0);
  upperArmR.add(forearmR);

  const handR = new THREE.Bone();
  handR.name = 'Hand_R';
  handR.position.set(-forearmLen, 0, 0);
  forearmR.add(handR);

  const hipL = new THREE.Bone();
  hipL.name = 'Hip_L';
  hipL.position.set(hipOffset, 0, 0);
  pelvis.add(hipL);

  const thighL = new THREE.Bone();
  thighL.name = 'Thigh_L';
  thighL.position.set(0, -0.05, 0);
  hipL.add(thighL);

  const calfL = new THREE.Bone();
  calfL.name = 'Calf_L';
  calfL.position.set(0, -thighLen, 0);
  thighL.add(calfL);

  const footL = new THREE.Bone();
  footL.name = 'Foot_L';
  footL.position.set(0, -calfLen, 0.05);
  calfL.add(footL);

  const hipR = new THREE.Bone();
  hipR.name = 'Hip_R';
  hipR.position.set(-hipOffset, 0, 0);
  pelvis.add(hipR);

  const thighR = new THREE.Bone();
  thighR.name = 'Thigh_R';
  thighR.position.set(0, -0.05, 0);
  hipR.add(thighR);

  const calfR = new THREE.Bone();
  calfR.name = 'Calf_R';
  calfR.position.set(0, -thighLen, 0);
  thighR.add(calfR);

  const footR = new THREE.Bone();
  footR.name = 'Foot_R';
  footR.position.set(0, -calfLen, 0.05);
  calfR.add(footR);

  const boneList = [
    pelvis, spine1, spine2, neck, head,
    clavicleL, upperArmL, forearmL, handL,
    clavicleR, upperArmR, forearmR, handR,
    hipL, thighL, calfL, footL,
    hipR, thighR, calfR, footR
  ];

  const bonesMap = {};
  boneList.forEach(b => { bonesMap[b.name] = b; });

  pelvis.updateMatrixWorld(true);

  const geometries = [];

  function getBonePos(bone) {
    const v = new THREE.Vector3();
    bone.getWorldPosition(v);
    return v;
  }

  const pPelvis = getBonePos(pelvis);
  const pSpine1 = getBonePos(spine1);
  const pSpine2 = getBonePos(spine2);
  const pNeck = getBonePos(neck);
  const pHead = getBonePos(head);

  const torsoRings = 24;
  const torsoRadSegs = 20;
  const torsoYMin = pPelvis.y - 0.12;
  const torsoYMax = pHead.y + 0.16 * props.headScale;
  const torsoH = torsoYMax - torsoYMin;

  const torsoPositions = [];
  const torsoIndices = [];
  const torsoUVs = [];

  for (let r = 0; r <= torsoRings; r++) {
    const v = r / torsoRings;
    const y = torsoYMin + v * torsoH;
    let rx = 0.16 * props.waistWidth;
    let rz = 0.12 * props.chestBulk;
    if (y < pPelvis.y) {
      const f = (y - torsoYMin) / (pPelvis.y - torsoYMin);
      rx = (0.13 + f * 0.05) * props.waistWidth;
      rz = (0.10 + f * 0.04);
    } else if (y >= pPelvis.y && y < pSpine1.y) {
      const f = (y - pPelvis.y) / (pSpine1.y - pPelvis.y);
      rx = (0.18 - f * 0.02) * props.waistWidth;
      rz = (0.14 - f * 0.02) * props.chestBulk;
    } else if (y >= pSpine1.y && y < pSpine2.y) {
      const f = (y - pSpine1.y) / (pSpine2.y - pSpine1.y);
      rx = (0.16 + f * 0.07 * props.shoulderWidth) * (1.0 + props.muscleDefinition * 0.15);
      rz = (0.12 + f * 0.04 * props.chestBulk) * (1.0 + props.muscleDefinition * 0.15);
    } else if (y >= pSpine2.y && y < pNeck.y) {
      const f = (y - pSpine2.y) / (pNeck.y - pSpine2.y);
      rx = THREE.MathUtils.lerp(0.23 * props.shoulderWidth, 0.07, f);
      rz = THREE.MathUtils.lerp(0.15 * props.chestBulk, 0.075, f);
    } else if (y >= pNeck.y && y < pHead.y) {
      const f = (y - pNeck.y) / (pHead.y - pNeck.y);
      rx = THREE.MathUtils.lerp(0.068, 0.09 * props.headScale, f);
      rz = THREE.MathUtils.lerp(0.072, 0.095 * props.headScale, f);
    } else {
      const f = (y - pHead.y) / (torsoYMax - pHead.y);
      const sphereProfile = Math.sqrt(Math.max(0, 1.0 - f * f));
      rx = 0.11 * props.headScale * sphereProfile;
      rz = 0.13 * props.headScale * sphereProfile;
    }
    for (let s = 0; s <= torsoRadSegs; s++) {
      const u = s / torsoRadSegs;
      const angle = u * Math.PI * 2;
      let cosA = Math.cos(angle);
      let sinA = Math.sin(angle);
      let px = cosA * rx;
      let pz = sinA * rz;
      let py = y;
      if (y >= pHead.y - 0.06 && y <= pHead.y + 0.08 && sinA > 0.3) {
        if (Math.abs(px) < 0.035 && y > pHead.y - 0.02 && y < pHead.y + 0.03) {
          pz += 0.03 * (1.0 - Math.abs(px) / 0.035);
        }
        if (y > pHead.y + 0.04 && y < pHead.y + 0.07 && Math.abs(px) < 0.06) {
          pz += 0.015;
        }
        if (y < pHead.y - 0.02) {
          pz += 0.015 * (1.0 - Math.abs(px) / 0.06);
        }
      }
      if (y >= pSpine1.y + 0.05 && y <= pSpine2.y + 0.02 && sinA > 0.2) {
        const pecBulge = Math.sin((y - pSpine1.y) * 12) * Math.sin(angle) * 0.02 * props.muscleDefinition;
        pz += Math.max(0, pecBulge);
      }
      torsoPositions.push(px, py, pz);
      torsoUVs.push(u, v);
    }
  }

  for (let r = 0; r < torsoRings; r++) {
    for (let s = 0; s < torsoRadSegs; s++) {
      const a = r * (torsoRadSegs + 1) + s;
      const b = (r + 1) * (torsoRadSegs + 1) + s;
      const c = (r + 1) * (torsoRadSegs + 1) + (s + 1);
      const d = r * (torsoRadSegs + 1) + (s + 1);
      torsoIndices.push(a, b, d);
      torsoIndices.push(b, c, d);
    }
  }

  const torsoGeom = new THREE.BufferGeometry();
  torsoGeom.setAttribute('position', new THREE.Float32BufferAttribute(torsoPositions, 3));
  torsoGeom.setAttribute('uv', new THREE.Float32BufferAttribute(torsoUVs, 2));
  torsoGeom.setIndex(torsoIndices);
  torsoGeom.computeVertexNormals();
  geometries.push(torsoGeom);

  function createLimbCylinder(pStart, pEnd, rStart, rEnd, radialSegs = 14, heightSegs = 8) {
    const dir = new THREE.Vector3().subVectors(pEnd, pStart);
    const len = dir.length();
    const geom = new THREE.CylinderGeometry(rEnd, rStart, len, radialSegs, heightSegs, false);
    geom.translate(0, len * 0.5, 0);
    const axis = new THREE.Vector3(0, 1, 0);
    const quat = new THREE.Quaternion().setFromUnitVectors(axis, dir.clone().normalize());
    geom.applyQuaternion(quat);
    geom.translate(pStart.x, pStart.y, pStart.z);
    geom.computeVertexNormals();
    return geom;
  }

  const pUarmL = getBonePos(upperArmL);
  const pFarmL = getBonePos(forearmL);
  const pHandL = getBonePos(handL);
  const pUarmR = getBonePos(upperArmR);
  const pFarmR = getBonePos(forearmR);
  const pHandR = getBonePos(handR);

  const armR = 0.055 * (1.0 + props.muscleDefinition * 0.3);

  const upperArmLGeom = createLimbCylinder(pUarmL, pFarmL, armR * 1.15, armR * 0.95);
  const forearmLGeom = createLimbCylinder(pFarmL, pHandL, armR * 0.95, armR * 0.70);
  const handLGeom = new THREE.BoxGeometry(0.08, 0.035, 0.09, 4, 2, 4);
  handLGeom.translate(pHandL.x + 0.04, pHandL.y, pHandL.z);
  geometries.push(upperArmLGeom, forearmLGeom, handLGeom);

  const upperArmRGeom = createLimbCylinder(pUarmR, pFarmR, armR * 1.15, armR * 0.95);
  const forearmRGeom = createLimbCylinder(pFarmR, pHandR, armR * 0.95, armR * 0.70);
  const handRGeom = new THREE.BoxGeometry(0.08, 0.035, 0.09, 4, 2, 4);
  handRGeom.translate(pHandR.x - 0.04, pHandR.y, pHandR.z);
  geometries.push(upperArmRGeom, forearmRGeom, handRGeom);

  const pHipL = getBonePos(hipL);
  const pThighL = getBonePos(thighL);
  const pCalfL = getBonePos(calfL);
  const pFootL = getBonePos(footL);
  const pHipR = getBonePos(hipR);
  const pThighR = getBonePos(thighR);
  const pCalfR = getBonePos(calfR);
  const pFootR = getBonePos(footR);

  const thighRadius = 0.092 * (1.0 + props.muscleDefinition * 0.25);
  const calfRadius = 0.068 * (1.0 + props.muscleDefinition * 0.2);

  const thighLGeom = createLimbCylinder(pThighL, pCalfL, thighRadius * 1.15, thighRadius * 0.85);
  const calfLGeom = createLimbCylinder(pCalfL, pFootL, calfRadius * 1.05, calfRadius * 0.65);
  const footLGeom = new THREE.BoxGeometry(0.09, 0.06, 0.18, 4, 2, 4);
  footLGeom.translate(pFootL.x, pFootL.y - 0.03, pFootL.z + 0.04);
  geometries.push(thighLGeom, calfLGeom, footLGeom);

  const thighRGeom = createLimbCylinder(pThighR, pCalfR, thighRadius * 1.15, thighRadius * 0.85);
  const calfRGeom = createLimbCylinder(pCalfR, pFootR, calfRadius * 1.05, calfRadius * 0.65);
  const footRGeom = new THREE.BoxGeometry(0.09, 0.06, 0.18, 4, 2, 4);
  footRGeom.translate(pFootR.x, pFootR.y - 0.03, pFootR.z + 0.04);
  geometries.push(thighRGeom, calfRGeom, footRGeom);

  const mergedGeometry = mergeBufferGeometries(geometries);

  const boneIndexMap = new Map();
  boneList.forEach((b, idx) => boneIndexMap.set(b, idx));

  const segments = [];
  function addSegment(parent, child) {
    const parentIdx = boneIndexMap.get(parent);
    const childIdx = boneIndexMap.get(child);
    segments.push({
      parentIdx,
      childIdx,
      pA: getBonePos(parent),
      pB: getBonePos(child),
      name: `${parent.name}->${child.name}`
    });
  }

  addSegment(pelvis, spine1);
  addSegment(spine1, spine2);
  addSegment(spine2, neck);
  addSegment(neck, head);
  addSegment(spine2, clavicleL);
  addSegment(clavicleL, upperArmL);
  addSegment(upperArmL, forearmL);
  addSegment(forearmL, handL);
  addSegment(spine2, clavicleR);
  addSegment(clavicleR, upperArmR);
  addSegment(upperArmR, forearmR);
  addSegment(forearmR, handR);
  addSegment(pelvis, hipL);
  addSegment(hipL, thighL);
  addSegment(thighL, calfL);
  addSegment(calfL, footL);
  addSegment(pelvis, hipR);
  addSegment(hipR, thighR);
  addSegment(thighR, calfR);
  addSegment(calfR, footR);

  function distToSegment(p, a, b) {
    const ab = new THREE.Vector3().subVectors(b, a);
    const ap = new THREE.Vector3().subVectors(p, a);
    const abLenSq = ab.lengthSq();
    if (abLenSq === 0) return { dist: ap.length(), t: 0 };
    let t = ap.dot(ab) / abLenSq;
    t = THREE.MathUtils.clamp(t, 0, 1);
    const closest = new THREE.Vector3().copy(a).addScaledVector(ab, t);
    return { dist: p.distanceTo(closest), t };
  }

  const posAttr = mergedGeometry.attributes.position;
  const vertexCount = posAttr.count;

  const skinIndices = [];
  const skinWeights = [];
  const vertex = new THREE.Vector3();

  for (let i = 0; i < vertexCount; i++) {
    vertex.fromBufferAttribute(posAttr, i);
    const boneInfluences = new Float32Array(boneList.length);
    for (let s = 0; s < segments.length; s++) {
      const seg = segments[s];
      const { dist, t } = distToSegment(vertex, seg.pA, seg.pB);
      const weight = Math.exp(-dist * 16.0);
      if (weight > 0.0001) {
        boneInfluences[seg.parentIdx] += weight * (1.0 - t);
        boneInfluences[seg.childIdx] += weight * t;
      }
    }
    const sortedBones = [];
    for (let b = 0; b < boneList.length; b++) {
      if (boneInfluences[b] > 0.00001) {
        sortedBones.push({ index: b, weight: boneInfluences[b] });
      }
    }
    sortedBones.sort((a, b) => b.weight - a.weight);
    const b0 = sortedBones[0] || { index: 0, weight: 1.0 };
    const b1 = sortedBones[1] || { index: 0, weight: 0.0 };
    const b2 = sortedBones[2] || { index: 0, weight: 0.0 };
    const b3 = sortedBones[3] || { index: 0, weight: 0.0 };
    const totalWeight = b0.weight + b1.weight + b2.weight + b3.weight;
    skinIndices.push(b0.index, b1.index, b2.index, b3.index);
    skinWeights.push(
      b0.weight / totalWeight,
      b1.weight / totalWeight,
      b2.weight / totalWeight,
      b3.weight / totalWeight
    );
  }

  mergedGeometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndices, 4));
  mergedGeometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeights, 4));

  const morphPositions = {};
  const morphNames = ['Muscularity', 'ChestBreath', 'JawWidth', 'Slimness', 'HeadScale', 'Smile'];

  morphNames.forEach(name => {
    const deltaArr = new Float32Array(vertexCount * 3);
    for (let i = 0; i < vertexCount; i++) {
      const vx = posAttr.getX(i);
      const vy = posAttr.getY(i);
      const vz = posAttr.getZ(i);
      let dx = 0, dy = 0, dz = 0;
      if (name === 'Muscularity') {
        if (vy > pPelvis.y * 0.8 && vy < pSpine2.y + 0.1) {
          dx = Math.sign(vx) * 0.035;
          dz = Math.sign(vz) * 0.030;
        }
      } else if (name === 'ChestBreath') {
        if (vy > pSpine1.y && vy < pSpine2.y + 0.08) {
          dz = Math.max(0, vz) * 0.25;
          dx = vx * 0.10;
        }
      } else if (name === 'JawWidth') {
        if (vy > pHead.y - 0.10 && vy < pHead.y) {
          dx = vx * 0.40;
        }
      } else if (name === 'Slimness') {
        if (vy < pHead.y - 0.15) {
          dx = -vx * 0.20;
          dz = -vz * 0.20;
        }
      } else if (name === 'HeadScale') {
        if (vy > pNeck.y) {
          dx = (vx - pHead.x) * 0.35;
          dy = (vy - pHead.y) * 0.35;
          dz = (vz - pHead.z) * 0.35;
        }
      } else if (name === 'Smile') {
        if (vy > pHead.y - 0.06 && vy < pHead.y - 0.02 && vz > pHead.z + 0.03) {
          dx = vx * 0.3;
          dy = 0.015;
          dz = 0.005;
        }
      }
      deltaArr[i * 3] = vx + dx;
      deltaArr[i * 3 + 1] = vy + dy;
      deltaArr[i * 3 + 2] = vz + dz;
    }
    morphPositions[name] = deltaArr;
  });

  mergedGeometry.morphAttributes.position = morphNames.map(name => {
    return new THREE.Float32BufferAttribute(morphPositions[name], 3);
  });

  const morphDict = {};
  morphNames.forEach((name, idx) => { morphDict[name] = idx; });

  const { diffuse, normal } = createProceduralSkinTexture();

  const skinMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(props.skinTone),
    map: diffuse,
    normalMap: normal,
    normalScale: new THREE.Vector2(0.35, 0.35),
    roughness: props.roughness,
    metalness: 0.0,
    transmission: props.subsurface * 0.15,
    thickness: 1.8,
    attenuationColor: new THREE.Color('#ff4422'),
    attenuationDistance: 0.4,
    clearcoat: 0.12,
    clearcoatRoughness: 0.45,
    reflectivity: 0.5,
    ior: 1.45,
    side: THREE.DoubleSide
  });

  const skinnedMesh = new THREE.SkinnedMesh(mergedGeometry, skinMat);
  skinnedMesh.castShadow = true;
  skinnedMesh.receiveShadow = true;

  const skeleton = new THREE.Skeleton(boneList);
  skinnedMesh.add(pelvis);
  skinnedMesh.bind(skeleton);

  const skeletonHelper = new THREE.SkeletonHelper(skinnedMesh);
  skeletonHelper.visible = false;

  return {
    mesh: skinnedMesh,
    skeleton,
    bones: bonesMap,
    boneList,
    materials: { skin: skinMat },
    morphDictionary: morphDict,
    skeletonHelper,
    proportions: { ...props }
  };
}

function mergeBufferGeometries(geometries) {
  const merged = new THREE.BufferGeometry();
  let totalVerts = 0;
  geometries.forEach(g => {
    totalVerts += g.attributes.position.count;
  });
  const positions = new Float32Array(totalVerts * 3);
  const normals = new Float32Array(totalVerts * 3);
  const uvs = new Float32Array(totalVerts * 2);
  let offset = 0;
  let uvOffset = 0;
  geometries.forEach(g => {
    const pos = g.attributes.position;
    const norm = g.attributes.normal;
    const uv = g.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      positions[offset * 3 + i * 3] = pos.getX(i);
      positions[offset * 3 + i * 3 + 1] = pos.getY(i);
      positions[offset * 3 + i * 3 + 2] = pos.getZ(i);
      if (norm) {
        normals[offset * 3 + i * 3] = norm.getX(i);
        normals[offset * 3 + i * 3 + 1] = norm.getY(i);
        normals[offset * 3 + i * 3 + 2] = norm.getZ(i);
      } else {
        normals[offset * 3 + i * 3 + 1] = 1.0;
      }
      if (uv) {
        uvs[uvOffset * 2 + i * 2] = uv.getX(i);
        uvs[uvOffset * 2 + i * 2 + 1] = uv.getY(i);
      } else {
        uvs[uvOffset * 2 + i * 2] = (pos.getX(i) + 1) * 0.5;
        uvs[uvOffset * 2 + i * 2 + 1] = (pos.getY(i) + 1) * 0.5;
      }
    }
    offset += pos.count;
    uvOffset += pos.count;
  });
  merged.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  merged.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  merged.computeVertexNormals();
  return merged;
}
