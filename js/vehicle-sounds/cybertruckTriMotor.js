// Tesla Cybertruck Cyberbeast electric drivetrain voice.
// Sound graph, motor-order harmonics, inverter noise, tyre/wind/body layers,
// pump/fan ambience and pedestrian warning tone are adapted from the authored
// "Cybertruck – electric drivetrain sound engine" demo. The local demo physics
// is replaced by real game motor-RPM, throttle, regenerative-braking and speed data.
import { createSoundEngineTools, clampSoundValue } from './soundEngineTools.js';

export function createCybertruckTriMotorEngine({ ctx, destination, noiseBuffer }) {
  const { G, F, O, N, burst, tone, target, disposeSources } =
    createSoundEngineTools(ctx, noiseBuffer);
  const SP = {
    beast: { P: 630, F: 33500, nm: 3, name: 'Cyberbeast' },
    awd: { P: 300, F: 26000, nm: 2, name: 'Dual motor' },
  };
  const SURF = {
    asphalt: { m: 1, f: 900, b: 0.5, name: 'Asphalt' },
    gravel: { m: 1.7, f: 1500, b: 1.4, name: 'Gravel' },
  };
  const PV = {
    cab: { mot: 0.55, tire: 1.2, wind: 1.25, body: 1, avas: 0.12, amb: 1 },
    out: { mot: 1, tire: 0.9, wind: 0.45, body: 0.8, avas: 1, amb: 0.2 },
  };
  const MIX = { mMot: 0.9, mTire: 0.8, mWind: 0.8, mBody: 0.8 };
  const S = {
    on: false, boot: 0, kph: 0, thr: 0, tIn: 0, brk: 0, ts: 0,
    pk: 0, mrpm: 0, ls: 0, wa: 0, mode: 'beast', surf: 'asphalt',
    cab: false, avas: true, slip: 0,
  };
  const A = {};
  let lastTime = ctx.currentTime;

  function build() {
    A.master = G(0);
    A.comp = ctx.createDynamicsCompressor();
    A.comp.threshold.value = -18;
    A.comp.ratio.value = 4;
    A.an = ctx.createAnalyser();
    A.an.fftSize = 4096;
    A.an.smoothingTimeConstant = 0.82;
    A.bus = G(1);
    A.persp = F('lowpass', 16000, 0.6);
    A.dry = G(1);
    A.wet = G(0.12);
    A.bus.connect(A.persp);
    A.persp.connect(A.dry);
    A.dry.connect(A.comp);
    const length = ctx.sampleRate * 0.35;
    const impulse = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let channel = 0; channel < 2; channel++) {
      const data = impulse.getChannelData(channel);
      for (let i = 0; i < length; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 3);
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
    ['mMot', 'mTire', 'mWind', 'mBody', 'mAvas', 'mAmb'].forEach((key) => {
      A[key] = G(key === 'mAvas' ? 1 : 0.8);
      A[key].connect(A.bus);
    });

    // Three motors: rotor-order tones through shared housing resonances.
    A.mw = G(0);
    A.pk1 = F('peaking', 900, 3); A.pk1.gain.value = 7;
    A.pk2 = F('peaking', 2300, 3); A.pk2.gain.value = 5;
    A.mw.connect(A.pk1);
    A.pk1.connect(A.pk2);
    A.pk2.connect(A.mMot);
    A.mot = [1, 1.006, 0.994].map((ratio) => {
      const lfo = O('sine', 10);
      const fmg = G(0);
      const mg = G(0);
      lfo.connect(fmg);
      mg.connect(A.mw);
      const os = [[6, 'sine', 0.5], [12, 'sine', 1], [24, 'sine', 0.55], [48, 'triangle', 0.1]]
        .map(([order, type, volume]) => {
          const oscillator = O(type, 100);
          const gain = G(volume);
          oscillator.connect(gain);
          gain.connect(mg);
          if (order === 12) fmg.connect(oscillator.frequency);
          return { o: oscillator, n: order };
        });
      return { r: ratio, lfo, fmg, mg, os };
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
    A.r1 = layer('lowpass', 230, 0.7, A.mTire);
    A.r2 = layer('bandpass', 900, 1.2, A.mTire);
    A.wd = layer('bandpass', 700, 0.5, A.mWind);
    A.bf = layer('lowpass', 70, 0.7, A.mWind);
    A.fan = layer('bandpass', 900, 0.4, A.mAmb);
    const osc = (frequency, destinationNode) => {
      const oscillator = O('sine', frequency);
      const gain = G(0);
      oscillator.connect(gain);
      gain.connect(destinationNode);
      return { o: oscillator, g: gain };
    };
    A.th = osc(400, A.mTire);
    A.pump = osc(98, A.mAmb);

    // Pedestrian warning tone with slow tremolo.
    A.avG = G(0);
    A.avG.connect(A.mAvas);
    A.avl = O('sine', 5.5);
    A.avd = G(0);
    A.avl.connect(A.avd);
    A.avd.connect(A.avG.gain);
    A.av = [0.5, 0.3, 0.12].map((volume) => {
      const oscillator = O('sine', 220);
      const gain = G(volume);
      oscillator.connect(gain);
      gain.connect(A.avG);
      return oscillator;
    });
  }

  function bump(amount) {
    tone(70 + Math.random() * 30, 32, 0.2, 0.32 * amount, A.mBody);
    burst({ type: 'lowpass', dur: 0.28, f0: 260, f1: 120, q: 0.7, g: 0.3 * amount, dest: A.mBody });
    tone(430 + Math.random() * 90, 420, 0.45, 0.035 * amount, A.mBody);
  }

  function click() {
    burst({ dur: 0.03, f0: 2600, f1: 900, q: 2, g: 0.6, dest: A.mBody });
    tone(220, 70, 0.06, 0.35, A.mBody);
  }

  function audio(dt) {
    const time = ctx.currentTime;
    const P = (param, value, smoothing = 0.05) => target(param, value, smoothing);
    const perspective = S.cab ? PV.cab : PV.out;
    const surface = SURF[S.surf];
    const running = S.on && S.boot <= 0;
    const speed = S.kph / 3.6;
    const speedNorm = Math.min(1, S.kph / 209);
    const rpmNorm = S.kph / 200;
    const drive = Math.max(0, S.ts);
    const regen = Math.max(0, -S.ts);
    const motorCount = SP[S.mode].nm;

    P(A.persp.frequency, S.cab ? 3200 : 16000, 0.15);
    P(A.mMot.gain, MIX.mMot * perspective.mot, 0.1);
    P(A.mTire.gain, MIX.mTire * perspective.tire, 0.1);
    P(A.mWind.gain, MIX.mWind * perspective.wind, 0.1);
    P(A.mBody.gain, MIX.mBody * perspective.body, 0.1);
    P(A.mAmb.gain, perspective.amb, 0.1);

    A.mot.forEach((motor, index) => {
      const fundamental = S.mrpm / 60 * motor.r;
      motor.os.forEach(part => P(part.o.frequency, Math.max(5, fundamental * part.n), 0.01));
      P(motor.lfo.frequency, fundamental + 0.1, 0.05);
      P(motor.fmg.gain, fundamental * 0.048, 0.05);
      P(motor.mg.gain, index < motorCount ? (motorCount === 3 ? 0.55 : 0.8) : 0, 0.2);
    });
    P(A.mw.gain, running
      ? (0.006 + 0.085 * Math.pow(speedNorm, 0.8)) * (0.3 + 0.7 * drive + 0.5 * regen + (S.kph > 1 ? 0.15 : 0))
      : 0, 0.06);
    P(A.pump.g.gain, running ? 0.01 + 0.03 * Math.abs(S.ts) : (S.on ? 0.008 : 0), 0.2);
    P(A.pump.o.frequency, 98 + Math.abs(S.ts) * 60, 0.2);
    P(A.fan.g.gain, S.on ? 0.014 : 0, 0.5);

    const warning = (running && S.avas && S.kph > 0.3)
      ? Math.max(0, Math.min(1, (30 - S.kph) / 16)) * 0.09 * perspective.avas
      : 0;
    const warningBase = 190 + S.kph * 7;
    P(A.avG.gain, warning, 0.1);
    P(A.avd.gain, warning * 0.25, 0.1);
    [1, 1.5, 2.01].forEach((multiple, index) => P(A.av[index].frequency, warningBase * multiple, 0.1));

    const rolling = Math.max(0, rpmNorm);
    P(A.r1.g.gain, 0.16 * Math.pow(rolling, 1.15) * surface.m, 0.1);
    P(A.r2.g.gain, 0.06 * Math.pow(rolling, 1.3) * surface.m, 0.1);
    P(A.r2.fl.frequency, surface.f, 0.2);
    P(A.th.g.gain, 0.008 * rolling, 0.1);
    P(A.th.o.frequency, Math.max(20, speed * 28), 0.05);
    P(A.wd.g.gain, 0.5 * Math.pow(rolling, 2.3), 0.1);
    P(A.wd.fl.frequency, 700 + S.kph * 4, 0.1);
    P(A.bf.g.gain, 0.4 * Math.pow(rolling, 3), 0.1);

    if (running && S.kph > 10
      && Math.random() < dt * (0.2 + S.kph / 80) * surface.b * 0.5) {
      bump(0.4 + Math.random() * 0.6);
    }
    if (running && S.surf === 'gravel' && S.kph > 5
      && Math.random() < dt * S.kph * 1.2) {
      burst({
        dur: 0.02 + Math.random() * 0.02,
        f0: 1500 + Math.random() * 3000,
        q: 2,
        g: 0.05 + 0.08 * Math.min(1, S.kph / 120),
        dest: A.mTire,
      });
    }
  }

  build();

  return {
    start(telemetry = {}, options = {}) {
      if (S.on) return;
      S.on = true;
      S.boot = options.coldStart === false ? 0 : 1.5;
      S.kph = Math.abs(Number(telemetry.speed) || 0) * 3.6;
      S.mrpm = Math.max(0, Number(telemetry.motorRpm ?? telemetry.rpm) || 0);
      S.mode = telemetry.driveMode === 'awd' ? 'awd' : 'beast';
      S.cab = !!telemetry.interior;
      S.avas = telemetry.avas !== false;
      A.master.gain.setTargetAtTime(0.9, ctx.currentTime, 0.05);
      if (options.coldStart !== false) {
        click();
        setTimeout(click, 190);
      }
    },
    update(telemetry = {}) {
      if (!S.on) return;
      const dt = clampSoundValue(telemetry.dt || 1 / 60, 0.001, 0.05);
      const targetThrottle = clampSoundValue(telemetry.throttle, 0, 1);
      S.thr += (targetThrottle - S.thr)
        * Math.min(1, dt * (targetThrottle > S.thr ? 12 : 16));
      S.kph = Math.abs(Number(telemetry.speed) || 0) * 3.6;
      S.mrpm = Math.max(0, Number(telemetry.motorRpm ?? telemetry.rpm) || 0);
      S.brk = telemetry.braking ? 1 : 0;
      S.cab = !!telemetry.interior;
      S.avas = telemetry.avas !== false;
      S.mode = telemetry.driveMode === 'awd' ? 'awd' : 'beast';
      const surfaceName = String(telemetry.surface || '').toLowerCase();
      S.surf = /gravel|dirt|loose|sand/.test(surfaceName) ? 'gravel' : 'asphalt';
      const driveDemand = clampSoundValue(telemetry.driveDemand ?? S.thr, 0, 1);
      const regenDemand = clampSoundValue(telemetry.regenLevel, 0, 1);
      S.ts = driveDemand - regenDemand;
      S.slip = clampSoundValue(telemetry.slipRatio, 0, 1);
      if (S.slip <= 0) {
        S.slip = (S.thr > 0.7 ? 0.08 : 0) * Math.max(0, 1 - S.kph / 50.4);
      }
      S.boot = Math.max(0, S.boot - dt);
      audio(dt);
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
    setWarningTone(enabled) { S.avas = !!enabled; },
    getState() { return { ...S }; },
  };
}
