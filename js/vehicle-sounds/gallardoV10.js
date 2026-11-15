// Lamborghini Gallardo V10 engine voice.
// Sound graph adapted from the authored "Lamborghini Gallardo – V10 sound engine"
// demo. Only the demo's standalone drivetrain simulation/UI has been replaced
// with live telemetry from the game's Gallardo powertrain.
import { createSoundEngineTools, clampSoundValue, numericGear } from './soundEngineTools.js';

export function createGallardoV10Engine({ ctx, destination, noiseBuffer }) {
  const { G, F, O, N, SH, burst, tone, target, disposeSources } =
    createSoundEngineTools(ctx, noiseBuffer);
  const IDLE = 900, LIM = 8500, RED = 8000;
  const PV = {
    cab: { eng: 0.8, exh: 0.6, int: 1.2, road: 1.4 },
    out: { eng: 1, exh: 1.2, int: 0.7, road: 0.5 },
  };
  const MIX = { mEng: 0.9, mExh: 0.8, mInt: 0.8, mRoad: 0.7 };
  const S = {
    on: false, crank: 0, rpm: IDLE, kph: 0, gear: 1,
    thr: 0, shift: 0, down: false, since: 9, te: 0,
    cut: false, hi: false, crk: 0, corsa: false, sport: false, cab: false,
  };
  const A = {};
  let startedAt = 0;
  let lastGear = 1;
  let lastUpdate = ctx.currentTime;

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
    A.persp = F('lowpass', 18000, 0.6);
    A.dry = G(1);
    A.wet = G(0.14);
    A.bus.connect(A.persp);
    A.persp.connect(A.dry);
    A.dry.connect(A.comp);
    const len = ctx.sampleRate * 0.5;
    const impulse = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let channel = 0; channel < 2; channel++) {
      const data = impulse.getChannelData(channel);
      for (let i = 0; i < len; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 4);
      }
    }
    A.conv = ctx.createConvolver();
    A.conv.buffer = impulse;
    A.persp.connect(A.conv);
    A.conv.connect(A.wet);
    A.wet.connect(A.comp);
    A.comp.connect(A.master);
    A.master.connect(A.an);
    A.master.connect(destination);
    ['mEng', 'mExh', 'mInt', 'mRoad'].forEach((key) => {
      A[key] = G(0.8);
      A[key].connect(A.bus);
    });

    // V10 firing orders -> drive -> tracking filter -> body and pipe resonances.
    A.pre = G(2);
    A.lp = F('lowpass', 900, 0.8);
    A.r1 = F('peaking', 700, 2); A.r1.gain.value = 6;
    A.r2 = F('peaking', 1900, 2.5); A.r2.gain.value = 5;
    A.lump = G(0.85);
    A.eng = G(0);
    const shaper = SH(1.7);
    A.pre.connect(shaper);
    shaper.connect(A.lp);
    A.lp.connect(A.r1);
    A.r1.connect(A.r2);
    A.r2.connect(A.lump);
    A.lump.connect(A.eng);
    A.eng.connect(A.mEng);
    A.oscs = [
      [0.5, 'sawtooth', 0.35, 0],
      [1, 'sawtooth', 0.95, -7],
      [1, 'sawtooth', 0.95, 7],
      [2, 'square', 0.4, 0],
      [3, 'triangle', 0.55, 0],
      [4, 'sawtooth', 0.3, 0],
    ].map(([multiple, type, volume, detune]) => {
      const oscillator = O(type, 100, detune);
      const gain = G(volume);
      oscillator.connect(gain);
      gain.connect(A.pre);
      return { o: oscillator, m: multiple };
    });
    A.lfo = O('sine', 10);
    A.ld = G(0.1);
    A.lfo.connect(A.ld);
    A.ld.connect(A.lump.gain);

    // Top-end scream bypasses the shaper.
    A.scrG = G(0);
    A.scrG.connect(A.mInt);
    A.scr = [[6, 'sawtooth', 1], [8, 'triangle', 0.7]].map(([multiple, type, volume]) => {
      const oscillator = O(type, 400);
      const gain = G(volume);
      oscillator.connect(gain);
      gain.connect(A.scrG);
      return { o: oscillator, m: multiple };
    });

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
    A.int = layer('bandpass', 600, 0.8, A.mInt);
    A.rum = layer('lowpass', 200, 0.7, A.mExh);
    A.rasp = layer('bandpass', 3500, 1.5, A.mExh);
    A.wnd = layer('bandpass', 700, 0.5, A.mRoad);
    A.rod = layer('lowpass', 260, 0.7, A.mRoad);
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
    const frequency = 130 + Math.random() * 560;
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

  function starter() {
    const time = ctx.currentTime;
    const oscillator = O('sawtooth', 90);
    const filter = F('lowpass', 700, 1);
    const gain = G(0);
    oscillator.connect(filter);
    filter.connect(gain);
    gain.connect(A.mEng);
    oscillator.frequency.setValueAtTime(90, time);
    oscillator.frequency.linearRampToValueAtTime(330, time + 1);
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(0.1, time + 0.25);
    gain.gain.setValueAtTime(0.1, time + 0.95);
    gain.gain.linearRampToValueAtTime(0, time + 1.15);
    oscillator.stop(time + 1.2);
  }

  function shiftSound(nextGear, direction) {
    const up = direction ? direction === 'up' : nextGear > S.gear;
    const fast = S.corsa;
    const sport = S.sport ? 1 : 0;
    S.down = !up && nextGear > 0;
    S.shift = nextGear ? (fast ? 0.09 : 0.24) : 0;
    S.since = 0;
    if (!nextGear) return;
    tone(75, 32, fast ? 0.1 : 0.16, fast ? 0.55 : 0.28, A.mRoad);
    if (up) {
      if (S.rpm > 4500 || fast) {
        for (let i = 0; i < 1 + 2 * sport; i++) {
          setTimeout(() => pop(0.5 + Math.random() * 0.5), 20 + i * 40 + Math.random() * 30);
        }
      }
      S.crk = Math.max(S.crk, 0.35);
    } else {
      for (let i = 0; i < 1 + sport; i++) {
        setTimeout(() => pop(0.35), 25 + i * 50);
      }
    }
  }

  function audio() {
    const time = ctx.currentTime;
    const P = (param, value, smoothing = 0.03) => target(param, value, smoothing);
    const f = S.rpm / 60 * 5;
    const te = S.te;
    const r = S.rpm / LIM;
    const crank = S.crank ? 1 : 0;
    const sport = S.sport ? 1 : 0;
    const perspective = S.cab ? PV.cab : PV.out;
    P(A.persp.frequency, S.cab ? 5200 : 18000, 0.15);
    P(A.mEng.gain, MIX.mEng * perspective.eng, 0.1);
    P(A.mExh.gain, MIX.mExh * perspective.exh * (sport ? 1.45 : 1), 0.1);
    P(A.mInt.gain, MIX.mInt * perspective.int, 0.1);
    P(A.mRoad.gain, MIX.mRoad * perspective.road, 0.1);
    A.oscs.forEach(x => P(x.o.frequency, Math.max(8, f * x.m), 0.01));
    A.scr.forEach(x => P(x.o.frequency, Math.max(20, f * x.m), 0.01));
    P(A.scrG.gain, crank ? 0 : te * Math.pow(r, 2.2) * (0.05 + 0.08 * sport), 0.05);
    P(A.lfo.frequency, S.rpm / 60 * 0.5 + 0.2, 0.05);
    P(A.ld.gain, 0.04 + 0.2 * Math.max(0, 1 - S.rpm / 3500), 0.1);
    P(A.lp.frequency, crank ? 300 : (450 + S.rpm * 0.45 + te * 2600) * (1 + 0.3 * sport), 0.04);
    P(A.pre.gain, 1.5 + te * 3.4);
    P(A.eng.gain, crank ? 0.5 : (S.cut ? 0.2 : (0.36 + 0.64 * te) * (0.7 + 0.3 * r)), S.cut ? 0.004 : 0.03);
    P(A.int.fl.frequency, 500 + S.rpm * 0.6);
    P(A.int.g.gain, crank ? 0 : 0.02 + 0.2 * te * r);
    P(A.rum.g.gain, crank ? 0.05 : 0.1 + 0.25 * te);
    P(A.rasp.g.gain, crank ? 0 : te * r * (0.06 + 0.1 * sport));
    const gearOn = S.gear > 0 && S.shift <= 0;
    P(A.whn.frequency, Math.max(20, S.rpm / 60 * 18), 0.02);
    P(A.whnG.gain, gearOn ? (0.01 + 0.022 * te) * r : 0, 0.05);
    P(A.wnd.g.gain, 0.4 * Math.pow(S.kph / 300, 2.2), 0.1);
    P(A.wnd.fl.frequency, 600 + S.kph * 4, 0.1);
    P(A.rod.g.gain, Math.min(1, S.kph / 100) * 0.1, 0.1);
  }

  build();

  return {
    start(telemetry = {}, options = {}) {
      if (S.on) return;
      S.on = true;
      startedAt = ctx.currentTime - (options.coldStart === false ? 1.1 : 0);
      S.crank = options.coldStart === false ? 0 : 1;
      S.rpm = Math.max(IDLE, Number(telemetry.rpm) || IDLE);
      S.gear = numericGear(telemetry.gear, 1);
      lastGear = S.gear;
      A.master.gain.setTargetAtTime(0.9, ctx.currentTime, 0.05);
      if (options.coldStart !== false) starter();
    },
    update(telemetry = {}) {
      if (!S.on) return;
      const dt = clampSoundValue((Number(telemetry.dt) || 1 / 60), 0.001, 0.05);
      const previousGear = lastGear;
      S.rpm = clampSoundValue(Number(telemetry.rpm) || IDLE, 0, LIM + 300);
      S.kph = Math.abs(Number(telemetry.speed) || 0) * 3.6;
      S.gear = numericGear(telemetry.gear, S.gear);
      const targetThrottle = clampSoundValue(telemetry.throttle, 0, 1);
      S.thr += (targetThrottle - S.thr)
        * Math.min(1, dt * (targetThrottle > S.thr ? 10 : 14));
      S.shift = Math.max(0, Number(telemetry.shiftTimer) || 0);
      S.down = telemetry.shiftDirection === 'down';
      S.te = S.shift > 0 ? (S.down ? 1 : 0) : S.thr;
      const previousCut = S.cut;
      S.cut = !!telemetry.revLimiter && Math.floor(ctx.currentTime / 0.05) % 2 === 0;
      if (S.cut) {
        S.te = 0;
        if (!previousCut && Math.random() < (S.sport ? 0.7 : 0.35)) pop(0.5);
      }
      S.cab = !!telemetry.interior;
      S.sport = !!telemetry.exhaustOpen;
      S.corsa = !!telemetry.corsa;
      S.crank = ctx.currentTime - startedAt < 1.1 ? 1 : 0;
      S.since += dt;

      if (S.gear !== previousGear && S.gear > 0) {
        shiftSound(S.gear, telemetry.shiftDirection);
      }
      lastGear = S.gear;

      if (S.thr > 0.6) S.hi = true;
      if (S.hi && S.thr < 0.2) {
        S.hi = false;
        S.crk = S.sport ? 2.6 : 1.2;
      }
      if (S.crk > 0) {
        S.crk -= dt;
        if (S.rpm > 3200 && S.thr < 0.1
          && Math.random() < dt * (S.rpm - 2800) / 5500 * (S.sport ? 18 : 6)) {
          pop(0.5 + Math.random() * 0.5);
        }
      }
      audio();
      lastUpdate = ctx.currentTime;
    },
    stop() {
      if (!S.on) return;
      S.on = false;
      A.master.gain.setTargetAtTime(0, ctx.currentTime, 0.08);
    },
    dispose() { disposeSources(0.12); },
    setMix(key, value) {
      if (!Object.prototype.hasOwnProperty.call(MIX, key)) return false;
      MIX[key] = clampSoundValue(value, 0, 1.5);
      if (A[key]) A[key].gain.setTargetAtTime(MIX[key], ctx.currentTime, 0.03);
      return true;
    },
    getState() { return { ...S }; },
  };
}
