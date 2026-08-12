/**
 * Little sounds, synthesised rather than loaded.
 *
 * These are short and played often, so generating them costs nothing to
 * download and each one can be tuned by changing a number instead of
 * re-exporting a file. Everything is deliberately soft and in tune with itself
 * — a C major arpeggio for tidying up, a gentle bloop, hooves that whisper.
 *
 * An AudioContext cannot start before the page has been interacted with, so one
 * is created lazily on the first sound and resumed if the browser parked it.
 */

/** Master level for all effects. Low: this plays over and over. */
const MASTER = 0.5;

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;

  /** Sound follows the same on/off switch as the music. */
  constructor(private readonly isEnabled: () => boolean) {}

  private ensure(): AudioContext | null {
    if (!this.isEnabled()) return null;

    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = MASTER;
      this.master.connect(this.ctx.destination);
    }
    // Browsers suspend the context until a gesture, and again on tab switches.
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  /** One shaped tone. `slideTo` bends the pitch over the note's life. */
  private tone(
    frequency: number,
    opts: {
      duration: number;
      gain: number;
      type?: OscillatorType;
      delay?: number;
      slideTo?: number;
    },
  ): void {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;

    const start = ctx.currentTime + (opts.delay ?? 0);
    const osc = ctx.createOscillator();
    const env = ctx.createGain();

    osc.type = opts.type ?? 'sine';
    osc.frequency.setValueAtTime(frequency, start);
    if (opts.slideTo !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(opts.slideTo, start + opts.duration);
    }

    // A few milliseconds of attack keeps the onset from clicking.
    env.gain.setValueAtTime(0, start);
    env.gain.linearRampToValueAtTime(opts.gain, start + 0.012);
    env.gain.exponentialRampToValueAtTime(0.0001, start + opts.duration);

    osc.connect(env).connect(this.master);
    osc.start(start);
    osc.stop(start + opts.duration + 0.02);
  }

  private noiseBuffer(ctx: AudioContext): AudioBuffer {
    if (!this.noise) {
      const length = Math.floor(ctx.sampleRate * 0.2);
      this.noise = ctx.createBuffer(1, length, ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    }
    return this.noise;
  }

  /** A hoof on grass: a very short puff of filtered noise. */
  step(): void {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;

    const start = ctx.currentTime;
    const source = ctx.createBufferSource();
    source.buffer = this.noiseBuffer(ctx);
    source.playbackRate.value = 0.8 + Math.random() * 0.4;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    // Wobbled a little so repeated steps do not sound like a machine.
    filter.frequency.value = 620 + Math.random() * 260;

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.09, start);
    env.gain.exponentialRampToValueAtTime(0.0001, start + 0.09);

    source.connect(filter).connect(env).connect(this.master);
    source.start(start);
    source.stop(start + 0.12);
  }

  /** A unicorn leaves a present: a soft, comedic little bloop. */
  plop(): void {
    this.tone(400, { duration: 0.16, gain: 0.14, type: 'sine', slideTo: 150 });
    this.tone(700, { duration: 0.05, gain: 0.05, type: 'triangle', delay: 0.01 });
  }

  /** Cleaning up: a bright rising arpeggio, the reward sound. */
  sparkle(): void {
    // C6 E6 G6 C7 — a plain major chord, which is hard to make unpleasant.
    const notes = [1046.5, 1318.5, 1568.0, 2093.0];
    notes.forEach((frequency, i) => {
      this.tone(frequency, {
        duration: 0.28,
        gain: 0.1,
        type: 'sine',
        delay: i * 0.055,
      });
    });
    // A little shimmer on top.
    this.tone(3136, { duration: 0.4, gain: 0.02, type: 'sine', delay: 0.16 });
  }

  /** Opening the spellbook: a soft, curious chime. */
  magicOpen(): void {
    this.tone(880, { duration: 0.3, gain: 0.07, type: 'sine' });
    this.tone(1174.7, { duration: 0.35, gain: 0.05, type: 'sine', delay: 0.09 });
  }

  /** A sigil completed: a long rising sparkle, the biggest sound in the game. */
  cast(): void {
    // A pentatonic run, which sounds triumphant without needing to resolve.
    const notes = [523.3, 659.3, 784.0, 1046.5, 1318.5, 1568.0];
    notes.forEach((frequency, i) => {
      this.tone(frequency, { duration: 0.5, gain: 0.09, type: 'sine', delay: i * 0.06 });
    });
    this.tone(2093, { duration: 0.9, gain: 0.03, type: 'sine', delay: 0.36 });
  }

  /** A sigil that did not match: a gentle "not quite", never a buzzer. */
  fizzle(): void {
    this.tone(392, { duration: 0.22, gain: 0.08, type: 'triangle', slideTo: 294 });
  }

  /** A strawberry landing on the grass. */
  drop(): void {
    this.tone(520 + Math.random() * 120, { duration: 0.07, gain: 0.05, type: 'sine', slideTo: 320 });
  }

  /** A unicorn eating something nice. */
  munch(): void {
    this.tone(300, { duration: 0.1, gain: 0.09, type: 'triangle', slideTo: 420 });
    this.tone(620, { duration: 0.16, gain: 0.06, type: 'sine', delay: 0.07 });
  }

  /** Picking something up: a short two-note lift. */
  pickup(): void {
    this.tone(660, { duration: 0.12, gain: 0.11, type: 'triangle' });
    this.tone(990, { duration: 0.2, gain: 0.1, type: 'triangle', delay: 0.08 });
  }
}
