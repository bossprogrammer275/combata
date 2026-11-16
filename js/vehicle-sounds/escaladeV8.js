// 2006 Cadillac Escalade ESV Vortec 6000 cross-plane V8 voice.
// This is a dedicated Web Audio prototype built from the game's shared primitives.
// It consumes the live four-speed automatic powertrain telemetry and keeps its
// own engine, exhaust, intake, transmission, tyre, road and wind layers.
import { createSoundEngineTools, clampSoundValue, numericGear } from './soundEngineTools.js';

export function createEscaladeV8Engine({ ctx, destination, noiseBuffer }) {
  const { G, F, O, N, SH, burst, tone, target: P, disposeSources } =
    createSoundEngineTools(ctx, noiseBuffer);
  const IDLE = 600, RED = 5600;
  const MIX = { mEng: 0.92, mExh: 0.9, mInt: 0.72, mTrans: 0.48, mRoad: 0.7, mWind: 0.48 };
  const S = {
    on: false, rpm: IDLE, kph: 0, gear: 1, thr: 0, load: 0,
    shift: 0, shiftDir: null, cab: false, env: 'open', sinceShift: 4,
    brake: false, slip: 0,
  };
  const A = {};
  let lastGear = 1;

  const layer = (type, frequency, q, dest) => {
    const source = N();
    const filter = F(type, frequency, q);
    const gain = G(0);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(dest);
    return { source, filter, gain };
  };
  const oscillator = (type, frequency, dest, gain = 0) => {
    const source = O(type, frequency);
    const volume = G(gain);
    source.connect(volume);
    volume.connect(dest);
    return { source, gain: volume };
  };

  function build() {
    A.master = G(0);
    A.compressor = ctx.createDynamicsCompressor();
    A.compressor.threshold.value = -17;
    A.compressor.knee.value = 22;
    A.compressor.ratio.value = 5;
    A.compressor.attack.value = 0.006;
    A.compressor.release.value = 0.18;

    A.bus = G(1);
    A.perspective = F('lowpass', 17000, 0.65);
    A.dry = G(1);
    A.wet = G(0.12);
    const impulseLength = Math.floor(ctx.sampleRate * 0.38);
    const impulse = ctx.createBuffer(2, impulseLength, ctx.sampleRate);
    for (let channel = 0; channel < 2; channel++) {
      const data = impulse.getChannelData(channel);
      for (let i = 0; i < impulseLength; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / impulseLength, 3.4);
      }
    }
    A.room = ctx.createConvolver();
    A.room.buffer = impulse;
    A.bus.connect(A.perspective);
    A.perspective.connect(A.dry);
    A.dry.connect(A.compressor);
    A.perspective.connect(A.room);
    A.room.connect(A.wet);
    A.wet.connect(A.compressor);
    A.compressor.connect(A.master);
    A.master.connect(destination);

    ['mEng', 'mExh', 'mInt', 'mTrans', 'mRoad', 'mWind'].forEach(key => {
      A[key] = G(0.8);
      A[key].connect(A.bus);
    });

    // Low-order crank rumble plus the strong fourth-order V8 firing pulse.
    A.pre = G(1.5);
    A.shaper = SH(1.45);
    A.engineLow = F('lowpass', 920, 0.82);
    A.engineBody = F('peaking', 118, 1.1);
    A.engineBody.gain.value = 5;
    A.engineMid = F('peaking', 620, 1.4);
    A.engineMid.gain.value = 3.5;
    A.engineGain = G(0);
    A.pre.connect(A.shaper);
    A.shaper.connect(A.engineLow);
    A.engineLow.connect(A.engineBody);
    A.engineBody.connect(A.engineMid);
    A.engineMid.connect(A.engineGain);
    A.engineGain.connect(A.mEng);

    A.orders = [
      [0.5, 'sawtooth', 0.18, -4],
      [1, 'triangle', 0.28, 0],
      [2, 'sawtooth', 0.24, 3],
      [4, 'sawtooth', 0.92, 0],
      [8, 'triangle', 0.26, -2],
      [12, 'square', 0.08, 1],
    ].map(([multiple, type, volume, detune]) => {
      const source = O(type, 30, detune);
      const gain = G(volume);
      source.connect(gain);
      gain.connect(A.pre);
      return { source, multiple };
    });

    // Intake growl follows throttle; exhaust gets a separate low-end body.
    A.intake = layer('bandpass', 680, 0.85, A.mInt);
    A.intakeHigh = layer('bandpass', 1850, 1.2, A.mInt);
    A.exhaustRumble = layer('lowpass', 155, 0.72, A.mExh);
    A.exhaustPulse = layer('bandpass', 520, 0.9, A.mExh);
    A.exhaustRasp = layer('bandpass', 1450, 1.3, A.mExh);

    // Four-speed automatic transmission whine and torque-converter/body tone.
    A.transWhine = oscillator('sine', 48, A.mTrans, 0);
    A.transBody = layer('bandpass', 270, 0.7, A.mTrans);

    // Tyre / road / wind layers remain audible when engine load is low.
    A.tireLow = layer('lowpass', 250, 0.7, A.mRoad);
    A.tireHigh = layer('bandpass', 980, 0.9, A.mRoad);
    A.wind = layer('bandpass', 620, 0.55, A.mWind);
    A.wheelWhirr = oscillator('sine', 120, A.mRoad, 0);
  }

  function starter() {
    const time = ctx.currentTime;
    const source = O('sawtooth', 72);
    const filter = F('lowpass', 340, 1.0);
    const gain = G(0);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(A.mEng);
    source.frequency.setValueAtTime(72, time);
    source.frequency.linearRampToValueAtTime(185, time + 0.34);
    source.frequency.linearRampToValueAtTime(95, time + 0.78);
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(0.12, time + 0.06);
    gain.gain.setValueAtTime(0.10, time + 0.55);
    gain.gain.linearRampToValueAtTime(0.001, time + 0.92);
    source.stop(time + 0.96);
  }

  function gearShift(nextGear, direction) {
    const up = direction ? direction === 'up' : nextGear > lastGear;
    const time = ctx.currentTime;
    S.shiftDir = up ? 'up' : 'down';
    S.sinceShift = 0;
    // A restrained driveline thump and clutch/gear engagement tick.
    tone(up ? 82 : 108, up ? 48 : 62, up ? 0.15 : 0.19, 0.24, A.mTrans);
    burst({
      type: 'bandpass', f0: up ? 720 : 980, f1: up ? 360 : 480,
      q: 1.1, dur: 0.09, g: up ? 0.16 : 0.20, dest: A.mTrans, t: time,
    });
  }

  function setEnvironment(environment) {
    S.env = environment === 'tunnel' ? 'tunnel' : 'open';
    P(A.wet.gain, S.env === 'tunnel' ? 0.30 : (S.cab ? 0.16 : 0.10), 0.22);
    P(A.perspective.frequency, S.cab ? 3100 : 17000, 0.18);
  }

  function updateAudio() {
    const rpm = Math.max(IDLE, Math.min(RED + 250, S.rpm));
    const crankHz = rpm / 60;
    const throttle = S.thr;
    const runningLoad = 0.28 + throttle * 0.72;
    const cab = S.cab ? 1 : 0;
    const kph = S.kph;
    const speedRatio = Math.min(1, kph / 180);
    const exterior = S.cab ? 0.62 : 1;
    const interior = S.cab ? 1 : 0.62;

    A.orders.forEach(order => {
      P(order.source.frequency, Math.max(8, crankHz * order.multiple), 0.018);
    });
    P(A.engineGain.gain,
      S.on ? (0.025 + Math.pow(rpm / RED, 0.68) * 0.085) * runningLoad : 0, 0.055);
    P(A.engineLow.frequency, 540 + throttle * 880 + rpm * 0.035, 0.08);

    P(A.intake.gain.gain, throttle * (0.015 + speedRatio * 0.045) * interior, 0.08);
    P(A.intake.filter.frequency, 560 + rpm * 0.10, 0.10);
    P(A.intakeHigh.gain.gain, throttle * throttle * 0.035 * interior, 0.08);
    P(A.intakeHigh.filter.frequency, 1200 + rpm * 0.18, 0.10);

    P(A.exhaustRumble.gain, (0.025 + runningLoad * 0.065) * exterior, 0.08);
    P(A.exhaustRumble.filter.frequency, 110 + rpm * 0.045, 0.08);
    P(A.exhaustPulse.gain, (0.018 + runningLoad * 0.052) * exterior, 0.08);
    P(A.exhaustPulse.filter.frequency, 360 + rpm * 0.16, 0.08);
    P(A.exhaustRasp.gain, throttle * (0.006 + speedRatio * 0.018) * exterior, 0.08);
    P(A.exhaustRasp.filter.frequency, 1050 + rpm * 0.22, 0.08);

    P(A.transWhine.gain.gain, (0.006 + speedRatio * 0.025) * (0.65 + throttle * 0.35), 0.10);
    P(A.transWhine.source.frequency, 34 + kph * 2.6 + S.gear * 16, 0.12);
    P(A.transBody.gain.gain, (S.shift > 0 ? 0.035 : 0.012) * interior, 0.05);
    P(A.transBody.filter.frequency, 190 + S.gear * 34 + kph * 1.1, 0.12);

    const road = Math.pow(speedRatio, 1.15);
    P(A.tireLow.gain.gain, road * (0.025 + Math.min(0.08, S.slip * 0.10)), 0.12);
    P(A.tireHigh.gain.gain, road * (0.012 + Math.min(0.10, S.slip * 0.16)), 0.12);
    P(A.tireHigh.filter.frequency, 760 + kph * 5.0, 0.12);
    P(A.wind.gain.gain, Math.pow(speedRatio, 2.1) * 0.24, 0.16);
    P(A.wind.filter.frequency, 520 + kph * 4.0, 0.16);
    P(A.wheelWhirr.gain.gain, road * 0.012, 0.12);
    P(A.wheelWhirr.source.frequency, 80 + kph * 5.5, 0.12);

    P(A.mEng.gain, MIX.mEng * (S.cab ? 0.88 : 1.0), 0.12);
    P(A.mExh.gain, MIX.mExh * (S.cab ? 0.52 : 1.0), 0.12);
    P(A.mInt.gain, MIX.mInt * (S.cab ? 1.08 : 0.72), 0.12);
    P(A.mTrans.gain, MIX.mTrans, 0.12);
    P(A.mRoad.gain, MIX.mRoad * (S.cab ? 0.9 : 0.72), 0.12);
    P(A.mWind.gain, MIX.mWind * (S.cab ? 0.55 : 1.0), 0.12);
    P(A.perspective.frequency, S.cab ? 3100 : 17000, 0.15);
    P(A.wet.gain, S.env === 'tunnel' ? 0.30 : (S.cab ? 0.16 : 0.10), 0.15);
  }

  build();

  return {
    start(telemetry = {}, options = {}) {
      if (S.on) return;
      S.on = true;
      S.rpm = Math.max(IDLE, Number(telemetry.rpm) || IDLE);
      S.gear = numericGear(telemetry.gear, 1);
      lastGear = S.gear;
      S.cab = !!telemetry.interior;
      S.thr = 0;
      P(A.master.gain, 0.88, 0.05);
      if (options.coldStart !== false) starter();
      setEnvironment(telemetry.environment);
      updateAudio();
    },
    update(telemetry = {}) {
      if (!S.on) return;
      const dt = clampSoundValue(telemetry.dt || 1 / 60, 0.001, 0.05);
      const nextGear = numericGear(telemetry.gear, S.gear);
      const targetThrottle = clampSoundValue(telemetry.throttle, 0, 1);
      S.thr += (targetThrottle - S.thr)
        * Math.min(1, dt * (targetThrottle > S.thr ? 8 : 13));
      S.rpm = clampSoundValue(telemetry.rpm || IDLE, IDLE, RED + 250);
      S.kph = Math.abs(Number(telemetry.speed) || 0) * 3.6;
      S.gear = nextGear;
      S.load = clampSoundValue(telemetry.engineLoad, 0, 1);
      S.shift = Math.max(0, Number(telemetry.shiftTimer) || 0);
      S.shiftDir = telemetry.shiftDirection || S.shiftDir;
      S.cab = !!telemetry.interior;
      S.brake = !!telemetry.braking;
      S.slip = clampSoundValue(telemetry.slipRatio, 0, 1);
      S.sinceShift += dt;
      if (nextGear !== lastGear) gearShift(nextGear, telemetry.shiftDirection);
      lastGear = nextGear;
      if (telemetry.environment) setEnvironment(telemetry.environment);
      updateAudio();
    },
    stop() {
      if (!S.on) return;
      S.on = false;
      P(A.master.gain, 0, 0.08);
    },
    dispose() { disposeSources(0.12); },
    setMix(key, value) {
      if (!Object.prototype.hasOwnProperty.call(MIX, key)) return false;
      MIX[key] = clampSoundValue(value, 0, 1.5);
      return true;
    },
    setEnvironment,
    getState() { return { ...S }; },
  };
}
