/**
 * The thin layer of chrome over the meadow.
 *
 * Aimed at a six-year-old reader: one short Swedish word per control, big
 * targets, and no menus to get lost in. Built as DOM rather than in the canvas
 * so it stays crisp and stays accessible to a screen reader.
 */

export interface HudCallbacks {
  onReroll(): void;
}

export class Hud {
  private readonly root: HTMLDivElement;
  private readonly nameLabel: HTMLSpanElement;

  constructor(parent: HTMLElement, callbacks: HudCallbacks) {
    this.root = document.createElement('div');
    this.root.className = 'hud';
    this.root.innerHTML = `
      <div class="hud-card">
        <span class="hud-name"></span>
        <button type="button" class="hud-button" aria-label="Skapa en ny enhörning">
          <span aria-hidden="true">🎲</span> Ny enhörning
        </button>
      </div>
      <p class="hud-hint">Gå med pilarna · eller peka där du vill gå</p>
    `;
    parent.appendChild(this.root);

    const nameLabel = this.root.querySelector<HTMLSpanElement>('.hud-name');
    const button = this.root.querySelector<HTMLButtonElement>('.hud-button');
    if (!nameLabel || !button) throw new Error('hud markup did not build');
    this.nameLabel = nameLabel;

    button.addEventListener('click', (event) => {
      event.preventDefault();
      callbacks.onReroll();
      // Otherwise the next arrow key press re-rolls instead of walking.
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

  /** Fades the hint out once the player has clearly worked out the controls. */
  dismissHint(): void {
    this.root.querySelector('.hud-hint')?.classList.add('gone');
  }
}
