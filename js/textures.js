// Procedural canvas textures — no external image assets.
import * as THREE from 'three';

// Texture cache — avoids regenerating canvas textures across World rebuilds.
const _texCache = new Map();

function canvas(size) { const c = document.createElement('canvas'); c.width = c.height = size; return c; }

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function noiseLayer(ctx, size, base, amp, cell = 4) {
  const img = ctx.getImageData(0, 0, size, size), d = img.data;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4;
    const n = (Math.random() - 0.5) * amp + Math.sin(x / cell) * Math.cos(y / cell) * amp * 0.3;
    d[i] = base[0] + n; d[i + 1] = base[1] + n; d[i + 2] = base[2] + n; d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

function tex(c, repeat = 1, srgb = true, key = null) {
  if (key && _texCache.has(key)) return _texCache.get(key);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (key) _texCache.set(key, t);
  return t;
}

function speckle(ctx, size, count, colors, rMin = 0.4, rMax = 1.6) {
  for (let i = 0; i < count; i++) {
    const c = colors[(Math.random() * colors.length) | 0];
    ctx.fillStyle = c;
    ctx.beginPath(); ctx.arc(Math.random() * size, Math.random() * size, rMin + Math.random() * (rMax - rMin), 0, 7); ctx.fill();
  }
}

function cracks(ctx, size, n = 40) {
  ctx.strokeStyle = 'rgba(20,20,22,.45)'; ctx.lineWidth = 1;
  for (let i = 0; i < n; i++) {
    ctx.beginPath(); let x = Math.random() * size, y = Math.random() * size;
    ctx.moveTo(x, y);
    for (let j = 0; j < 4; j++) { x += (Math.random() - .5) * 30; y += (Math.random() - .5) * 30; ctx.lineTo(x, y); }
    ctx.stroke();
  }
}

// Water-runoff dirt: blobs + drip streaks concentrated in the lower third.
function baseStains(ctx, size, count = 18) {
  for (let i = 0; i < count; i++) {
    const y = size * (0.55 + Math.random() * 0.45);
    const w = 8 + Math.random() * 30, h = 10 + Math.random() * 42;
    ctx.fillStyle = `rgba(30,28,24,${0.06 + Math.random() * 0.1})`;
    ctx.beginPath(); ctx.ellipse(Math.random() * size, y, w, h, 0, 0, 7); ctx.fill();
  }
  ctx.lineWidth = 1.2;
  for (let i = 0; i < count / 2; i++) {
    const x = Math.random() * size;
    ctx.strokeStyle = `rgba(30,28,24,${0.05 + Math.random() * 0.08})`;
    ctx.beginPath(); ctx.moveTo(x, size * (0.6 + Math.random() * 0.3));
    ctx.quadraticCurveTo(x + (Math.random() - .5) * 6, size * 0.85, x + (Math.random() - .5) * 10, size); ctx.stroke();
  }
}

// Soft low-opacity mottling blobs to kill flat fills.
function mottle(ctx, size, count = 40, alpha = 0.05) {
  for (let i = 0; i < count; i++) {
    const r = 10 + Math.random() * 50;
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
    g.addColorStop(0, `rgba(0,0,0,${alpha})`); g.addColorStop(1, 'transparent');
    ctx.save(); ctx.translate(Math.random() * size, Math.random() * size); ctx.fillStyle = g;
    ctx.fillRect(-r, -r, r * 2, r * 2); ctx.restore();
  }
}

// ---------------------------------------------------------------------------
// GROUND — dry grass / earth mix, olive-tinted. Optional tint overrides hue.
// ---------------------------------------------------------------------------
export function makeGroundTexture(size = 512, tint = null) {
  const key = 'ground|' + size + '|' + (tint ? tint.join(',') : 'default');
  const c = canvas(size), ctx = c.getContext('2d');
  const base = tint || [118, 124, 100];
  noiseLayer(ctx, size, base, 3, 32);
  speckle(ctx, size, 40, ['rgba(84,104,64,.08)', 'rgba(96,112,72,.06)', 'rgba(60,64,48,.07)'], 0.8, 1.2);
  return tex(c, 18, true, key);
}

// ---------------------------------------------------------------------------
// ASPHALT ROAD — dark gray aggregate with patches and cracks.
// Optional tile markings are retained for other uses; the city renderer uses
// plain asphalt plus junction-aware lane-marking geometry.
// ---------------------------------------------------------------------------
export function makeRoadTexture(size = 1024, laneMarks = true) {
  const key = 'road|' + size + '|' + (laneMarks ? 'marked' : 'plain');
  const c = canvas(size), ctx = c.getContext('2d');
  noiseLayer(ctx, size, [58, 60, 63], 15, 3);
  speckle(ctx, size, 2800, ['rgba(38,40,43,.5)', 'rgba(72,74,78,.4)', 'rgba(48,50,53,.55)', 'rgba(30,31,33,.4)'], 0.4, 1.5);
  mottle(ctx, size, 60, 0.04);
  // repaired patches
  for (let i = 0; i < 9; i++) {
    const x = Math.random() * size, y = Math.random() * size, r = 16 + Math.random() * 40;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(24,25,27,.3)'); g.addColorStop(1, 'transparent');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
  }
  // oil / rubber streaks
  for (let i = 0; i < 10; i++) {
    ctx.fillStyle = `rgba(${20 + Math.random() * 14},${20 + Math.random() * 14},${22 + Math.random() * 14},${.12 + Math.random() * .14})`;
    ctx.beginPath();
    ctx.ellipse(Math.random() * size, Math.random() * size, 12 + Math.random() * 26, 3 + Math.random() * 8, Math.random() * Math.PI, 0, 7);
    ctx.fill();
  }
  cracks(ctx, size, 46);
  if (laneMarks) {
    // For a 6m longitudinal UV tile, a half-tile dash gives roughly 3m paint
    // with a 3m gap. The former 10px dash repeated every 6m looked like noise.
    const dashLength = size * 0.5;
    const centerWidth = Math.max(5, size * 0.008);
    const edgeWidth = Math.max(5, size * 0.008);
    for (let y = 0; y < size; y += dashLength * 2) {
      const worn = 0.72 + Math.random() * 0.22;
      ctx.fillStyle = `rgba(228,226,214,${worn})`;
      ctx.fillRect(size * 0.5 - centerWidth / 2, y, centerWidth, dashLength * 0.96);
    }
    ctx.fillStyle = 'rgba(236,234,224,.82)';
    ctx.fillRect(size * 0.03 - edgeWidth / 2, 0, edgeWidth, size);
    ctx.fillRect(size * 0.97 - edgeWidth / 2, 0, edgeWidth, size);
    // Worn paint chips should be subtle, not erase whole dash segments.
    for (let i = 0; i < 14; i++) {
      ctx.fillStyle = 'rgba(58,60,63,.8)';
      ctx.fillRect(size * 0.5 - centerWidth / 2, Math.random() * size, centerWidth, 2 + Math.random() * 5);
    }
  }
  return tex(c, 1, true, key);
}

// ---------------------------------------------------------------------------
// SIDEWALK — concrete pavers with offset joints, stains and moss.
// ---------------------------------------------------------------------------
export function makeSidewalkTexture(size = 512) {
  const key = 'sidewalk|' + size;
  const c = canvas(size), ctx = c.getContext('2d');
  noiseLayer(ctx, size, [148, 146, 142], 14, 4);
  const slab = size / 3;
  ctx.strokeStyle = 'rgba(88,86,82,.65)'; ctx.lineWidth = 3;
  for (let i = 0; i <= 3; i++) {
    ctx.beginPath(); ctx.moveTo(i * slab, 0); ctx.lineTo(i * slab, size); ctx.stroke();
  }
  for (let i = 0; i <= 3; i++) {
    const off = (i % 2) ? slab / 2 : 0;
    ctx.beginPath(); ctx.moveTo(0, i * slab + off); ctx.lineTo(size, i * slab + off); ctx.stroke();
  }
  // slab tone variation
  for (let i = 0; i < 10; i++) {
    ctx.fillStyle = `rgba(${110 + Math.random() * 50},${108 + Math.random() * 48},${104 + Math.random() * 46},${.08 + Math.random() * .1})`;
    ctx.fillRect(Math.random() * size, Math.random() * size, 40 + Math.random() * 90, 34 + Math.random() * 80);
  }
  mottle(ctx, size, 40, 0.05);
  baseStains(ctx, size, 14);
  // stains + moss in joints
  for (let i = 0; i < 14; i++) {
    ctx.fillStyle = `rgba(${60 + Math.random() * 30},${52 + Math.random() * 24},${44 + Math.random() * 20},${.1 + Math.random() * .12})`;
    ctx.beginPath(); ctx.arc(Math.random() * size, Math.random() * size, 5 + Math.random() * 16, 0, 7); ctx.fill();
  }
  for (let i = 0; i < 10; i++) {
    ctx.fillStyle = `rgba(${66 + Math.random() * 24},${86 + Math.random() * 22},${52 + Math.random() * 16},${.14 + Math.random() * .12})`;
    ctx.fillRect(Math.random() * size, Math.random() * size, 2 + Math.random() * 30, 2);
    ctx.fillRect(Math.random() * size, Math.random() * size, 2, 2 + Math.random() * 30);
  }
  return tex(c);
}

// ---------------------------------------------------------------------------
// CONCRETE — plain poured panels with faint seams + grime.
// ---------------------------------------------------------------------------
export function makeConcreteTexture(size = 512, tint = [150, 148, 145]) {
  const key = 'concrete|' + size + '|' + tint.join(',');
  const c = canvas(size), ctx = c.getContext('2d');
  noiseLayer(ctx, size, tint, 16, 5);
  ctx.strokeStyle = 'rgba(40,40,42,.4)'; ctx.lineWidth = 2;
  for (let i = 1; i < 4; i++) {
    ctx.beginPath(); ctx.moveTo(0, i * size / 4); ctx.lineTo(size, i * size / 4); ctx.stroke();
  }
  // stains
  for (let i = 0; i < 16; i++) {
    const r = 8 + Math.random() * 30;
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
    g.addColorStop(0, `rgba(${40 - (tint[0] > 128 ? 12 : 4)},${38 - (tint[1] > 128 ? 12 : 4)},${34 - (tint[2] > 128 ? 12 : 4)},.18)`);
    g.addColorStop(1, 'transparent');
    ctx.save(); ctx.translate(Math.random() * size, Math.random() * size); ctx.fillStyle = g;
    ctx.fillRect(-r, -r, r * 2, r * 2); ctx.restore();
  }
  mottle(ctx, size, 50, 0.045);
  baseStains(ctx, size, 16);
  speckle(ctx, size, 700, ['rgba(255,255,255,.06)', 'rgba(0,0,0,.08)'], 0.4, 1.2);
  return tex(c);
}

// ---------------------------------------------------------------------------
// BRICK — running bond with mortar, per-brick tone variation, smoked bricks.
// ---------------------------------------------------------------------------
export function makeBrickTexture(size = 512, tint = null) {
  const key = 'brick|' + size + '|' + (tint ? tint.join(',') : 'default');
  const c = canvas(size), ctx = c.getContext('2d');
  const base = tint || [152, 100, 84];
  const mortar = [186, 178, 166];
  ctx.fillStyle = `rgb(${mortar[0]},${mortar[1]},${mortar[2]})`;
  ctx.fillRect(0, 0, size, size);
  const bw = size / 6, bh = size / 10;
  for (let r = 0; r < 10; r++) {
    const off = (r % 2) * bw / 2;
    for (let i = -1; i < 7; i++) {
      const x = i * bw + off, y = r * bh;
      const v = (Math.random() - .5) * 30;
      const dark = Math.random() < 0.12 ? 0.78 : 1;
      const r2 = base[0] * dark + v, g2 = base[1] * dark + v, b2 = base[2] * dark + v;
      ctx.fillStyle = `rgb(${r2 | 0},${g2 | 0},${b2 | 0})`;
      ctx.fillRect(x + 2, y + 2, bw - 4, bh - 4);
      // fake AO per brick: light top edge (sun), dark bottom-right edge
      ctx.fillStyle = 'rgba(255,255,255,.10)'; ctx.fillRect(x + 2, y + 2, bw - 4, 2);
      ctx.fillStyle = 'rgba(0,0,0,.22)'; ctx.fillRect(x + 2, y + bh - 5, bw - 4, 3);
      ctx.fillStyle = 'rgba(0,0,0,.12)'; ctx.fillRect(x + bw - 8, y + 4, 3, bh - 9);
      // subtle surface texture
      speckle(ctx, size, 8, ['rgba(0,0,0,.06)'], 0.4, 1);
    }
  }
  const ctxN = c.getContext('2d');
  ctxN.globalAlpha = .12; ctxN.drawImage((() => { const n = canvas(size); noiseLayer(n.getContext('2d'), size, [128, 128, 128], 70, 5); return n; })(), 0, 0);
  // grime near bottom
  const gr = ctx.createLinearGradient(0, size * .75, 0, size);
  gr.addColorStop(0, 'transparent'); gr.addColorStop(1, 'rgba(40,36,30,.25)');
  ctx.fillStyle = gr; ctx.fillRect(0, 0, size, size);
  baseStains(ctx, size, 12);
  return tex(c, 1, true, key);
}

// ---------------------------------------------------------------------------
// METAL — brushed panels with rivets + rust. Tintable (containers etc).
// ---------------------------------------------------------------------------
export function makeMetalTexture(size = 512, base = [96, 100, 104]) {
  const key = 'metal|' + size + '|' + base.join(',');
  const c = canvas(size), ctx = c.getContext('2d');
  noiseLayer(ctx, size, base, 14, 3);
  // brushed lines
  ctx.globalAlpha = .1;
  for (let i = 0; i < size; i += 2) {
    ctx.fillStyle = Math.random() > .5 ? '#fff' : '#000';
    ctx.fillRect(0, i, size, 1);
  }
  ctx.globalAlpha = 1;
  // panel seams (vertical, every 1m scale)
  ctx.strokeStyle = 'rgba(20,20,24,.5)'; ctx.lineWidth = 3;
  for (let x = size / 4; x < size; x += size / 4) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, size); ctx.stroke();
  }
  // rivets
  ctx.fillStyle = 'rgba(30,32,34,.8)';
  for (let x = 16; x < size; x += 40) for (let y = 16; y < size; y += 40) {
    ctx.beginPath(); ctx.arc(x, y, 2.4, 0, 7); ctx.fill();
    ctx.fillStyle = 'rgba(200,205,210,.5)'; ctx.beginPath(); ctx.arc(x - 1, y - 1, 1.1, 0, 7); ctx.fill();
    ctx.fillStyle = 'rgba(30,32,34,.8)';
  }
  // rust patches
  for (let i = 0; i < 12; i++) {
    ctx.fillStyle = `rgba(${120 + Math.random() * 40},${60 + Math.random() * 20},30,${.1 + Math.random() * .2})`;
    ctx.beginPath(); ctx.arc(Math.random() * size, Math.random() * size, 5 + Math.random() * 16, 0, 7); ctx.fill();
  }
  return tex(c, 1, true, key);
}

// ---------------------------------------------------------------------------
// GLASS — one window tile with frame + mullions + reflection (for windows).
// ---------------------------------------------------------------------------
export function makeGlassTexture(size = 256) {
  const key = 'glass|' + size;
  const c = canvas(size), ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, size, size);
  g.addColorStop(0, '#9fb6c8'); g.addColorStop(.45, '#66798c'); g.addColorStop(.55, '#5b6c7e'); g.addColorStop(1, '#3c4856');
  ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
  // sky reflection streak
  ctx.fillStyle = 'rgba(255,255,255,.10)';
  ctx.beginPath(); ctx.moveTo(size * .18, 0); ctx.lineTo(size * .62, 0); ctx.lineTo(size * .28, size); ctx.lineTo(0, size * .55); ctx.closePath(); ctx.fill();
  // interior haze
  const hz = ctx.createLinearGradient(0, size, 0, 0);
  hz.addColorStop(0, 'rgba(20,26,32,.35)'); hz.addColorStop(.5, 'rgba(20,26,32,.05)'); hz.addColorStop(1, 'transparent');
  ctx.fillStyle = hz; ctx.fillRect(0, 0, size, size);
  // frame
  ctx.strokeStyle = '#22262a'; ctx.lineWidth = 8; ctx.strokeRect(4, 4, size - 8, size - 8);
  ctx.fillStyle = 'rgba(222,226,230,.35)'; ctx.fillRect(4, 4, size - 8, 2);
  // mullions
  ctx.strokeStyle = '#2a2e33'; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(size / 2, 4); ctx.lineTo(size / 2, size - 4); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(4, size / 2); ctx.lineTo(size - 4, size / 2); ctx.stroke();
  return tex(c, 1, true, key);
}

// ---------------------------------------------------------------------------
// GRAVEL ROOF — dark bitumen with stone chips.
// ---------------------------------------------------------------------------
export function makeRoofTexture(size = 512) {
  const key = 'roof|' + size;
  const c = canvas(size), ctx = c.getContext('2d');
  noiseLayer(ctx, size, [74, 72, 70], 14, 3);
  speckle(ctx, size, 1600, ['rgba(110,108,104,.5)', 'rgba(60,58,56,.5)', 'rgba(130,126,120,.35)', 'rgba(40,40,40,.5)'], 0.4, 1.6);
  mottle(ctx, size, 40, 0.05);
  baseStains(ctx, size, 12);
  // old patch lines
  ctx.strokeStyle = 'rgba(30,30,32,.5)'; ctx.lineWidth = 4;
  for (let i = 0; i < 6; i++) {
    ctx.beginPath();
    ctx.moveTo(Math.random() * size, Math.random() * size);
    ctx.lineTo(Math.random() * size, Math.random() * size); ctx.stroke();
  }
  return tex(c, 1, true, key);
}

// ---------------------------------------------------------------------------
// SHINGLES — asphalt roof shingles, weathered rows.
// ---------------------------------------------------------------------------
export function makeShingleTexture(size = 512, tint = [92, 90, 88]) {
  const key = 'shingle|' + size + '|' + tint.join(',');
  const c = canvas(size), ctx = c.getContext('2d');
  ctx.fillStyle = `rgb(${tint[0]},${tint[1]},${tint[2]})`;
  ctx.fillRect(0, 0, size, size);
  const rowH = size / 8;
  for (let r = 0; r < 9; r++) {
    for (let i = 0; i < 7; i++) {
      const v = (Math.random() - .5) * 26;
      const f = Math.random() < .12 ? .7 : 1;
      ctx.fillStyle = `rgb(${(tint[0] * f + v) | 0},${(tint[1] * f + v) | 0},${(tint[2] * f + v) | 0})`;
      ctx.fillRect(i * size / 6 - 2, r * rowH, size / 6 + 3, rowH - 2);
      // lit top edge (sun exposure), shadow under the row above
      ctx.fillStyle = 'rgba(255,255,255,.08)';
      ctx.fillRect(i * size / 6 - 2, r * rowH, size / 6 + 3, 2);
      ctx.fillStyle = 'rgba(0,0,0,.25)';
      ctx.fillRect(i * size / 6 - 2, r * rowH + rowH - 5, size / 6 + 3, 4);
    }
  }
  speckle(ctx, size, 900, ['rgba(0,0,0,.12)', 'rgba(255,255,255,.05)'], 0.4, 1.2);
  mottle(ctx, size, 40, 0.05);
  return tex(c, 1, true, key);
}

// ---------------------------------------------------------------------------
// CLAY TILE ROOF — terracotta barrel tiles.
// ---------------------------------------------------------------------------
export function makeTileTexture(size = 512, tint = [168, 84, 56]) {
  const key = 'tile|' + size + '|' + tint.join(',');
  const c = canvas(size), ctx = c.getContext('2d');
  ctx.fillStyle = `rgb(${tint[0]},${tint[1]},${tint[2]})`;
  ctx.fillRect(0, 0, size, size);
  const cols = 8, tileW = size / cols;
  const rowH = size / 7;
  for (let r = 0; r < 8; r++) {
    const off = (r % 2) * tileW / 2;
    for (let i = -1; i < cols + 1; i++) {
      const v = (Math.random() - .5) * 26;
      const x = i * tileW + off;
      ctx.fillStyle = `rgb(${(tint[0] + v) | 0},${(tint[1] + v) | 0},${(tint[2] + v * .7) | 0})`;
      ctx.beginPath();
      ctx.ellipse(x + tileW / 2, r * rowH + rowH / 2, tileW / 2, rowH / 2 + 2, 0, 0, Math.PI * 2);
      ctx.fill();
      // lit upper-left edge, shadowed lower-right edge (fake AO)
      ctx.fillStyle = 'rgba(255,230,200,.10)';
      ctx.beginPath();
      ctx.ellipse(x + tileW / 2 - tileW * .12, r * rowH + rowH * .30, tileW * .3, rowH * .22, 0, 0, Math.PI * 2);
      ctx.fill();
      // ridge shadow
      ctx.fillStyle = 'rgba(60,20,10,.28)';
      ctx.beginPath();
      ctx.ellipse(x + tileW / 2, r * rowH + rowH - 3, tileW / 2, 3.4, 0, 0, Math.PI * 2);
ctx.fill();
    }
  }
  return tex(c, 1, true, key);
}

// ---------------------------------------------------------------------------
// MOSQUE DOME — radial tile bands with per-band shading + faint gold seams.
// UVs of a hemisphere map: u around the latitude, v down the meridian, so we
// draw concentric arcs as horizontal bands and vertical meridian seams.
// ---------------------------------------------------------------------------
export function makeDomeTexture(size = 256, tint = [30, 110, 82]) {
  const c = canvas(size), ctx = c.getContext('2d');
  noiseLayer(ctx, size, tint, 14, 4);
  const bands = 10, bandH = size / bands;
  for (let b = 0; b < bands; b++) {
    const y = b * bandH;
    // per-band tone + top-light / bottom-shade falloff toward the pole
    const falloff = 1 - b / bands * 0.55;
    const v = (Math.random() - .5) * 10;
    ctx.fillStyle = `rgba(${(tint[0] * falloff + v) | 0},${(tint[1] * falloff + v) | 0},${(tint[2] * falloff + v) | 0},.35)`;
    ctx.fillRect(0, y, size, bandH);
    ctx.fillStyle = 'rgba(255,255,255,.06)';
    ctx.fillRect(0, y, size, 2);
    ctx.fillStyle = 'rgba(0,0,0,.18)';
    ctx.fillRect(0, y + bandH - 2, size, 2);
    // meridian tile seams, staggered per band
    const n = 7;
    const off = (b % 2) * size / n / 2;
    ctx.strokeStyle = 'rgba(0,0,0,.16)'; ctx.lineWidth = 1.5;
    for (let m = 0; m < n; m++) {
      const mx2 = (m * size / n + off) % size;
      ctx.beginPath(); ctx.moveTo(mx2, y); ctx.lineTo(mx2 + 1, y + bandH); ctx.stroke();
    }
  }
  // faint gold accent seams (bands 3 and 7)
  for (const gb of [3, 7]) {
    ctx.fillStyle = 'rgba(217,178,74,.30)';
    ctx.fillRect(0, gb * bandH, size, 2.5);
  }
  // sparse mottle so it isn't perfectly uniform
  mottle(ctx, size, 30, 0.04);
  return tex(c);
}

// ---------------------------------------------------------------------------
// CORRUGATED METAL — wavy panels with rust streaks.
// ---------------------------------------------------------------------------
export function makeCorrugatedTexture(size = 512, tint = [126, 128, 126]) {
  const key = 'corrugated|' + size + '|' + tint.join(',');
  const c = canvas(size), ctx = c.getContext('2d');
  noiseLayer(ctx, size, tint, 12, 3);
  const ribW = size / 20;
  for (let x = 0; x < size; x += ribW) {
    const lit = (x / ribW) % 2 === 0;
    ctx.fillStyle = lit ? 'rgba(255,255,255,.10)' : 'rgba(0,0,0,.16)';
    ctx.fillRect(x, 0, ribW, size);
    // per-rib top highlight / bottom shadow for vertical light falloff
    ctx.fillStyle = lit ? 'rgba(255,255,255,.07)' : 'rgba(255,255,255,.02)';
    ctx.fillRect(x, 0, ribW, 4);
    ctx.fillStyle = 'rgba(0,0,0,.10)';
    ctx.fillRect(x, size - 4, ribW, 4);
  }
  // horizontal panel seams every 1.2m
  ctx.strokeStyle = 'rgba(30,30,34,.5)'; ctx.lineWidth = 2.4;
  for (let y = size / 4; y < size; y += size / 4) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(size, y); ctx.stroke();
  }
  // rivets along seams
  ctx.fillStyle = 'rgba(30,32,36,.75)';
  for (let y = size / 4; y <= size; y += size / 4) for (let x = 10; x < size; x += 26) {
    ctx.beginPath(); ctx.arc(x, y, 1.6, 0, 7); ctx.fill();
  }
  speckle(ctx, size, 300, ['rgba(120,64,40,.12)'], 0.5, 2);
  baseStains(ctx, size, 10);
  return tex(c, 1, true, key);
}

// ---------------------------------------------------------------------------
// WOOD PLANK SIDING — horizontal clapboards with grain.
// ---------------------------------------------------------------------------
export function makePlankTexture(size = 512, tint = [122, 96, 70]) {
  const key = 'plank|' + size + '|' + tint.join(',');
  const c = canvas(size), ctx = c.getContext('2d');
  const rows = 8, ph = size / rows;
  for (let r = 0; r < rows; r++) {
    const v = (Math.random() - .5) * 22;
    ctx.fillStyle = `rgb(${(tint[0] + v) | 0},${(tint[1] + v) | 0},${(tint[2] + v) | 0})`;
    ctx.fillRect(0, r * ph, size, ph - 2);
    // lit top edge of each clapboard
    ctx.fillStyle = 'rgba(255,255,255,.07)';
    ctx.fillRect(0, r * ph, size, 2);
    // plank end seams (staggered)
    ctx.fillStyle = 'rgba(40,28,16,.55)';
    const sx = (r % 2) ? size * .33 : size * .66;
    ctx.fillRect(sx, r * ph, 2, ph - 2);
    // grain lines
    ctx.strokeStyle = 'rgba(60,44,28,.30)'; ctx.lineWidth = 1;
    for (let g = 0; g < 3; g++) {
      const gy = r * ph + 4 + g * (ph / 4);
      ctx.beginPath(); ctx.moveTo(0, gy);
      for (let x = 0; x < size; x += 32) ctx.lineTo(x, gy + Math.sin(x / 24) * 1.6);
      ctx.stroke();
    }
    // nail heads
    ctx.fillStyle = 'rgba(30,22,14,.8)';
    for (let nx = 14; nx < size; nx += 54) { ctx.beginPath(); ctx.arc(nx, r * ph + ph / 2, 1.4, 0, 7); ctx.fill(); }
  }
  // lap shadow under each plank
  ctx.fillStyle = 'rgba(0,0,0,.28)';
  for (let r = 0; r < rows; r++) ctx.fillRect(0, r * ph + ph - 4, size, 3);
  baseStains(ctx, size, 10);
  return tex(c, 1, true, key);
}

// ---------------------------------------------------------------------------
// PANELED WOOD DOOR.
// ---------------------------------------------------------------------------
export function makeDoorTexture(size = 256, tint = [104, 74, 50]) {
  const key = 'door|' + size + '|' + tint.join(',');
  const c = canvas(size), ctx = c.getContext('2d');
  ctx.fillStyle = `rgb(${tint[0]},${tint[1]},${tint[2]})`;
  ctx.fillRect(0, 0, size, size);
  // vertical grain
  ctx.strokeStyle = 'rgba(40,26,14,.35)'; ctx.lineWidth = 1;
  for (let x = 6; x < size; x += 5) {
    ctx.beginPath(); ctx.moveTo(x, 0);
    for (let y = 0; y < size; y += 20) ctx.lineTo(x + Math.sin(y / 14) * 1.2, y);
    ctx.stroke();
  }
  // inset panels (4 or 6)
  const panels = [
    [0.12, 0.10, 0.76, 0.32],
    [0.12, 0.46, 0.76, 0.32],
    [0.12, 0.82, 0.76, 0.12],
  ];
  for (const [px, py, pw, ph] of panels) {
    ctx.fillStyle = `rgba(0,0,0,.22)`;
    ctx.fillRect(px * size, py * size, pw * size, ph * size);
    ctx.fillStyle = `rgb(${(tint[0] * .82) | 0},${(tint[1] * .82) | 0},${(tint[2] * .82) | 0})`;
    ctx.fillRect(px * size + 3, py * size + 3, pw * size - 6, ph * size - 6);
    ctx.strokeStyle = 'rgba(20,12,6,.6)'; ctx.lineWidth = 2;
    ctx.strokeRect(px * size + 3, py * size + 3, pw * size - 6, ph * size - 6);
  }
  // handle
  ctx.fillStyle = '#c9a227';
  ctx.beginPath(); ctx.arc(size * .84, size * .52, 3.2, 0, 7); ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,.4)'; ctx.beginPath(); ctx.arc(size * .84, size * .52, 1.2, 0, 7); ctx.fill();
  // frame
  ctx.strokeStyle = '#241a10'; ctx.lineWidth = 5; ctx.strokeRect(2, 2, size - 4, size - 4);
  return tex(c, 1, true, key);
}

// ---------------------------------------------------------------------------
// ROLLER SHUTTER — corrugated roll-up door.
// ---------------------------------------------------------------------------
export function makeRollerTexture(size = 256) {
  const key = 'roller|' + size;
  const c = canvas(size), ctx = c.getContext('2d');
  ctx.fillStyle = '#585a5c';
  ctx.fillRect(0, 0, size, size);
  const n = 8, bh = size / n;
  for (let r = 0; r < n; r++) {
    ctx.fillStyle = (r % 2) ? 'rgba(0,0,0,.12)' : 'rgba(255,255,255,.08)';
    ctx.fillRect(0, r * bh, size, bh);
    ctx.strokeStyle = 'rgba(30,30,34,.5)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(0, r * bh); ctx.lineTo(size, r * bh); ctx.stroke();
  }
  // center latch strip
  ctx.fillStyle = 'rgba(28,30,34,.85)';
  ctx.fillRect(size / 2 - 6, 0, 12, size);
  ctx.fillStyle = 'rgba(90,94,100,.9)';
  ctx.fillRect(size / 2 - 3, size * .45, 6, size * .18);
  return tex(c, 1, true, key);
}

// ---------------------------------------------------------------------------
// BUILDING FACADES — full wall textures with a real window grid.
// style: 'office' | 'tenement' | 'industrial' | 'cottage'
// faceW / faceH are wall dimensions in meters. seed makes each face unique.
// ---------------------------------------------------------------------------
function drawBrickWall(ctx, size, rnd, brick, mortar) {
  const bw = size / 8, bh = size / 12;
  ctx.fillStyle = `rgb(${mortar[0]},${mortar[1]},${mortar[2]})`;
  ctx.fillRect(0, 0, size, size);
  for (let r = 0; r < 12; r++) {
    const off = (r % 2) * bw / 2;
    for (let i = -1; i < 9; i++) {
      const x = i * bw + off, y = r * bh;
      const v = (rnd() - .5) * 34;
      const f = rnd() < .1 ? .72 : 1;
      ctx.fillStyle = `rgb(${(brick[0] * f + v) | 0},${(brick[1] * f + v) | 0},${(brick[2] * f + v) | 0})`;
      ctx.fillRect(x + 1.5, y + 1.5, bw - 3, bh - 3);
      ctx.fillStyle = 'rgba(0,0,0,.16)'; ctx.fillRect(x + 1.5, y + 1.5, bw - 3, 2.5);
    }
  }
}

function drawPlasterWall(ctx, size, rnd, plaster) {
  ctx.fillStyle = `rgb(${plaster[0]},${plaster[1]},${plaster[2]})`;
  ctx.fillRect(0, 0, size, size);
  speckle(ctx, size, 900, ['rgba(0,0,0,.07)', 'rgba(255,255,255,.05)', 'rgba(90,80,60,.06)'], 0.4, 2);
  // horizontal floor seams
  ctx.strokeStyle = 'rgba(70,70,74,.35)'; ctx.lineWidth = 2.4;
  for (let y = size / 3; y < size; y += size / 3) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(size, y); ctx.stroke();
  }
  // damp patch near base
  const gr = ctx.createLinearGradient(0, size * .82, 0, size);
  gr.addColorStop(0, 'transparent'); gr.addColorStop(1, 'rgba(40,40,44,.28)');
  ctx.fillStyle = gr; ctx.fillRect(0, 0, size, size);
}

function drawCorrugatedWall(ctx, size, rnd, steel) {
  ctx.fillStyle = `rgb(${steel[0]},${steel[1]},${steel[2]})`;
  ctx.fillRect(0, 0, size, size);
  const ribW = size / 22;
  for (let x = 0; x < size; x += ribW) {
    ctx.fillStyle = (x / ribW | 0) % 2 === 0 ? 'rgba(255,255,255,.10)' : 'rgba(0,0,0,.15)';
    ctx.fillRect(x, 0, ribW, size);
  }
  ctx.strokeStyle = 'rgba(28,30,34,.5)'; ctx.lineWidth = 2.4;
  for (let y = size / 4; y < size; y += size / 4) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(size, y); ctx.stroke();
  }
  speckle(ctx, size, 260, ['rgba(110,60,36,.14)', 'rgba(0,0,0,.08)'], 0.5, 2.2);
}

export function makeFacadeTexture(faceW, faceH, style = 'office', seed = 1) {
  const key = 'facade|' + faceW + '|' + faceH + '|' + style + '|' + seed;
  const base = Math.max(faceW, faceH) * 30;
  const S = Math.max(256, Math.min(1024, Math.pow(2, Math.round(Math.log2(base)))));
  const c = canvas(S), ctx = c.getContext('2d');
  const rnd = mulberry32((seed * 7919 + 13) >>> 0);
  const PX = S / faceW, PY = S / faceH;
  const mx = (x) => x * PX;
  const my = (y) => S - y * PY;

  const cols = Math.max(2, Math.min(16, Math.round(faceW / 3.4)));
  const rows = Math.max(2, Math.min(18, Math.round((faceH - 1.2) / 3.1)));
  const cellW = faceW / cols, cellH = faceH / rows;
  const winW = cellW * 0.68, winH = cellH * 0.64;
  const rndM = () => Math.random();

  // ---- wall base ----
  if (style === 'tenement') { drawBrickWall(ctx, S, rnd, [152, 96, 78], [178, 168, 152]); }
  else if (style === 'industrial') { drawCorrugatedWall(ctx, S, rnd, [126, 128, 124]); }
  else if (style === 'cottage') { drawPlasterWall(ctx, S, rnd, [176, 164, 142]); }
  else if (style === 'apartment') { drawPlasterWall(ctx, S, rnd, [172, 168, 158]); }
  else if (style === 'parking') {
    ctx.fillStyle = 'rgb(150,148,144)'; ctx.fillRect(0, 0, S, S);
    speckle(ctx, S, 700, ['rgba(0,0,0,.08)', 'rgba(255,255,255,.05)'], 0.4, 1.6);
  }
  else if (style === 'church') { drawPlasterWall(ctx, S, rnd, [188, 182, 168]); }
  else if (style === 'mosque') {
    drawPlasterWall(ctx, S, rnd, [198, 188, 162]);
    // green decorative band rows
    ctx.fillStyle = 'rgba(26,84,64,.55)';
    ctx.fillRect(0, S * .5 - 4, S, 6);
    ctx.fillStyle = 'rgba(22,70,54,.6)';
    ctx.fillRect(0, S * .72 - 4, S, 5);
    // arched blind niche row
    ctx.fillStyle = 'rgba(0,0,0,.18)';
    for (let i = 0; i < cols * 2; i++) {
      const nx0 = PX * ((i + 0.5) * (faceW / (cols * 2)) - 0.4);
      const ny0 = S * .55;
      const nw = PX * 0.8, nh = S * .17;
      ctx.beginPath(); ctx.rect(nx0, ny0, nw, nh);
      ctx.arc(nx0 + nw / 2, ny0, nw / 2, Math.PI, 0);
      ctx.fill();
    }
  }
  else { drawPlasterWall(ctx, S, rnd, [170, 168, 162]); }

  // street-level grime band
  const grime = ctx.createLinearGradient(0, S - (2.6 * PY), 0, S);
  grime.addColorStop(0, 'transparent');
  grime.addColorStop(1, style === 'industrial' ? 'rgba(20,20,24,.35)' : 'rgba(30,28,24,.3)');
  ctx.fillStyle = grime; ctx.fillRect(0, 0, S, S);

  // floor separation lines (except cottage)
  if (style !== 'cottage') {
    ctx.strokeStyle = 'rgba(0,0,0,.22)'; ctx.lineWidth = Math.max(1, PY * 0.08);
    for (let r = 1; r < rows; r++) {
      ctx.beginPath(); ctx.moveTo(0, my(faceH - r * cellH)); ctx.lineTo(S, my(faceH - r * cellH)); ctx.stroke();
    }
  }

  // parking garage: horizontal slat openings instead of windows
  if (style === 'parking') {
    const slatH = 0.9, gapH = 1.1, cell2H = 2.2;
    for (let r = 0; r < rows; r++) {
      const yTop = faceH - (r + 1) * cell2H + 0.2;
      if (yTop < 0.6) continue;
      const y0 = my(yTop + slatH);
      ctx.fillStyle = '#20242a';
      ctx.fillRect(PX * 0.25, y0, S - PX * 0.5, slatH * PY);
      ctx.fillStyle = 'rgba(255,255,255,.14)';
      ctx.fillRect(PX * 0.25, y0 + slatH * PY * 0.5, S - PX * 0.5, slatH * PY * 0.2);
      ctx.fillStyle = 'rgba(0,0,0,.3)';
      ctx.fillRect(PX * 0.25, y0 - 2, S - PX * 0.5, 3);
    }
    const capG = ctx.createLinearGradient(0, 0, 0, S);
    capG.addColorStop(0, 'rgba(0,0,0,.25)'); capG.addColorStop(.06, 'transparent');
    ctx.fillStyle = capG; ctx.fillRect(0, 0, S, S);
return tex(c, 1, true, key);
}

  // ---- windows ----
  const officeGlass = (x0, y0, w, h) => {
    const j = (rnd() - .5) * 12;
    const g = ctx.createLinearGradient(x0, y0, x0 + w, y0 + h);
    g.addColorStop(0, `rgb(${169 + j | 0},${191 + j | 0},${208 + j | 0})`);
    g.addColorStop(.4, `rgb(${124 + j | 0},${147 + j | 0},${166 + j | 0})`);
    g.addColorStop(.5, `rgb(${93 + j | 0},${111 + j | 0},${128 + j | 0})`);
    g.addColorStop(1, `rgb(${58 + j | 0},${70 + j | 0},${82 + j | 0})`);
    ctx.fillStyle = g; ctx.fillRect(x0, y0, w, h);
    ctx.fillStyle = 'rgba(255,255,255,.12)';
    ctx.beginPath(); ctx.moveTo(x0 + w * .15, y0); ctx.lineTo(x0 + w * .55, y0); ctx.lineTo(x0 + w * .25, y0 + h); ctx.lineTo(x0, y0 + h * .5); ctx.closePath(); ctx.fill();
  };
  const punched = (x0, y0, w, h) => {
    // frame
    ctx.fillStyle = '#e8e6e0'; ctx.fillRect(x0 - 3, y0 - 3, w + 6, h + 6);
    ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fillRect(x0 - 3, y0 + h, w + 6, 4); // sill shadow
    officeGlass(x0, y0, w, h);
    ctx.strokeStyle = '#8a8c90'; ctx.lineWidth = 2;
    ctx.strokeRect(x0, y0, w, h);
    // mullion
    ctx.strokeStyle = 'rgba(0,0,0,.3)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(x0 + w / 2, y0); ctx.lineTo(x0 + w / 2, y0 + h); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x0, y0 + h / 2); ctx.lineTo(x0 + w, y0 + h / 2); ctx.stroke();
  };
  const litWindow = (x0, y0, w, h) => {
    const g = ctx.createLinearGradient(x0, y0, x0, y0 + h);
    g.addColorStop(0, '#ffe9b8'); g.addColorStop(1, '#e8b45e');
    ctx.fillStyle = g; ctx.fillRect(x0, y0, w, h);
    ctx.fillStyle = 'rgba(0,0,0,.14)';
    ctx.fillRect(x0, y0 + h * .2, w, 1.5);
  };

  const officeRows = style === 'office' ? rows : rows - 1;
  const windowTop = faceH - (style === 'industrial' ? 4 : 3.6); // start below parapet
  for (let r = 0; r < officeRows; r++) {
    const yC = windowTop - (r + 0.5) * cellH;
    if (yC - winH / 2 < 1.8) continue;
    for (let cc = 0; cc < cols; cc++) {
      // broken rhythm: slight per-window horizontal jitter + occasional blind window
      const xJ = (rnd() - .5) * cellW * 0.07;
      const xC = (cc + 0.5) * cellW + xJ;
      const blind = rnd() < (style === 'office' ? 0.05 : 0.08);
      const x0 = mx(xC - winW / 2), y0 = my(yC + winH / 2);
      const wPx = winW * PX, hPx = winH * PY;
      const lit = rndM() < (style === 'office' ? 0.10 : 0.13);
      if (blind) {
        ctx.fillStyle = 'rgba(0,0,0,.14)';
        ctx.fillRect(x0 - 3, y0 - 3, wPx + 6, hPx + 6);
        ctx.fillStyle = 'rgba(120,110,96,.9)';
        ctx.fillRect(x0, y0, wPx, hPx);
        ctx.fillStyle = 'rgba(0,0,0,.2)';
        ctx.fillRect(x0, y0, wPx, 3);
      } else if (style === 'office') {
        officeGlass(x0, y0, wPx, hPx);
        if (lit) { litWindow(x0 + 2, y0 + 2, wPx - 4, hPx - 4); }
        // spandrel mullions for the whole grid
        ctx.fillStyle = 'rgba(30,34,40,.55)';
        ctx.fillRect(x0 - 1.5, y0 - 1.5, wPx + 3, 3);
      } else if (style === 'industrial') {
        if (r > 1) { ctx.fillStyle = '#39424c'; ctx.fillRect(x0, y0, wPx, hPx); ctx.fillStyle = 'rgba(255,255,255,.1)'; ctx.fillRect(x0, y0, wPx, 2); }
      } else if (style === 'church') {
        // tall arched window
        ctx.fillStyle = '#3a2c22'; ctx.fillRect(x0 - 3, y0 - 3, wPx + 6, hPx + 6);
        ctx.fillStyle = '#23262c'; ctx.fillRect(x0, y0, wPx, hPx);
        ctx.fillStyle = 'rgba(160,190,215,.25)';
        ctx.fillRect(x0 + wPx * .1, y0 + hPx * .08, wPx * .8, hPx * .8);
        ctx.beginPath();
        ctx.arc(x0 + wPx / 2, y0 + hPx * .25, wPx / 2, Math.PI, 0);
        ctx.fillStyle = 'rgba(160,190,215,.35)'; ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,.4)'; ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x0 + wPx / 2, y0); ctx.lineTo(x0 + wPx / 2, y0 + hPx);
        ctx.stroke();
      } else if (style === 'apartment') {
        punched(x0, y0, wPx, hPx);
        if (lit) litWindow(x0 + 3, y0 + 3, wPx - 6, hPx - 6);
        // window sill
        ctx.fillStyle = 'rgba(200,198,192,.9)';
        ctx.fillRect(x0 - 4, y0 + hPx, wPx + 8, 3);
      } else if (style === 'mosque') {
        // pointed arch window
        ctx.fillStyle = 'rgba(24,74,58,.9)'; ctx.fillRect(x0 - 4, y0 - 4, wPx + 8, hPx + 8);
        ctx.fillStyle = '#1c1f24'; ctx.fillRect(x0, y0, wPx, hPx);
        ctx.fillStyle = 'rgba(170,200,215,.28)';
        ctx.fillRect(x0 + wPx * .12, y0 + hPx * .1, wPx * .76, hPx * .78);
        ctx.beginPath();
        ctx.moveTo(x0 + wPx * .05, y0 + hPx * .9);
        ctx.lineTo(x0 + wPx * .05, y0 + hPx * .34);
        ctx.quadraticCurveTo(x0 + wPx / 2, y0 - hPx * .25, x0 + wPx * .95, y0 + hPx * .34);
        ctx.lineTo(x0 + wPx * .95, y0 + hPx * .9);
        ctx.fillStyle = 'rgba(170,200,215,.1)'; ctx.fill();
        ctx.strokeStyle = 'rgba(240,238,230,.85)'; ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(x0 + wPx * .05, y0 + hPx * .9);
        ctx.lineTo(x0 + wPx * .05, y0 + hPx * .34);
        ctx.quadraticCurveTo(x0 + wPx / 2, y0 - hPx * .25, x0 + wPx * .95, y0 + hPx * .34);
        ctx.lineTo(x0 + wPx * .95, y0 + hPx * .9);
        ctx.stroke();
        ctx.fillStyle = 'rgba(240,238,230,.9)';
        ctx.fillRect(x0 - 2, y0 + hPx, wPx + 4, 3);
      } else {
        punched(x0, y0, wPx, hPx);
        if (lit) litWindow(x0 + 3, y0 + 3, wPx - 6, hPx - 6);
        if (style === 'cottage') {
          // shutters
          ctx.fillStyle = 'rgba(56,78,56,.9)';
          ctx.fillRect(x0 - wPx * .26, y0, wPx * .2, hPx);
          ctx.fillRect(x0 + wPx * 1.06, y0, wPx * .2, hPx);
        }
      }
    }
  }

  // parapet cap line for office / tenement
  if (style !== 'cottage') {
    ctx.fillStyle = 'rgba(0,0,0,.28)';
    ctx.fillRect(0, 0, S, Math.max(2, PY * 0.7));
    ctx.fillStyle = 'rgba(255,255,255,.12)';
    ctx.fillRect(0, 2, S, 2);
  }
  return tex(c, 1, true, key);
}

// ---------------------------------------------------------------------------
// STOREFRONT FACADE — full glass shopfront with metal framing & signage band.
// ---------------------------------------------------------------------------
export function makeStorefrontTexture(faceW, faceH, seed = 1) {
  const key = 'storefront|' + faceW + '|' + faceH + '|' + seed;
  const S = 512;
  const c = canvas(S), ctx = c.getContext('2d');
  const rnd = mulberry32((seed * 104729 + 3) >>> 0);
  const PX = S / faceW, PY = S / faceH;
  const my = (y) => S - y * PY;
  const bandH = Math.min(faceH * 0.32, 2.8);
  const glassTop = faceH - bandH;

  // upper wall band (brick)
  const wallPx = S - bandH * PY;
  drawBrickWall(ctx, S, rnd, [158, 100, 80], [180, 170, 154]);
  ctx.fillStyle = 'rgba(0,0,0,.28)';
  ctx.fillRect(0, wallPx, S, S - wallPx);

  // signboard zone
  const signH = Math.min(1.2, bandH * 0.5);
  const signTop = faceH - 0.25 - signH;
  ctx.fillStyle = '#22262c';
  ctx.fillRect(0, my(signTop + signH), S, signH * PY);
  ctx.fillStyle = 'rgba(255,220,140,.9)';
  ctx.fillRect(2, my(signTop + signH) + 2, S - 4, signH * PY - 4);

  // display glass
  const panes = Math.max(2, Math.round(faceW / 4));
  const paneW = faceW / panes;
  const glassH = faceH - bandH - 0.15;
  for (let i = 0; i < panes; i++) {
    const x0 = i * paneW * PX + 2, w = paneW * PX - 4;
    const y0 = my(0.15 + glassH);
    const h = glassH * PY - 4;
    const g = ctx.createLinearGradient(x0, y0, x0 + w, y0 + h);
    g.addColorStop(0, '#8fa6b8'); g.addColorStop(.45, '#5a6d7e'); g.addColorStop(.55, '#4c5b6a'); g.addColorStop(1, '#2c3640');
    ctx.fillStyle = g; ctx.fillRect(x0, y0, w, h);
    // interior glow (some shops lit)
    if (rnd() < .5) {
      ctx.fillStyle = `rgba(${255},${210 + Math.random() * 40},${140},.16)`;
      ctx.fillRect(x0 + 4, y0 + 4, w - 8, h - 8);
    }
    // reflection streak
    ctx.fillStyle = 'rgba(255,255,255,.10)';
    ctx.beginPath(); ctx.moveTo(x0 + w * .15, y0); ctx.lineTo(x0 + w * .5, y0); ctx.lineTo(x0 + w * .2, y0 + h); ctx.lineTo(x0, y0 + h * .45); ctx.closePath(); ctx.fill();
    // frame
    ctx.strokeStyle = '#2a2e34'; ctx.lineWidth = 3;
    ctx.strokeRect(x0, y0, w, h);
  }
  // mullion between panes
  ctx.fillStyle = '#2a2e34';
  for (let i = 1; i < panes; i++) ctx.fillRect(i * paneW * PX - 1.5, my(glassH), 3, glassH * PY);
  // sill
  ctx.fillStyle = 'rgba(120,116,110,.9)';
  ctx.fillRect(0, my(0.12), S, 4);
  // recessed door (2nd pane)
  const doorPane = 1;
  const dx = doorPane * paneW * PX, dw = paneW * PX;
  ctx.fillStyle = '#191d21';
  ctx.fillRect(dx + dw * .12, my(glassH) + 3, dw * .76, glassH * PY - 8);
  ctx.strokeStyle = '#2a2e34'; ctx.lineWidth = 2;
  ctx.strokeRect(dx + dw * .12, my(glassH) + 3, dw * .76, glassH * PY - 8);
  return tex(c, 1, true, key);
}

// ---------------------------------------------------------------------------
// CAMO / FABRIC / SANDBAG / CRATE / WINDOW / SKY / SPRITES (legacy + fx)
// ---------------------------------------------------------------------------
export function makeCamoTexture(size = 256) {  const c = canvas(size), ctx = c.getContext('2d');
  ctx.fillStyle = '#4a5240'; ctx.fillRect(0, 0, size, size);
  const cols = ['#5a6350', '#3a4234', '#6b6a58', '#2e352a'];
  for (const col of cols) {
    ctx.fillStyle = col;
    for (let i = 0; i < 26; i++) {
      ctx.beginPath();
      const x = Math.random() * size, y = Math.random() * size, r = 8 + Math.random() * 26;
      for (let a = 0; a < 6.4; a += 1) {
        const rr = r * (0.6 + Math.random() * .7);
        const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
        a === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
      ctx.closePath(); ctx.fill();
    }
  }
  return tex(c);
}

export function makeFabricTexture(tint = [40, 48, 64], size = 128) {
  const c = canvas(size), ctx = c.getContext('2d');
  const base = `rgb(${tint[0] | 0},${tint[1] | 0},${tint[2] | 0})`;
  ctx.fillStyle = base; ctx.fillRect(0, 0, size, size);
  ctx.globalAlpha = 0.18;
  for (let y = 0; y < size; y += 2) {
    ctx.fillStyle = (y / 2) % 2 ? 'rgba(255,255,255,.5)' : 'rgba(0,0,0,.5)';
    ctx.fillRect(0, y, size, 1);
  }
  for (let x = 0; x < size; x += 2) {
    ctx.fillStyle = (x / 2) % 2 ? 'rgba(255,255,255,.35)' : 'rgba(0,0,0,.35)';
    ctx.fillRect(x, 0, 1, size);
  }
  ctx.globalAlpha = 1;
  return tex(c, 1);
}

export function makeSandbagTexture(size = 256) {
  const c = canvas(size), ctx = c.getContext('2d');
  noiseLayer(ctx, size, [134, 118, 88], 20, 5);
  ctx.strokeStyle = 'rgba(60,50,36,.6)'; ctx.lineWidth = 2;
  for (let y = 12; y < size; y += 24) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(size, y); ctx.stroke(); }
  ctx.strokeStyle = 'rgba(90,76,54,.5)';
  for (let i = 0; i < 40; i++) {
    const y = Math.random() * size;
    ctx.beginPath(); ctx.moveTo(Math.random() * size, y); ctx.lineTo(Math.random() * size, y + (Math.random() - .5) * 4); ctx.stroke();
  }
  return tex(c, 2);
}

export function makeCrateTexture(size = 512) {
  const key = 'crate|' + size;
  const c = canvas(size), ctx = c.getContext('2d');
  noiseLayer(ctx, size, [118, 98, 70], 22, 7);
  ctx.strokeStyle = 'rgba(46,34,20,.6)'; ctx.lineWidth = 3;
  const step = size / 4;
  for (let i = 0; i <= 4; i++) { ctx.beginPath(); ctx.moveTo(0, i * step); ctx.lineTo(size, i * step); ctx.stroke(); }
  ctx.lineWidth = 10; ctx.strokeStyle = 'rgba(58,44,26,.9)'; ctx.strokeRect(5, 5, size - 10, size - 10);
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(size, size); ctx.moveTo(size, 0); ctx.lineTo(0, size); ctx.stroke();
  return tex(c, 1, true, key);
}

export function makeWindowTexture(size = 64) {
  return makeGlassTexture(size);
}

export function makeSkyTexture() {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 512;
  const ctx = c.getContext('2d');
  // daylight sky: deep blue to pale horizon
  const g = ctx.createLinearGradient(0, 0, 0, 512);
  g.addColorStop(0, '#2f6fae'); g.addColorStop(.45, '#5d94c9');
  g.addColorStop(.72, '#a8c6e2'); g.addColorStop(.9, '#dbe8f2'); g.addColorStop(1, '#e8eef4');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 1024, 512);
  // soft clouds
  for (let i = 0; i < 14; i++) {
    const cx = Math.random() * 1024, cy = 60 + Math.random() * 200;
    const rw = 40 + Math.random() * 90, rh = 12 + Math.random() * 22;
    for (let j = 0; j < 5; j++) {
      const g2 = ctx.createRadialGradient(cx + (j - 2) * rw * .4, cy, 2, cx + (j - 2) * rw * .4, cy, rw * .7);
      g2.addColorStop(0, `rgba(255,255,255,${.25 + Math.random() * .2})`); g2.addColorStop(1, 'transparent');
      ctx.fillStyle = g2;
      ctx.beginPath(); ctx.ellipse(cx + (j - 2) * rw * .4, cy, rw * .55, rh, 0, 0, 7); ctx.fill();
    }
  }
  // sun
  const sg = ctx.createRadialGradient(820, 150, 4, 820, 150, 220);
  sg.addColorStop(0, 'rgba(255,250,230,.95)'); sg.addColorStop(.1, 'rgba(255,244,200,.5)'); sg.addColorStop(1, 'transparent');
  ctx.fillStyle = sg; ctx.fillRect(0, 0, 1024, 512);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.mapping = THREE.EquirectangularReflectionMapping;
  return t;
}

export function makeFlashSprite() {
  const c = canvas(128), ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 2, 64, 64, 62);
  g.addColorStop(0, 'rgba(255,255,220,1)'); g.addColorStop(.25, 'rgba(255,200,90,.9)');
  g.addColorStop(.6, 'rgba(255,120,30,.35)'); g.addColorStop(1, 'transparent');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
  ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = 'rgba(255,230,160,.9)'; ctx.lineWidth = 5;
  for (let i = 0; i < 4; i++) {
    ctx.save(); ctx.translate(64, 64); ctx.rotate(i * Math.PI / 4 + .3);
    ctx.beginPath(); ctx.moveTo(-58, 0); ctx.lineTo(58, 0); ctx.stroke(); ctx.restore();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export function makeSmokeSprite() {
  const c = canvas(128), ctx = c.getContext('2d');
  for (let i = 0; i < 26; i++) {
    const x = 30 + Math.random() * 68, y = 30 + Math.random() * 68, r = 12 + Math.random() * 22;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(160,155,148,.16)'); g.addColorStop(1, 'transparent');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
  }
  return new THREE.CanvasTexture(c);
}

export function makeGlowSprite(color = '255,180,80') {
  const c = canvas(64), ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 1, 32, 32, 30);
  g.addColorStop(0, `rgba(${color},1)`); g.addColorStop(.4, `rgba(${color},.4)`); g.addColorStop(1, 'transparent');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

// ---------------------------------------------------------------------------
// SAND — golden Vice Beach sand with fine shell specks and gentle wind ripples
// ---------------------------------------------------------------------------
export function makeSandTexture(size = 512) {
  const c = canvas(size), ctx = c.getContext('2d');
  noiseLayer(ctx, size, [226, 198, 142], 18, 4);
  // wind ripple bands
  ctx.strokeStyle = 'rgba(205,172,118,.25)';
  ctx.lineWidth = 14;
  for (let y = 0; y < size; y += 38) {
    ctx.beginPath();
    ctx.moveTo(0, y + (Math.random() - .5) * 6);
    ctx.bezierCurveTo(size * .33, y + 12, size * .66, y - 8, size, y + 4);
    ctx.stroke();
  }
  speckle(ctx, size, 1200, ['rgba(245,230,195,.7)', 'rgba(195,160,110,.5)', 'rgba(255,248,225,.8)', 'rgba(170,135,90,.35)'], 0.4, 1.8);
  mottle(ctx, size, 45, 0.05);
  return tex(c, 16);
}

// ---------------------------------------------------------------------------
// OCEAN WATER — deep turquoise to azure with specular wave crests and foam
// ---------------------------------------------------------------------------
export function makeWaterTexture(size = 512) {
  const c = canvas(size), ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, size, size);
  g.addColorStop(0, '#106488'); g.addColorStop(0.5, '#1682a8'); g.addColorStop(1, '#0e5576');
  ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
  noiseLayer(ctx, size, [22, 120, 160], 22, 6);
  // caustic wave lines
  ctx.strokeStyle = 'rgba(210,245,255,.22)';
  ctx.lineWidth = 3;
  for (let i = 0; i < 40; i++) {
    ctx.beginPath();
    let x = Math.random() * size, y = Math.random() * size;
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + (Math.random() - .5) * 60, y + (Math.random() - .5) * 60, x + (Math.random() - .5) * 100, y + (Math.random() - .5) * 100);
    ctx.stroke();
  }
  speckle(ctx, size, 500, ['rgba(255,255,255,.35)', 'rgba(180,240,255,.25)'], 0.6, 2.0);
  return tex(c, 12);
}

// ---------------------------------------------------------------------------
// PALM TRUNK — ringed fibrous bark texture
// ---------------------------------------------------------------------------
export function makePalmTrunkTexture(size = 256) {
  const c = canvas(size), ctx = c.getContext('2d');
  noiseLayer(ctx, size, [122, 98, 72], 20, 2);
  // horizontal growth rings
  for (let y = 0; y < size; y += 14) {
    ctx.fillStyle = 'rgba(72,52,36,.65)';
    ctx.fillRect(0, y, size, 3.5);
    ctx.fillStyle = 'rgba(175,145,115,.45)';
    ctx.fillRect(0, y + 4, size, 2);
  }
  // vertical fibers
  ctx.strokeStyle = 'rgba(50,36,24,.3)'; ctx.lineWidth = 1;
  for (let x = 0; x < size; x += 6) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + (Math.random() - .5) * 6, size); ctx.stroke();
  }
  return tex(c, 2);
}

// ---------------------------------------------------------------------------
// PALM FROND — lush tropical leaf blade texture
// ---------------------------------------------------------------------------
export function makePalmFrondTexture(size = 256) {
  const c = canvas(size), ctx = c.getContext('2d');
  noiseLayer(ctx, size, [54, 118, 46], 18, 3);
  // central spine
  ctx.fillStyle = 'rgba(165,195,85,.85)';
  ctx.fillRect(size * 0.48, 0, size * 0.04, size);
  // leaf rib lines
  ctx.strokeStyle = 'rgba(32,74,26,.45)'; ctx.lineWidth = 1.2;
  for (let y = 0; y < size; y += 6) {
    ctx.beginPath();
    ctx.moveTo(size * 0.48, y);
    ctx.lineTo(0, y + 14);
    ctx.moveTo(size * 0.52, y);
    ctx.lineTo(size, y + 14);
    ctx.stroke();
  }
  return tex(c, 1);
}

// ---------------------------------------------------------------------------
// MODERN GLASS FACADE — tinted structural curtain wall with room silhouettes
// ---------------------------------------------------------------------------
export function makeModernGlassTexture(size = 512) {
  const key = 'modernglass|' + size;
  const c = canvas(size), ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, size, size);
  g.addColorStop(0, '#1a3348'); g.addColorStop(0.5, '#284d68'); g.addColorStop(1, '#15293a');
  ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
  
  // window mullion grid
  const cols = 8, rows = 8;
  const cw = size / cols, rh = size / rows;
  for (let r = 0; r < rows; r++) {
    for (let col = 0; col < cols; col++) {
      const x = col * cw, y = r * rh;
      const isLit = (col * 7 + r * 13) % 4 === 0;
      if (isLit) {
        ctx.fillStyle = 'rgba(255,238,180,.18)';
        ctx.fillRect(x + 3, y + 3, cw - 6, rh - 6);
      }
      // pane reflection gradient
      const pg = ctx.createLinearGradient(x, y, x + cw, y + rh);
      pg.addColorStop(0, 'rgba(255,255,255,.12)');
      pg.addColorStop(0.5, 'transparent');
      pg.addColorStop(1, 'rgba(0,0,0,.15)');
      ctx.fillStyle = pg;
      ctx.fillRect(x + 2, y + 2, cw - 4, rh - 4);
    }
  }
  // mullion frames
  ctx.strokeStyle = 'rgba(30,35,42,.95)'; ctx.lineWidth = 3.5;
  for (let x = 0; x <= size; x += cw) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, size); ctx.stroke(); }
  for (let y = 0; y <= size; y += rh) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(size, y); ctx.stroke(); }
  return tex(c, 2, true, key);
}

// ---------------------------------------------------------------------------
// ART DECO PASTEL — Miami Vice stylized stucco facade with geometric fluting
// ---------------------------------------------------------------------------
export function makeArtDecoTexture(size = 512, pastel = 'pink') {
  const c = canvas(size), ctx = c.getContext('2d');
  const base = pastel === 'pink' ? [235, 170, 180] : pastel === 'teal' ? [140, 210, 205] : pastel === 'cream' ? [240, 228, 200] : [175, 195, 235];
  noiseLayer(ctx, size, base, 12, 3);
  // fluted relief panels
  const pw = size / 16;
  for (let i = 0; i < 16; i++) {
    const x = i * pw;
    ctx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,.14)' : 'rgba(0,0,0,.08)';
    ctx.fillRect(x, 0, pw, size);
  }
  // horizontal Art Deco band moldings
  ctx.fillStyle = 'rgba(255,255,255,.45)'; ctx.fillRect(0, size * 0.2, size, 6); ctx.fillRect(0, size * 0.8, size, 6);
  ctx.fillStyle = 'rgba(0,0,0,.2)'; ctx.fillRect(0, size * 0.2 + 6, size, 3); ctx.fillRect(0, size * 0.8 + 6, size, 3);
  return tex(c, 2);
}

// ---------------------------------------------------------------------------
// WOOD DECK — Marina pier / boardwalk timber planks with grain and nail rivets
// ---------------------------------------------------------------------------
export function makeWoodDeckTexture(size = 512) {
  const c = canvas(size), ctx = c.getContext('2d');
  noiseLayer(ctx, size, [158, 126, 92], 20, 2);
  const plankH = 32;
  for (let y = 0; y < size; y += plankH) {
    // subtle plank shade variation
    ctx.fillStyle = Math.random() < 0.5 ? 'rgba(255,255,255,.07)' : 'rgba(0,0,0,.09)';
    ctx.fillRect(0, y, size, plankH);
    // seam line
    ctx.fillStyle = 'rgba(42,30,20,.85)';
    ctx.fillRect(0, y, size, 2.5);
    // nails
    for (let x = 20; x < size; x += 70) {
      ctx.fillStyle = 'rgba(30,25,20,.7)';
      ctx.beginPath(); ctx.arc(x, y + plankH * 0.35, 1.8, 0, 7); ctx.arc(x, y + plankH * 0.65, 1.8, 0, 7); ctx.fill();
    }
  }
  return tex(c, 4);
}

// ---------------------------------------------------------------------------
// NEON SIGN — Vice City luminous signboards
// ---------------------------------------------------------------------------
export function makeNeonSignTexture(text = 'VICE', fgColor = '#ff2a85', bgColor = '#0a0812', size = 512) {
  const c = canvas(size), ctx = c.getContext('2d');
  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, size, size);
  // border glow
  ctx.strokeStyle = fgColor;
  ctx.lineWidth = 10;
  ctx.shadowColor = fgColor;
  ctx.shadowBlur = 24;
  ctx.strokeRect(20, 20, size - 40, size - 40);
  
  // text
  ctx.font = '900 64px "Bebas Neue", "Arial Black", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = fgColor;
  ctx.shadowBlur = 32;
  ctx.fillText(text, size / 2, size / 2);
  ctx.fillText(text, size / 2, size / 2);
  return tex(c, 1);
}

