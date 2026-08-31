// VehicleSystem: Arcade & Simulation driving for authored maps with multiple car classes,
// free mouse look around while driving, dynamic chase camera & ambient AI traffic.
import * as THREE from 'three';

const KINDS = {
  car:         { body: [2.1, 0.75, 4.4], cab: [1.75, 0.65, 2.2], color: 0xda2828, roof: 0x1a1a1c, max: 32, accel: 18, turn: 1.9, isSports: true },
  supercar:    { body: [2.2, 0.62, 4.6], cab: [1.70, 0.55, 2.2], color: 0x00d4ff, roof: 0x121418, max: 38, accel: 24, turn: 2.2, isSuper: true, isSports: true },
  muscle:      { body: [2.15, 0.85, 4.8], cab: [1.80, 0.70, 2.3], color: 0xe67e22, roof: 0x1a1a1a, max: 34, accel: 20, turn: 1.7, isMuscle: true },
  convertible: { body: [2.1, 0.70, 4.4], cab: [1.75, 0.40, 2.0], color: 0xf5f5f5, roof: 0x8a2020, max: 30, accel: 17, turn: 1.85, isConvertible: true },
  taxi:        { body: [2.1, 0.85, 4.5], cab: [1.80, 0.75, 2.2], color: 0xf1c40f, roof: 0xf1c40f, max: 28, accel: 15, turn: 1.7, isTaxi: true },
  police:      { body: [2.1, 0.85, 4.5], cab: [1.80, 0.75, 2.2], color: 0x121418, roof: 0xf5f5f8, max: 33, accel: 19, turn: 1.85, isPolice: true },
  truck:       { body: [2.4, 1.40, 5.4], cab: [2.10, 1.20, 2.2], color: 0x2e4a66, roof: 0x1e3350, max: 20, accel: 10, turn: 1.2, isTruck: true },
  jeep:        { body: [2.1, 1.10, 4.4], cab: [1.80, 0.85, 2.0], color: 0x3a5a2e, roof: 0x2a4020, max: 26, accel: 17, turn: 1.75, isJeep: true },
};

export class VehicleSystem {
  constructor(scene, world, camera, audio) {
    this.scene = scene;
    this.world = world;
    this.camera = camera;
    this.audio = audio;
    this.vehicles = [];
    this.driver = null;
    this._camPos = null;
    this._camLook = null;
    this._lookYaw = 0;
    this._lookPitch = 0.2;
  }

  buildFromWorld() {
    for (const s of this.world.vehicleSpawns || []) this.spawn(s);
  }

  spawn(def) {
    const k = KINDS[def.kind] || KINDS.car;
    const root = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({ color: k.color, roughness: .25, metalness: .75 });
    const cabMat = new THREE.MeshStandardMaterial({ color: k.roof, roughness: .35, metalness: .65 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x121416, roughness: .85 });
    const glassMat = new THREE.MeshPhysicalMaterial({ color: 0x182430, roughness: .05, metalness: .5, transparent: true, opacity: .85, clearcoat: 1.0 });
    const rimMat = new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: .15, metalness: .95 });
    const tireMat = new THREE.MeshStandardMaterial({ color: 0x161616, roughness: .9 });
    const headMat = new THREE.MeshStandardMaterial({ color: 0xfff6dd, emissive: 0xffe49e, emissiveIntensity: 1.4 });
    const tailMat = new THREE.MeshStandardMaterial({ color: 0xff1010, emissive: 0xff0000, emissiveIntensity: 1.2 });

    const bodyH = k.body[1];
    const halfL = k.body[2] / 2;

    // 1. Main Aerodynamic Body (Center at y = bodyH/2 + 0.28)
    const body = new THREE.Mesh(new THREE.BoxGeometry(k.body[0], bodyH, k.body[2]), bodyMat);
    body.position.y = bodyH / 2 + 0.28;
    body.castShadow = true;
    root.add(body);

    // 2. Cabin / Greenhouse (Set slightly toward the rear: +Z is rear, -Z is front)
    if (!k.isConvertible) {
      const cab = new THREE.Mesh(new THREE.BoxGeometry(k.cab[0], k.cab[1], k.cab[2]), cabMat);
      cab.position.set(0, bodyH + 0.28 + k.cab[1] / 2 - 0.05, 0.2);
      cab.castShadow = true;
      root.add(cab);

      // Glass Canopy
      const wind = new THREE.Mesh(new THREE.BoxGeometry(k.cab[0] + 0.02, k.cab[1] - 0.08, k.cab[2] + 0.05), glassMat);
      wind.position.set(0, bodyH + 0.28 + k.cab[1] / 2 - 0.05, 0.2);
      root.add(wind);
    } else {
      // Convertible Interior Seats & Windshield
      const seatL = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.6, 0.5), darkMat);
      seatL.position.set(-0.4, bodyH + 0.4, 0.2); root.add(seatL);
      const seatR = seatL.clone(); seatR.position.x = 0.4; root.add(seatR);
      const aeroWind = new THREE.Mesh(new THREE.BoxGeometry(k.cab[0] - 0.1, 0.35, 0.1), glassMat);
      aeroWind.position.set(0, bodyH + 0.45, -0.6); aeroWind.rotation.x = -0.3; root.add(aeroWind);
    }

    // 3. Muscle Hood Air Scoop
    if (k.isMuscle) {
      const scoop = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.2, 1.1), darkMat);
      scoop.position.set(0, bodyH + 0.38, -halfL * 0.4);
      root.add(scoop);
    }

    // 4. Taxi Rooftop Sign
    if (k.isTaxi) {
      const signMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffea70, emissiveIntensity: 1.2 });
      const taxiSign = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.22, 0.35), signMat);
      taxiSign.position.set(0, bodyH + 0.28 + k.cab[1] + 0.12, 0.2);
      root.add(taxiSign);
    }

    // 5. Police Emergency Lightbar
    if (k.isPolice) {
      const lightbar = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.14, 0.25), darkMat);
      lightbar.position.set(0, bodyH + 0.28 + k.cab[1] + 0.08, 0.2);
      root.add(lightbar);
      const redLight = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.12, 0.22), new THREE.MeshStandardMaterial({ color: 0xff0000, emissive: 0xff0000, emissiveIntensity: 1.8 }));
      redLight.position.set(-0.28, bodyH + 0.28 + k.cab[1] + 0.08, 0.2);
      root.add(redLight);
      const blueLight = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.12, 0.22), new THREE.MeshStandardMaterial({ color: 0x0066ff, emissive: 0x0088ff, emissiveIntensity: 1.8 }));
      blueLight.position.set(0.28, bodyH + 0.28 + k.cab[1] + 0.08, 0.2);
      root.add(blueLight);
    }

    // 6. Side Mirrors (facing backward toward -Z)
    for (const sx of [-1, 1]) {
      const mirror = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.09, 0.12), bodyMat);
      mirror.position.set(sx * (k.body[0] / 2 + 0.08), bodyH + 0.32, -0.4);
      root.add(mirror);
    }

    // 7. Rear Spoiler Wing (At +Z rear)
    if (k.isSports || k.isSuper) {
      const spW = k.body[0] - 0.05;
      const spoilerBlade = new THREE.Mesh(new THREE.BoxGeometry(spW, 0.05, 0.35), darkMat);
      spoilerBlade.position.set(0, bodyH + 0.62, halfL - 0.25);
      root.add(spoilerBlade);
      for (const sx of [-0.65, 0.65]) {
        const stand = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.28, 0.12), darkMat);
        stand.position.set(sx, bodyH + 0.48, halfL - 0.25);
        root.add(stand);
      }
    }

    // 8. FRONT (-Z face): Front Bumper, Splitter & Headlights
    const frontBumper = new THREE.Mesh(new THREE.BoxGeometry(k.body[0] + 0.04, 0.22, 0.25), darkMat);
    frontBumper.position.set(0, 0.32, -halfL - 0.08);
    root.add(frontBumper);

    const headL = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.14, 0.08), headMat);
    headL.position.set(-k.body[0] * 0.32, bodyH * 0.75 + 0.15, -halfL - 0.02);
    root.add(headL);
    const headR = headL.clone(); headR.position.x = k.body[0] * 0.32; root.add(headR);

    // 9. REAR (+Z face): Taillights, Rear Bumper & Dual Exhausts
    const tailBar = new THREE.Mesh(new THREE.BoxGeometry(k.body[0] * 0.88, 0.12, 0.08), tailMat);
    tailBar.position.set(0, bodyH * 0.8 + 0.15, halfL + 0.02);
    root.add(tailBar);

    const rearBumper = new THREE.Mesh(new THREE.BoxGeometry(k.body[0] + 0.04, 0.22, 0.25), darkMat);
    rearBumper.position.set(0, 0.32, halfL + 0.08);
    root.add(rearBumper);

    for (const sx of [-0.5, 0.5]) {
      const exhaust = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.15, 10), rimMat);
      exhaust.rotation.x = Math.PI / 2;
      exhaust.position.set(sx, 0.25, halfL + 0.16);
      root.add(exhaust);
    }

    // 10. Alloy Wheels with Brake Calipers
    const wheelGeo = new THREE.CylinderGeometry(0.38, 0.38, 0.28, 20);
    const rimGeo = new THREE.CylinderGeometry(0.24, 0.24, 0.29, 12);
    const wheels = [];
    const wOff = k.body[0] / 2 - 0.06;
    const wL = halfL - 0.65;

    // sx: left/right, sz: -1 = FRONT (-Z), +1 = REAR (+Z)
    for (const [sx, sz, steer] of [[-1, -1, true], [1, -1, true], [-1, 1, false], [1, 1, false]]) {
      const g = new THREE.Group();
      g.position.set(sx * wOff, 0.38, sz * wL);
      const w = new THREE.Mesh(wheelGeo, tireMat);
      w.rotation.z = Math.PI / 2;
      w.castShadow = true;
      g.add(w);
      const rim = new THREE.Mesh(rimGeo, rimMat);
      rim.rotation.z = Math.PI / 2;
      g.add(rim);
      root.add(g);
      wheels.push({ spin: w, steerGroup: g, steer });
    }

    root.position.set(def.x, 0, def.z);
    root.rotation.y = def.ry || 0;
    this.scene.add(root);
    const col = this.world.addCollider(def.x, 0, def.z, k.body[0] + 0.4, k.body[1] + 1.2, k.body[2] + 0.4);

    const veh = {
      def, kind: def.kind || 'car', k, root, wheels, col,
      pos: new THREE.Vector3(def.x, 0, def.z),
      vel: new THREE.Vector3(),
      yaw: def.ry || 0,
      speed: 0,
      steerVis: 0,
    };
    this.vehicles.push(veh);
    return veh;
  }

  nearest(x, z, maxDist) {
    let best = null, bd = maxDist;
    for (const v of this.vehicles) {
      const d = Math.hypot(v.pos.x - x, v.pos.z - z);
      if (d < bd) { bd = d; best = v; }
    }
    return best;
  }

  enter(veh, player) {
    if (this.driver) return false;
    this.driver = veh;
    veh.def.occupied = true;
    player.vel.set(0, 0, 0);
    player.char.root.visible = false;
    this._camPos = null;
    this._camLook = null;
    this._lookYaw = 0;
    this._lookPitch = 0.2;
    return true;
  }

  exit(player) {
    const veh = this.driver;
    if (!veh) return;
    this.driver = null;
    veh.def.occupied = false;
    const nx = Math.cos(veh.yaw), nz = Math.sin(veh.yaw);
    player.pos.set(veh.pos.x + nx * 3.0, 0.5, veh.pos.z + nz * 3.0);
    player.vel.set(0, 0, 0);
    player.yaw = veh.yaw + Math.PI;
    player.char.root.visible = true;
  }

  collide(v, dt) {
    const cs = Math.abs(Math.cos(v.yaw)), sn = Math.abs(Math.sin(v.yaw));
    const hw = (v.k.body[2] / 2) * cs + (v.k.body[0] / 2) * sn;
    const hd = (v.k.body[2] / 2) * sn + (v.k.body[0] / 2) * cs;
    const fx = -Math.sin(v.yaw), fz = -Math.cos(v.yaw);
    const r = Math.max(hw, hd) * 0.9;
    const vCandidates = this.world.grid
      ? this.world.grid.queryAABB(v.pos.x - r, v.pos.z - r, v.pos.x + r, v.pos.z + r)
      : this.world.colliders;
    for (const c of vCandidates) {
      if (c === v.col || c.max.y < 0.2) continue;
      const cx = Math.max(c.min.x, Math.min(v.pos.x, c.max.x));
      const cz = Math.max(c.min.z, Math.min(v.pos.z, c.max.z));
      let dx = v.pos.x - cx, dz = v.pos.z - cz;
      let d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      let nx2, nz2;
      if (d2 < 1e-9) {
        const px = Math.min(v.pos.x - c.min.x, c.max.x - v.pos.x);
        const pz = Math.min(v.pos.z - c.min.z, c.max.z - v.pos.z);
        if (px < pz) { nx2 = v.pos.x - c.min.x < c.max.x - v.pos.x ? -1 : 1; nz2 = 0; }
        else { nx2 = 0; nz2 = v.pos.z - c.min.z < c.max.z - v.pos.z ? -1 : 1; }
        v.pos.x += nx2 * (px + 0.05);
        v.pos.z += nz2 * (pz + 0.05);
      } else {
        const d = Math.sqrt(d2);
        nx2 = dx / d; nz2 = dz / d;
        const push = r - d;
        v.pos.x += nx2 * push;
        v.pos.z += nz2 * push;
      }
      const vn = fx * nx2 + fz * nz2;
      if (vn < -0.1) v.speed *= 0.35;
    }
  }

  update(dt, input, player) {
    // 1. Ambient AI Traffic: cruise non-driven vehicles along road axes
    for (const v of this.vehicles) {
      if (v === this.driver) continue;
      if (v.def && v.def.ambient !== false) {
        const speed = v.def.cruiseSpeed || (v.kind === 'police' ? 14 : v.kind === 'truck' ? 8 : 11);
        const fx = -Math.sin(v.yaw), fz = -Math.cos(v.yaw);
        v.pos.x += fx * speed * dt;
        v.pos.z += fz * speed * dt;
        const B = (this.world.bounds || 1600) - 50;
        if (v.pos.x > B) v.pos.x = -B; else if (v.pos.x < -B) v.pos.x = B;
        if (v.pos.z > B) v.pos.z = -B; else if (v.pos.z < -B) v.pos.z = B;
        v.root.position.set(v.pos.x, 0, v.pos.z);
        v.root.rotation.y = v.yaw;
        if (v.col) {
          v.col.min.set(v.pos.x - v.k.body[0] / 2, 0, v.pos.z - v.k.body[2] / 2);
          v.col.max.set(v.pos.x + v.k.body[0] / 2, v.k.body[1] + 1.2, v.pos.z + v.k.body[2] / 2);
        }
        for (const w of v.wheels) w.spin.rotation.x -= speed * dt * 2.5;
      }
    }

    const v = this.driver;
    if (!v) return;
    const k = v.k;
    const throttle = input.forward;
    const steer = input.right;
    const handbrake = !!input.jump;

    // Acceleration & Braking
    if (throttle > 0) {
      v.speed += k.accel * dt;
    } else if (throttle < 0) {
      if (v.speed > 1) v.speed -= k.accel * 3.4 * dt;
      else v.speed -= k.accel * 0.75 * dt;
    }
    if (handbrake) v.speed -= k.accel * 4.5 * dt;
    v.speed *= Math.max(0, 1 - dt * (throttle !== 0 ? 0.3 : 1.6));
    v.speed = Math.max(-k.max * 0.4, Math.min(k.max, v.speed));

    // Steering (Correctly oriented: left turns left, right turns right)
    const dir = v.speed >= 0 ? 1 : -1;
    const turn = -steer * k.turn * (0.35 + 0.65 * Math.min(1, Math.abs(v.speed) / 6)) * dir;
    v.yaw += turn * dt;

    // Movement vector in world coordinates (-sin(yaw), -cos(yaw))
    const fx = -Math.sin(v.yaw), fz = -Math.cos(v.yaw);
    v.pos.x += fx * v.speed * dt;
    v.pos.z += fz * v.speed * dt;
    this.collide(v, dt);
    const B = this.world.bounds || 1600;
    v.pos.x = Math.max(-B, Math.min(B, v.pos.x));
    v.pos.z = Math.max(-B, Math.min(B, v.pos.z));

    v.root.position.set(v.pos.x, 0, v.pos.z);
    // Add subtle suspension roll when cornering
    v.root.rotation.set(0, v.yaw, -steer * Math.min(1, Math.abs(v.speed) / 15) * 0.08);

    v.steerVis += (-steer * 0.42 - v.steerVis) * Math.min(1, dt * 8);
    const spin = (v.speed / 0.38) * dt;
    for (const w of v.wheels) {
      w.spin.rotation.x -= spin;
      if (w.steer) w.steerGroup.rotation.y = v.steerVis;
    }

    if (Math.abs(v.speed) > 0.5 && this.audio && this.audio.engine) {
      this.audio.engine(Math.min(1, Math.abs(v.speed) / k.max));
    }

    // Dynamic Chase Camera with Looking Around Orbit
    const mouseDX = input.mouseDX || 0;
    const mouseDY = input.mouseDY || 0;
    this._lookYaw -= mouseDX * 0.003;
    this._lookPitch = Math.max(0.05, Math.min(0.8, this._lookPitch - mouseDY * 0.003));
    // Spring recenter lookYaw slowly toward 0 when accelerating forward
    if (Math.abs(v.speed) > 3) {
      this._lookYaw *= Math.max(0, 1 - dt * 1.5);
    }
    input.mouseDX = 0; input.mouseDY = 0;

    const totalYaw = v.yaw + this._lookYaw;
    const camFx = -Math.sin(totalYaw), camFz = -Math.cos(totalYaw);
    const camDist = 9.2 + Math.min(3.5, Math.abs(v.speed) * 0.1);
    const camH = 3.6 + this._lookPitch * 4.0;

    const target = new THREE.Vector3(v.pos.x - camFx * camDist, camH, v.pos.z - camFz * camDist);
    const look = new THREE.Vector3(v.pos.x + camFx * 4, 1.4, v.pos.z + camFz * 4);

    if (!this._camPos) { this._camPos = target.clone(); this._camLook = look.clone(); }
    this._camPos.lerp(target, Math.min(1, dt * 8));
    this._camLook.lerp(look, Math.min(1, dt * 8));

    this.camera.position.copy(this._camPos);
    this.camera.lookAt(this._camLook);

    const tfov = 62 + Math.min(12, Math.abs(v.speed) * 0.4);
    if (Math.abs(this.camera.fov - tfov) > .05) {
      this.camera.fov += (tfov - this.camera.fov) * Math.min(1, dt * 4);
      this.camera.updateProjectionMatrix();
    }

    player.pos.set(v.pos.x, 0.5, v.pos.z);
    player.yaw = v.yaw;
  }
}
