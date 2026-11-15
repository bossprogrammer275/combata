// Bugatti Chiron Pur Sport W16 voice.
// Synth graph and transient design are adapted from the authored
// "Chiron Pur Sport – W16 sound engine" demo. Its local car simulator is
// replaced by the game's live W16/DCT/turbo telemetry.
import { createSoundEngineTools, clampSoundValue, numericGear } from './soundEngineTools.js';

export function createChironW16Engine({ ctx, destination, noiseBuffer }) {
  const { G, F, O, N, SH, burst, tone, target } =
    createSoundEngineTools(ctx, noiseBuffer);
  const IDLE = 850, LIM = 7000, RED = 6700;
  const MIX = { mEng: 0.9, mTur: 0.7, mExh: 0.8, mRoad: 0.6 };
  const S = {
    on: false, crank: 0, rpm: IDLE, kph: 0, gear: 1, thr: 0,
    boost: 0, shift: 0, since: 9, te: 0, cut: false, hi: false,
    crk: 0, env: 'open',
  };
  const A = {};
  let startedAt = 0;
  let lastGear = 1;
  let lastLimiter = false;

  function setEnv(environment) {
    S.env = environment;
    const tunnel = environment === 'tunnel';
    const length = ctx.sampleRate * (tunnel ? 2.4 : 0.5);
    const impulse = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let channel = 0; channel < 2; channel++) {
      const data = impulse.getChannelData(channel);
      for (let i = 0; i < length; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, tunnel ? 2.5 : 4);
      }
    }
    if (A.conv) {
      A.bus.disconnect(A.conv);
      A.conv.disconnect();
    }
    A.conv = ctx.createConvolver();
    A.conv.buffer = impulse;
    A.bus.connect(A.conv);
    A.conv.connect(A.wet);
    A.wet.gain.value = tunnel ? 0.5 : 0.18;
  }

  function build() {
    A.master = G(0);
    A.comp = ctx.createDynamicsCompressor();
    A.comp.threshold.value = -16;
    A.comp.ratio.value = 6;
    A.comp.attack.value = 0.005;
    A.an = ctx.createAnalyser();
    A.an.fftSize = 4096;
    A.an.smoothingTimeConstant = 0.82;
    A.bus = G(1);
    A.dry = G(1);
    A.wet = G(0.2);
    A.bus.connect(A.dry);
    A.dry.connect(A.comp);
    A.wet.connect(A.comp);
    A.comp.connect(A.master);
    A.master.connect(A.an);
    A.master.connect(destination);
    setEnv(S.env);
    for (const key in MIX) {
      A[key] = G(MIX[key]);
      A[key].connect(A.bus);
    }

    // W16 firing harmonics -> drive -> tracking filter -> exhaust resonance.
    A.pre = G(2);
    A.lp = F('lowpass', 900, 0.8);
    A.res = F('peaking', 170, 2);
    A.res.gain.value = 7;
    A.lump = G(0.85);
    A.eng = G(0);
    const shaper = SH(1.6);
    A.pre.connect(shaper);
    shaper.connect(A.lp);
    A.lp.connect(A.res);
    A.res.connect(A.lump);
    A.lump.connect(A.eng);
    A.eng.connect(A.mEng);
    A.oscs = [
      [0.5, 'sawtooth', 0.5, 0],
      [1, 'sawtooth', 0.9, -8],
      [1, 'sawtooth', 0.9, 8],
      [2, 'square', 0.3, 0],
      [3, 'triangle', 0.5, 0],
      [4, 'sawtooth', 0.18, 0],
      [6, 'triangle', 0.14, 0],
    ].map(([multiple, type, volume, detune]) => {
      const oscillator = O(type, 100, detune);
      const gain = G(volume);
      oscillator.connect(gain);
      gain.connect(A.pre);
      return { o: oscillator, m: multiple };
    });
    A.lfo = O('sine', 10);
    const lfoDepth = G(0.14);
    A.lfo.connect(lfoDepth);
    lfoDepth.connect(A.lump.gain);

    // Noise layers.
    const layer = (type, frequency, q, destinationNode) => {
      const source = N();
      const filter = F(type, frequency, q);
      const gain = G(0);
      source.connect(filter);
      filter.connect(gain);
      gain.connect(destinationNode);
      return { fl: filter, g: gain };
    };
    A.int = layer('bandpass', 600, 0.8, A.mEng);
    A.rum = layer('lowpass', 190, 0.7, A.mExh);
    A.who = layer('bandpass', 2400, 0.6, A.mTur);
    A.wnd = layer('bandpass', 700, 0.5, A.mRoad);
    A.rod = layer('lowpass', 260, 0.7, A.mRoad);

    // Turbo whistle, gear whine and crackle bus.
    A.tw = [0, 1].map(() => {
      const oscillator = O('sine', 3000);
      const gain = G(0);
      oscillator.connect(gain);
      gain.connect(A.mTur);
      return { o: oscillator, g: gain };
    });
    A.whn = O('sine', 400);
    A.whnG = G(0);
    A.whn.connect(A.whnG);
    A.whnG.connect(A.mRoad);
    A.popB = G(3);
    const popShaper = SH(3);
    const popGain = G(0.5);
    A.popB.connect(popShaper);
    popShaper.connect(popGain);
    popGain.connect(A.mExh);
  }

  function pop(volume = 1) {
    const frequency = 130 + Math.random() * 520;
    burst({
      dur: 0.05 + Math.random() * 0.07,
      f0: frequency * 2.2,
      f1: frequency,
      q: 1.3,
      g: 0.8 * volume,
      dest: A.popB,
    });
    tone(120, 40, 0.09, 0.35 * volume, A.mExh);
  }

  function bov(boost) {
    const volume = Math.min(1, boost);
    const count = Math.random() < 0.5 ? 3 : 1;
    for (let i = 0; i < count; i++) {
      burst({
        t: ctx.currentTime + i * 0.09,
        dur: 0.38,
        f0: 5200,
        f1: 2000,
        q: 1.4,
        g: 0.55 * volume,
        atk: 0.01,
        dest: A.mTur,
      });
    }
    burst({ dur: 0.3, f0: 900, f1: 400, q: 0.7, g: 0.25 * volume, dest: A.mTur });
  }

  function starter() {
    const time = ctx.currentTime;
    const oscillator = O('sawtooth', 110);
    const filter = F('lowpass', 900, 1);
    const gain = G(0);
    oscillator.connect(filter);
    filter.connect(gain);
    gain.connect(A.mEng);
    oscillator.frequency.setValueAtTime(110, time);
    oscillator.frequency.linearRampToValueAtTime(480, time + 1.2);
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(0.1, time + 0.3);
    gain.gain.setValueAtTime(0.1, time + 1.1);
    gain.gain.linearRampToValueAtTime(0, time + 1.35);
    oscillator.stop(time + 1.4);
  }

  function shiftSound(nextGear, direction) {
    const up = direction ? direction === 'up' : nextGear > S.gear;
    S.gear = nextGear;
    S.shift = nextGear ? 0.17 : 0;
    S.since = 0;
    if (!nextGear) return;
    tone(85, 35, 0.16, 0.3, A.mRoad);
    if (up) {
      if (S.boost > 0.4) bov(S.boost * 0.8);
      if (S.rpm > 4200) {
        for (let i = 0; i < 3; i++) {
          setTimeout(() => pop(0.6 + Math.random() * 0.4), 30 + i * 45 + Math.random() * 30);
        }
      }
      S.crk = Math.max(S.crk, 0.3);
    } else {
      for (let i = 0; i < 2; i++) setTimeout(() => pop(0.4), 20 + i * 55);
    }
  }

  function audio() {
    const time = ctx.currentTime;
    const P = (param, value, smoothing = 0.03) => target(param, value, smoothing);
    const f = S.rpm / 60 * 8;
    const te = S.te;
    const r = S.rpm / LIM;
    const crank = S.crank ? 1 : 0;
    A.oscs.forEach(x => P(x.o.frequency, Math.max(8, f * x.m), 0.012));
    P(A.lfo.frequency, f / 4 + 0.3, 0.05);
    P(A.lp.frequency, crank ? 260 : 350 + S.rpm * 0.38 + te * 2700, 0.04);
    P(A.pre.gain, 1.4 + te * 3.2);
    P(A.eng.gain, crank ? 0.55 : (S.cut ? 0.18 : (0.34 + 0.66 * te) * (0.75 + 0.25 * r)), S.cut ? 0.004 : 0.03);
    P(A.int.fl.frequency, 400 + S.rpm * 0.55);
    P(A.int.g.gain, crank ? 0 : 0.015 + 0.17 * te * r);
    P(A.rum.g.gain, crank ? 0.05 : 0.09 + 0.22 * te);
    P(A.who.g.gain, S.boost * 0.16);
    P(A.who.fl.frequency, 1800 + S.boost * 2600);
    A.tw.forEach((x, i) => {
      P(x.o.frequency, (2300 + S.boost * 6200) * (i ? 1.51 : 1), 0.05);
      P(x.g.gain, S.boost * (i ? 0.012 : 0.03), 0.05);
    });
    P(A.whn.frequency, 250 + S.kph * 8);
    P(A.whnG.gain, S.gear ? Math.min(0.035, S.kph / 350 * 0.04) * (0.4 + 0.6 * te) : 0);
    P(A.wnd.g.gain, Math.pow(S.kph / 350, 2) * 0.45);
    P(A.wnd.fl.frequency, 500 + S.kph * 4);
    P(A.rod.g.gain, Math.min(1, S.kph / 90) * 0.14);
  }

  build();

  return {
    start(telemetry = {}, options = {}) {
      if (S.on) return;
      S.on = true;
      startedAt = ctx.currentTime - (options.coldStart === false ? 1.3 : 0);
      S.crank = options.coldStart === false ? 0 : 1;
      S.rpm = Math.max(IDLE, Number(telemetry.rpm) || IDLE);
      S.gear = numericGear(telemetry.gear, 1);
      S.boost = clampSoundValue(telemetry.boost, 0, 1);
      lastGear = S.gear;
      A.master.gain.setTargetAtTime(0.9, ctx.currentTime, 0.05);
      if (options.coldStart !== false) starter();
    },
    update(telemetry = {}) {
      if (!S.on) return;
      const dt = clampSoundValue(telemetry.dt || 1 / 60, 0.001, 0.05);
      const previousGear = lastGear;
      S.rpm = clampSoundValue(telemetry.rpm || IDLE, 0, LIM + 300);
      S.kph = Math.abs(Number(telemetry.speed) || 0) * 3.6;
      S.gear = numericGear(telemetry.gear, S.gear);
      const targetThrottle = clampSoundValue(telemetry.throttle, 0, 1);
      S.thr += (targetThrottle - S.thr)
        * Math.min(1, dt * (targetThrottle > S.thr ? 9 : 14));
      S.shift = Math.max(0, Number(telemetry.shiftTimer) || 0);
      S.te = S.shift > 0 ? 0 : S.thr;
      S.boost = clampSoundValue(telemetry.boost, 0, 1);
      S.crank = ctx.currentTime - startedAt < 1.3 ? 1 : 0;
      S.cut = !!telemetry.revLimiter
        && Math.floor(ctx.currentTime / 0.055) % 2 === 0;
      S.since += dt;

      if (S.gear !== previousGear && S.gear > 0) {
        shiftSound(S.gear, telemetry.shiftDirection);
      }
      lastGear = S.gear;

      if (S.thr > 0.6) S.hi = true;
      if (S.hi && S.thr < 0.2) {
        S.hi = false;
        if (S.boost > 0.3) bov(S.boost);
        S.crk = 2.2;
      }
      if (S.crk > 0) {
        S.crk -= dt;
        if (S.rpm > 3000 && S.thr < 0.1
          && Math.random() < dt * (S.rpm - 2500) / 4500 * 16) {
          pop(0.5 + Math.random() * 0.5);
        }
      }
      if (S.cut && !lastLimiter && Math.random() < 0.5) pop(0.5);
      lastLimiter = S.cut;
      const environment = telemetry.environment === 'tunnel' ? 'tunnel' : 'open';
      if (environment !== S.env) setEnv(environment);
      audio();
    },
    stop() {
      if (!S.on) return;
      S.on = false;
      A.master.gain.setTargetAtTime(0, ctx.currentTime, 0.08);
    },
    setMix(key, value) {
      if (!Object.prototype.hasOwnProperty.call(MIX, key)) return false;
      MIX[key] = clampSoundValue(value, 0, 1.5);
      if (A[key]) A[key].gain.setTargetAtTime(MIX[key], ctx.currentTime, 0.03);
      return true;
    },
    setEnvironment(value) {
      const environment = value === 'tunnel' ? 'tunnel' : 'open';
      if (environment !== S.env) setEnv(environment);
    },
    getState() { return { ...S }; },
  };
}
