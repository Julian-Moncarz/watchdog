let audioCtx: AudioContext | null = null;

function getCtx(): AudioContext {
  if (!audioCtx) {
    audioCtx = new AudioContext();
  }
  return audioCtx;
}

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
