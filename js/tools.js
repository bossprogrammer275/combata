import * as THREE from 'three';

export class Tools {
  constructor(game) {
    this.game = game;
    this.deviceOpen = false;
    this.alt = 100;
    this._missiles = [];
    this._fireballs = [];
    this._hoverPos = null;
    this._panTarget = new THREE.Vector3();

    // --- Drag state ---
    this._dragStart = null;
    this._dragLast = null;
    this._dragDist = 0;

    // --- Picture-in-picture 3D top-down view ---
    this.pipSize = 512;
    this.pipCanvas = document.createElement('canvas');
    this.pipCanvas.width = this.pipSize;
    this.pipCanvas.height = this.pipSize;
    this.pipCanvas.style.cssText =
      'position:fixed;right:20px;bottom:20px;z-index:43;' +
      'border:2px solid #c9a227;border-radius:10px;' +
      'box-shadow:0 0 40px rgba(0,0,0,.9);cursor:crosshair;background:#0a0e0a';
    this.pipCanvas.classList.add('hidden');
    document.body.appendChild(this.pipCanvas);

    this.pipRenderer = new THREE.WebGLRenderer({ canvas: this.pipCanvas, antialias: true });
    this.pipRenderer.setPixelRatio(window.devicePixelRatio);
    this.pipRenderer.setClearColor(0x0a0e0a, 1);

    this.pipCamera = new THREE.PerspectiveCamera(45, 1, 1, 1200);
    this.pipCamera.up.set(0, 0, -1);
    // Enable layer 1 for markers (main camera only renders layer 0)
    this.pipCamera.layers.enable(1);

    // --- Target ring ---
    const ringGeo = new THREE.RingGeometry(3.5, 4.5, 36);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xff2020, side: THREE.DoubleSide, transparent: true, opacity: 0.9 });
    this._ring = new THREE.Mesh(ringGeo, ringMat);
    this._ring.rotation.x = -Math.PI / 2;
    this._ring.visible = false;
    game.scene.add(this._ring);
    this._ring.layers.enable(1);

    // --- Vertical laser beam ---
    const beamGeo = new THREE.CylinderGeometry(0.1, 0.1, 200, 6);
    const beamMat = new THREE.MeshBasicMaterial({ color: 0xff2020, transparent: true, opacity: 0.15 });
    this._beam = new THREE.Mesh(beamGeo, beamMat);
    this._beam.position.y = 100;
    this._beam.visible = false;
    game.scene.add(this._beam);
    this._beam.layers.enable(1);

    // --- Player marker (cyan ring, layer 1 so only PIP sees it) ---
    const pmGeo = new THREE.RingGeometry(0.6, 1.4, 28);
    const pmMat = new THREE.MeshBasicMaterial({ color: 0x00ffcc, side: THREE.DoubleSide, transparent: true, opacity: 0.9 });
    this._playerMarker = new THREE.Mesh(pmGeo, pmMat);
    this._playerMarker.rotation.x = -Math.PI / 2;
    this._playerMarker.position.y = 0.15;
    this._playerMarker.layers.set(1);
    game.scene.add(this._playerMarker);

    // --- Inner dot for player ---
    const dotGeo = new THREE.CircleGeometry(0.5, 16);
    const dotMat = new THREE.MeshBasicMaterial({ color: 0xffcc00, side: THREE.DoubleSide, transparent: true, opacity: 0.6 });
    this._playerDot = new THREE.Mesh(dotGeo, dotMat);
    this._playerDot.rotation.x = -Math.PI / 2;
    this._playerDot.position.y = 0.16;
    this._playerDot.layers.set(1);
    game.scene.add(this._playerDot);

    // --- Enemy markers (red rings, layer 1) ---
    this._enemyMarkers = [];
    this._emPoolSize = 50;
    const emGeo = new THREE.RingGeometry(0.4, 0.8, 16);
    for (let i = 0; i < this._emPoolSize; i++) {
      const m = new THREE.Mesh(emGeo.clone(), new THREE.MeshBasicMaterial({ color: 0xff3030, side: THREE.DoubleSide, transparent: true, opacity: 0.7 }));
      m.rotation.x = -Math.PI / 2;
      m.position.y = 0.15;
      m.visible = false;
      m.layers.set(1);
      game.scene.add(m);
      this._enemyMarkers.push(m);
    }

    this._bindPipMouse();
  }

  _bindPipMouse() {
    const raycaster = new THREE.Raycaster();

    this.pipCanvas.addEventListener('mousedown', (e) => {
      if (!this.deviceOpen) return;
      this._dragStart = { x: e.clientX, y: e.clientY };
      this._dragLast = { x: e.clientX, y: e.clientY };
      this._dragDist = 0;
    });

    this.pipCanvas.addEventListener('mousemove', (e) => {
      if (!this.deviceOpen) { this._dragStart = null; return; }
      // Update hover/raycasting regardless of drag state
      const rect = this.pipCanvas.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(new THREE.Vector2(x, y), this.pipCamera);
      const origin = raycaster.ray.origin;
      const dir = raycaster.ray.direction;
      if (dir.y >= 0) { this._ring.visible = false; this._beam.visible = false; return; }
      const t = (0 - origin.y) / dir.y;
      if (t < 0) { this._ring.visible = false; this._beam.visible = false; return; }
      const hit = origin.clone().addScaledVector(dir, t);
      this._hoverPos = hit;
      this._ring.position.copy(hit);
      this._beam.position.set(hit.x, 100, hit.z);
      this._ring.visible = true;
      this._beam.visible = true;

      // Handle drag for panning
      if (this._dragStart && this._dragLast) {
        const dx = e.clientX - this._dragLast.x;
        const dy = e.clientY - this._dragLast.y;
        this._dragDist += Math.abs(dx) + Math.abs(dy);
        const halfH = this.alt * Math.tan(this.pipCamera.fov * Math.PI / 180 / 2);
        const mpp = halfH * 2 / this.pipSize;
        const B = this.game.world.bounds || 160;
        this._panTarget.x = Math.max(-B, Math.min(B, this._panTarget.x - dx * mpp));
        this._panTarget.z = Math.max(-B, Math.min(B, this._panTarget.z - dy * mpp));
        this._dragLast = { x: e.clientX, y: e.clientY };
      }
    });

    this.pipCanvas.addEventListener('mouseup', (e) => {
      if (!this.deviceOpen || !this._dragStart) return;
      // If barely moved, treat as click → launch missile
      if (this._dragDist < 8 && this._hoverPos) {
        this.launchMissile(this._hoverPos.clone());
      }
      this._dragStart = null;
      this._dragLast = null;
    });

    // Stop dragging if mouse leaves canvas
    this.pipCanvas.addEventListener('mouseleave', () => {
      this._dragStart = null;
      this._dragLast = null;
    });
  }

  isOpen() { return this.deviceOpen; }

  open() {
    if (this.deviceOpen) return;
    this.deviceOpen = true;
    this.alt = 100;
    this._hoverPos = null;
    this._ring.visible = false;
    this._beam.visible = false;
    this._panTarget.copy(this.game.player.pos);
    this.pipCanvas.classList.remove('hidden');
    document.getElementById('device-screen').classList.remove('hidden');
    if (document.exitPointerLock) document.exitPointerLock();
  }

  close() {
    if (!this.deviceOpen) return;
    this.deviceOpen = false;
    this._ring.visible = false;
    this._beam.visible = false;
    this.pipCanvas.classList.add('hidden');
    document.getElementById('device-screen').classList.add('hidden');
    this._dragStart = null;
    this._dragLast = null;
    if (this.game.state === 'playing') this.game.lockPointer();
  }

  handleWheel(deltaY) {
    if (!this.deviceOpen) return;
    this.alt = Math.max(15, Math.min(700, this.alt * (deltaY < 0 ? 0.82 : 1.22)));
  }

  renderPip() {
    if (!this.deviceOpen) return;
    const g = this.game;
    if (!g.player) return;
    const savedFog = g.scene.fog;
    g.scene.fog = null;
    this.pipRenderer.render(g.scene, this.pipCamera);
    g.scene.fog = savedFog;
  }

  launchMissile(worldPos) {
    const g = this.game;
    const B = g.world.bounds || 160;
    worldPos.x = Math.max(-B, Math.min(B, worldPos.x));
    worldPos.z = Math.max(-B, Math.min(B, worldPos.z));
    worldPos.y = 0;

    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(.18, .18, 1.6, 10),
      new THREE.MeshStandardMaterial({ color: 0x2a2c28, roughness: .6, metalness: .5, emissive: 0x551500, emissiveIntensity: .8 })
    );
    mesh.rotation.x = Math.PI / 2;
    mesh.position.set(worldPos.x, 220, worldPos.z);
    g.scene.add(mesh);
    this._missiles.push({ mesh, target: worldPos.clone(), life: 1.8, t: 0 });
    g.hud.toast('⚠ MISSILE INBOUND ⚠');
  }

  _bigExplosion(at) {
    const g = this.game;

    const fireMat = new THREE.MeshBasicMaterial({ color: 0xff4400, transparent: true, opacity: 0.7 });
    const fireMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 12), fireMat);
    fireMesh.position.copy(at);
    g.scene.add(fireMesh);
    this._fireballs.push({ mesh: fireMesh, mat: fireMat, maxScale: 30, t: 0, life: 1.0, startOp: 0.7 });

    const coreMat = new THREE.MeshBasicMaterial({ color: 0xffcc88, transparent: true, opacity: 0.9 });
    const coreMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 10), coreMat);
    coreMesh.position.copy(at);
    g.scene.add(coreMesh);
    this._fireballs.push({ mesh: coreMesh, mat: coreMat, maxScale: 14, t: 0, life: 0.5, startOp: 0.9 });

    g.fx.shockwave(at.clone(), 50, 0.7, 0xff4400);
    g.fx.burst(at, 60, new THREE.Color(1, 0.4, 0.05), 20, 0.7, 0.9, 2, 2.5);
    g.fx.burst(at, 40, new THREE.Color(1, 0.8, 0.2), 25, 0.5, 0.7, 1, 3);
    g.fx.burst(at, 30, new THREE.Color(0.4, 0.3, 0.2), 28, 1.2, 0.8, 12, 2.5);
    g.fx.flashLight(at.clone().add(new THREE.Vector3(0, 6, 0)), 0xff4000, 4000, 0.5);
    for (let s = 0; s < 15; s++) {
      const off = new THREE.Vector3((Math.random() - .5) * 16, Math.random() * 4, (Math.random() - .5) * 16);
      g.fx.smoke(at.clone().add(off), 1.8 + Math.random() * 3, 2.2 + Math.random(), 3);
    }
    g.fx.addShake(0.8);

    const audio = g.audio;
    if (audio) {
      if (audio.rocketImpact) audio.rocketImpact(0);
      if (audio._tone) {
        audio._tone(36, 3.0, 0.85, 'sine', 15);
        audio._tone(50, 2.5, 0.55, 'sawtooth', 28);
        audio._noise(2.5, 'lowpass', 500, 0.6, 0.5, 2.0);
      }
      setTimeout(() => { try { if (audio.rocketImpact) audio.rocketImpact(0); } catch (e) {} }, 400);
      setTimeout(() => { try { if (audio.rocketImpact) audio.rocketImpact(0); } catch (e) {} }, 900);
      setTimeout(() => { try { if (audio._tone) audio._tone(32, 2.0, 0.4, 'sine', 12); } catch (e) {} }, 600);
    }

    const blast = 55, blastDmg = 420;
    for (const e of g.enemyMgr.enemies) {
      if (!e.alive) continue;
      const d = e.pos.distanceTo(at);
      if (d < blast) {
        const killed = e.takeDamage(blastDmg * (1 - d / blast) + 30, false);
        if (killed && g.enemyMgr.onBotKilled) g.enemyMgr.onBotKilled(g.player, e);
      }
    }
    // player immune to own missile
  }

  _updateMissiles(dt) {
    const g = this.game;
    for (let i = this._missiles.length - 1; i >= 0; i--) {
      const m = this._missiles[i];
      m.t += dt; m.life -= dt;
      const k = Math.min(1, m.t / 1.8);
      const pos = new THREE.Vector3(m.target.x, 220, m.target.z).lerp(new THREE.Vector3(m.target.x, 0.2, m.target.z), k);
      m.mesh.position.copy(pos);
      g.fx.flashLight(pos, 0xff7020, 18, .08);
      if (Math.random() < .7) g.fx.smoke(pos.clone().add(new THREE.Vector3((Math.random() - .5) * .8, 0, (Math.random() - .5) * .8)), .5, .5, 1);
      if (m.life <= 0 || k >= 1) {
        this._bigExplosion(m.target);
        g.scene.remove(m.mesh);
        this._missiles.splice(i, 1);
      }
    }
  }

  _updateFireballs(dt) {
    const g = this.game;
    for (let i = this._fireballs.length - 1; i >= 0; i--) {
      const fb = this._fireballs[i];
      fb.t += dt;
      const progress = Math.min(1, fb.t / fb.life);
      const scale = fb.maxScale * Math.min(1, progress * 1.6);
      fb.mesh.scale.setScalar(scale);
      fb.mat.opacity = fb.startOp * (1 - progress);
      if (progress >= 1) {
        g.scene.remove(fb.mesh);
        this._fireballs.splice(i, 1);
      }
    }
  }

  update(dt) {
    this._updateMissiles(dt);
    this._updateFireballs(dt);
    if (this.deviceOpen) {
      const g = this.game;
      if (g && g.player) {
        const t = performance.now() / 1000;
        // Pulse player marker
        const pulse = 1 + Math.sin(t * 3) * 0.2;
        this._playerMarker.scale.setScalar(pulse);

        // Position player marker
        this._playerMarker.position.x = g.player.pos.x;
        this._playerMarker.position.z = g.player.pos.z;
        this._playerDot.position.x = g.player.pos.x;
        this._playerDot.position.z = g.player.pos.z;

        // Position enemy markers
        const enemies = g.enemyMgr.enemies;
        let markerIdx = 0;
        for (const e of enemies) {
          if (!e.alive || markerIdx >= this._emPoolSize) continue;
          const m = this._enemyMarkers[markerIdx++];
          m.position.x = e.pos.x;
          m.position.z = e.pos.z;
          m.visible = true;
          m.scale.setScalar(0.8 + Math.sin(t * 4 + markerIdx) * 0.2);
        }
        // Hide unused markers
        for (let i = markerIdx; i < this._emPoolSize; i++) {
          this._enemyMarkers[i].visible = false;
        }

        // Animate target ring
        const s = 1 + Math.sin(t * 4) * 0.15;
        this._ring.scale.set(s, s, s);

        // Position PIP camera above pan target
        this.pipCamera.position.set(this._panTarget.x, this.alt, this._panTarget.z);
        this.pipCamera.lookAt(this._panTarget.x, 0, this._panTarget.z);
      }
    }
  }
}
