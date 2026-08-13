/**
 * The spelling game: a picture, a row of slots, and pieces to put in them.
 *
 * Three levels of the same puzzle, differing only in how big the pieces are:
 * whole chunks of a compound word, then a few missing letters, then every
 * letter. `words.ts` builds the puzzle; this file is the hands.
 *
 * Two ways to place a piece, both always live. Dragging is the point of the
 * game, but dragging is genuinely hard for a small hand on a tablet, so a plain
 * tap drops a piece into the first empty slot. Nobody gets stuck.
 *
 * Checking waits until every slot is full, and then keeps the letters that were
 * right and returns only the wrong ones. Partial credit is visible, which is
 * how a child works out what they got wrong without being told the answer.
 */

import type { AssetLibrary } from '../engine/assets.ts';
import {
  DIFFICULTIES,
  buildPuzzle,
  playableWords,
  type Difficulty,
  type Puzzle,
} from './words.ts';

export interface SpellingCallbacks {
  onSound(kind: 'open' | 'pick' | 'place' | 'right' | 'wrong'): void;
  onClose(): void;
}

const STORAGE_KEY = 'enhorningsangen.spelling';

/** Movement under this many pixels counts as a tap rather than a drag. */
const TAP_SLOP = 8;

export class Spelling {
  private readonly root: HTMLDivElement;
  private readonly picture: HTMLImageElement;
  private readonly slotRow: HTMLDivElement;
  private readonly trayRow: HTMLDivElement;
  private readonly status: HTMLParagraphElement;
  private readonly levelRow: HTMLDivElement;
  private readonly scoreLabel: HTMLSpanElement;

  private difficulty: Difficulty;
  private puzzle: Puzzle | null = null;
  /** What is currently sitting in each slot, or null. */
  private placed: Array<string | null> = [];
  private locked: boolean[] = [];
  private score = 0;
  private settled = false;
  /** Which tray position each filled slot took its piece from. */
  private readonly trayOfSlot = new Map<number, number>();

  open = false;

  constructor(
    parent: HTMLElement,
    private readonly assets: AssetLibrary,
    private readonly callbacks: SpellingCallbacks,
  ) {
    this.difficulty = this.loadDifficulty();

    this.root = document.createElement('div');
    this.root.className = 'spelling';
    this.root.hidden = true;
    this.root.innerHTML = `
      <div class="spelling-panel" role="dialog" aria-modal="true" aria-label="Stava ordet">
        <button type="button" class="spelling-close" aria-label="Stäng">✕</button>
        <div class="spelling-levels" role="tablist"></div>
        <img class="spelling-picture" alt="" />
        <div class="spelling-slots"></div>
        <div class="spelling-tray"></div>
        <p class="spelling-status"></p>
        <div class="spelling-footer">
          <span class="spelling-score">⭐ 0</span>
          <button type="button" class="spelling-next">Nästa ord</button>
        </div>
      </div>
    `;
    parent.appendChild(this.root);

    const q = <T extends HTMLElement>(sel: string): T => {
      const el = this.root.querySelector<T>(sel);
      if (!el) throw new Error(`spelling markup missing ${sel}`);
      return el;
    };

    this.picture = q<HTMLImageElement>('.spelling-picture');
    this.slotRow = q<HTMLDivElement>('.spelling-slots');
    this.trayRow = q<HTMLDivElement>('.spelling-tray');
    this.status = q<HTMLParagraphElement>('.spelling-status');
    this.levelRow = q<HTMLDivElement>('.spelling-levels');
    this.scoreLabel = q<HTMLSpanElement>('.spelling-score');

    q<HTMLButtonElement>('.spelling-close').addEventListener('click', () => this.close());
    q<HTMLButtonElement>('.spelling-next').addEventListener('click', () => this.nextWord());

    for (const level of DIFFICULTIES) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'spelling-level';
      button.setAttribute('role', 'tab');
      button.innerHTML = `<span aria-hidden="true">${level.icon}</span><span>${level.label}</span>`;
      button.addEventListener('click', () => {
        this.difficulty = level.id;
        this.saveDifficulty();
        this.nextWord();
      });
      this.levelRow.appendChild(button);
    }
  }

  private loadDifficulty(): Difficulty {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved && DIFFICULTIES.some((d) => d.id === saved)) return saved as Difficulty;
    } catch {
      // No storage: just start on the easiest level.
    }
    return 'latt';
  }

  private saveDifficulty(): void {
    try {
      localStorage.setItem(STORAGE_KEY, this.difficulty);
    } catch {
      // Nothing to do; the choice simply will not survive a reload.
    }
  }

  /** Deals a fresh word at the current level. */
  private nextWord(): void {
    const pool = playableWords(this.difficulty).filter((w) => this.assets.has(w.partId));
    if (!pool.length) {
      this.status.textContent = 'Inga ord att öva på än.';
      return;
    }

    const word = pool[Math.floor(Math.random() * pool.length)]!;
    this.puzzle = buildPuzzle(word, this.difficulty, Math.random);
    // Left over from the previous word, this would hide tray pieces that the
    // new puzzle needs.
    this.trayOfSlot.clear();
    this.placed = this.puzzle.slots.map((s) => s);
    // A slot that came pre-filled is already correct and cannot be moved.
    this.locked = this.puzzle.slots.map((s) => s !== null);
    this.settled = false;

    const part = this.assets.get(word.partId);
    this.picture.src = new URL(part.url, document.baseURI).href;
    this.picture.alt = word.word;

    const level = DIFFICULTIES.find((d) => d.id === this.difficulty);
    this.status.textContent = level?.hint ?? '';
    this.render();
  }

  private render(): void {
    if (!this.puzzle) return;

    for (const [i, button] of [...this.levelRow.children].entries()) {
      const active = DIFFICULTIES[i]?.id === this.difficulty;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
    }

    this.slotRow.replaceChildren();
    this.placed.forEach((content, index) => {
      const slot = document.createElement('div');
      slot.className = 'spelling-slot';
      slot.dataset.slot = String(index);
      if (this.locked[index]) slot.classList.add('given');
      if (content !== null) {
        slot.appendChild(this.makeTile(content, this.locked[index] ? null : { from: 'slot', index }));
      }
      this.slotRow.appendChild(slot);
    });

    this.trayRow.replaceChildren();
    this.puzzle.tray.forEach((piece, index) => {
      // A piece that is currently in a slot leaves a gap behind in the tray.
      if (this.usedTrayIndices().has(index)) {
        const gap = document.createElement('div');
        gap.className = 'spelling-gap';
        this.trayRow.appendChild(gap);
        return;
      }
      this.trayRow.appendChild(this.makeTile(piece, { from: 'tray', index }));
    });

    this.scoreLabel.textContent = `⭐ ${this.score}`;
  }

  private usedTrayIndices(): Set<number> {
    return new Set(this.trayOfSlot.values());
  }

  private makeTile(text: string, source: { from: 'tray' | 'slot'; index: number } | null): HTMLElement {
    const tile = document.createElement(source ? 'button' : 'div');
    tile.className = `spelling-tile${source ? '' : ' fixed'}`;
    tile.textContent = text;
    if (!source) return tile;

    (tile as HTMLButtonElement).type = 'button';
    this.makeDraggable(tile, source);
    return tile;
  }

  private makeDraggable(tile: HTMLElement, source: { from: 'tray' | 'slot'; index: number }): void {
    let startX = 0;
    let startY = 0;
    let moved = false;

    const onMove = (event: PointerEvent): void => {
      const dx = event.clientX - startX;
      const dy = event.clientY - startY;
      if (!moved && Math.hypot(dx, dy) > TAP_SLOP) {
        moved = true;
        tile.classList.add('dragging');
      }
      if (moved) tile.style.transform = `translate(${dx}px, ${dy}px) scale(1.12)`;
    };

    const onUp = (event: PointerEvent): void => {
      tile.removeEventListener('pointermove', onMove);
      tile.removeEventListener('pointerup', onUp);
      tile.removeEventListener('pointercancel', onUp);
      tile.classList.remove('dragging');
      tile.style.transform = '';

      if (this.settled) return;

      if (!moved) {
        // A tap on a tray piece sends it to the first empty slot, so nobody has
        // to aim; a tap on a placed one takes it back out again.
        this.placeIn(source.from === 'slot' ? null : this.firstEmptySlot(), source);
        return;
      }

      // Dropped: whatever slot is under the finger, if any.
      tile.style.pointerEvents = 'none';
      const under = document.elementFromPoint(event.clientX, event.clientY);
      tile.style.pointerEvents = '';
      const slot = under?.closest<HTMLElement>('.spelling-slot');
      const index = slot?.dataset.slot;
      this.placeIn(index === undefined ? null : Number(index), source);
    };

    tile.addEventListener('pointerdown', (event) => {
      if (this.settled) return;
      event.preventDefault();
      startX = event.clientX;
      startY = event.clientY;
      moved = false;
      tile.setPointerCapture(event.pointerId);
      tile.addEventListener('pointermove', onMove);
      tile.addEventListener('pointerup', onUp);
      tile.addEventListener('pointercancel', onUp);
      this.callbacks.onSound('pick');
    });
  }

  private firstEmptySlot(): number | null {
    const index = this.placed.findIndex((content) => content === null);
    return index === -1 ? null : index;
  }

  /** Moves a piece into `slot`, or back to the tray when `slot` is null. */
  private placeIn(slot: number | null, source: { from: 'tray' | 'slot'; index: number }): void {
    if (!this.puzzle) return;

    // Taking a piece out of a slot frees both the slot and its tray position.
    let piece: string | undefined;
    let trayIndex: number | undefined;

    if (source.from === 'slot') {
      piece = this.placed[source.index] ?? undefined;
      trayIndex = this.trayOfSlot.get(source.index);
      this.placed[source.index] = null;
      this.trayOfSlot.delete(source.index);
    } else {
      piece = this.puzzle.tray[source.index];
      trayIndex = source.index;
    }

    if (piece === undefined || trayIndex === undefined) return;

    // Dropped on nothing, or on a slot that is taken: it goes back to the tray.
    if (slot === null || this.locked[slot] || this.placed[slot] !== null) {
      this.render();
      return;
    }

    this.placed[slot] = piece;
    this.trayOfSlot.set(slot, trayIndex);
    this.callbacks.onSound('place');
    this.render();

    if (this.placed.every((content) => content !== null)) this.check();
  }

  private check(): void {
    if (!this.puzzle) return;
    const answer = this.puzzle;

    // Compare against the word itself rather than the slots, so the middle
    // level's given letters are checked the same way as the placed ones.
    const expected = answer.slots.map((given, i) => given ?? this.expectedAt(i));
    const wrong: number[] = [];
    this.placed.forEach((content, i) => {
      if (!this.locked[i] && content !== expected[i]) wrong.push(i);
    });

    if (!wrong.length) {
      this.settled = true;
      this.score++;
      this.callbacks.onSound('right');
      this.status.textContent = `Rätt! ${answer.word.word.toUpperCase()}`;
      this.slotRow.classList.add('correct');
      this.scoreLabel.textContent = `⭐ ${this.score}`;
      window.setTimeout(() => {
        this.slotRow.classList.remove('correct');
        this.nextWord();
      }, 1800);
      return;
    }

    this.callbacks.onSound('wrong');
    this.status.textContent = 'Nästan! Prova igen.';

    // Right letters stay put; only the wrong ones come back.
    for (const index of wrong) {
      this.placed[index] = null;
      this.trayOfSlot.delete(index);
    }
    this.slotRow.classList.add('shake');
    window.setTimeout(() => this.slotRow.classList.remove('shake'), 420);
    this.render();
  }

  /** The letter or chunk that belongs in a slot. */
  private expectedAt(index: number): string {
    if (!this.puzzle) return '';
    const units =
      this.difficulty === 'latt' ? this.puzzle.word.chunks : [...this.puzzle.word.word];
    return units[index] ?? '';
  }

  show(): void {
    this.open = true;
    this.root.hidden = false;
    this.trayOfSlot.clear();
    this.callbacks.onSound('open');
    this.nextWord();
  }

  close(): void {
    this.open = false;
    this.root.hidden = true;
    this.callbacks.onClose();
  }
}
