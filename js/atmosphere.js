// Atmospheric sky: sky texture + procedural clouds, time-of-day
// with sun/moon orbit, synchronized lighting, and color grading per phase
// (morning, day, evening, night).
import * as THREE from 'three';

const skyVertex = `
varying vec3 vWorldPos;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const skyFragment = `
uniform vec3 uSunDir;
uniform vec3 uCameraPos;
uniform float uTimeOfDay;
uniform vec3 uSkyTint;
uniform float uExposure;
uniform float uCloudDensity;
uniform float uCloudSharpness;
uniform float uNightBlend;
uniform sampler2D uSkyTex;
uniform float uRain;

varying vec3 vWorldPos;
varying vec2 vUv;

const float PI = 3.14159265359;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) {
    v += a * noise(p);
    p *= 2.0;
    a *= 0.5;
  }
  return v;
}

void main() {
  vec3 dir = normalize(vWorldPos - uCameraPos);
  float sunDot = dot(dir, uSunDir);
  float sunAngle = acos(clamp(sunDot, -1.0, 1.0));

  // Sample sky texture using equirectangular mapping from direction
  float theta = atan(dir.z, dir.x);
  float phi = asin(clamp(dir.y, -1.0, 1.0));
  vec2 skyUv = vec2(theta / (2.0 * PI) + 0.5, phi / PI + 0.5);
  vec3 skyColor = texture2D(uSkyTex, skyUv).rgb;

  // Time-of-day tint: apply color grading to the sky texture
  vec3 dayTint = uSkyTint;
  vec3 nightTint = vec3(0.02, 0.03, 0.06);
  vec3 dawnTint = vec3(0.9, 0.55, 0.35);
  float nightFactor = uNightBlend;

  // Blend between tinted sky based on time
  vec3 tintedSky = mix(skyColor * dayTint * 2.0, skyColor * nightTint * 3.0, nightFactor);

  // Dawn/dusk warm glow near horizon during golden hours
  float horizonFade = pow(1.0 - abs(dir.y), 4.0);
  float dawnGlow = smoothstep(-0.1, 0.15, uSunDir.y) * (1.0 - smoothstep(0.15, 0.4, uSunDir.y));
  float duskGlow = smoothstep(0.15, -0.1, uSunDir.y) * (1.0 - smoothstep(-0.1, -0.4, uSunDir.y));
  vec3 goldenGlow = vec3(1.0, 0.55, 0.2) * (dawnGlow + duskGlow) * horizonFade * 0.6;
  tintedSky += goldenGlow;

  // Sun disc and glow
  float sunDisc = smoothstep(0.018, 0.0, sunAngle);
  float sunGlow = exp(-sunAngle * 2.5) * 0.5;
  vec3 sunColor = mix(vec3(1.0, 0.6, 0.3), vec3(1.0, 0.95, 0.85), smoothstep(-0.05, 0.3, uSunDir.y));
  vec3 sun = sunColor * (sunDisc * 8.0 + sunGlow);

  // Moon at night
  vec3 moonDir = -uSunDir;
  float moonDot = dot(dir, moonDir);
  float moonAngle = acos(clamp(moonDot, -1.0, 1.0));
  float moonDisc = smoothstep(0.015, 0.0, moonAngle) * nightFactor;
  vec3 moonColor = vec3(0.6, 0.65, 0.8) * moonDisc * 1.5;

  // Stars at night
  float starField = 0.0;
  if (nightFactor > 0.2) {
    vec2 starUv = dir.xz / (abs(dir.y) + 0.1) * 300.0;
    float star = hash(floor(starUv));
    star = smoothstep(0.985, 1.0, star);
    float twinkle = sin(uTimeOfDay * 1.5 + star * 6.28) * 0.3 + 0.7;
    starField = star * twinkle * nightFactor * step(0.0, dir.y);
  }

  // Procedural cloud layer
  float cloud = 0.0;
  if (dir.y > 0.03) {
    vec2 cloudUv = dir.xz / dir.y * 4.0 + uCameraPos.xz * 0.00015;
    cloudUv += vec2(uTimeOfDay * 0.008, uTimeOfDay * 0.004);
    float n = fbm(cloudUv * 3.5);
    float baseDensity = uCloudDensity;
    // Rain increases cloud density and makes them lower/thicker
    baseDensity = mix(baseDensity, 0.85, uRain);
    cloud = smoothstep(1.0 - baseDensity, 1.0 - baseDensity + 1.0 / uCloudSharpness, n);
    cloud *= smoothstep(0.03, 0.2, dir.y);
    // Cloud lighting from sun
    float cloudLight = mix(0.15, 1.0, clamp(sunDot * 0.5 + 0.5, 0.0, 1.0));
    vec3 cloudDayColor = mix(vec3(0.7, 0.75, 0.85), vec3(1.0, 0.95, 0.88), cloudLight);
    vec3 cloudNightColor = vec3(0.08, 0.1, 0.15) * cloudLight + vec3(0.03, 0.04, 0.06);
    vec3 cloudDawnColor = mix(vec3(0.85, 0.5, 0.3), vec3(1.0, 0.85, 0.7), cloudLight);
    float isDawn = dawnGlow + duskGlow;
    vec3 cloudColor = mix(cloudDayColor, cloudNightColor, nightFactor);
    cloudColor = mix(cloudColor, cloudDawnColor, isDawn * (1.0 - nightFactor) * 0.6);
    tintedSky = mix(tintedSky, cloudColor, cloud * 0.75);
  }

  // Combine everything
  vec3 color = tintedSky + sun + moonColor + starField * vec3(0.5, 0.55, 0.7);

  // Fog tint during rain
  color = mix(color, vec3(0.45, 0.48, 0.55), uRain * 0.2);

  color *= uExposure;

  // Tone mapping (ACES-ish)
  color = color / (color + vec3(1.0));
  color = pow(color, vec3(1.0 / 2.2));

  gl_FragColor = vec4(color, 1.0);
}`;

// ===== PHASE DEFINITIONS =====
// Each phase: name, sun elevation range [min, max], lighting, fog, clouds
const PHASES = [
  {
    name: 'night', sunY: [-1.0, -0.15],
    fogColor: [0x060a14], sunColor: [0x112244], sunInt: 0.12, ambInt: 0.06,
    hemiSky: [0x080e1a], hemiGnd: [0x040608],
    exposure: 0.3, fogDens: 0.005, cloudDens: 0.25, cloudSharp: 1.5, nightBlend: 1.0
  },
  {
    name: 'morning', sunY: [-0.15, 0.05],
    fogColor: [0x6a4030], sunColor: [0xff9955], sunInt: 1.2, ambInt: 0.4,
    hemiSky: [0x886655], hemiGnd: [0x443322],
    exposure: 0.85, fogDens: 0.003, cloudDens: 0.4, cloudSharp: 2.0, nightBlend: 0.3
  },
  {
    name: 'day', sunY: [0.05, 0.5],
    fogColor: [0x8aa8c8], sunColor: [0xfff4dd], sunInt: 2.8, ambInt: 1.0,
    hemiSky: [0xcfe3ff], hemiGnd: [0x6a6c60],
    exposure: 1.0, fogDens: 0.0025, cloudDens: 0.35, cloudSharp: 2.5, nightBlend: 0.0
  },
  {
    name: 'afternoon', sunY: [0.5, 0.15],
    fogColor: [0x9aaabb], sunColor: [0xffeedd], sunInt: 2.4, ambInt: 0.85,
    hemiSky: [0xbbddff], hemiGnd: [0x5a5c50],
    exposure: 0.95, fogDens: 0.0028, cloudDens: 0.38, cloudSharp: 2.2, nightBlend: 0.0
  },
  {
    name: 'evening', sunY: [0.15, -0.15],
    fogColor: [0x5a2820], sunColor: [0xff5522], sunInt: 1.0, ambInt: 0.35,
    hemiSky: [0x664433], hemiGnd: [0x331810],
    exposure: 0.8, fogDens: 0.0035, cloudDens: 0.5, cloudSharp: 2.0, nightBlend: 0.2
  },
];

export class Atmosphere {
  constructor(scene, quality = 'high') {
    this.scene = scene;
    this.quality = quality;
    this.timeOfDay = 10.0; // 0..24 hours (default: 10 AM — morning)
    this.timeSpeed = 1.0;  // hours per real-time minute (0 = frozen)
    this.weather = 'clear'; // clear, overcast, rain, fog
    this.cloudOverride = null;

    this._sunDir = new THREE.Vector3(0, 1, 0);
    this._fogColor = new THREE.Color(0x8aa8c8);
    this._sunColor = new THREE.Color(0xfff4dd);
    this._sunIntensity = 2.8;
    this._ambientIntensity = 1.0;
    this._hemiSky = new THREE.Color(0xcfe3ff);
    this._hemiGnd = new THREE.Color(0x6a6c60);
    this._exposure = 1.0;
    this._fogDensity = 0.0025;
    this._cloudDensity = 0.35;
    this._cloudSharpness = 2.5;
    this._nightBlend = 0.0;
    this._skyTint = new THREE.Vector3(1.0, 1.0, 1.0);
    this._rain = 0.0;

    this._loadSkyTexture();
    this._buildSkyDome();
    this._buildLights();
  }

  _loadSkyTexture() {
    const loader = new THREE.TextureLoader();
    this._skyTex = loader.load('./data/models/textures/skytex.jpg', (t) => {
      t.colorSpace = THREE.SRGBColorSpace;
      t.mapping = THREE.EquirectangularReflectionMapping;
      console.log('[Atmosphere] Sky texture loaded OK');
    }, undefined, (err) => {
      console.warn('[Atmosphere] Sky texture FAILED:', err);
      this._skyTex = null;
    });
  }

  _buildSkyDome() {
    if (this.quality === 'ultra-low') return;
    const geo = new THREE.SphereGeometry(4000, 32, 20);
    const mat = new THREE.ShaderMaterial({
      vertexShader: skyVertex,
      fragmentShader: skyFragment,
      uniforms: {
        uSunDir: { value: this._sunDir },
        uCameraPos: { value: new THREE.Vector3() },
        uTimeOfDay: { value: this.timeOfDay },
        uSkyTint: { value: this._skyTint },
        uExposure: { value: this._exposure },
        uCloudDensity: { value: this._cloudDensity },
        uCloudSharpness: { value: this._cloudSharpness },
        uNightBlend: { value: this._nightBlend },
        uSkyTex: { value: this._skyTex },
        uRain: { value: 0.0 },
      },
      side: THREE.BackSide,
      depthWrite: false,
    });
    this.skyDome = new THREE.Mesh(geo, mat);
    this.skyDome.renderOrder = -100;
    this.scene.add(this.skyDome);
  }

  _buildLights() {
    this.sun = new THREE.DirectionalLight(0xfff4dd, 2.8);
    this.sun.position.set(200, 180, 80);
    this.sun.castShadow = this.quality !== 'low' && this.quality !== 'ultra-low';
    if (this.sun.castShadow) {
      this.sun.shadow.mapSize.setScalar(this.quality === 'high' ? 2048 : 1024);
      const S = this.quality === 'high' ? 220 : 140;
      Object.assign(this.sun.shadow.camera, { left: -S, right: S, top: S, bottom: -S, near: 10, far: 500 });
      this.sun.shadow.bias = -0.0008;
      this.sun.shadow.normalBias = 0.02;
    }
    this.scene.add(this.sun);

    this.hemi = new THREE.HemisphereLight(0xcfe3ff, 0x6a6c60, 1.0);
    this.scene.add(this.hemi);

    this.fill = new THREE.DirectionalLight(0xa8bfd8, 0.5);
    this.fill.position.set(-60, 20, -80);
    this.scene.add(this.fill);

    this.scene.fog = new THREE.FogExp2(0x9aa8c8, 0.0025);
  }

  setTime(t) { this.timeOfDay = ((t % 24) + 24) % 24; }

  update(dt, cameraPos) {
    if (this.timeSpeed > 0) {
      this.timeOfDay += dt * this.timeSpeed * (1 / 60);
      this.timeOfDay = ((this.timeOfDay % 24) + 24) % 24;
    }

    // Sun orbit: hour 6 = sunrise, 12 = noon, 18 = sunset
    const hourAngle = ((this.timeOfDay - 6) / 12) * Math.PI;
    const sunElev = Math.sin(hourAngle);
    const sunAzimuth = Math.cos(hourAngle);
    this._sunDir.set(sunAzimuth * 0.5, sunElev, -0.866).normalize();

    // Interpolate between phases
    const phase = this._getPhase(sunElev);
    const nextPhase = this._getNextPhase(sunElev);
    const lerpT = this._phaseLerpT(sunElev);

    // Interpolate fog color
    this._fogColor.set(phase.fogColor);
    const nextFog = new THREE.Color(nextPhase.fogColor);
    this._fogColor.lerp(nextFog, lerpT);

    // Interpolate sun color/intensity
    this._sunColor.set(phase.sunColor);
    this._sunIntensity = THREE.MathUtils.lerp(phase.sunInt, nextPhase.sunInt, lerpT);
    this._ambientIntensity = THREE.MathUtils.lerp(phase.ambInt, nextPhase.ambInt, lerpT);

    // Hemisphere
    this._hemiSky.set(phase.hemiSky);
    this._hemiGnd.set(phase.hemiGnd);
    const nextHemiSky = new THREE.Color(nextPhase.hemiSky);
    const nextHemiGnd = new THREE.Color(nextPhase.hemiGnd);
    this._hemiSky.lerp(nextHemiSky, lerpT);
    this._hemiGnd.lerp(nextHemiGnd, lerpT);

    // Exposure, fog density, clouds, night blend
    this._exposure = THREE.MathUtils.lerp(phase.exposure, nextPhase.exposure, lerpT);
    this._fogDensity = THREE.MathUtils.lerp(phase.fogDens, nextPhase.fogDens, lerpT);
    this._cloudDensity = THREE.MathUtils.lerp(phase.cloudDens, nextPhase.cloudDens, lerpT);
    this._cloudSharpness = THREE.MathUtils.lerp(phase.cloudSharp, nextPhase.cloudSharp, lerpT);
    this._nightBlend = THREE.MathUtils.lerp(phase.nightBlend, nextPhase.nightBlend, lerpT);

    // Weather modifiers
    const targetRain = this.weather === 'rain' ? 1.0 : 0.0;
    this._rain += (targetRain - this._rain) * Math.min(dt * 2, 1);

    if (this.weather === 'overcast') {
      this._cloudDensity = Math.max(this._cloudDensity, 0.75);
      this._sunIntensity *= 0.4;
      this._exposure *= 0.75;
    } else if (this.weather === 'rain') {
      this._cloudDensity = Math.max(this._cloudDensity, 0.85);
      this._sunIntensity *= 0.3;
      this._exposure *= 0.65;
      this._fogDensity *= 2.0;
      this._fogColor.lerp(new THREE.Color(0x556677), 0.5);
    } else if (this.weather === 'fog') {
      this._fogDensity *= 4.0;
      this._sunIntensity *= 0.3;
      this._exposure *= 0.7;
    }

    // Apply to scene
    const sunDist = 250;
    this.sun.position.copy(this._sunDir).multiplyScalar(sunDist);
    this.sun.color.copy(this._sunColor);
    this.sun.intensity = this._sunIntensity;
    this.hemi.color.copy(this._hemiSky);
    this.hemi.groundColor.copy(this._hemiGnd);
    this.hemi.intensity = this._ambientIntensity;
    this.fill.intensity = this._ambientIntensity * 0.4;
    this.scene.fog.color.copy(this._fogColor);
    this.scene.fog.density = this._fogDensity;

    // Sky dome uniforms
    if (this.skyDome && this.skyDome.material.uniforms) {
      const u = this.skyDome.material.uniforms;
      u.uSunDir.value.copy(this._sunDir);
      u.uCameraPos.value.copy(cameraPos);
      u.uTimeOfDay.value = this.timeOfDay;
      u.uExposure.value = this._exposure;
      u.uCloudDensity.value = this.cloudOverride !== null ? this.cloudOverride : this._cloudDensity;
      u.uCloudSharpness.value = this._cloudSharpness;
      u.uNightBlend.value = this._nightBlend;
      u.uRain.value = this._rain;
      u.uSkyTex.value = this._skyTex || this._fallbackSkyTex();
    }

    // Fallback scene background: blend between day/night so there's no black void
    if (!this.scene.background) {
      const dayBg = new THREE.Color(0x87CEEB);
      const nightBg = new THREE.Color(0x060a14);
      this.scene.background = nightBg.clone().lerp(dayBg, 1.0 - this._nightBlend);
    } else {
      const dayBg = new THREE.Color(0x87CEEB);
      const nightBg = new THREE.Color(0x060a14);
      this.scene.background.copy(nightBg).lerp(dayBg, 1.0 - this._nightBlend);
    }

    if (this.skyDome) {
      this.skyDome.position.copy(cameraPos);
    }
  }

  _getPhase(sunElev) {
    // Morning: sun rising (-0.15 to 0.05)
    // Day: sun high (0.05 to 0.5)
    // Afternoon: sun descending (0.5 to 0.15)
    // Evening: sun setting (0.15 to -0.15)
    // Night: sun below horizon
    for (const p of PHASES) {
      if (p.name === 'afternoon') {
        if (sunElev >= p.sunY[1] && sunElev < p.sunY[0]) return p;
      } else {
        if (sunElev >= p.sunY[0] && sunElev < p.sunY[1]) return p;
      }
    }
    return PHASES[2]; // default day
  }

  _getNextPhase(sunElev) {
    const idx = PHASES.indexOf(this._getPhase(sunElev));
    return PHASES[(idx + 1) % PHASES.length];
  }

  _phaseLerpT(sunElev) {
    const phase = this._getPhase(sunElev);
    if (phase.name === 'afternoon') {
      const range = phase.sunY[0] - phase.sunY[1];
      return range > 0 ? (phase.sunY[0] - sunElev) / range : 0;
    }
    const range = phase.sunY[1] - phase.sunY[0];
    return range > 0 ? (sunElev - phase.sunY[0]) / range : 0;
  }

  get phaseName() {
    const sunElev = Math.sin(((this.timeOfDay - 6) / 12) * Math.PI);
    return this._getPhase(sunElev).name;
  }

  _fallbackSkyTex() {
    if (!this._fallbackTex) {
      const c = document.createElement('canvas');
      c.width = 4; c.height = 2;
      const ctx = c.getContext('2d');
      const g = ctx.createLinearGradient(0, 0, 0, 2);
      g.addColorStop(0, '#1a3a5c'); g.addColorStop(0.5, '#87CEEB'); g.addColorStop(1, '#b8d8e8');
      ctx.fillStyle = g; ctx.fillRect(0, 0, 4, 2);
      this._fallbackTex = new THREE.CanvasTexture(c);
      this._fallbackTex.colorSpace = THREE.SRGBColorSpace;
    }
    return this._fallbackTex;
  }

  dispose() {
    if (this.skyDome) {
      this.scene.remove(this.skyDome);
      this.skyDome.geometry.dispose();
      this.skyDome.material.dispose();
    }
  }
}
