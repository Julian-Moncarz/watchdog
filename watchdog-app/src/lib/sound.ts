let audioCtx: AudioContext | null = null;

function getCtx(): AudioContext {
  if (!audioCtx) {
    audioCtx = new AudioContext();
  }
  return audioCtx;
}

export function playChime(type: 'false' | 'true' | 'neutral' = 'false'): void {
  const ctx = getCtx();
  const now = ctx.currentTime;

  const frequencies: Record<string, number[]> = {
    false: [440, 554, 659],
    true: [523, 659],
    neutral: [440, 523],
  };

  const gains: Record<string, number> = {
    false: 0.12,
    true: 0.06,
    neutral: 0.04,
  };

  const freqs = frequencies[type];
  const gain = gains[type];

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
    amp.gain.linearRampToValueAtTime(gain, now + i * 0.08 + 0.02);
    amp.gain.exponentialRampToValueAtTime(0.001, now + i * 0.08 + 0.6);

    osc.connect(filter);
    filter.connect(amp);
    amp.connect(ctx.destination);

    osc.start(now + i * 0.08);
    osc.stop(now + i * 0.08 + 0.7);
  });
}

export function initAudio(): void {
  getCtx();
}
