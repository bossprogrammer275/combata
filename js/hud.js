// HUD: DOM overlay + canvas minimap.
export class HUD {
  constructor() {
    this.$ = (id) => document.getElementById(id);
    this.map = this.$('minimap').getContext('2d');
    this.full = this.$('fullmap').getContext('2d');
    this.hitT = null;
    this.feedItems = [];
  }

  show() { this.$('hud').style.display = 'block'; }
  hide() { this.$('hud').style.display = 'none'; }

  // transient bottom-center notification (outfit changes, cap toggle, etc.)
  toast(msg) {
    let el = this.$('toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'toast';
      el.style.cssText = 'position:fixed;left:50%;bottom:14%;transform:translateX(-50%);' +
        'background:rgba(0,0,0,.55);color:#e8e8e8;padding:6px 14px;border-radius:6px;' +
        'font:600 14px system-ui,sans-serif;pointer-events:none;z-index:50;' +
        'transition:opacity .25s;opacity:0;';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.style.opacity = '1';
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => { el.style.opacity = '0'; }, 1100);
  }

  setWeapon(def, state) {
    this.$('wname').textContent = def.name;
    this.$('mag').textContent = state.mag;
    this.$('reserve').textContent = state.reserve;
    this.$('firemode').textContent = def.mode;
  }

  setReloading(on) {
    this.$('ammo-panel').classList.toggle('reloading', on);
  }

  showReloadHint(on) {
    this.$('reload-hint').style.display = on ? 'block' : 'none';
  }

  setHealth(hp, max) {
    const bar = this.$('hpbar');
    bar.firstElementChild.style.width = Math.max(0, hp / max * 100) + '%';
    bar.classList.toggle('low', hp < 40);
  }

  setStance(text) { this.$('stance').textContent = text; }

  showRoofPrompt(on) {
    const el = this.$('roof-prompt');
    if (el) el.style.display = on ? 'block' : 'none';
  }

  showAchievementToast(ach, color, chime, onDone) {
    const el = document.getElementById('achievement-toast');
    if (!el) return;
    const icon = document.getElementById('ach-icon');
    const name = document.getElementById('ach-name');
    const desc = document.getElementById('ach-desc');
    const tier = document.getElementById('ach-tier');
    if (icon) icon.textContent = ach.icon || '🏆';
    if (name) { name.textContent = ach.name; name.style.color = color; }
    if (desc) desc.textContent = ach.desc;
    if (tier) { tier.textContent = ach.tier.toUpperCase(); tier.style.color = color; }
    el.style.borderColor = color;
    el.classList.add('show');
    clearTimeout(this._achT);
    this._achT = setTimeout(() => {
      el.classList.remove('show');
      if (onDone) setTimeout(onDone, 400);
    }, 2500);
  }

  setScore(score, kills, deaths, wave, left) {
    const e = (id, v) => { const el = this.$(id); if (el) el.textContent = v; };
    e('score', score); e('kills', kills); e('deaths', deaths);
    e('wave-num', wave); e('enemies-left', left);
  }

  setCrosshairSpread(px) {
    this.$('crosshair').style.setProperty('--sp', px + 'px');
  }

  hitmarker(kill) {
    const el = this.$('hitmarker');
    el.classList.remove('show', 'kill');
    void el.offsetWidth;
    el.classList.add('show');
    if (kill) el.classList.add('kill');
  }

  killfeed(playerName, weaponName, enemyName, headshot) {
    const feed = this.$('killfeed');
    const div = document.createElement('div');
    div.className = 'kf';
    div.innerHTML = `<span class="me">${playerName}</span><span class="wep">[${weaponName}${headshot ? ' · HEADSHOT' : ''}]</span><span class="foe">${enemyName}</span>`;
    feed.prepend(div);
    while (feed.children.length > 5) feed.lastChild.remove();
    setTimeout(() => { div.style.transition = 'opacity .5s'; div.style.opacity = '0'; setTimeout(() => div.remove(), 500); }, 3800);
  }

  medal(title, sub = '') {
    const wrap = this.$('medals');
    const div = document.createElement('div');
    div.className = 'medal';
    div.innerHTML = title + (sub ? `<div class="sub">${sub}</div>` : '');
    wrap.appendChild(div);
    setTimeout(() => div.remove(), 1400);
  }

  waveBanner(title, sub) {
    const b = this.$('wave-banner');
    if (!b) return;
    const t = b.querySelector('.t'), s = b.querySelector('.s');
    if (t) t.textContent = title;
    if (s) s.textContent = sub;
    b.style.display = 'block';
    clearTimeout(this._wbT);
    this._wbT = setTimeout(() => { if (b) b.style.display = 'none'; }, 3000);
  }

  damageFrom(angle) {
    const wrap = this.$('dmg-ind');
    const arc = document.createElement('div');
    arc.className = 'dmg-arc';
    arc.style.transform = `rotate(${angle}rad)`;
    arc.style.opacity = '1';
    wrap.appendChild(arc);
    setTimeout(() => { arc.style.transition = 'opacity .6s'; arc.style.opacity = '0'; setTimeout(() => arc.remove(), 650); }, 120);
  }

  setVignette(v) {
    this.$('damage-vignette').style.opacity = v;
  }

  setQuality(q) { this._quality = q; }
  drawMinimap(player, enemies, world) {
    this._mmFrame = (this._mmFrame ?? 0) + 1;
    if (this._quality === 'ultra-low' && this._mmFrame % 2 !== 0) return;
    if (this._quality === 'low' && this._mmFrame % 2 !== 0) return;
    const ctx = this.map, W = 160, H = 160;
    // show the WHOLE world (every zone / biome) — not just a bubble around the player
    const bounds = world.bounds || 160;
    const range = bounds * 2 * 1.04;
    const sx = W / range, sz = H / range;
    const toX = (x) => W / 2 + x * sx;
    const toY = (z) => H / 2 + z * sz;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(6,14,10,.88)';
    ctx.fillRect(0, 0, W, H);

    // world perimeter
    ctx.strokeStyle = 'rgba(125,255,90,.5)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(toX(-bounds), toY(-bounds), bounds * 2 * sx, bounds * 2 * sz);
    ctx.lineWidth = 1;

    // grid
    ctx.strokeStyle = 'rgba(125,255,90,.07)';
    for (let i = 1; i < 8; i++) {
      ctx.beginPath(); ctx.moveTo(i * W / 8, 0); ctx.lineTo(i * W / 8, H); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i * H / 8); ctx.lineTo(W, i * H / 8); ctx.stroke();
    }
    // colliders (walls/buildings) — always visible so the whole map reads
    ctx.fillStyle = 'rgba(150,170,150,.45)';
    for (const c of world.colliders) {
      if (c.max.y < 1) continue;
      const x = toX(c.min.x), z = toY(c.min.z);
      ctx.fillRect(x, z, Math.max(1, (c.max.x - c.min.x) * sx), Math.max(1, (c.max.z - c.min.z) * sz));
    }
    // HOSTILES — always shown as small red dots
    for (const e of enemies) {
      if (!e.alive) continue;
      ctx.fillStyle = '#cc3322';
      ctx.beginPath();
      ctx.arc(toX(e.pos.x), toY(e.pos.z), 2.0, 0, 7);
      ctx.fill();
    }

    // player arrow (centered, since the whole map is shown)
    const px = toX(player.pos.x), pz = toY(player.pos.z);
    ctx.save();
    ctx.translate(px, pz);
    ctx.rotate(-player.yaw);
    ctx.fillStyle = '#7dff5a';
    ctx.beginPath();
    ctx.moveTo(0, -5); ctx.lineTo(3.6, 4); ctx.lineTo(0, 2); ctx.lineTo(-3.6, 4);
    ctx.closePath(); ctx.fill();
    ctx.restore();

    // border
    ctx.strokeStyle = 'rgba(125,255,90,.35)';
    ctx.strokeRect(.5, .5, W - 1, H - 1);
  }

  // Full-screen tactical map (Ctrl+M). Reuses the same projection but larger, with
  // readable labels, a legend, and a live player arrow so you can orient instantly.
  drawFullMap(player, enemies, world) {
    const ctx = this.full, S = 520, H = 520;
    const bounds = world.bounds || 200;
    const range = bounds * 2 * 1.04;
    const sx = S / range, sz = H / range;
    const toX = (x) => S / 2 + x * sx;
    const toY = (z) => H / 2 + z * sz;
    ctx.clearRect(0, 0, S, H);
    ctx.fillStyle = '#0a140e'; ctx.fillRect(0, 0, S, H);
    // perimeter + grid
    ctx.strokeStyle = 'rgba(125,255,90,.5)'; ctx.lineWidth = 2;
    ctx.strokeRect(toX(-bounds), toY(-bounds), bounds * 2 * sx, bounds * 2 * sz);
    ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(125,255,90,.07)';
    for (let i = 1; i < 12; i++) {
      ctx.beginPath(); ctx.moveTo(i * S / 12, 0); ctx.lineTo(i * S / 12, H); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i * H / 12); ctx.lineTo(S, i * H / 12); ctx.stroke();
    }
    // buildings
    ctx.fillStyle = 'rgba(150,170,150,.4)';
    for (const c of world.colliders) {
      if (c.max.y < 1) continue;
      ctx.fillRect(toX(c.min.x), toY(c.min.z), Math.max(1, (c.max.x - c.min.x) * sx), Math.max(1, (c.max.z - c.min.z) * sz));
    }
    // hostiles
    for (const e of enemies) {
      if (!e.alive) continue;
      ctx.fillStyle = '#ff4a3a';
      ctx.beginPath(); ctx.arc(toX(e.pos.x), toY(e.pos.z), 3.5, 0, 7); ctx.fill();
    }
    // player arrow
    const px = toX(player.pos.x), pz = toY(player.pos.z);
    ctx.save(); ctx.translate(px, pz); ctx.rotate(-player.yaw);
    ctx.fillStyle = '#7dff5a';
    ctx.beginPath(); ctx.moveTo(0, -14); ctx.lineTo(10, 11); ctx.lineTo(0, 6); ctx.lineTo(-10, 11);
    ctx.closePath(); ctx.fill(); ctx.restore();
    ctx.strokeStyle = 'rgba(125,255,90,.35)'; ctx.strokeRect(.5, .5, S - 1, H - 1);
    // legend
    const legend = this.$('fullmap-legend');
    if (legend && (!legend.dataset.built)) {
      const items = [{ c: '#ff4a3a', n: 'HOSTILE' }, { c: '#7dff5a', n: 'YOU' }];
      legend.innerHTML = items.map(i => `<span><i style="background:${i.c}"></i>${i.n}</span>`).join('');
      legend.dataset.built = '1';
    }
  }

  // ---- TRANSIT MENU ----
  showTransitMenu(locations) {
    const el = document.getElementById('transit-menu');
    if (!el) return;
    el.classList.remove('hidden');
    const list = el.querySelector('.transit-list');
    list.innerHTML = '';
    for (let i = 0; i < locations.length; i++) {
      const L = locations[i];
      const row = document.createElement('div');
      row.className = 'tr-item';
      row.innerHTML = `<span class="tr-num">${i + 1}</span>${L.name} <span class="tr-cur">◈50</span>`;
      row.onclick = () => {
        window.__transitPick && window.__transitPick(i);
      };
      list.appendChild(row);
    }
    const cv = document.getElementById('transit-coins-val');
    if (cv && window.__getCoins) cv.textContent = window.__getCoins();
  }
  hideTransitMenu() {
    const el = document.getElementById('transit-menu');
    if (el) el.classList.add('hidden');
  }
}
