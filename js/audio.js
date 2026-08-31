// Procedural audio — all sounds synthesized via Web Audio, no asset files.
export class GameAudio {
  constructor(quality) {
    this.ctx = null;
    this.master = null;
    this.volume = 1.4;
    this._disabled = quality === 'ultra-low';
  }

  init() {
    if (this.ctx) return;
    if (this._disabled) return;
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(this.ctx.destination);
    // reusable noise buffer
    const len = this.ctx.sampleRate * 1.2;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  setVolume(v) { this.volume = v; if (this.master) this.master.gain.value = v; }

  _noise(dur, filterType, freq, q, gain, decay = null, freqEnd = null) {
    if (!this.ctx) return null;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = filterType; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + (decay || dur));
    src.connect(f).connect(g).connect(this.master);
    src.start(t); src.stop(t + dur + .05);
    return g;
  }

  _tone(freq, dur, gain, type = 'sine', freqEnd = null) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + dur + .05);
  }

  // distance attenuation (kept subtle so it still feels powerful up close)
  _att(dist) { return 1 / (1 + dist * dist * 0.0025); }

  // a single gunshot "crack": sharp transient + low body + airy tail
  _shot(profile, dist = 0) {
    if (!this.ctx) return;
    const a = this._att(dist);
    const t = this.ctx.currentTime;
    // 1) sharp crack transient (very short bandpassed noise burst)
    this._noise(profile.crack, 'bandpass', profile.crackFreq, profile.crackQ || 1.2, profile.crackGain * a, profile.crackDecay);
    // 2) low body "boom" of the propellant
    this._noise(profile.body, 'lowpass', profile.bodyFreq, .8, profile.bodyGain * a, profile.bodyDecay, profile.bodyFreqEnd || 120);
    // 3) sub thump
    this._tone(profile.subFreq, profile.subDur, profile.subGain * a, 'sine', profile.subFreqEnd || 45);
    // 4) airy tail / "ca-chunk" for semis
    if (profile.tail) this._noise(profile.tail, 'highpass', 1200, 1, profile.tailGain * a, profile.tailDecay);
  }

  gunshot(kind = 'rifle', dist = 0) {
    switch (kind) {
      case 'pistol':
        this._shot({ crack: .05, crackFreq: 2200, crackQ: 1.4, crackGain: .5, crackDecay: .04,
          body: .09, bodyFreq: 1600, bodyGain: .42, bodyDecay: .08, subFreq: 150, subDur: .07, subGain: .42, subFreqEnd: 70,
          tail: .05, tailGain: .22, tailDecay: .05 }, dist);
        break;
      case 'rifle':
        this._shot({ crack: .05, crackFreq: 3400, crackQ: 1.3, crackGain: .6, crackDecay: .045,
          body: .12, bodyFreq: 2200, bodyGain: .5, bodyDecay: .11, subFreq: 120, subDur: .1, subGain: .55, subFreqEnd: 50,
          tail: .06, tailGain: .25, tailDecay: .06 }, dist);
        break;
      case 'lmg':
        this._shot({ crack: .045, crackFreq: 3000, crackQ: 1.1, crackGain: .62, crackDecay: .04,
          body: .1, bodyFreq: 1900, bodyGain: .55, bodyDecay: .1, subFreq: 100, subDur: .09, subGain: .6, subFreqEnd: 42,
          tail: .05, tailGain: .22, tailDecay: .05 }, dist);
        break;
      case 'smg':
        this._shot({ crack: .04, crackFreq: 3600, crackQ: 1.4, crackGain: .5, crackDecay: .035,
          body: .07, bodyFreq: 2400, bodyGain: .4, bodyDecay: .07, subFreq: 140, subDur: .06, subGain: .45, subFreqEnd: 60,
          tail: .045, tailGain: .2, tailDecay: .045 }, dist);
        break;
      case 'shotgun':
        this._shot({ crack: .07, crackFreq: 1800, crackQ: .9, crackGain: .7, crackDecay: .06,
          body: .16, bodyFreq: 1200, bodyGain: .65, bodyDecay: .16, subFreq: 90, subDur: .14, subGain: .8, subFreqEnd: 34,
          tail: .09, tailGain: .35, tailDecay: .09 }, dist);
        break;
      case 'sniper':
        this._shot({ crack: .09, crackFreq: 4200, crackQ: 1.1, crackGain: .75, crackDecay: .07,
          body: .26, bodyFreq: 3200, bodyGain: .62, bodyDecay: .26, subFreq: 110, subDur: .2, subGain: .8, subFreqEnd: 36,
          tail: .12, tailGain: .35, tailDecay: .12 }, dist);
        break;
      case 'dmr':
        this._shot({ crack: .07, crackFreq: 3800, crackQ: 1.2, crackGain: .68, crackDecay: .06,
          body: .18, bodyFreq: 2600, bodyGain: .55, bodyDecay: .18, subFreq: 115, subDur: .15, subGain: .7, subFreqEnd: 40,
          tail: .09, tailGain: .3, tailDecay: .09 }, dist);
        break;
      case 'rocket':
        // launch: throaty whoosh + igniton thump (the warhead impact is handled by explosion())
        this._noise(.4, 'lowpass', 900, .6, .6, .35, 200);
        this._tone(80, .35, .5, 'sawtooth', 40);
        this._noise(.45, 'bandpass', 600, 2, .3, .4);
        break;
      default:
        this.gunshot('rifle', dist);
    }
  }

  enemyShot(dist) { this.gunshot('rifle', Math.max(dist, 1)); }

  reload(stage = 0) {
    if (stage === 0) { this._tone(900, .04, .15, 'square', 500); this._noise(.06, 'bandpass', 1800, 3, .2); }
    else { this._tone(600, .05, .2, 'square', 1100); this._noise(.05, 'bandpass', 2400, 3, .25); }
  }

  hitmarker(kill = false) {
    this._tone(kill ? 1400 : 1000, .05, .18, 'sine', kill ? 900 : 800);
  }

  hurt() {
    this._noise(.18, 'lowpass', 500, 1, .4, .15);
    this._tone(90, .15, .35, 'sine', 50);
  }

  explosion(dist = 0) {
    const att = 1 / (1 + Math.max(dist, 0) * 0.02);
    // sharp blast front
    this._noise(.25, 'lowpass', 2600, .6, .9 * att, .2, 300);
    // deep boom body
    this._noise(1.0, 'lowpass', 700, .5, .85 * att, .85, 50);
    this._tone(48, .8, .75 * att, 'sine', 24);
    this._tone(90, .4, .4 * att, 'triangle', 36);
    // debris hiss
    this._noise(.5, 'highpass', 700, 1, .3 * att, .35);
  }

  rocketImpact(dist = 0) { this.explosion(dist); }

  planeDrone(dist = 0) {
    if (!this.ctx) return;
    const a = this._att(dist || 30) * .5;
    // two detuned engines + low rumble
    this._tone(70, 2.4, .25 * a, 'sawtooth', 64);
    this._tone(73, 2.4, .22 * a, 'sawtooth', 67);
    this._noise(2.4, 'lowpass', 380, .4, .18 * a, 2.2);
  }

  grenadeBounce() { this._noise(.04, 'bandpass', 900, 3, .18); }
  grenadeThrow() { this._noise(.15, 'highpass', 500, 1, .12, .12); }

  // flamethrower jet — a whooshing roar that plays while firing
  flame() {
    if (!this.ctx) return;
    this._noise(.12, 'bandpass', 700 + Math.random() * 200, .7, .35, .1, 300);
  }

  footstep() { this._noise(.05, 'lowpass', 400 + Math.random() * 200, 1, .08, .045); }

  // vehicle engine drone — pitch rises with throttle (called per-frame while driving)
  engine(intensity = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    if (!this._engine) {
      const g = this.ctx.createGain(); g.gain.value = 0; g.connect(this.master);
      const o = this.ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 55; o.connect(g); o.start();
      const o2 = this.ctx.createOscillator(); o.type = 'square'; o2.frequency.value = 28;
      const g2 = this.ctx.createGain(); g2.gain.value = 0.35;
      o2.connect(g2); g2.connect(g); o2.start();
      this._engine = { g, o, o2, last: 0 };
    }
    const e = this._engine;
    const now = performance.now();
    if (now - e.last < 80) return;
    e.last = now;
    e.g.gain.setTargetAtTime(0.015 + intensity * 0.15, t, 0.15);
    e.o.frequency.setTargetAtTime(55 + intensity * 110, t, 0.12);
    e.o2.frequency.setTargetAtTime(28 + intensity * 55, t, 0.12);
  }

  stopEngine() {
    if (this._engine && this.ctx) this._engine.g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.08);
  }

  jump() { this._noise(.08, 'lowpass', 500, 1, .1, .07); }

  airstrikeRadio() {
    this._noise(.25, 'bandpass', 1400, 4, .15);
    this._tone(1200, .08, .08, 'square');
    setTimeout(() => this._tone(900, .1, .08, 'square'), 120);
  }

  sentryShot() {
    this._noise(.08, 'lowpass', 2600, .7, .25, .07, 400);
    this._tone(200, .05, .2, 'square', 100);
  }

  click() { this._tone(1400, .03, .1, 'square', 900); }

  waveStart() {
    this._tone(220, .35, .2, 'sawtooth', 440);
    setTimeout(() => this._tone(330, .4, .18, 'sawtooth', 660), 200);
  }

  // ---------- procedural ambient music (menu + intro) ----------
  // No asset files needed: a layered drone + slow tension pulses. Loops itself
  // via a scheduler until stopMusic() is called.
  startMusic(intense = false) {
    if (!this.ctx || this._disabled) return;
    this.stopMusic();
    this._music = { intense, step: 0, timer: null };
    const m = this._music;
    const BPM = intense ? 132 : 84;
    const beat = 60 / BPM;
    // --- bed: detuned drone through lowpass ---
    const dg = this.ctx.createGain(); dg.gain.value = intense ? 0.16 : 0.10; dg.connect(this.master);
    const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = intense ? 700 : 420; lp.connect(dg);
    const o1 = this.ctx.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = 55;
    const o2 = this.ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = 55.5;
    o1.connect(lp); o2.connect(lp); o1.start(); o2.start();
    m.drone = [o1, o2];
    // --- harmonic material: A minor pentatonic ---
    const root = intense ? 110 : 98;            // A2 / G2
    const P = [0, 3, 5, 7, 10];                 // minor pentatonic semitone offsets
    const note = (semi, oct = 0) => root * Math.pow(2, (semi + 12 * oct) / 12);
    const arp = intense ? [0, 7, 12, 7, 3, 10, 12, 10] : [0, 7, 12, 7];
    const bass = intense ? [0, 0, 7, 0, 5, 5, 3, 0] : [0, null, 5, null];
    const tick = () => {
      if (!this._music || this._music !== m) return;
      const s = m.step++;
      // BASS — plucky square on the root/fifth
      const b = bass[s % bass.length];
      if (b !== null && b !== undefined) {
        const f = note(b, -1);
        const g = this.ctx.createGain(); g.gain.value = 0; g.connect(this.master);
        const o = this.ctx.createOscillator(); o.type = 'square'; o.frequency.value = f;
        const flt = this.ctx.createBiquadFilter(); flt.type = 'lowpass'; flt.frequency.value = 600;
        o.connect(flt).connect(g); o.start();
        g.gain.setValueAtTime(0.0001, this.ctx.currentTime);
        g.gain.exponentialRampToValueAtTime(intense ? 0.22 : 0.14, this.ctx.currentTime + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + beat * (intense ? 0.9 : 1.4));
        o.stop(this.ctx.currentTime + beat * 1.6);
      }
      // ARP — triangle lead every other step (intense) / every step (calm)
      if (intense ? true : s % 2 === 0) {
        const a = arp[s % arp.length];
        const f = note(a, 1);
        const g = this.ctx.createGain(); g.gain.value = 0; g.connect(this.master);
        const o = this.ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
        o.connect(g); o.start();
        g.gain.setValueAtTime(0.0001, this.ctx.currentTime);
        g.gain.exponentialRampToValueAtTime(intense ? 0.10 : 0.07, this.ctx.currentTime + 0.03);
        g.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + beat * 0.7);
        o.stop(this.ctx.currentTime + beat * 0.8);
      }
      // PERCUSSION — kick on every beat, hat off-beat when intense
      const kg = this.ctx.createGain(); kg.gain.value = 0; kg.connect(this.master);
      const ko = this.ctx.createOscillator(); ko.type = 'sine'; ko.frequency.setValueAtTime(intense ? 130 : 100, this.ctx.currentTime);
      ko.frequency.exponentialRampToValueAtTime(40, this.ctx.currentTime + 0.12);
      ko.connect(kg); ko.start();
      kg.gain.setValueAtTime(0.0001, this.ctx.currentTime);
      kg.gain.exponentialRampToValueAtTime(intense ? 0.32 : 0.22, this.ctx.currentTime + 0.01);
      kg.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + 0.16);
      ko.stop(this.ctx.currentTime + 0.2);
      if (intense && s % 2 === 1) {
        this._noise(0.03, 'highpass', 6000, 1, 0.08, 0.02);
      }
      // PAD swell every 8 steps (calm tension)
      if (!intense && s % 8 === 0) {
        const f = note(P[(s / 8) % P.length], 1);
        const g = this.ctx.createGain(); g.gain.value = 0; g.connect(this.master);
        const o = this.ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
        o.connect(g); o.start();
        g.gain.linearRampToValueAtTime(0.05, this.ctx.currentTime + 0.5);
        g.gain.linearRampToValueAtTime(0, this.ctx.currentTime + beat * 4);
        o.stop(this.ctx.currentTime + beat * 4.2);
      }
      m.timer = setTimeout(tick, beat * 1000 / 2); // two steps per beat
    };
    tick();
  }

  stopMusic() {
    if (this._disabled) return;
    if (this._music) {
      clearTimeout(this._music.timer);
      if (this._music.drone) for (const o of this._music.drone) { try { o.stop(); } catch (e) {} }
      this._music = null;
    }
  }
}
