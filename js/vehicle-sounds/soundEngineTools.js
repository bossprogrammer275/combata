// Shared Web Audio primitives used by the authored vehicle sound engines.
// The individual engine modules keep their own oscillator/filter graphs.
export function createSoundEngineTools(ctx, noiseBuffer) {
  const G = (value = 0) => {
    const node = ctx.createGain();
    node.gain.value = value;
    return node;
  };
  const F = (type, frequency, q = 1) => {
    const node = ctx.createBiquadFilter();
    node.type = type;
    node.frequency.value = frequency;
    node.Q.value = q;
    return node;
  };
  const O = (type, frequency = 100, detune = 0) => {
    const node = ctx.createOscillator();
    node.type = type;
    node.frequency.value = frequency;
    node.detune.value = detune;
    node.start();
    return node;
  };
  const N = () => {
    const source = ctx.createBufferSource();
    source.buffer = noiseBuffer;
    source.loop = true;
    const latestSafeOffset = Math.max(0, noiseBuffer.duration - 0.55);
    source.start(0, Math.random() * latestSafeOffset);
    return source;
  };
  const SH = (amount) => {
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < curve.length; i++) {
      curve[i] = Math.tanh((i / 512 - 1) * amount);
    }
    shaper.curve = curve;
    shaper.oversample = '2x';
    return shaper;
  };
  const burst = (options) => {
    const time = options.t ?? ctx.currentTime;
    const source = ctx.createBufferSource();
    const filter = F(options.type || 'bandpass', options.f0, options.q || 1);
    const gain = G(0);
    source.buffer = noiseBuffer;
    filter.frequency.setValueAtTime(options.f0, time);
    if (options.f1) {
      filter.frequency.exponentialRampToValueAtTime(options.f1, time + options.dur);
    }
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(options.g, time + (options.atk || 0.004));
    gain.gain.exponentialRampToValueAtTime(0.001, time + options.dur);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(options.dest);
    const latestSafeOffset = Math.max(0, noiseBuffer.duration - options.dur - 0.05);
    source.start(time, Math.random() * latestSafeOffset, options.dur + 0.05);
    return { source, filter, gain };
  };
  const tone = (f0, f1, duration, volume, destination) => {
    const time = ctx.currentTime;
    const oscillator = O('sine', f0);
    const gain = G(0);
    oscillator.connect(gain);
    gain.connect(destination);
    oscillator.frequency.setValueAtTime(f0, time);
    oscillator.frequency.exponentialRampToValueAtTime(f1, time + duration);
    gain.gain.setValueAtTime(volume, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + duration);
    oscillator.stop(time + duration + 0.02);
    return { oscillator, gain };
  };
  const target = (param, value, timeConstant = 0.03) => {
    if (!param || !Number.isFinite(value)) return;
    param.setTargetAtTime(value, ctx.currentTime, timeConstant);
  };
  return { ctx, noiseBuffer, G, F, O, N, SH, burst, tone, target };
}

export const clampSoundValue = (value, min, max) =>
  Math.max(min, Math.min(max, Number.isFinite(Number(value)) ? Number(value) : min));

export function numericGear(value, fallback = 1) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}
