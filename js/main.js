// STATIC COMMAND — single-player open world (free roam).
// Handcrafted city loaded from a scene JSON. Third-person / first-person, combat,
// fast travel, achievements. Multiplayer removed.
import * as THREE from 'three';
import { World } from './world.js';
import { Player } from './player.js';
import { Character } from './character.js';
import { WeaponSystem } from './weapons.js';
import { EnemyManager, Enemy } from './enemies.js';
import { Effects } from './effects.js';
import { Tools } from './tools.js';
import { HUD } from './hud.js';
import { GameAudio } from './audio.js';
import { Profile, SHOP } from './profile.js';
import { AchievementSystem } from './achievements.js';
import { VehicleSystem } from './vehicles.js';
import { Civilians } from './civilians.js';
import { Physics } from './physics.js';
import { resolveDriveAxes } from './vehicle-steering.js';
import { prefetch } from './model-loader.js';

const currentScene = new URLSearchParams(location.search).get('scene') || 'city-a.json';
const SCENE_URL = './data/worlds/' + currentScene;

class Game {
  constructor() {
    this.state = 'boot';
    this.profile = new Profile();
    this.stats = { score: 0, kills: 0, deaths: 0, shotsFired: 0, shotsHit: 0 };
    this.match = null;
    this.input = { forward: 0, right: 0, sprint: false, crouch: false, jump: false, climb: false, fire: false, ads: false, throwGrenade: false, mouseDX: 0, mouseDY: 0, toRoof: false };
    this.playerTeam = -1; // -1: every NPC is hostile to the player
    this.fullMapOpen = false;
    this.transitMenuOpen = false;
    this.nearTransit = null;
    this.nearLoot = null;
    this.ismailg = false;
    this.overview = null;

    window.__getCoins = () => this.profile ? this.profile.coins : 0;
    window.__transitPick = (idx) => {
      const locs = this.world && this.world.namedLocations;
      if (this.transitMenuOpen && locs && idx >= 0 && idx < locs.length) {
        this.fastTravelTo(locs[idx]);
      }
    };

    this.setupRenderer();
    this.hud = new HUD();
    this.audio = new GameAudio(this.profile.data.settings.quality);
    this.achievements = new AchievementSystem(this.profile, this.audio);
    this.bindUI();
    this.bindInput();
    this.clock = new THREE.Clock();
    this.shakeOffset = new THREE.Vector3();
    this.ambientPlanes = [];
    this.planeTimer = 12 + Math.random() * 20;
    this.skipIntro = false;
    this.applyProfileSettings();
    this.showNamePrompt();
  }

  showNamePrompt() {
    const prompt = document.getElementById('name-prompt');
    const input = document.getElementById('name-input');
    const confirm = document.getElementById('name-confirm');
    prompt.classList.remove('hidden');

    const doName = () => {
      const name = input.value.trim() || 'OPERATOR';
      this.playerName = name;
      this.ismailg = name.toLowerCase() === 'ismailg';
      prompt.classList.add('hidden');
      this.showLogo();
    };

    confirm.onclick = doName;
    input.onkeydown = (e) => { if (e.key === 'Enter') doName(); };
    const qn = new URLSearchParams(location.search).get('name');
    if (qn) { input.value = qn; doName(); return; }
    setTimeout(() => input.focus(), 300);
  }

  showLogo() {
    const logo = document.getElementById('logo-screen');
    const firstRun = !localStorage.getItem('sc_has_launched');
    if (!firstRun) {
      logo.classList.add('hidden');
      this.bootLoader();
      return;
    }
    localStorage.setItem('sc_has_launched', '1');
    setTimeout(() => {
      logo.classList.add('hidden');
      this.bootLoader();
    }, 2800);
  }

  bootLoader() {
    const setLoad = (p, msg) => {
      const f = document.getElementById('load-fill'), m = document.getElementById('load-msg');
      if (f) f.style.width = Math.round(p * 100) + '%';
      if (m && msg) m.textContent = msg;
    };
    setLoad(0.05, 'INITIALIZING…');
    // Pre-fetch scene data in parallel with renderer warmup.
    this._sceneFetch = fetch(SCENE_URL).then(r => r.json()).then(data => {
      // Immediately start prefetching all GLB model binaries off main thread
      if (data && data.glbAssets) {
        const urls = data.glbAssets.map(a => a.url).filter(u => u && (u.endsWith('.glb') || u.endsWith('.gltf')));
        if (urls.length) prefetch(urls);
      }
      return data;
    }).catch(() => null);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      setLoad(0.15, 'LOADING CITY…');
      setTimeout(() => this.initGame(this.profile.data.settings.quality, setLoad), 30);
    }));
  }

  async initGame(quality, setLoad) {
    setLoad(0.25, 'LOADING CITY DATA…');
    let sceneData = null;
    try {
      sceneData = this._sceneFetch ? await this._sceneFetch : await fetch(SCENE_URL).then(r => r.json());
    } catch (e) {
      console.warn('scene load failed — falling back to empty world', e);
    }
    this._sceneFetch = null;
    setLoad(0.45, 'TERRAIN & STRUCTURES…');
    this.world = new World(this.scene, quality, sceneData);
    await this.world.assetsReady;
    this.fx = new Effects(this.scene, quality);

    // Initialize Rapier physics engine
    this.physics = null;
    try {
      this.physics = new Physics();
      await Physics.init();
      this.physics.createWorld();
      this.physics.registerStaticBatch(this.world.colliders);
      this.physics.registerStaticRoadMeshes(this.world.roadPhysicsMeshes);
      this.physics.addGroundPlane();
      this.world._physics = this.physics;
      console.log('[Game] Rapier physics initialized');
    } catch (e) {
      console.warn('[Game] Rapier physics init failed, falling back to AABB collision:', e);
      this.physics = null;
    }
    this.player = new Player(this.camera, this.world, this.audio, this.physics);
    this.player.applyProfile(this.profile);
    this.weapons = new WeaponSystem(this.camera, this.scene, this.world, this.fx, this.audio, this.hud);
    this.scene.add(this.player.char.root);
    this.weapons.rig.visible = false;
    this.weapons.firstPerson = false;
    this.enemyMgr = new EnemyManager(this.scene, this.world, this.fx, this.audio, this.camera, this.hud, quality);
    this.enemyMgr.onBotKilled = (shooter, victim) => {
      this.hud.killfeed(shooter.name, shooter.weaponType, victim.name, false);
      this.updateHud();
    };
    this.vehicles = new VehicleSystem(this.scene, this.world, this.camera, this.audio, this.physics);
    this.vehicles.buildFromWorld();
    this.vehicles.setPlayerRef(this.player);
    setLoad(0.74, 'LOADING CIVILIAN 002…');
    this.civilians = new Civilians(this.scene, this.world, {
      quality,
      physics: this.physics,
      vehicles: this.vehicles,
      player: this.player,
      hud: this.hud,
    });
    this.civilians.onCasualty = (civ) => this.civilianDown(civ);
    await this.civilians.ready;
    this.tools = new Tools(this);
    this.godMode = false;
    this._hostileCap = 1;
    this._hostileTimer = 6;
    setLoad(0.85, 'FINALIZING…');
    this.hud.setQuality(quality);
    this.applyQuality(quality);
    this.renderer.setAnimationLoop(() => this.tick());
    setLoad(1, 'READY');
    setTimeout(() => {
      const ls = document.getElementById('load-screen');
      if (ls) ls.classList.add('hidden');
      this.playIntro();
      if (location.search.includes('autostart')) this.skipIntro = true;
    }, 250);
  }

  openMenu() {
    this.state = 'menu';
    this.hud && this.hud.hide && this.hud.hide();
    document.getElementById('death-screen').style.display = 'none';
    document.getElementById('menu-screen').style.display = 'flex';
    this.refreshMenu();
    document.getElementById('coins-menu').textContent = this.profile.coins;
    this.audio.init();
    this.audio.startMusic(false);
    if (location.search.includes('autostart')) { this.startFreeRoam(); }
  }

  refreshMenu() {
    const p = this.profile;
    const names = ['OLIVE', 'RUST', 'NAVY', 'TAN', 'SLATE', 'TEAL', 'VIOLET', 'MOSS'];
    const cs = document.getElementById('cloth-sel');
    cs.innerHTML = '';
    for (const i of p.data.owned.clothColors) {
      const opt = document.createElement('option');
      opt.value = i; opt.textContent = names[i] || ('Color ' + i);
      if (p.data.equipped.clothColor === i) opt.selected = true;
      cs.appendChild(opt);
    }
    document.getElementById('cap-state').textContent = p.data.equipped.cap ? 'ON' : 'OFF';
    document.getElementById('glasses-state').textContent = p.data.equipped.glasses ? 'ON' : 'OFF';
    const al = document.getElementById('ammo-shop');
    al.innerHTML = '';
    for (const a of SHOP.ammo) {
      const cur = this.weapons ? this.weapons.defs.find(d => d.id === a.weapon) : null;
      const curReserve = (cur && cur.state) ? cur.state.reserve : '—';
      const row = document.createElement('div'); row.className = 'shop-item';
      row.innerHTML = `<div><div class="nm">${a.name}</div><div class="ds">◈ ${a.price} · RESERVE: ${curReserve}</div></div>`;
      const b = document.createElement('button'); b.textContent = 'BUY';
      b.onclick = () => {
        const r = this.profile.buyAmmo(a.id);
        if (r.ok) {
          const def = this.weapons.defs.find(d => d.id === a.weapon);
          if (def && def.state) def.state.reserve += a.amount;
          this.hud.toast && this.hud.toast('Bought ' + a.name);
        } else {
          this.hud.toast && this.hud.toast(r.msg);
        }
        this.refreshMenu();
      };
      row.appendChild(b); al.appendChild(row);
    }
  }

  applyProfileSettings() {
    const s = this.profile.data.settings;
    this.player && (this.player.sensitivity = s.sens);
    this._pendingQuality = s.quality;
  }

  // ===== FREE ROAM =====
  startFreeRoam() {
    this.match = { mode: 'freeroam', running: true };
    this.audio.init();
    this.audio.setVolume(parseFloat(document.getElementById('vol').value));
    this.audio.stopMusic();
    document.getElementById('menu-screen').style.display = 'none';
    this.hud.show();
    this.resetRun();
    this.state = 'playing';
    this.match.running = true;
    this.lockPointer();
    this.hud.waveBanner('FREE ROAM', 'THE CITY IS YOURS');
    for (let i = 0; i < Math.min(1, this._hostileCap); i++) this.spawnHostile();
    this.updateHud();
    if (location.search.includes('autostart')) this.autoDeploy();
  }

  // dev deep-link: ?ov=yaw,pitch,dist,tx,tz drops straight into overview camera
  autoDeploy() {
    const qp = new URLSearchParams(location.search);
    const ov = qp.get('ov');
    if (!ov) return;
    this.toggleOverview();
    const o = this.overview;
    if (!o) return;
    const [yaw, pitch, dist, tx, tz] = ov.split(',').map(parseFloat);
    if (!isNaN(yaw)) o.yaw = yaw;
    if (!isNaN(pitch)) o.pitch = pitch;
    if (!isNaN(dist)) o.dist = dist;
    if (!isNaN(tx)) o.tx = tx;
    if (!isNaN(tz)) o.tz = tz;
  }

  toggleOverview() {
    if (this.drone) this.toggleDrone();
    if (this.overview) {
      this.overview = null;
      this.hud.toast('FIRST PERSON');
      this.lockPointer();
    } else {
      this.overview = { yaw: 0.8, pitch: 0.5, dist: 460, tx: 0, tz: 0, ty: 12 };
      document.exitPointerLock();
      this.hud.toast('OVERVIEW — [O] BACK · DRAG ORBIT · WHEEL ZOOM · WASD PAN');
      document.getElementById('crosshair').style.opacity = 0;
    }
  }

  toggleDrone() {
    if (this.overview) this.toggleOverview();
    if (this.drone) {
      this.drone = null;
      this.hud.toast('FIRST PERSON');
      this.lockPointer();
      this.player.char.root.visible = !this.player.firstPerson;
      this.weapons.rig.visible = this.player.firstPerson;
    } else {
      const p = this.player.pos;
      this.drone = {
        pos: new THREE.Vector3(p.x, p.y + 15, p.z),
        yaw: this.player.yaw,
        pitch: -0.3,
        speed: 40,
      };
      this.player.char.root.visible = false;
      this.weapons.rig.visible = false;
      document.exitPointerLock();
      this.hud.toast('DRONE — [F5] EXIT · WASD FLY · MOUSE LOOK · SHIFT FAST · SPACE/CTRL UP/DOWN');
      document.getElementById('crosshair').style.opacity = 0;
    }
  }

  _showWeatherUI(active) {
    let el = document.getElementById('weather-panel');
    if (!el) {
      el = document.createElement('div');
      el.id = 'weather-panel';
      el.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:20;display:flex;flex-direction:column;gap:10px;padding:18px 24px;background:rgba(0,0,0,0.75);border-radius:14px;backdrop-filter:blur(8px);pointer-events:auto;';
      // Time of day buttons
      const timeLabel = document.createElement('div');
      timeLabel.textContent = 'TIME OF DAY';
      timeLabel.style.cssText = 'color:#aaa;font:600 11px "Bebas Neue","Oswald",sans-serif;letter-spacing:2px;text-align:center;';
      el.appendChild(timeLabel);
      const timeRow = document.createElement('div');
      timeRow.style.cssText = 'display:flex;gap:8px;';
      const times = [
        { id: 'morning', label: 'Morning', icon: '\u{1F305}', h: 8 },
        { id: 'afternoon', label: 'Afternoon', icon: '\u{2600}', h: 14 },
        { id: 'evening', label: 'Evening', icon: '\u{1F307}', h: 18 },
        { id: 'night', label: 'Night', icon: '\u{1F319}', h: 22 },
      ];
      for (const t of times) {
        const btn = document.createElement('button');
        btn.dataset.time = t.id;
        btn.textContent = `${t.icon} ${t.label}`;
        btn.style.cssText = 'padding:8px 14px;border:2px solid rgba(255,255,255,0.2);border-radius:8px;background:rgba(255,255,255,0.08);color:#ccc;font:600 13px "Bebas Neue","Oswald",sans-serif;cursor:pointer;transition:all .15s;';
        btn.onmouseenter = () => btn.style.background = 'rgba(255,255,255,0.2)';
        btn.onmouseleave = () => btn.style.background = 'rgba(255,255,255,0.08)';
        btn.onclick = () => {
          if (this.world.atmosphere) this.world.atmosphere.setTime(t.h);
          this.hud.toast(`TIME: ${t.label.toUpperCase()}`);
        };
        timeRow.appendChild(btn);
      }
      el.appendChild(timeRow);
      // Weather buttons
      const weatherLabel = document.createElement('div');
      weatherLabel.textContent = 'WEATHER';
      weatherLabel.style.cssText = 'color:#aaa;font:600 11px "Bebas Neue","Oswald",sans-serif;letter-spacing:2px;text-align:center;margin-top:4px;';
      el.appendChild(weatherLabel);
      const weatherRow = document.createElement('div');
      weatherRow.style.cssText = 'display:flex;gap:8px;';
      const weathers = [
        { id: 'clear', label: 'Clear', icon: '\u2600' },
        { id: 'overcast', label: 'Overcast', icon: '\u2601' },
        { id: 'fog', label: 'Fog', icon: '\u26B6' },
        { id: 'rain', label: 'Rain', icon: '\u2614' },
      ];
      for (const w of weathers) {
        const btn = document.createElement('button');
        btn.dataset.weather = w.id;
        btn.textContent = `${w.icon} ${w.label}`;
        btn.style.cssText = 'padding:8px 14px;border:2px solid rgba(255,255,255,0.2);border-radius:8px;background:rgba(255,255,255,0.08);color:#ccc;font:600 13px "Bebas Neue","Oswald",sans-serif;cursor:pointer;transition:all .15s;';
        btn.onmouseenter = () => btn.style.background = 'rgba(255,255,255,0.2)';
        btn.onmouseleave = () => btn.style.background = w.id === active ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.08)';
        btn.onclick = () => {
          if (this.world.atmosphere) this.world.atmosphere.weather = w.id;
          this.hud.toast(`WEATHER: ${w.id.toUpperCase()}`);
        };
        weatherRow.appendChild(btn);
      }
      el.appendChild(weatherRow);
      document.body.appendChild(el);
      setTimeout(() => { el.style.opacity = '1'; }, 10);
      this._weatherUITimer = setTimeout(() => { el.style.display = 'none'; }, 4000);
    } else {
      el.style.display = 'flex';
      clearTimeout(this._weatherUITimer);
      for (const btn of el.children) {
        btn.style.borderColor = btn.dataset.weather === active ? '#fff' : 'rgba(255,255,255,0.2)';
        btn.style.background = btn.dataset.weather === active ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.08)';
      }
      this._weatherUITimer = setTimeout(() => { el.style.display = 'none'; }, 3000);
    }
  }

  updateDrone(dt) {
    const d = this.drone;
    if (!d) return;
    const spd = d.speed * (this.input.sprint ? 3 : 1);
    const cy = Math.cos(d.yaw), sy = Math.sin(d.yaw);
    let vert = 0;
    if (this.input.jump) vert = 1;
    if (this.input.crouch) vert = -1;
    d.pos.x += (-sy * this.input.forward + cy * this.input.right) * spd * dt;
    d.pos.z += (-cy * this.input.forward - sy * this.input.right) * spd * dt;
    d.pos.y += vert * spd * dt;
    d.yaw += this.input.mouseDX * 0.004;
    d.pitch = Math.max(-1.5, Math.min(1.5, d.pitch + this.input.mouseDY * 0.004));
    const cp = Math.cos(d.pitch), sp = Math.sin(d.pitch);
    this.camera.position.set(
      d.pos.x + cp * Math.sin(d.yaw) * 0.1,
      d.pos.y + sp * 0.1,
      d.pos.z + cp * Math.cos(d.yaw) * 0.1
    );
    this.camera.lookAt(
      d.pos.x + cp * Math.sin(d.yaw) * 10,
      d.pos.y + sp * 10,
      d.pos.z + cp * Math.cos(d.yaw) * 10
    );
    this.input.mouseDX = 0;
    this.input.mouseDY = 0;
  }

  updateOverview(dt) {
    const o = this.overview;
    const spd = (this.input.sprint ? 260 : 90) * dt;
    const cy = Math.cos(o.yaw), sy = Math.sin(o.yaw);
    if (this.input.forward) { o.tx += -sy * this.input.forward * spd; o.tz += -cy * this.input.forward * spd; }
    if (this.input.right) { o.tx += cy * this.input.right * spd; o.tz += -sy * this.input.right * spd; }
    o.yaw += this.input.mouseDX * 0.004;
    o.pitch = Math.max(0.06, Math.min(1.45, o.pitch + this.input.mouseDY * 0.004));
    const cp = Math.cos(o.pitch), sp = Math.sin(o.pitch);
    this.camera.position.set(o.tx + o.dist * cp * Math.sin(o.yaw), o.ty + o.dist * sp, o.tz + o.dist * cp * Math.cos(o.yaw));
    this.camera.lookAt(o.tx, o.ty, o.tz);
    this.input.mouseDX = 0; this.input.mouseDY = 0;
  }

  respawn() {
    document.getElementById('death-screen').style.display = 'none';
    this.hp = this.maxHp;
    this.killChain = { count: 0, timer: 0 };
    this.weapons.equip(0, true);
    const d0 = this.weapons.defs[0], d1 = this.weapons.defs[1], d2 = this.weapons.defs[2];
    for (const d of [d0, d1, d2]) if (d.state) { d.state.mag = d.mag; d.state.reserve = 240; }
    const s = this.world.startPoint;
    this.player.pos.set(s.x, 0.5, s.z);
    this.player.vel.set(0, 0, 0);
    this.player.yaw = s.yaw != null ? s.yaw : Math.PI;
    this.player.pitch = 0;
    this.player.onGround = true;
    this.player.skydive = false;
    if (this.physics) this.physics.setPlayerPosition(this.player.pos.x, this.player.pos.y, this.player.pos.z);
    this.state = 'playing';
    this.hud.setHealth(this.hp, this.maxHp);
    this.updateHud();
    this.lockPointer();
    this.hud.toast('RESPAWNED');
  }

  resetRun() {
    this.stats = { score: 0, kills: 0, deaths: 0, shotsFired: 0, shotsHit: 0 };
    this.diff = { dmg: 1.3, acc: 0.95, spd: 1.25, aggro: 1 };
    this.hp = 100;
    this.maxHp = 100;
    this.killChain = { count: 0, timer: 0 };
    this.enemyMgr.clearAll();
    if (this.civilians) this.civilians.resetPopulation();
    this.weapons.equip(0, true);
    const d0 = this.weapons.defs[0], d1 = this.weapons.defs[1], d2 = this.weapons.defs[2];
    for (const d of [d0, d1, d2]) if (d.state) { d.state.mag = d.mag; d.state.reserve = 240; }
    this.weapons.hud.setWeapon(this.weapons.def, this.weapons.state);
    const s = this.world.startPoint;
    this.player.pos.set(s.x, 0.5, s.z);
    this.player.vel.set(0, 0, 0);
    this.player.yaw = s.yaw != null ? s.yaw : Math.PI;
    this.player.pitch = 0;
    this.player.onGround = true;
    if (this.physics) this.physics.setPlayerPosition(this.player.pos.x, this.player.pos.y, this.player.pos.z);
    this.updateHud();
  }

  spawnHostile() {
    if (!this.world.spawnPoints || !this.world.spawnPoints.length) return;
    const names = ['MARLOWE', 'VEX', 'CORVUS', 'SABLE', 'TALON', 'ODIN', 'RAVEN', 'KESTREL', 'SLADE', 'BORG'];
    this.enemyMgr.spawnWave(1, 1, this.diff || { dmg: .9, acc: .7, spd: 1, aggro: .8 },
      { name: names[(Math.random() * names.length) | 0] });
    this.updateHud();
  }

  registerKill(enemy, headshot, weaponDef) {
    if (enemy && enemy.isPlayer) return;
    if (enemy && enemy.civilian) { this.civilianDown(enemy); return; }
    this.stats.kills++;
    const base = headshot ? 150 : 100;
    this.killChain.count++;
    this.killChain.timer = 4;
    let bonus = 0;
    if (this.killChain.count === 2) { bonus = 50; this.hud.medal('DOUBLE KILL', '+50'); }
    else if (this.killChain.count === 3) { bonus = 100; this.hud.medal('TRIPLE KILL', '+100'); }
    else if (this.killChain.count >= 4) { bonus = 150; this.hud.medal('RAMPAGE x' + this.killChain.count, '+150'); }
    if (headshot) this.hud.medal('HEADSHOT', '+150');
    this.trackAchievementProgress('kill', headshot, weaponDef?.id);

    if (headshot && this.weapons.adsT < 0.3 && (weaponDef?.id === 'dmr' || weaponDef?.id === 'sniper')) {
      this.trackAchievementProgress('noScope', true, weaponDef?.id);
    }

    this.stats.score += base + bonus + 25;
    this.hud.killfeed('YOU', weaponDef.name, enemy.name, headshot);
    this.profile.addCoins(20);
    this.updateHud();
    this.achievements.check(this.hud);
  }

  trackAchievementProgress(killType, headshot, weaponId) {
    const prog = this.achievements.progress;
    prog.totalKills = (prog.totalKills || 0) + 1;
    if (headshot) prog.headshots = (prog.headshots || 0) + 1;
    if (killType === 'noScope') prog.noScopeKills = (prog.noScopeKills || 0) + 1;
    if (!prog.weaponKills) prog.weaponKills = {};
    prog.weaponKills[weaponId] = (prog.weaponKills[weaponId] || 0) + 1;
    if (this.killChain.count === 2) prog.doubleKills = (prog.doubleKills || 0) + 1;
    if (this.killChain.count === 3) prog.tripleKills = (prog.tripleKills || 0) + 1;
    if (this.killChain.count >= 4) prog.rampages = (prog.rampages || 0) + 1;
    this.achievements.saveProgress();
  }

  playerDown() {
    this.hp = 0;
    this.stats.deaths++;
    this.state = 'dead';
    document.exitPointerLock();

    const acc = this.stats.shotsFired ? Math.round(this.stats.shotsHit / this.stats.shotsFired * 100) : 0;
    document.getElementById('death-title').textContent = 'K.I.A.';
    document.getElementById('death-cause').textContent = 'ELIMINATED';
    document.getElementById('d-score').textContent = this.stats.score;
    document.getElementById('d-kills').textContent = this.stats.kills;
    document.getElementById('d-acc').textContent = acc + '%';
    document.getElementById('death-screen').style.display = 'flex';
    this.achievements.check(this.hud);
  }

  // ===== INPUT / UI =====
  bindUI() {
    const $ = (id) => document.getElementById(id);

    $('deploy-btn').onclick = () => {
      this.audio.init();
      this.audio.setVolume(parseFloat($('vol').value));
      this.audio.click();
      this.startFreeRoam();
    };
    $('respawn-btn').onclick = () => { this.audio.click(); this.respawn(); };
    $('resume-btn').onclick = () => { this.audio.click(); this.resume(); };
    $('open-cockpit-settings').onclick = () => { this.audio.click(); this.showPausePanel('cockpit'); };
    $('cockpit-back').onclick = () => { this.audio.click(); this.showPausePanel('main'); };
    $('cockpit-resume-btn').onclick = () => { this.audio.click(); this.resume(); };
    $('cockpit-reset').onclick = () => {
      if (this.vehicles && this.vehicles.resetInteriorCameraSettings()) this.refreshCockpitSettingsUI();
    };
    $('cockpit-view-toggle').onclick = () => {
      if (this.vehicles && this.vehicles.driver) {
        this.vehicles.toggleInteriorView();
        this.refreshCockpitSettingsUI();
      }
    };
    document.querySelectorAll('[data-cockpit-setting]').forEach((input) => {
      input.addEventListener('input', () => {
        const key = input.dataset.cockpitSetting;
        const value = Number(input.value);
        if (this.vehicles && this.vehicles.setInteriorCameraSetting(key, value)) {
          const output = document.querySelector('[data-cockpit-value="' + key + '"]');
          if (output) output.textContent = this.formatCockpitSetting(key, value);
        }
      });
    });
    $('sens').oninput = (e) => { this.player.sensitivity = parseFloat(e.target.value); this.profile.data.settings.sens = parseFloat(e.target.value); this.profile.save(); };
    $('vol').oninput = (e) => { this.audio.setVolume(parseFloat(e.target.value)); this.profile.data.settings.vol = parseFloat(e.target.value); this.profile.save(); };
    $('quality').onchange = (e) => { this.applyQuality(e.target.value); this.profile.data.settings.quality = e.target.value; this.profile.save(); };
    const mapSel = $('map-select');
    if (mapSel) {
      mapSel.value = currentScene;
      mapSel.onchange = (e) => {
        const u = new URL(location.href);
        u.searchParams.set('scene', e.target.value);
        location.href = u.toString();
      };
    }

    document.querySelectorAll('.navbtn').forEach(b => b.onclick = () => {
      document.querySelectorAll('.navbtn').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      document.querySelectorAll('.sec').forEach(s => s.classList.add('hidden'));
      document.getElementById('sec-' + b.dataset.sec).classList.remove('hidden');
      this.audio && this.audio.click && this.audio.click();
    });

    $('outfit-sel').onchange = (e) => { this.profile.equip('outfit', e.target.value); this.player.applyProfile(this.profile); this.refreshMenu(); };
    $('cloth-sel').onchange = (e) => { this.profile.equip('cloth', parseInt(e.target.value, 10)); this.player.applyProfile(this.profile); this.refreshMenu(); };
    $('buy-cap').onclick = () => { const r = this.profile.buy('caps'); this.hud.toast(r.ok ? 'Cap owned!' : r.msg); this.refreshMenu(); };
    $('buy-glasses').onclick = () => { const r = this.profile.buy('glasses'); this.hud.toast(r.ok ? 'Shades owned!' : r.msg); this.refreshMenu(); };
    $('toggle-cap').onclick = () => { this.profile.equip('cap', !this.profile.data.equipped.cap); this.player.applyProfile(this.profile); this.refreshMenu(); };
    $('toggle-glasses').onclick = () => { this.profile.equip('glasses', !this.profile.data.equipped.glasses); this.player.applyProfile(this.profile); this.refreshMenu(); };

    const introSkip = document.getElementById('intro-skip');
    if (introSkip) introSkip.onclick = () => { this.skipIntro = true; };
  }

  bindInput() {
    const I = this.input;
    const driveKeys = this._driveKeys || (this._driveKeys = new Set());
    const driveKeyCodes = new Set([
      'KeyW', 'KeyA', 'KeyS', 'KeyD',
      'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight',
    ]);
    const updateDriveAxes = () => Object.assign(I, resolveDriveAxes(driveKeys));
    addEventListener('keydown', (e) => {
      if (this.state === 'paused' && e.code !== 'Escape') { e.preventDefault(); return; }
      if (driveKeyCodes.has(e.code)) {
        e.preventDefault();
        driveKeys.add(e.code);
        updateDriveAxes();
        return;
      }
      if (e.repeat) return;
      if (this.state === 'playing' && this.civilians?.currentConversation) {
        if (e.code === 'Digit1' || e.code === 'Digit2' || e.code === 'Digit3') {
          e.preventDefault();
          this.civilians.chooseDialogue(Number(e.code.slice(-1)) - 1);
          return;
        }
        if (e.code === 'Escape') {
          e.preventDefault();
          this.civilians.closeConversation();
          return;
        }
      }
      switch (e.code) {
        case 'ShiftLeft': case 'ShiftRight': I.sprint = true; break;
        case 'KeyC': case 'ControlLeft': I.crouch = true; e.preventDefault(); break;
        case 'Space': I.jump = true; e.preventDefault(); break;
        case 'KeyR': if (this.state === 'playing' && !this.player.skydive && !(this.vehicles && this.vehicles.driver)) this.weapons.startReload(); break;
        case 'KeyX': if (this.state === 'playing' && !this.player.skydive && !(this.vehicles && this.vehicles.driver)) this.input.throwGrenade = true; break;
        case 'KeyF': if (this.state === 'playing' && this.nearLoot) this.lootPickup(); else I.climb = true; e.preventDefault(); break;
        case 'KeyZ': if (this.state === 'playing') I.climb = true; e.preventDefault(); break;
        case 'KeyK':
          if (this.state === 'playing' && this.player && !this.player.skydive && this.vehicles) {
            this.vehicles.spawnNearPlayer('bugatti', this.player).then((v) => {
              this.hud.toast(v ? 'BUGATTI READY · PRESS E TO ENTER' : 'NO CLEAR SPACE FOR BUGATTI');
            }).catch((err) => console.error('[Vehicle] Bugatti spawn failed:', err));
          }
          break;
        case 'KeyT':
          if (this.state === 'playing' && this.player && !this.player.skydive && this.vehicles) {
            if (this.transitMenuOpen) { this.transitMenuOpen = false; this.hud.hideTransitMenu(); }
            this.vehicles.spawnNearPlayer('cybertruck', this.player).then((v) => {
              this.hud.toast(v ? 'TESLA READY · PRESS E TO ENTER' : 'NO CLEAR SPACE FOR TESLA');
            }).catch((err) => console.error('[Vehicle] Tesla spawn failed:', err));
          }
          break;
        case 'KeyU':
          if (this.state === 'playing' && !this.player.skydive && !(this.vehicles && this.vehicles.driver) && this.nearTransit && this.world.namedLocations) {
            this.transitMenuOpen = !this.transitMenuOpen;
            if (this.transitMenuOpen) this.hud.showTransitMenu(this.world.namedLocations);
            else this.hud.hideTransitMenu();
          }
          break;
        case 'KeyV':
          if (this.state === 'playing' && this.vehicles && this.vehicles.driver) this.vehicles.toggleInteriorView();
          else if (this.state === 'playing') this.toggleView();
          break;
        case 'F6': window.open('./tools/asset-lab.html', 'strike-command-asset-lab'); break;
        case 'KeyQ': if (this.state === 'playing' && !this.player.skydive && !(this.vehicles && this.vehicles.driver)) this.weapons.swap(1); break;
        case 'KeyE':
          if (this.state === 'playing') {
            if (this.vehicles && this.vehicles.driver) {
              this.vehicles.exit(this.player);
              this.audio.stopEngine();
            } else if (this.civilians && this.player.onGround && !this.player.skydive && this.civilians.tryInteract(this.player)) {
              // Civilian interaction takes priority over nearby vehicle/tool interaction.
            } else if (this.vehicles && this.player.onGround && !this.player.skydive) {
              const preferred = this.vehicles.preferredVehicle;
              const preferredDistance = preferred && this.vehicles.vehicles.includes(preferred)
                ? this.vehicles.surfaceDistance(preferred, this.player.pos.x, this.player.pos.z)
                : Infinity;
              const v = preferredDistance <= 4.5
                ? preferred
                : this.vehicles.nearest(this.player.pos.x, this.player.pos.z, 4.5);
              if (v) {
                this.vehicles.preferredVehicle = null;
                this.vehicles.enter(v, this.player);
              }
              else if (this.tools && this.tools.isOpen()) this.tools.close();
              else if (this.tools) this.tools.open();
            } else if (this.tools && this.tools.isOpen()) this.tools.close();
            else if (this.tools && this.player && this.player.onGround && !this.player.skydive) this.tools.open();
          }
          break;
        case 'BracketLeft': if (this.state === 'playing') this.cycleClothes(-1); break;
        case 'BracketRight': if (this.state === 'playing') this.cycleClothes(1); break;
        case 'KeyB': if (this.state === 'playing') this.toggleCap(); break;
        case 'KeyG': this.godMode = !this.godMode; this.hud.toast(this.godMode ? 'GOD MODE ON' : 'GOD MODE OFF'); break;
        case 'Digit1': case 'Digit2': case 'Digit3': if (this.state === 'playing' && !this.player.skydive && !(this.vehicles && this.vehicles.driver)) this.weapons.equip(parseInt(e.code.slice(5)) - 1); break;
        case 'Digit4': case 'Digit5': case 'Digit6': case 'Digit7': case 'Digit8': case 'Digit9':
          if (this.transitMenuOpen) {
            const idx = parseInt(e.code.slice(5)) - 1;
            const locs = this.world && this.world.namedLocations;
            if (locs && idx >= 0 && idx < locs.length) this.fastTravelTo(locs[idx]);
          }
          break;
        case 'KeyM': if (e.ctrlKey || e.metaKey) { e.preventDefault(); this.toggleFullMap(); } break;
        case 'KeyY': if (this.state === 'playing') this.input.toRoof = true; break;
        case 'KeyO': if (this.state === 'playing') this.toggleOverview(); break;
        case 'F5': if (this.state === 'playing') this.toggleDrone(); break;
        case 'F6': if (this.state === 'playing' && this.world.atmosphere) { this.world.atmosphere.timeSpeed = Math.min((this.world.atmosphere.timeSpeed || 0) + 2, 20); this.hud.toast(`TIME SPEED: ${this.world.atmosphere.timeSpeed.toFixed(0)}x`); } break;
        case 'F7': if (this.state === 'playing' && this.world.atmosphere) { this.world.atmosphere.timeSpeed = Math.max((this.world.atmosphere.timeSpeed || 0) - 2, 0); this.hud.toast(`TIME SPEED: ${this.world.atmosphere.timeSpeed.toFixed(0)}x`); } break;
        case 'F8': if (this.state === 'playing' && this.world.atmosphere) { const tod = this.world.atmosphere; const times = [{name:'MORNING',h:8},{name:'AFTERNOON',h:14},{name:'EVENING',h:18},{name:'NIGHT',h:22}]; let ci = times.findIndex(t => { const d = Math.abs(tod.timeOfDay - t.h); return d < 3 || d > 21; }); ci = (ci + 1) % times.length; tod.setTime(times[ci].h); this.hud.toast(`TIME: ${times[ci].name}`); } break;
        case 'Escape':
          e.preventDefault();
          if (this.state === 'paused') this.resume();
          else if (this.fullMapOpen) this.toggleFullMap();
          else if (this.tools && this.tools.isOpen()) this.tools.close();
          else if (this.state === 'playing') this.pause();
          break;
      }
    });
    addEventListener('keyup', (e) => {
      if (driveKeyCodes.has(e.code)) {
        e.preventDefault();
        if (driveKeys.delete(e.code)) updateDriveAxes();
      }
      switch (e.code) {
        case 'ShiftLeft': case 'ShiftRight': I.sprint = false; break;
        case 'KeyC': case 'ControlLeft': I.crouch = false; break;
        case 'Space': I.jump = false; break;
        case 'KeyF': I.climb = false; break;
        case 'KeyZ': I.climb = false; break;
      }
    });
    addEventListener('blur', () => {
      driveKeys.clear();
      updateDriveAxes();
      I.sprint = false; I.crouch = false; I.jump = false;
    });
    addEventListener('mousedown', (e) => {
      if (this.state !== 'playing' || this.player.skydive || (this.tools && this.tools.isOpen())) return;
      if (e.button === 0) I.fire = true;
      if (e.button === 2) I.ads = true;
    });
    addEventListener('mouseup', (e) => {
      if (this.tools && this.tools.isOpen()) return;
      if (e.button === 0) I.fire = false;
      if (e.button === 2) I.ads = false;
    });
    addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('wheel', (e) => {
      if (this.tools && this.tools.isOpen()) { this.tools.handleWheel(e.deltaY); return; }
      if (this.overview) {
        this.overview.dist = Math.max(15, Math.min(2400, this.overview.dist * (e.deltaY > 0 ? 1.12 : 1 / 1.12)));
        return;
      }
      if (this.state === 'playing' && !this.player.skydive && !(this.vehicles && this.vehicles.driver)) this.weapons.swap(e.deltaY > 0 ? 1 : -1);
    }, { passive: true });
    addEventListener('mousemove', (e) => {
      if (this.state !== 'playing' || this.player.skydive || (this.tools && this.tools.isOpen())) return;
      if (this.drone) {
        this.input.mouseDX = e.movementX; this.input.mouseDY = e.movementY;
        return;
      }
      if (this.overview) {
        if (document.pointerLockElement === this.renderer.domElement || this.lookDrag) {
          this.input.mouseDX = e.movementX; this.input.mouseDY = e.movementY;
        }
        return;
      }
      if (document.pointerLockElement === this.renderer.domElement) {
        this.player.onMouseMove(e.movementX, e.movementY);
        I.mouseDX = e.movementX; I.mouseDY = e.movementY;
      } else if (this.lookDrag) {
        this.player.onMouseMove(e.movementX, e.movementY);
      }
    });
    addEventListener('mousedown', (e) => {
      if (this.state === 'playing' && !this.player.skydive && document.pointerLockElement !== this.renderer.domElement && !(this.tools && this.tools.isOpen())) this.lookDrag = true;
    });
    addEventListener('mouseup', () => { this.lookDrag = false; });
    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement !== this.renderer.domElement && this.state === 'playing' && !this.player.skydive && !(this.tools && this.tools.isOpen()) && !this.drone) this.pause();
    });
  }

  lockPointer() {
    try { const p = this.renderer.domElement.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (e) {}
  }

  formatCockpitSetting(key, value) {
    const degrees = key === 'lookPitch' || key === 'lookYaw';
    return Number(value).toFixed(degrees ? 1 : 2) + (degrees ? '°' : ' m');
  }

  refreshCockpitSettingsUI() {
    const vehicle = this.vehicles && this.vehicles.driver;
    const settings = this.vehicles && this.vehicles.getInteriorCameraSettings();
    const hint = document.getElementById('cockpit-settings-hint');
    const toggle = document.getElementById('cockpit-view-toggle');
    if (hint) hint.textContent = vehicle
      ? vehicle.kind.toUpperCase() + ' · CHANGES SAVE FOR THIS VEHICLE'
      : 'ENTER A VEHICLE TO ADJUST ITS COCKPIT CAMERA. EACH VEHICLE KEEPS ITS OWN SETTINGS.';
    if (toggle) {
      toggle.disabled = !vehicle;
      toggle.textContent = this.vehicles && this.vehicles.interiorView ? 'EXIT COCKPIT VIEW · V' : 'ENTER COCKPIT VIEW · V';
    }
    const reset = document.getElementById('cockpit-reset');
    if (reset) reset.disabled = !vehicle;
    document.querySelectorAll('[data-cockpit-setting]').forEach((input) => {
      const key = input.dataset.cockpitSetting;
      input.disabled = !settings;
      if (settings && Number.isFinite(settings[key])) input.value = String(settings[key]);
      const output = document.querySelector('[data-cockpit-value="' + key + '"]');
      if (output) output.textContent = this.formatCockpitSetting(key, settings ? settings[key] : Number(input.value));
    });
  }

  showPausePanel(panel = 'main') {
    document.getElementById('pause-main-panel').classList.toggle('hidden', panel !== 'main');
    document.getElementById('pause-cockpit-panel').classList.toggle('hidden', panel !== 'cockpit');
    if (panel === 'cockpit') this.refreshCockpitSettingsUI();
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    if (this._driveKeys) this._driveKeys.clear();
    this.input.forward = 0; this.input.right = 0;
    this.input.fire = false; this.input.ads = false;
    this.input.sprint = false; this.input.crouch = false; this.input.jump = false;
    if (document.pointerLockElement) document.exitPointerLock();
    this.showPausePanel('main');
    document.getElementById('pause-screen').style.display = 'flex';
  }

  resume() {
    if (this.state !== 'paused') return;
    document.getElementById('pause-screen').style.display = 'none';
    this.state = 'playing';
    if (this.vehicles && this.vehicles.driver) {
      this.vehicles._camPos = null;
      this.vehicles._camLook = null;
    }
    this.lockPointer();
  }

  toggleFullMap() {
    this.fullMapOpen = !this.fullMapOpen;
    document.getElementById('fullmap-wrap').classList.toggle('hidden', !this.fullMapOpen);
  }

  fastTravelTo(dest) {
    if (!dest || !this.player || !this.profile) return;
    const cost = 50;
    if (this.profile.coins < cost) { this.hud.toast('Not enough coins! ◈' + cost + ' needed'); return; }
    this.profile.spend(cost);
    this.profile.save();
    this.player.pos.set(dest.x, 0.5, dest.z);
    this.player.vel.set(0, 0, 0);
    if (this.physics) this.physics.setPlayerPosition(dest.x, 0.5, dest.z);
    this.transitMenuOpen = false;
    this.hud.hideTransitMenu();
    this.hud.toast('Fast-travel to ' + dest.name + '  ◈' + cost);
    this.audio.click && this.audio.click();
    this.updateHud();
  }

  toggleView() {
    this.player.firstPerson = !this.player.firstPerson;
    // New skinned rig: root contains the mesh; toggling root.visible is correct.
    // In first-person we hide the third-person body but show viewmodel arms + gun.
    // Use new helper so head/pack don't leak into FPS cam.
    if (this.player.char.setFirstPerson) this.player.char.setFirstPerson(this.player.firstPerson);
    else this.player.char.root.visible = !this.player.firstPerson;
    this.weapons.rig.visible = this.player.firstPerson;
    // Ensure weapon mesh is built and visible
    if (this.player.firstPerson && this.weapons.mesh) this.weapons.mesh.visible = true;
    this.audio && this.audio.click && this.audio.click();
    this.hud.toast(this.player.firstPerson ? 'FIRST PERSON' : 'THIRD PERSON');
  }

  cycleClothes(dir) {
    const p = this.player; const n = p.clothesPalette.length;
    p.colorIndex = (p.colorIndex + dir + n) % n;
    this.profile.data.equipped.clothColor = p.colorIndex; this.profile.save();
    p.setAppearance({ shirt: p.clothesPalette[p.colorIndex] });
    this.hud.toast && this.hud.toast('Outfit #' + (p.colorIndex + 1));
  }
  toggleCap() { this.profile.equip('cap', !this.profile.data.equipped.cap); this.player.applyProfile(this.profile); this.hud.toast(this.profile.data.equipped.cap ? 'Cap on' : 'Cap off'); }
  toggleGlasses() { this.profile.equip('glasses', !this.profile.data.equipped.glasses); this.player.applyProfile(this.profile); this.hud.toast(this.profile.data.equipped.glasses ? 'Shades on' : 'Shades off'); }

  damagePlayer(amount, fromEnemy) {
    if (this.godMode) return;
    if (this.state !== 'playing' || this.player.skydive) return;
    this.hp -= amount;
    this.lastDamageT = performance.now() / 1000;
    this.audio.hurt();
    this.fx.addShake(.15);
    if (fromEnemy) {
      const to = fromEnemy.pos.clone().sub(this.player.pos);
      const worldAngle = Math.atan2(-to.x, -to.z);
      const rel = worldAngle - this.player.yaw + Math.PI;
      this.hud.damageFrom(-rel);
    }
    this.hud.setHealth(this.hp, this.maxHp);
    if (this.hp <= 0) this.playerDown();
  }

  airstrikeDamage(p, radius, damage) {
    if (!this.enemyMgr || !this.fx) return;
    for (const e of this.enemyMgr.enemies) {
      if (!e.alive) continue;
      const dist = e.pos.distanceTo(p);
      if (dist < radius) {
        const dmg = damage * (1 - dist / radius) + 20;
        const killed = e.takeDamage(dmg, false);
        if (killed) this.registerKill(e, false, { name: 'PRECISION AIRSTRIKE', headMult: 1 });
      }
    }
    if (this.civilians) this.civilians.fleeFrom(p, radius + 10);
    const pd = this.player.pos.distanceTo(p);
    if (pd < radius) this.damagePlayer(Math.min(damage * (1 - pd / radius) * .5, 80), null);
    this.fx.addShake(.5);
  }

  updateHud() {
    const hostiles = this.enemyMgr ? this.enemyMgr.aliveCount() : 0;
    this.hud.setScore(this.stats.score, this.stats.kills, this.stats.deaths, 1, hostiles);
    this.hud.setHealth(this.hp, this.maxHp);
    const av = document.getElementById('alive-num'); if (av) av.textContent = hostiles;
    const ch = document.getElementById('coins-hud-v'); if (ch) ch.textContent = this.profile.coins;
  }

  // ===== LOOT =====
  lootPickup() {
    if (!this.nearLoot || !this.world) return;
    const L = this.nearLoot;
    const i = this.world.lootPoints.indexOf(L);
    if (i < 0) return;
    const at = new THREE.Vector3(L.x, 1, L.z);
    this.fx.burst(at, 14, new THREE.Color(1, .85, .3), 2.6, .6, .5, 1.1);
    this.audio.click && this.audio.click();
    const roll = Math.random();
    let msg = '';
    if (roll < 0.45) {
      const coins = 30 + ((Math.random() * 50) | 0);
      this.profile.addCoins(coins);
      msg = 'LOOTED: ◈' + coins;
    } else if (roll < 0.75) {
      const d = this.weapons.def;
      if (d && d.state) { d.state.reserve += 60; msg = 'LOOTED: +60 ' + d.name + ' AMMO'; }
      else { this.profile.addCoins(40); msg = 'LOOTED: ◈40'; }
    } else {
      const heal = Math.min(30, this.maxHp - this.hp);
      this.hp += heal;
      this.hud.setHealth(this.hp, this.maxHp);
      msg = heal > 0 ? 'LOOTED: +' + heal + ' INTEGRITY' : 'LOOTED: ◈25';
    }
    this.hud.toast && this.hud.toast(msg);
    this.world.removeLoot(i);
    this.nearLoot = null;
    this.stats.looted = (this.stats.looted || 0) + 1;
    this.updateHud();
  }

  // ===== CIVILIANS =====
  civilianDown(civ) {
    this.stats.civilianKills = (this.stats.civilianKills || 0) + 1;
    this.stats.score = Math.max(0, this.stats.score - 75);
    this.killChain.count = 0;
    this.killChain.timer = 0;
    this.fx.bloodPuff(civ.pos.clone().add(new THREE.Vector3(0, 1.1, 0)));
    this.hud.toast && this.hud.toast('CIVILIAN DOWN — -75 SCORE');
    this.audio.hurt && this.audio.hurt();
    this.updateHud();
  }

  // ===== MAIN LOOP =====
  tick() {
    const dt = Math.min(this.clock.getDelta(), .05);
    if (this.state === 'playing') this.tickPlaying(dt);
    else if (this.state === 'menu') this.tickMenu(dt);
    else if (this.state === 'intro') { this.tickIntro(dt); this.renderer.render(this.scene, this.camera); return; }
    this.fx.update(dt);
    if (this.state === 'playing' && this.fx.shake > 0) {
      this.fx.getShakeOffset(this.shakeOffset);
      this.camera.position.add(this.shakeOffset);
    }
    this.renderer.render(this.scene, this.camera);
    this.tools.renderPip();
  }

  tickMenu(dt) {
    const t = performance.now() / 1000 * .08;
    this.camera.position.set(Math.cos(t) * 34, 12, Math.sin(t) * 34);
    this.camera.lookAt(0, 2, 0);
    if (this.camera.fov !== 60) { this.camera.fov = 60; this.camera.updateProjectionMatrix(); }
  }

  tickPlaying(dt) {
    const now = performance.now() / 1000;

    // overview camera: freeze the sim, orbit the fully-rendered map like the editor
    if (this.overview) {
      this.updateOverview(dt);
      this.updateAmbient(dt);
      this.hud.drawMinimap(this.player, this.enemyMgr.enemies, this.world);
      this.updateHud();
      return;
    }

    // drone camera: free-fly, no physics/enemies
    if (this.drone) {
      this.updateDrone(dt);
      this.updateAmbient(dt);
      this.hud.drawMinimap(this.player, this.enemyMgr.enemies, this.world);
      this.updateHud();
      return;
    }

    // ---- ismailg privileges: unlimited ammo ----
    if (this.ismailg) {
      for (const d of this.weapons.defs) {
        if (d.state) { d.state.mag = d.mag; d.state.reserve = 9999; }
      }
    }

    // ---- ambient hostiles: keep the streets alive ----
    if (this.enemyMgr.aliveCount() < this._hostileCap) {
      this._hostileTimer -= dt;
      if (this._hostileTimer <= 0) {
        this._hostileTimer = 6 + Math.random() * 8;
        this.spawnHostile();
      }
    }

    if (this.hp < this.maxHp && now - (this.lastDamageT || 0) > 4) {
      this.hp = Math.min(this.maxHp, this.hp + dt * 18); this.hud.setHealth(this.hp, this.maxHp);
    }

    const lowHp = 1 - this.hp / this.maxHp;
    this.hud.setVignette(Math.min(lowHp * .9 + (now - (this.lastDamageT || 0) < .3 ? .3 : 0), 1));

    if (this.killChain.timer > 0) { this.killChain.timer -= dt; if (this.killChain.timer <= 0) this.killChain.count = 0; }

    this.planeTimer -= dt;
    if (this.planeTimer <= 0) { this.planeTimer = 24 + Math.random() * 30; this.spawnPlane(); }

    const driving = !!(this.vehicles && this.vehicles.driver);
    const entering = !!(this.vehicles && this.vehicles._enterState);

    // Move kinematic gameplay objects first, then advance Rapier. Stepping
    // before movement made collision/query state trail player and vehicle transforms.
    if (driving || entering) {
      this.vehicles.update(dt, this.input, this.player);
    } else {
      this.player.update(dt, this.input);
    }
    if (this.physics && this.physics.world) {
      this.physics.step(dt, (physicsDt) => {
        if (this.vehicles) this.vehicles.stepPhysics(physicsDt);
      });
    }
    if (this.vehicles) {
      this.vehicles.syncDynamicBodies(dt);
      if (this.vehicles.driver) {
        this.vehicles.updateChaseCamera(dt, this.input, this.player);
      }
    }

    // update atmospheric sky (time-of-day, lighting, clouds)
    if (this.world.atmosphere) {
      this.world.atmosphere.update(dt, this.camera.position);
    }
    const wt = this.weapons.def.id;
    if (wt !== this.player.weaponType) { this.player.weaponType = wt; this.player.char.setAppearance({ weaponType: wt }); }

    this.world.updateReactive(dt, this.fx, this.audio, this.player, this.enemyMgr.enemies, this);
    const roof = this.player.nearestRoof();
    this.hud.showRoofPrompt(!!roof && !this.player.skydive && !driving);
    if (this.input.toRoof && !driving) { if (roof) this.player.goToRoof(roof); this.input.toRoof = false; }
    if (this.input.toRoof && driving) this.input.toRoof = false;

    // climb prompt
    const cpEl = document.getElementById('climb-prompt');
    if (cpEl) {
      const nearClimb = !driving && !this.player.skydive && this.player.onGround && !this.player.nearPortal && this.player.nearestClimbable();
      cpEl.classList.toggle('hidden', !nearClimb || !!this.player.climbing);
      if (nearClimb) {
        cpEl.textContent = nearClimb.type === 'fence'
          ? 'PRESS [Z] TO JUMP THE FENCE'
          : 'PRESS [Z] TO CLIMB';
      }
    }

    // portal prompt
    const ppEl = document.getElementById('portal-prompt');
    if (ppEl) {
      const nearPortal = !driving && !this.player.skydive && this.player.onGround && this.player.nearPortal;
      ppEl.classList.toggle('hidden', !nearPortal);
      if (nearPortal) {
        ppEl.textContent = this.player.insideBuilding ? 'PRESS [F] TO EXIT' : 'PRESS [F] TO ENTER';
      }
    }

    // vehicle enter/exit prompt
    const vpEl = document.getElementById('vehicle-prompt');
    if (vpEl) {
      const near = !driving && this.player.onGround && !this.player.skydive && this.vehicles && this.vehicles.nearest(this.player.pos.x, this.player.pos.z, 4.5);
      vpEl.classList.toggle('hidden', !near && !driving);
      if (driving) vpEl.textContent = 'PRESS [E] TO EXIT · [↑/W] DRIVE · [↓/S] BRAKE+REVERSE · [←→/AD] STEER · [SPACE] HANDBRAKE';
      else if (near) vpEl.textContent = 'PRESS [E] TO ENTER ' + near.kind.toUpperCase();
    }

    const dp = document.getElementById('device-prompt');
    if (dp) dp.classList.toggle('hidden', !this.player.onGround || this.player.skydive || (this.tools && this.tools.isOpen()));

    this.nearTransit = null;
    if (this.player.onGround && !this.player.skydive && this.world.transitPoints && this.world.transitPoints.length) {
      const pp = this.player.pos;
      const ts = this.world.transitPoints[0];
      if (ts && Math.hypot(pp.x - ts.x, pp.z - ts.z) < 6) this.nearTransit = ts;
    }
    const tpEl = document.getElementById('transit-prompt');
    if (tpEl) {
      const show = !!this.nearTransit && !this.transitMenuOpen;
      tpEl.classList.toggle('hidden', !show);
      if (show) {
        const coin = this.profile ? this.profile.coins : 0;
        tpEl.textContent = 'PRESS [U] TO FAST-TRAVEL  ◈' + coin;
      }
    }
    if (this.transitMenuOpen && !this.nearTransit) {
      this.transitMenuOpen = false;
      this.hud.hideTransitMenu();
    }

    // ---- loot pickup ----
    this.nearLoot = null;
    if (this.player.onGround && !this.player.skydive && !driving) {
      const pp = this.player.pos;
      for (const L of this.world.lootPoints) {
        if (L.looted) continue;
        if (Math.hypot(L.x - pp.x, L.z - pp.z) < 2.2) { this.nearLoot = L; break; }
      }
    }
    const lpEl = document.getElementById('loot-prompt');
    if (lpEl) lpEl.classList.toggle('hidden', !this.nearLoot);

    // weather button — always visible when playing
    const wbEl = document.getElementById('weather-btn');
    if (wbEl) {
      wbEl.style.display = (this.state === 'playing' && !driving) ? 'block' : 'none';
      wbEl.onclick = () => { if (this.world.atmosphere) { const tod = this.world.atmosphere; const times = [{name:'MORNING',h:8},{name:'AFTERNOON',h:14},{name:'EVENING',h:18},{name:'NIGHT',h:22}]; let ci = times.findIndex(t => { const d = Math.abs(tod.timeOfDay - t.h); return d < 3 || d > 21; }); ci = (ci + 1) % times.length; tod.setTime(times[ci].h); this.hud.toast(`TIME: ${times[ci].name}`); } };
      const ap = this.world.atmosphere ? this.world.atmosphere.phaseName : 'day';
      wbEl.textContent = `F8: ${ap.toUpperCase()}`;
    }

    this.updateAmbient(dt);
    const hittables = this.civilians ? [...this.enemyMgr.enemies, ...this.civilians.alive()] : this.enemyMgr.enemies;
    if (!this.player.skydive && !driving) {
      this.weapons.update(dt, this.input, hittables, (e, h, d) => this.registerKill(e, h, d), this);
      this.enemyMgr.update(dt, this.player, (dmg, from) => this.damagePlayer(dmg, from), this);
    } else {
      this.enemyMgr.update(dt, this.player, (dmg, from) => this.damagePlayer(dmg, from), this);
    }
    if (this.civilians) {
      const shots = this.stats.shotsFired || 0;
      const playerFired = shots > (this._lastCivilianShotCount || 0);
      this._lastCivilianShotCount = shots;
      if (playerFired) this.civilians.fleeFrom(this.player.pos, 25);
      this.civilians.update(dt, {
        player: this.player,
        vehicles: this.vehicles,
        aiming: this.weapons.adsT > 0.45,
        camera: this.camera,
        gunshot: playerFired,
      });
    }
    this.tools.update(dt);
    this.input.jump = false;

    const spread = (this.weapons.def.spreadHip * (1 - this.weapons.adsT) + this.weapons.def.spreadAds * this.weapons.adsT) * 900 + 8;
    this.hud.setCrosshairSpread(driving ? 0 : (this.weapons.adsT > .7 ? 2 : spread));
    const showCrosshair = !this.player.skydive && !driving && this.weapons.adsT > 0.3;
    document.getElementById('crosshair').style.opacity = showCrosshair ? Math.min(1, (this.weapons.adsT - 0.3) * 2.5) : 0;
    this.hud.setStance(driving
      ? `DRIVING · ${Math.round(Math.abs(this.vehicles.driver.speed) * 3.6)} KM/H · [E] EXIT`
      : (this.player.crouched ? 'CROUCHED' : this.player.sprinting ? 'SPRINTING' : 'STANDING') + ' · [SHIFT] SPRINT · [C] CROUCH');
    this.hud.drawMinimap(this.player, this.enemyMgr.enemies, this.world);
    if (this.fullMapOpen) this.hud.drawFullMap(this.player, this.enemyMgr.enemies, this.world);
    this.updateHud();
  }

  // ---- INTRO ----
  playIntro() {
    this.state = 'intro';
    const cap = document.getElementById('intro-cap');
    const skip = document.getElementById('intro-skip');
    const scr = document.getElementById('intro-screen');
    if (scr) scr.style.display = 'flex';
    if (cap) { cap.textContent = 'ONE CITY · CRAFTED BY HAND'; cap.style.opacity = 1; }
    this.audio.init();
    this.audio.startMusic(true);

    const introObjs = [];
    const soldiers = [];
    const outfits = ['camo', 'navy', 'soldier', 'casual', 'cadpat', 'urban'];
    const pts = (this.world.spawnPoints && this.world.spawnPoints.length) ? this.world.spawnPoints
      : [new THREE.Vector3(0, 0, 0), new THREE.Vector3(20, 0, -20), new THREE.Vector3(-20, 0, 20)];
    for (let i = 0; i < 10; i++) {
      const base = pts[(Math.random() * pts.length) | 0].clone();
      base.x += (Math.random() - .5) * 14; base.z += (Math.random() - .5) * 14;
      const ch = new Character({
        skin: [0.7, 0.56, 0.44], pants: [0.18, 0.2, 0.22], shirt: [0.3, 0.3, 0.26],
        boots: [0.12, 0.12, 0.12], vest: [0.26, 0.27, 0.23], helmet: Math.random() < .7,
        weaponType: ['rifle', 'rifle', 'smg', 'shotgun', 'dmr', 'lmg'][(Math.random() * 6) | 0],
        weaponTint: [0.15, 0.15, 0.18]
      });
      ch.setAppearance({ outfit: outfits[(Math.random() * outfits.length) | 0], glasses: Math.random() < .4, showCap: Math.random() < .3 });
      ch.root.position.copy(base);
      ch.root.rotation.y = Math.random() * Math.PI * 2;
      this.scene.add(ch.root); introObjs.push(ch.root);
      soldiers.push({ ch, phase: Math.random() * 10, yaw: ch.root.rotation.y, aim: Math.random() < .5, idx: i });
    }

    const planes = [];
    const mkPlane = (scale, color) => {
      const g = new THREE.Group();
      const m = new THREE.MeshStandardMaterial({ color, roughness: .8, metalness: .2 });
      g.add(new THREE.Mesh(new THREE.BoxGeometry(3.4 * scale, 2.6 * scale, 22 * scale), m));
      const wing = new THREE.Mesh(new THREE.BoxGeometry(26 * scale, .5 * scale, 4.4 * scale),
        new THREE.MeshStandardMaterial({ color: 0x2b2f2a, roughness: .85 }));
      wing.position.y = .6 * scale; g.add(wing);
      const glow = new THREE.Mesh(new THREE.SphereGeometry(.9 * scale, 8, 6), new THREE.MeshBasicMaterial({ color: 0x66ccff }));
      glow.position.set(0, 0, -11.5 * scale); g.add(glow);
      return g;
    };
    for (let i = 0; i < 4; i++) {
      const g = mkPlane(1, 0x39432f);
      const dir = i % 2 ? 1 : -1;
      g.position.set(-dir * 170, 34 + i * 7, (Math.random() - .5) * 80);
      g.rotation.y = dir > 0 ? Math.PI / 2 : -Math.PI / 2;
      this.scene.add(g); introObjs.push(g);
      planes.push({ mesh: g, vx: dir * (30 + Math.random() * 16) });
    }

    this.introObjs = introObjs;
    this.intro = { soldiers, planes, t: 0, cap, skip, scr, duration: 13, fxT: 0 };

    const end = () => {
      if (this.state !== 'intro') return;
      if (scr) scr.style.display = 'none';
      for (const o of introObjs) this.scene.remove(o);
      this.intro = null; this.introObjs = null;
      if (this.camera.fov !== 60) { this.camera.fov = 60; this.camera.updateProjectionMatrix(); }
      this.openMenu();
    };
    this._endIntro = end;
    if (skip) skip.onclick = () => { this.audio && this.audio.click && this.audio.click(); end(); };
    this._capTimer = 0; this._capIdx = 0;
    if (location.search.includes('autostart')) { end(); }
  }

  tickIntro(dt) {
    const I = this.intro; if (!I) return;
    I.t += dt; I.fxT += dt;
    this._capTimer += dt;
    if (this._capTimer > 3.2) {
      this._capTimer = 0; this._capIdx = (this._capIdx + 1) % 4;
      const caps = ['ONE CITY · CRAFTED BY HAND', 'NO GRIDS · NO GENERATION · PLACED BY HAND', 'EVERY CORNER TELLS A STORY', 'STRIKE COMMAND'];
      if (I.cap) { I.cap.style.opacity = 0; setTimeout(() => { if (I.cap) { I.cap.textContent = caps[this._capIdx]; I.cap.style.opacity = 1; } }, 400); }
    }
    I.tickCount = (I.tickCount || 0) + 1;
    for (const s of I.soldiers) {
      s.phase += dt * (2 + Math.random() * 1.5);
      if (I.tickCount % 3 !== s.idx % 3) continue;
      const speed = 0.5 + (s.aim ? 0.3 : 0.8);
      s.ch.setState({
        x: s.ch.root.position.x, y: 0, z: s.ch.root.position.z, yaw: s.yaw, pitch: 0,
        crouch: 0, aim: s.aim ? 1 : 0, moveX: 0, moveZ: 1, sprint: 0, lean: 0,
        speed, phase: s.phase, weaponType: s.ch.weaponType, airborne: 0, landDip: 0
      });
      if (s.aim && Math.random() < dt * 6) {
        const muzzle = s.ch.root.position.clone().add(new THREE.Vector3(0, 1.35, 0));
        const tgt = I.soldiers[(Math.random() * I.soldiers.length) | 0].ch.root.position.clone().add(new THREE.Vector3(0, 1.3, 0));
        this.fx.tracer(muzzle, tgt, 0xffd36a);
        this.fx.flashLight(muzzle, 0xffd070, 8, .04);
        this.audio.enemyShot(muzzle.distanceTo(tgt));
      }
    }
    for (const p of I.planes) {
      p.mesh.position.x += p.vx * dt;
      if (Math.abs(p.mesh.position.x) > 180) p.mesh.position.x = -Math.sign(p.vx) * 180;
    }
    if (I.fxT > 0.35) {
      I.fxT = 0;
      const a = Math.random() * Math.PI * 2, r = 20 + Math.random() * 90;
      const at = new THREE.Vector3(Math.cos(a) * r, 0.5, Math.sin(a) * r);
      this.fx.burst(at, 16, new THREE.Color(1, .5 + Math.random() * .3, .12), 4, .7, .9, 2.2);
      this.fx.flashLight(at.clone().add(new THREE.Vector3(0, 2, 0)), 0xff5a10, 14, .12);
      this.fx.smoke(at.clone().add(new THREE.Vector3(0, 1, 0)), .8, 1.2, 2.4);
      this.audio.explosion ? this.audio.explosion() : this.audio.enemyShot(60);
    }
    this.fx.update(dt);

    const t = I.t, D = I.duration, k = Math.min(t / D, 1);
    const ang = t * 0.3;
    const rad = 54 - k * 30 + Math.sin(t * 0.7) * 6;
    const h = 22 - k * 12 + Math.sin(t * 0.9) * 4;
    this.camera.position.set(Math.cos(ang) * rad, h, Math.sin(ang) * rad);
    this.camera.lookAt(Math.sin(t * 0.4) * 10, 2 + Math.cos(t * 0.5) * 3, Math.cos(t * 0.3) * 10);
    if (this.camera.fov !== 60) { this.camera.fov = 60; this.camera.updateProjectionMatrix(); }

    if (this.skipIntro || t >= D) { this.skipIntro = false; this._endIntro(); }
  }

  spawnPlane() {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.4, .5, 5), new THREE.MeshStandardMaterial({ color: 0x2b2f2a, roughness: .8 }));
    g.add(body);
    const wing = new THREE.Mesh(new THREE.BoxGeometry(9, .12, 1.2), new THREE.MeshStandardMaterial({ color: 0x39432f, roughness: .85 }));
    g.add(wing);
    const dir = Math.random() < .5 ? 1 : -1;
    const y = 34 + Math.random() * 10;
    g.position.set(-dir * 160, y, (Math.random() - .5) * 120);
    g.rotation.y = dir > 0 ? Math.PI / 2 : -Math.PI / 2;
    this.scene.add(g);
    this.ambientPlanes.push({ mesh: g, vx: dir * (28 + Math.random() * 14) });
    this.audio.planeDrone(60);
  }

  updateAmbient(dt) {
    for (let i = this.ambientPlanes.length - 1; i >= 0; i--) {
      const p = this.ambientPlanes[i];
      p.mesh.position.x += p.vx * dt;
      if (Math.abs(p.mesh.position.x) > 180) { this.scene.remove(p.mesh); this.ambientPlanes.splice(i, 1); }
    }
  }

  setupRenderer() {
    this.renderScale = 1;
    this.renderer = new THREE.WebGLRenderer({
      antialias: false,
      powerPreference: 'high-performance',
      depth: true,
      stencil: false,
      preserveDrawingBuffer: false,
      alpha: false,
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.25));
    this.renderer.setSize(innerWidth, innerHeight, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;
    this.renderer.domElement.className = 'game';
    this.renderer.domElement.addEventListener('webglcontextlost', (event) => {
      event.preventDefault();
      console.warn('[Renderer] WebGL context lost; waiting for browser restoration.');
    }, false);
    this.renderer.domElement.addEventListener('webglcontextrestored', () => {
      console.info('[Renderer] WebGL context restored.');
    }, false);
    document.getElementById('app').appendChild(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, .05, 400);
    this.scene.add(this.camera);
    addEventListener('resize', () => {
      const q = this.profile?.data?.settings?.quality || 'medium';
      const scale = q === 'ultra-low' ? 0.5 : q === 'low' ? 0.65 : 1;
      const dpr = Math.min(devicePixelRatio || 1, q === 'ultra-low' || q === 'low' ? 1 : 1.25);
      this.renderer.setPixelRatio(dpr);
      this.renderer.setSize(Math.max(1, Math.round(innerWidth * scale)), Math.max(1, Math.round(innerHeight * scale)), false);
      this.renderer.domElement.style.width = '100%';
      this.renderer.domElement.style.height = '100%';
      this.camera.aspect = innerWidth / Math.max(1, innerHeight);
      this.camera.updateProjectionMatrix();
    });
  }

  applyQuality(q) {
    this.profile.data.settings.quality = q; this.profile.save();
    this.renderScale = q === 'ultra-low' ? 0.5 : q === 'low' ? 0.65 : 1;
    const qSel = document.getElementById('quality'); if (qSel) qSel.value = q;
    if (q === 'ultra-low') {
      this.renderer.setPixelRatio(1);
      this.renderer.setSize(Math.round(innerWidth * 0.5), Math.round(innerHeight * 0.5), false);
      this.renderer.domElement.style.width = innerWidth + 'px';
      this.renderer.domElement.style.height = innerHeight + 'px';
      this.renderer.toneMapping = THREE.NoToneMapping;
      if (this.world) { this.world.sun.castShadow = false; }
      this.camera.far = 200; this.camera.updateProjectionMatrix();
    } else if (q === 'low') {
      this.renderer.setPixelRatio(1);
      this.renderer.setSize(Math.round(innerWidth * 0.65), Math.round(innerHeight * 0.65), false);
      this.renderer.domElement.style.width = innerWidth + 'px';
      this.renderer.domElement.style.height = innerHeight + 'px';
      this.renderer.toneMapping = THREE.NoToneMapping;
      if (this.world) { this.world.sun.castShadow = false; }
      this.camera.far = 250; this.camera.updateProjectionMatrix();
    } else if (q === 'medium') {
      this.renderer.setSize(innerWidth, innerHeight, true);
      this.renderer.setPixelRatio(1.0);
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      if (this.world) { this.world.sun.castShadow = true; this.world.sun.shadow.mapSize.setScalar(1024); this.world.sun.shadow.map?.dispose(); this.world.sun.shadow.map = null; }
      this.camera.far = 300; this.camera.updateProjectionMatrix();
    } else {
      this.renderer.setSize(innerWidth, innerHeight, true);
      this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.25));
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      if (this.world) { this.world.sun.castShadow = true; this.world.sun.shadow.mapSize.setScalar(2048); this.world.sun.shadow.map?.dispose(); this.world.sun.shadow.map = null; }
      this.camera.far = 400; this.camera.updateProjectionMatrix();
    }
    if (!this.renderer.capabilities || !this.renderer.capabilities.isWebGL2) {
      this.renderer.setPixelRatio(1);
      this.renderer.setSize(Math.round(innerWidth * 0.5), Math.round(innerHeight * 0.5), false);
      this.renderer.domElement.style.width = innerWidth + 'px';
      this.renderer.domElement.style.height = innerHeight + 'px';
    }
  }
}

const __game = new Game();
if (typeof window !== 'undefined') window.__game = __game;
