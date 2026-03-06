let audioCtx: AudioContext | null = null;

function getCtx(): AudioContext {
  if (!audioCtx) {
    audioCtx = new AudioContext();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

/** Chime for false claims — ascending minor triad, alert tone */
export function playChime(): void {
  const ctx = getCtx();
  const now = ctx.currentTime;
  const freqs = [440, 554, 659];

  freqs.forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    const filter = ctx.createBiquadFilter();

    osc.type = 'sine';
    osc.frequency.value = freq;

    filter.type = 'lowpass';
    filter.frequency.value = 2000;
    filter.Q.value = 0.7;

    amp.gain.setValueAtTime(0, now + i * 0.08);
    amp.gain.linearRampToValueAtTime(0.12, now + i * 0.08 + 0.02);
    amp.gain.exponentialRampToValueAtTime(0.001, now + i * 0.08 + 0.6);

    osc.connect(filter);
    filter.connect(amp);
    amp.connect(ctx.destination);

    osc.start(now + i * 0.08);
    osc.stop(now + i * 0.08 + 0.7);
  });
}

/** Soft chime for watchdog answers — single gentle tone */
export function playAnswerChime(): void {
  const ctx = getCtx();
  const now = ctx.currentTime;

  const osc = ctx.createOscillator();
  const amp = ctx.createGain();
  const filter = ctx.createBiquadFilter();

  osc.type = 'sine';
  osc.frequency.value = 784; // G5

  filter.type = 'lowpass';
  filter.frequency.value = 1500;
  filter.Q.value = 0.5;

  amp.gain.setValueAtTime(0, now);
  amp.gain.linearRampToValueAtTime(0.08, now + 0.02);
  amp.gain.exponentialRampToValueAtTime(0.001, now + 0.4);

  osc.connect(filter);
  filter.connect(amp);
  amp.connect(ctx.destination);

  osc.start(now);
  osc.stop(now + 0.5);
}
