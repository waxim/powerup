/** Tiny synthesized sound effects (no audio files to download). */
let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(freq: number, start: number, duration: number, type: OscillatorType = "sine", gain = 0.08, slideTo?: number) {
  const a = audio();
  if (!a) return;
  const osc = a.createOscillator();
  const g = a.createGain();
  const t0 = a.currentTime + start;
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + duration);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  osc.connect(g).connect(a.destination);
  osc.start(t0);
  osc.stop(t0 + duration + 0.05);
}

export const sfx = {
  yourTurn() {
    tone(660, 0, 0.14, "triangle");
    tone(990, 0.12, 0.2, "triangle");
  },
  power() {
    tone(220, 0, 0.35, "sawtooth", 0.05, 880);
    tone(1320, 0.18, 0.18, "sine", 0.05);
  },
  win() {
    [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.09, 0.22, "triangle", 0.07));
  },
  /** Browsers only allow audio after a user gesture; call this from one. */
  unlock() {
    audio();
  },
};
