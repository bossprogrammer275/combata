// Effects: pooled particles, tracers, explosions, muzzle flashes, screen shake.
import * as THREE from 'three';
import { makeFlashSprite, makeSmokeSprite, makeGlowSprite } from './textures.js';

const MAX_PARTICLES = 900;

export class Effects {
  constructor(scene, quality) {
    quality = quality || 'high';
    this.scene = scene;
    this.flashTex = makeFlashSprite();
    this.smokeTex = makeSmokeSprite();
    this.sparkTex = makeGlowSprite('255,200,120');
    this.shake = 0;
    this.time = 0;

    const ultra = quality === 'ultra-low';
    const lowQ = quality === 'low' || ultra;
    const maxP = ultra ? 200 : lowQ ? 450 : MAX_PARTICLES;
    const tracerCount = ultra ? 10 : lowQ ? 20 : 40;
    const smokeCount = ultra ? 5 : lowQ ? 12 : 30;

    // ---- pooled point particles ----
    this.pGeo = new THREE.BufferGeometry();
    this.pPos = new Float32Array(maxP * 3);
    this.pCol = new Float32Array(maxP * 3);
    this.pSize = new Float32Array(maxP);
    this.pGeo.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3));
    this.pGeo.setAttribute('color', new THREE.BufferAttribute(this.pCol, 3));
    this.pGeo.setAttribute('size', new THREE.BufferAttribute(this.pSize, 1));
    const pMat = new THREE.PointsMaterial({
      size: 1, vertexColors: true, map: this.sparkTex, transparent: true,
      depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true
    });
    pMat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('uniform float size;', 'attribute float size;');
    };
    this.points = new THREE.Points(this.pGeo, pMat);
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.parts = [];
    for (let i = 0; i < maxP; i++) this.parts.push({ alive: false, pos: new THREE.Vector3(), vel: new THREE.Vector3(), life: 0, maxLife: 1, r: 1, g: 1, b: 1, size: 1, grav: 0, drag: 1 });
    this.pCursor = 0;

    // ---- tracers (pooled line boxes) ----
    this.tracers = [];
    const tGeo = new THREE.BoxGeometry(0.02, 0.02, 1);
    const tMat = new THREE.MeshBasicMaterial({ color: 0xffd080, transparent: true, opacity: .9, blending: THREE.AdditiveBlending, depthWrite: false });
    for (let i = 0; i < tracerCount; i++) {
      const t = new THREE.Mesh(tGeo, tMat);
      t.visible = false; t.frustumCulled = false;
      scene.add(t);
      this.tracers.push({ mesh: t, life: 0 });
    }
    this.tCursor = 0;

    // ---- smoke sprites ----
    this.smokes = [];
    const sMat = new THREE.SpriteMaterial({ map: this.smokeTex, transparent: true, opacity: .5, depthWrite: false });
    for (let i = 0; i < smokeCount; i++) {
      const s = new THREE.Sprite(sMat.clone());
      s.visible = false; scene.add(s);
      this.smokes.push({ sprite: s, life: 0, maxLife: 1, grow: 1 });
    }
    this.sCursor = 0;

    // ---- flash lights (pooled) ----
    this.lights = [];
    for (let i = 0; i < 3; i++) {
      const l = new THREE.PointLight(0xffc060, 0, 14, 2);
      scene.add(l);
      this.lights.push({ light: l, life: 0, maxLife: 1, peak: 1 });
    }
    this.lCursor = 0;

    // ---- expanding shockwave rings (pooled) ----
    this.shocks = [];
    const shGeo = new THREE.RingGeometry(0.6, 1, 28);
    for (let i = 0; i < 6; i++) {
      const m = new THREE.Mesh(shGeo, new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
      m.rotation.x = -Math.PI / 2; m.visible = false; scene.add(m);
      this.shocks.push({ mesh: m, life: 0, maxLife: 1, maxScale: 1 });
    }
    this.shCursor = 0;
  }

  shockwave(pos, maxScale = 6, life = .5, color = 0xffd9a0) {
    const s = this.shocks[this.shCursor];
    this.shCursor = (this.shCursor + 1) % this.shocks.length;
    s.mesh.position.copy(pos); s.mesh.position.y = 0.15;
    s.mesh.material.color.setHex(color);
    s.mesh.material.opacity = 0.9; s.mesh.visible = true;
    s.life = life; s.maxLife = life; s.maxScale = maxScale;
  }

  spawnParticle(pos, vel, life, color, size, grav = 0, drag = 1) {
    if (!this.parts || !this.parts.length) return;
    const p = this.parts[this.pCursor];
    this.pCursor = (this.pCursor + 1) % this.parts.length;
    p.alive = true; p.pos.copy(pos); p.vel.copy(vel);
    p.life = life; p.maxLife = life;
    p.r = color.r; p.g = color.g; p.b = color.b;
    p.size = size; p.grav = grav; p.drag = drag;
  }

  burst(pos, n, color, speed = 5, life = .5, size = .35, grav = 6, spread = 1) {
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3((Math.random() - .5) * spread, Math.random() * .9 + .1, (Math.random() - .5) * spread)
        .normalize().multiplyScalar(speed * (.4 + Math.random() * .8));
      this.spawnParticle(pos, v, life * (.5 + Math.random()), color, size * (.6 + Math.random() * .8), grav, .94);
    }
  }

  impactDust(pos, normal) {
    const c = new THREE.Color(0.55, 0.48, 0.38);
    for (let i = 0; i < 6; i++) {
      const v = normal.clone().multiplyScalar(1.5 + Math.random() * 2.5)
        .add(new THREE.Vector3((Math.random() - .5) * 2, Math.random() * 1.5, (Math.random() - .5) * 2));
      this.spawnParticle(pos, v, .4 + Math.random() * .3, c, .3 + Math.random() * .25, 4, .9);
    }
    this.smoke(pos.clone().addScaledVector(normal, .15), .35, .5, 1.2);
  }

  bloodPuff(pos) {
    const c = new THREE.Color(0.5, 0.08, 0.05);
    this.burst(pos, 10, c, 3.5, .45, .3, 7);
  }

  tracer(from, to, color = 0xffd080) {
    const t = this.tracers[this.tCursor];
    this.tCursor = (this.tCursor + 1) % this.tracers.length;
    const m = t.mesh;
    m.material.color.setHex(color);
    m.material.opacity = .85;
    const dir = to.clone().sub(from);
    const len = dir.length();
    m.position.copy(from).addScaledVector(dir, .5);
    m.lookAt(to); m.scale.set(1, 1, len);
    m.visible = true;
    t.life = .07;
  }

  smoke(pos, scale = 1, life = 1.2, grow = 1.6) {
    const s = this.smokes[this.sCursor];
    this.sCursor = (this.sCursor + 1) % this.smokes.length;
    s.sprite.position.copy(pos);
    s.sprite.scale.setScalar(scale);
    s.sprite.material.opacity = .45;
    s.sprite.material.rotation = Math.random() * 6;
    s.sprite.visible = true;
    s.life = life; s.maxLife = life; s.grow = grow;
  }

  flashLight(pos, color, intensity = 40, life = .08) {
    const f = this.lights[this.lCursor];
    this.lCursor = (this.lCursor + 1) % this.lights.length;
    f.light.position.copy(pos);
    f.light.color.setHex(color);
    f.light.intensity = intensity;
    f.life = life; f.maxLife = life; f.peak = intensity;
  }

  explosion(pos, big = 1) {
    const fire = new THREE.Color(1, .55, .15);
    const fire2 = new THREE.Color(1, .85, .4);
    this.burst(pos, 26 * big, fire, 9 * big, .7, 1.1, 4, 1.6);
    this.burst(pos, 16 * big, fire2, 13 * big, .35, .8, 3, 2);
    // debris / shrapnel
    this.burst(pos, 20 * big, new THREE.Color(.3, .26, .22), 11 * big, 1.1, .5, 14, 1.4);
    // smoke column
    for (let i = 0; i < 7; i++) {
      this.smoke(pos.clone().add(new THREE.Vector3((Math.random() - .5) * 2, i * .8, (Math.random() - .5) * 2)),
        1.6 * big, 1.8 + Math.random(), 2.2);
    }
    // ground scorch smoke
    this.smoke(pos.clone().add(new THREE.Vector3(0, .2, 0)), 2.4 * big, 2.4, 2.6);
    // shockwave ring
    this.shockwave(pos.clone(), (6 + 8 * big), .5 + .15 * big, 0xffd9a0);
    this.flashLight(pos.clone().add(new THREE.Vector3(0, 1.5, 0)), 0xff9040, 300 * big, .25);
    this.addShake(.35 * big + .15);
  }

  addShake(v) { this.shake = Math.min(this.shake + v, .8); }

  // Continuous flame jet (flamethrower). `strength` 0..1 controls density.
  fire(pos, dir, strength = 1) {
    const n = Math.floor(3 * strength);
    for (let i = 0; i < n; i++) {
      const spread = .25;
      const v = dir.clone().add(new THREE.Vector3((Math.random() - .5) * spread, (Math.random() - .5) * spread, (Math.random() - .5) * spread)).normalize()
        .multiplyScalar(14 * (.5 + Math.random() * .6));
      v.y += 1.5;
      this.spawnParticle(pos.clone().addScaledVector(dir, .3), v, .35 + Math.random() * .2,
        new THREE.Color(1, .4 + Math.random() * .4, .12), .5 + Math.random() * .3, 2, 1.1);
    }
    // a few embers/smoke
    if (Math.random() < .4) this.smoke(pos.clone().addScaledVector(dir, 1.5), .5, .5, 1.2);
  }

  update(dt) {
    this.time += dt;
    // particles
    const pos = this.pPos, col = this.pCol, sz = this.pSize;
    for (let i = 0; i < this.parts.length; i++) {
      const p = this.parts[i];
      const i3 = i * 3;
      if (!p.alive) { sz[i] = 0; continue; }
      p.life -= dt;
      if (p.life <= 0) { p.alive = false; sz[i] = 0; continue; }
      p.vel.y -= p.grav * dt;
      p.vel.multiplyScalar(Math.pow(p.drag, dt * 60));
      p.pos.addScaledVector(p.vel, dt);
      if (p.pos.y < 0.02) { p.pos.y = 0.02; p.vel.y *= -.3; p.vel.x *= .6; p.vel.z *= .6; }
      const k = p.life / p.maxLife;
      pos[i3] = p.pos.x; pos[i3 + 1] = p.pos.y; pos[i3 + 2] = p.pos.z;
      col[i3] = p.r * k + .05; col[i3 + 1] = p.g * k + .04; col[i3 + 2] = p.b * k + .03;
      sz[i] = p.size * (0.5 + k * 0.5);
    }
    this.pGeo.attributes.position.needsUpdate = true;
    this.pGeo.attributes.color.needsUpdate = true;
    this.pGeo.attributes.size.needsUpdate = true;

    for (const t of this.tracers) {
      if (!t.mesh.visible) continue;
      t.life -= dt;
      if (t.life <= 0) { t.mesh.visible = false; continue; }
      t.mesh.material.opacity = t.life / .07 * .85;
    }
    for (const s of this.smokes) {
      if (!s.sprite.visible) continue;
      s.life -= dt;
      if (s.life <= 0) { s.sprite.visible = false; continue; }
      const k = 1 - s.life / s.maxLife;
      s.sprite.scale.addScalar(s.grow * dt);
      s.sprite.position.y += dt * .7;
      s.sprite.material.opacity = .45 * (1 - k);
    }
    for (const f of this.lights) {
      if (f.life <= 0) continue;
      f.life -= dt;
      f.light.intensity = Math.max(0, f.life / f.maxLife) * f.peak;
    }
    for (const s of this.shocks) {
      if (!s.mesh.visible) continue;
      s.life -= dt;
      if (s.life <= 0) { s.mesh.visible = false; continue; }
      const k = 1 - s.life / s.maxLife;
      const sc = 0.5 + k * s.maxScale;
      s.mesh.scale.set(sc, sc, sc);
      s.mesh.material.opacity = 0.9 * (1 - k);
    }
    this.shake = Math.max(0, this.shake - dt * 1.8);
  }

  getShakeOffset(out) {
    const s = this.shake * this.shake;
    out.set(
      (Math.random() - .5) * s * .3,
      (Math.random() - .5) * s * .3,
      (Math.random() - .5) * s * .1
    );
    return out;
  }
}
