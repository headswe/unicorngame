/**
 * Background music.
 *
 * Any audio file dropped into src/assets/music/ is picked up at build time — no
 * filename to keep in sync, and nothing to 404 when the folder is empty. Several
 * files play as a playlist; one file loops on its own.
 *
 * Two things make this fiddlier than "call play()":
 *
 * - Browsers refuse to start audio before the user has interacted with the page.
 *   The first attempt is expected to fail, so playback is retried on the first
 *   tap or key press instead of giving up.
 * - It is somebody's child's tablet. The volume is low, the track fades in
 *   rather than starting abruptly, it stops when the tab is hidden, and the
 *   on/off choice is remembered.
 */

const TRACKS: string[] = Object.values(
  import.meta.glob('../assets/music/*.{mp3,ogg,m4a,wav}', {
    eager: true,
    query: '?url',
    import: 'default',
  }) as Record<string, string>,
).sort();

/** Quiet enough to sit under a conversation in the room. */
const VOLUME = 0.18;
const FADE_MS = 1200;

const STORAGE_KEY = 'enhorningsangen.music';

export class Music {
  /** Not attached to the document; nothing needs to see it but this class. */
  readonly audio: HTMLAudioElement | null = null;
  private index = 0;
  private fade: number | null = null;
  private unlockAttached = false;

  /** Whether the player wants music at all. */
  enabled: boolean;

  constructor() {
    this.enabled = this.loadPreference();

    if (!TRACKS.length) return;

    this.audio = new Audio();
    this.audio.preload = 'auto';
    this.audio.volume = 0;
    // Each track is followed by the next, wrapping — which also loops a single
    // track without needing a separate case.
    this.audio.addEventListener('ended', () => {
      this.index = (this.index + 1) % TRACKS.length;
      this.load();
      void this.audio?.play().catch(() => undefined);
    });
    this.load();

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.audio?.pause();
      else if (this.enabled) void this.tryPlay();
    });
  }

  /** True when there is anything to play — the HUD hides its button otherwise. */
  get available(): boolean {
    return this.audio !== null;
  }

  private load(): void {
    const track = TRACKS[this.index];
    if (this.audio && track) this.audio.src = track;
  }

  private loadPreference(): boolean {
    try {
      return localStorage.getItem(STORAGE_KEY) !== 'off';
    } catch {
      return true;
    }
  }

  private savePreference(): void {
    try {
      localStorage.setItem(STORAGE_KEY, this.enabled ? 'on' : 'off');
    } catch {
      // Private browsing; the choice just will not survive a reload.
    }
  }

  /** Starts playing, arranging to retry after a user gesture if blocked. */
  async start(): Promise<void> {
    if (!this.audio || !this.enabled) return;
    const started = await this.tryPlay();
    if (!started) this.attachUnlock();
  }

  private async tryPlay(): Promise<boolean> {
    if (!this.audio) return false;
    try {
      await this.audio.play();
      this.fadeTo(VOLUME);
      return true;
    } catch {
      return false;
    }
  }

  /** Waits for the first interaction, which is all a browser needs to allow audio. */
  private attachUnlock(): void {
    if (this.unlockAttached) return;
    this.unlockAttached = true;

    const unlock = (): void => {
      void this.tryPlay().then((started) => {
        if (!started) return;
        window.removeEventListener('pointerdown', unlock);
        window.removeEventListener('keydown', unlock);
        this.unlockAttached = false;
      });
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
  }

  /** Flips music on or off and remembers the choice. Returns the new state. */
  toggle(): boolean {
    this.enabled = !this.enabled;
    this.savePreference();

    if (this.enabled) void this.start();
    else this.fadeTo(0, () => this.audio?.pause());

    return this.enabled;
  }

  private fadeTo(target: number, done?: () => void): void {
    if (!this.audio) return;
    if (this.fade !== null) window.clearInterval(this.fade);

    const from = this.audio.volume;
    const started = performance.now();

    this.fade = window.setInterval(() => {
      if (!this.audio) return;
      const t = Math.min(1, (performance.now() - started) / FADE_MS);
      this.audio.volume = from + (target - from) * t;
      if (t >= 1) {
        window.clearInterval(this.fade!);
        this.fade = null;
        done?.();
      }
    }, 40);
  }
}
