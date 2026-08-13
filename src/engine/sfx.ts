/**
 * Little sounds, synthesised rather than loaded.
 *
 * These are short and played often, so generating them costs nothing to
 * download and each one is a number to tune rather than a file to re-export.
 * Everything is deliberately soft and in tune with itself: the reward sounds
 * are plain major and pentatonic runs, which are hard to make unpleasant, and
 * nothing is ever a buzzer.
 *
 * The magical sounds go through a reverb send, which is most of what separates
 * "a beep" from "a spell". The impulse response is generated rather than loaded,
 * for the same reason as everything else here.
 *
 * An AudioContext cannot start before the page has been interacted with, so one
 * is created lazily on the first sound and resumed if the browser parked it.
 * A context can also be passed in, which is how scripts/render-sfx.mjs renders
 * these to files using this exact code rather than a copy of it.
 */

/**
 * Master level for all effects, set so the loudest of them sits a little above
 * the music (which plays at 0.18) without ever approaching clipping. Check with
 * `node scripts/render-sfx.mjs`, which prints the peak of every sound.
 */
const MASTER = 0.85;

interface ToneOptions {
  duration: number;
  gain: number;
  type?: OscillatorType;
  delay?: number;
  /** Bends the pitch across the note. */
  slideTo?: number;
  /** Depth in cents of a 6 Hz wobble, for a bit of shimmer. */
  vibrato?: number;
  /** How much of this note is fed to the reverb, 0..1. */
  send?: number;
}

interface NoiseOptions {
  duration: number;
  gain: number;
  /** Band-pass centre at the start and end, which is what makes a whoosh. */
  from: number;
  to: number;
  q?: number;
  delay?: number;
  send?: number;
}

export class Sfx {
  private ctx: BaseAudioContext | null = null;
  private master: GainNode | null = null;
  private reverbIn: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;

  /**
   * @param isEnabled Sound follows the same on/off switch as the music.
   * @param context   Supply one to render offline; otherwise a live one is made.
   */
  constructor(
    private readonly isEnabled: () => boolean,
    private readonly context?: BaseAudioContext,
  ) {}

  private ensure(): BaseAudioContext | null {
    if (!this.isEnabled()) return null;

    if (!this.ctx) {
      if (this.context) {
        this.ctx = this.context;
      } else {
        const Ctor =
          window.AudioContext ??
          (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return null;
        this.ctx = new Ctor();
      }

      this.master = this.ctx.createGain();
      this.master.gain.value = MASTER;
      this.master.connect(this.ctx.destination);

      this.reverbIn = this.ctx.createGain();
      const convolver = this.ctx.createConvolver();
      convolver.buffer = this.impulse(this.ctx);
      const wet = this.ctx.createGain();
      wet.gain.value = 0.7;
      this.reverbIn.connect(convolver).connect(wet).connect(this.master);
    }

    // Browsers suspend a live context until a gesture, and again on tab
    // switches. An offline context also reports "suspended" but throws if
    // resumed, so only the one we made ourselves is ever poked.
    if (!this.context) {
      const live = this.ctx as AudioContext;
      if (live.state === 'suspended') void live.resume();
    }
    return this.ctx;
  }

  /** A short hall: noise that decays exponentially. */
  private impulse(ctx: BaseAudioContext): AudioBuffer {
    const seconds = 1.4;
    const length = Math.floor(ctx.sampleRate * seconds);
    const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let channel = 0; channel < 2; channel++) {
      const data = buffer.getChannelData(channel);
      for (let i = 0; i < length; i++) {
        data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 3.2;
      }
    }
    return buffer;
  }

  private noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
    if (!this.noiseBuf) {
      const length = Math.floor(ctx.sampleRate * 1.5);
      this.noiseBuf = ctx.createBuffer(1, length, ctx.sampleRate);
      const data = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    }
    return this.noiseBuf;
  }

  /** Routes a finished voice to the dry master and, optionally, the reverb. */
  private route(node: AudioNode, send: number): void {
    if (this.master) node.connect(this.master);
    if (send > 0 && this.reverbIn) {
      const ctx = this.ctx!;
      const tap = ctx.createGain();
      tap.gain.value = send;
      node.connect(tap).connect(this.reverbIn);
    }
  }

  private tone(frequency: number, opts: ToneOptions): void {
    const ctx = this.ensure();
    if (!ctx) return;

    const start = ctx.currentTime + (opts.delay ?? 0);
    const osc = ctx.createOscillator();
    const env = ctx.createGain();

    osc.type = opts.type ?? 'sine';
    osc.frequency.setValueAtTime(frequency, start);
    if (opts.slideTo !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(opts.slideTo, start + opts.duration);
    }

    if (opts.vibrato) {
      const lfo = ctx.createOscillator();
      const depth = ctx.createGain();
      lfo.frequency.value = 6;
      depth.gain.value = opts.vibrato;
      lfo.connect(depth).connect(osc.detune);
      lfo.start(start);
      lfo.stop(start + opts.duration + 0.02);
    }

    // A few milliseconds of attack keeps the onset from clicking.
    env.gain.setValueAtTime(0, start);
    env.gain.linearRampToValueAtTime(opts.gain, start + 0.012);
    env.gain.exponentialRampToValueAtTime(0.0001, start + opts.duration);

    osc.connect(env);
    this.route(env, opts.send ?? 0);
    osc.start(start);
    osc.stop(start + opts.duration + 0.02);
  }

  /** Band-passed noise with a moving centre: whooshes, sparkle, hooves. */
  private noise(opts: NoiseOptions): void {
    const ctx = this.ensure();
    if (!ctx) return;

    const start = ctx.currentTime + (opts.delay ?? 0);
    const source = ctx.createBufferSource();
    source.buffer = this.noiseBuffer(ctx);

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = opts.q ?? 1.2;
    filter.frequency.setValueAtTime(opts.from, start);
    filter.frequency.exponentialRampToValueAtTime(opts.to, start + opts.duration);

    const env = ctx.createGain();
    env.gain.setValueAtTime(0, start);
    env.gain.linearRampToValueAtTime(opts.gain, start + opts.duration * 0.25);
    env.gain.exponentialRampToValueAtTime(0.0001, start + opts.duration);

    source.connect(filter).connect(env);
    this.route(env, opts.send ?? 0);
    source.start(start);
    source.stop(start + opts.duration + 0.05);
  }

  // --- world sounds ---------------------------------------------------------

  /** A hoof on grass: a very short, soft puff. */
  step(): void {
    this.noise({
      duration: 0.09,
      gain: 0.12,
      // Wobbled a little so repeated steps do not sound like a machine.
      from: 700 + Math.random() * 300,
      to: 260,
      q: 0.8,
    });
  }

  /** A unicorn leaves a present: a soft, comedic little bloop. */
  plop(): void {
    this.tone(400, { duration: 0.16, gain: 0.14, slideTo: 150 });
    this.tone(700, { duration: 0.05, gain: 0.05, type: 'triangle', delay: 0.01 });
  }

  /** Shovelling up: a bright rising arpeggio, the caretaking reward. */
  sparkle(): void {
    // C6 E6 G6 C7 — a plain major chord, hard to make unpleasant.
    [1046.5, 1318.5, 1568.0, 2093.0].forEach((frequency, i) => {
      this.tone(frequency, { duration: 0.28, gain: 0.13, delay: i * 0.055, send: 0.25 });
    });
    this.tone(3136, { duration: 0.4, gain: 0.02, delay: 0.16, send: 0.4 });
  }

  /** A strawberry landing on the grass. */
  drop(): void {
    this.tone(520 + Math.random() * 120, { duration: 0.07, gain: 0.05, slideTo: 320 });
  }

  /** A unicorn eating something nice. */
  munch(): void {
    this.tone(300, { duration: 0.1, gain: 0.09, type: 'triangle', slideTo: 420 });
    this.tone(620, { duration: 0.16, gain: 0.06, delay: 0.07 });
  }

  /** Picking something up: a short two-note lift. */
  pickup(): void {
    this.tone(660, { duration: 0.12, gain: 0.11, type: 'triangle' });
    this.tone(990, { duration: 0.2, gain: 0.1, type: 'triangle', delay: 0.08 });
  }

  // --- magic ----------------------------------------------------------------

  /** Opening the spellbook: a soft, curious chime in a big room. */
  magicOpen(): void {
    this.noise({ duration: 0.5, gain: 0.05, from: 900, to: 4200, q: 2, send: 0.5 });
    this.tone(880, { duration: 0.45, gain: 0.09, delay: 0.05, send: 0.5, vibrato: 8 });
    this.tone(1318.5, { duration: 0.6, gain: 0.07, delay: 0.16, send: 0.6, vibrato: 10 });
  }

  /**
   * A sigil completed. The biggest sound in the game: a rising whoosh under a
   * pentatonic run, with a shimmering tail.
   */
  cast(): void {
    this.noise({ duration: 0.55, gain: 0.1, from: 300, to: 5200, q: 1.4, send: 0.7 });

    // C5 D5 E5 G5 A5 C6 D6 E6 — pentatonic, so every note agrees with the rest.
    [523.3, 587.3, 659.3, 784.0, 880.0, 1046.5, 1174.7, 1318.5].forEach((frequency, i) => {
      this.tone(frequency, {
        duration: 0.45,
        gain: 0.14,
        delay: 0.06 + i * 0.045,
        send: 0.45,
        vibrato: 6,
      });
    });

    // Two bells a fifth apart ringing on into the reverb.
    this.tone(2093, { duration: 1.1, gain: 0.05, delay: 0.42, send: 0.8, vibrato: 12 });
    this.tone(3136, { duration: 1.3, gain: 0.035, delay: 0.5, send: 0.9, vibrato: 14 });
  }

  /** A sigil that did not match: a comic little deflation, never a buzzer. */
  fizzle(): void {
    this.tone(430, { duration: 0.28, gain: 0.12, type: 'triangle', slideTo: 190, vibrato: 40 });
    this.noise({ duration: 0.3, gain: 0.045, from: 1600, to: 300, q: 1.5 });
  }

  /** Strawberry rain: a sprinkle of little drops over a soft swell. */
  rainSpell(): void {
    this.noise({ duration: 1.5, gain: 0.07, from: 4000, to: 900, q: 0.7, send: 0.5 });
    // Twenty scattered plinks, high and quiet, like berries pattering down.
    for (let i = 0; i < 20; i++) {
      this.tone(1200 + Math.random() * 1400, {
        duration: 0.12,
        gain: 0.055,
        delay: 0.1 + Math.random() * 1.1,
        slideTo: 500 + Math.random() * 300,
        send: 0.35,
      });
    }
  }

  /**
   * The egg arriving: a low swell that resolves upward, like something being
   * set down gently and then deciding to exist.
   */
  eggSpell(): void {
    this.noise({ duration: 0.9, gain: 0.06, from: 240, to: 1800, q: 1.1, send: 0.6 });
    // A rising major triad — the sound of a promise rather than a reward.
    [261.6, 329.6, 392.0, 523.3].forEach((frequency, i) => {
      this.tone(frequency, {
        duration: 0.7,
        gain: 0.11,
        type: 'triangle',
        delay: 0.08 + i * 0.1,
        send: 0.5,
        vibrato: 5,
      });
    });
    this.tone(1046.5, { duration: 1.2, gain: 0.045, delay: 0.5, send: 0.85, vibrato: 12 });
  }

  /** The shell cracking: two dry little ticks, no music. */
  crack(): void {
    // Short and narrow-band, so these need a lot of gain to reach the same
    // apparent loudness as the longer sounds.
    this.noise({ duration: 0.05, gain: 0.34, from: 2600, to: 900, q: 3 });
    this.noise({ duration: 0.06, gain: 0.28, from: 3200, to: 1100, q: 3, delay: 0.13 });
  }

  /**
   * The egg opening. The one moment in the game worth a fanfare: the shell
   * bursts, then a bright little arrival tune over the reverb.
   */
  hatch(): void {
    this.noise({ duration: 0.35, gain: 0.12, from: 1800, to: 5000, q: 1, send: 0.7 });
    // C6 E6 G6 A6 C7 — the same major shapes as the other rewards, an octave up
    // so it sits above everything else happening in the meadow.
    [1046.5, 1318.5, 1568.0, 1760.0, 2093.0].forEach((frequency, i) => {
      this.tone(frequency, {
        duration: 0.42,
        gain: 0.13,
        delay: i * 0.07,
        send: 0.5,
        vibrato: 8,
      });
    });
    // A soft low note underneath, so the fanfare has a floor to stand on.
    this.tone(523.3, { duration: 0.9, gain: 0.08, type: 'triangle', delay: 0.1, send: 0.4 });
    this.tone(3136, { duration: 1.2, gain: 0.03, delay: 0.36, send: 0.9, vibrato: 16 });
  }

  /** Flower circle: a harp run opening upward, then settling. */
  bloomSpell(): void {
    // A pentatonic sweep up two octaves, quick enough to read as one gesture.
    const scale = [523.3, 587.3, 659.3, 784.0, 880.0, 1046.5, 1174.7, 1318.5, 1568.0, 1760.0];
    scale.forEach((frequency, i) => {
      this.tone(frequency, {
        duration: 0.6,
        gain: 0.09,
        type: 'triangle',
        delay: i * 0.05,
        send: 0.55,
      });
    });
    // Soft pops underneath, as each flower opens.
    for (let i = 0; i < 6; i++) {
      this.tone(320 + i * 40, {
        duration: 0.14,
        gain: 0.075,
        delay: 0.35 + i * 0.09,
        slideTo: 620 + i * 60,
      });
    }
  }
}
