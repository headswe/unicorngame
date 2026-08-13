/**
 * The thin layer of chrome over the meadow.
 *
 * Aimed at a six-year-old reader: one short Swedish word per control, big
 * targets, and no menus to get lost in. Built as DOM rather than in the canvas
 * so it stays crisp and stays accessible to a screen reader.
 */

export interface HudCallbacks {
  /** Opens the wardrobe to dress the player's unicorn. */
  onOpenWardrobe(): void;
  /** Opens the spellcasting overlay. */
  onCastSpell(): void;
  /** Returns the new state: true when music is now playing. */
  onToggleMusic(): boolean;
}

export interface HudOptions {
  /** Hides the music button when there is no music to play. */
  hasMusic: boolean;
  musicOn: boolean;
}

export class Hud {
  private readonly root: HTMLDivElement;
  private readonly nameLabel: HTMLSpanElement;
  private readonly tally: HTMLSpanElement;
  private readonly tallyCount: HTMLSpanElement;
  private hint: string | null = null;

  constructor(parent: HTMLElement, callbacks: HudCallbacks, options: HudOptions) {
    this.root = document.createElement('div');
    this.root.className = 'hud';
    this.root.innerHTML = `
      <div class="hud-card">
        <span class="hud-name"></span>
        <span class="hud-tally" hidden><span class="hud-tally-icon" aria-hidden="true">💩</span><span class="hud-tally-count">0</span></span>
        <button type="button" class="hud-button" aria-label="Ändra din enhörning">
          <span aria-hidden="true">👗</span> Min enhörning
        </button>
        <button type="button" class="hud-icon hud-spell" aria-label="Trolla">
          <span aria-hidden="true">✨</span>
        </button>
        <button type="button" class="hud-icon hud-music" aria-pressed="true">
          <span aria-hidden="true">🎵</span>
        </button>
      </div>
      <p class="hud-hint">Gå med pilarna · eller peka där du vill gå</p>
    `;
    parent.appendChild(this.root);

    const nameLabel = this.root.querySelector<HTMLSpanElement>('.hud-name');
    const button = this.root.querySelector<HTMLButtonElement>('.hud-button');
    const music = this.root.querySelector<HTMLButtonElement>('.hud-music');
    const spell = this.root.querySelector<HTMLButtonElement>('.hud-spell');
    const tally = this.root.querySelector<HTMLSpanElement>('.hud-tally');
    const tallyCount = this.root.querySelector<HTMLSpanElement>('.hud-tally-count');
    if (!nameLabel || !button || !music || !tally || !tallyCount || !spell) {
      throw new Error('hud markup did not build');
    }
    this.nameLabel = nameLabel;
    this.tally = tally;
    this.tallyCount = tallyCount;

    if (!options.hasMusic) {
      music.remove();
    } else {
      const paint = (on: boolean): void => {
        music.setAttribute('aria-pressed', String(on));
        music.setAttribute('aria-label', on ? 'Stäng av musiken' : 'Sätt på musiken');
        music.classList.toggle('off', !on);
        const icon = music.firstElementChild;
        if (icon) icon.textContent = on ? '🎵' : '🔇';
      };
      paint(options.musicOn);
      music.addEventListener('click', (event) => {
        event.preventDefault();
        paint(callbacks.onToggleMusic());
        music.blur();
      });
    }

    spell.addEventListener('click', (event) => {
      event.preventDefault();
      callbacks.onCastSpell();
      spell.blur();
    });

    button.addEventListener('click', (event) => {
      event.preventDefault();
      callbacks.onOpenWardrobe();
      // Otherwise the next arrow key press hits the button instead of walking.
      button.blur();
    });
    // The canvas is listening for pointerdown everywhere; keep taps on the HUD
    // from also ordering the unicorn to walk into the corner.
    for (const type of ['pointerdown', 'pointerup'] as const) {
      this.root.addEventListener(type, (e) => e.stopPropagation());
    }
  }

  setName(name: string): void {
    this.nameLabel.textContent = name;
  }

  /** Shows the tally of poops shovelled, once there is a shovel to do it with. */
  setCleaned(count: number): void {
    this.tally.hidden = false;
    this.tallyCount.textContent = String(count);
    // A quick pop, so a six-year-old can see the number react.
    this.tally.classList.remove('pop');
    void this.tally.offsetWidth;
    this.tally.classList.add('pop');
  }

  /** Replaces the hint line. Passing null restores the controls reminder. */
  setHint(text: string | null): void {
    const el = this.root.querySelector<HTMLParagraphElement>('.hud-hint');
    if (!el) return;
    if (text === this.hint) return;
    this.hint = text;
    el.textContent = text ?? 'Gå med pilarna · eller peka där du vill gå';
    el.classList.remove('gone');
  }

  /** Fades the hint out once the player has clearly worked out the controls. */
  dismissHint(): void {
    this.root.querySelector('.hud-hint')?.classList.add('gone');
  }
}
