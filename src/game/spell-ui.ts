/**
 * The spellcasting overlay: pick a spell, then trace its sigil.
 *
 * Built as DOM and a 2D canvas rather than in the scene. Tracing is a user
 * interface, it wants crisp lines and real text at any screen density, and the
 * overlay sitting above the game canvas is also what stops the pointer from
 * reaching the meadow — no tap can order a walk while a spell is being drawn.
 *
 * A failed trace never punishes: the sigil just shakes and invites another go.
 */

import { scoreSigil, type Point } from './sigil.ts';
import { SPELLS, type Spell } from './spellbook.ts';

export interface SpellUiCallbacks {
  onCast(spell: Spell): void;
  onOpen(): void;
  onClose(): void;
  /** Fired on a successful trace, a failed one, and on opening. */
  onSound(kind: 'success' | 'fail' | 'open'): void;
}

const TRAIL_FADE_MS = 260;

export class SpellUi {
  private readonly root: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly title: HTMLHeadingElement;
  private readonly picker: HTMLDivElement;
  private readonly drawArea: HTMLDivElement;
  private readonly status: HTMLParagraphElement;

  private spell: Spell | null = null;
  private stroke: Point[] = [];
  private drawing = false;
  private settled = false;

  /** True while the overlay is up, so the game can hold the unicorn still. */
  open = false;

  constructor(parent: HTMLElement, private readonly callbacks: SpellUiCallbacks) {
    this.root = document.createElement('div');
    this.root.className = 'spell';
    this.root.hidden = true;
    this.root.innerHTML = `
      <div class="spell-panel" role="dialog" aria-modal="true" aria-label="Trolla">
        <button type="button" class="spell-close" aria-label="Stäng">✕</button>
        <h2 class="spell-title">Välj en trollformel</h2>
        <div class="spell-picker"></div>
        <div class="spell-draw" hidden>
          <canvas class="spell-canvas" width="520" height="520"></canvas>
        </div>
        <p class="spell-status"></p>
      </div>
    `;
    parent.appendChild(this.root);

    const q = <T extends HTMLElement>(selector: string): T => {
      const el = this.root.querySelector<T>(selector);
      if (!el) throw new Error(`spell overlay markup missing ${selector}`);
      return el;
    };

    this.title = q<HTMLHeadingElement>('.spell-title');
    this.picker = q<HTMLDivElement>('.spell-picker');
    this.drawArea = q<HTMLDivElement>('.spell-draw');
    this.status = q<HTMLParagraphElement>('.spell-status');
    this.canvas = q<HTMLCanvasElement>('.spell-canvas');
    this.ctx = this.canvas.getContext('2d');

    q<HTMLButtonElement>('.spell-close').addEventListener('click', () => this.close());

    for (const spell of SPELLS) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'spell-card';
      card.innerHTML = `
        <span class="spell-card-icon" aria-hidden="true">${spell.icon}</span>
        <span class="spell-card-name">${spell.name}</span>
        <span class="spell-card-desc">${spell.description}</span>
      `;
      card.addEventListener('click', () => this.choose(spell));
      this.picker.appendChild(card);
    }

    this.attachDrawing();
  }

  private attachDrawing(): void {
    const toCanvas = (event: PointerEvent): Point => {
      const rect = this.canvas.getBoundingClientRect();
      // The canvas is a fixed 520 square scaled by CSS, so map back into it.
      return {
        x: ((event.clientX - rect.left) / rect.width) * this.canvas.width,
        y: ((event.clientY - rect.top) / rect.height) * this.canvas.height,
      };
    };

    this.canvas.addEventListener('pointerdown', (event) => {
      if (!this.spell || this.settled) return;
      event.preventDefault();
      this.canvas.setPointerCapture(event.pointerId);
      this.drawing = true;
      this.stroke = [toCanvas(event)];
      this.render();
    });

    this.canvas.addEventListener('pointermove', (event) => {
      if (!this.drawing) return;
      event.preventDefault();
      const point = toCanvas(event);
      const last = this.stroke[this.stroke.length - 1];
      // Drop near-duplicate points; they add nothing and skew resampling.
      if (last && Math.hypot(point.x - last.x, point.y - last.y) < 2) return;
      this.stroke.push(point);
      this.render();
    });

    const finish = (event: PointerEvent): void => {
      if (!this.drawing) return;
      event.preventDefault();
      this.drawing = false;
      this.judge();
    };
    this.canvas.addEventListener('pointerup', finish);
    this.canvas.addEventListener('pointercancel', finish);
  }

  private judge(): void {
    if (!this.spell) return;
    const { passed } = scoreSigil(this.stroke, this.spell.sigil);

    if (!passed) {
      this.callbacks.onSound('fail');
      this.status.textContent = 'Nästan! Försök igen.';
      this.drawArea.classList.remove('shake');
      void this.drawArea.offsetWidth;
      this.drawArea.classList.add('shake');
      // Wipe the failed attempt so the next one starts clean.
      window.setTimeout(() => {
        this.stroke = [];
        this.render();
      }, TRAIL_FADE_MS);
      return;
    }

    this.settled = true;
    this.callbacks.onSound('success');
    this.status.textContent = `${this.spell.name}!`;
    this.drawArea.classList.add('cast');

    const spell = this.spell;
    window.setTimeout(() => {
      this.callbacks.onCast(spell);
      this.close();
    }, 520);
  }

  private choose(spell: Spell): void {
    this.spell = spell;
    this.stroke = [];
    this.settled = false;
    this.title.textContent = spell.name;
    this.status.textContent = 'Rita tecknet med fingret!';
    this.picker.hidden = true;
    this.drawArea.hidden = false;
    this.drawArea.classList.remove('cast');
    this.render();
  }

  show(): void {
    this.open = true;
    this.root.hidden = false;
    this.spell = null;
    this.stroke = [];
    this.settled = false;
    this.title.textContent = 'Välj en trollformel';
    this.status.textContent = '';
    this.picker.hidden = false;
    this.drawArea.hidden = true;
    this.callbacks.onSound('open');
    this.callbacks.onOpen();
  }

  close(): void {
    this.open = false;
    this.root.hidden = true;
    this.drawing = false;
    this.callbacks.onClose();
  }

  /** Draws the ghost sigil to trace, plus whatever has been drawn so far. */
  private render(): void {
    const ctx = this.ctx;
    if (!ctx || !this.spell) return;

    const size = this.canvas.width;
    ctx.clearRect(0, 0, size, size);

    // The template, as a dashed guide with a dot at the suggested start.
    const points = this.spell.sigil.points;
    const pad = size * 0.12;
    const span = size - pad * 2;
    const at = (p: Point) => ({ x: pad + p.x * span, y: pad + p.y * span });

    ctx.save();
    ctx.setLineDash([14, 12]);
    ctx.lineWidth = 8;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(74, 51, 39, 0.32)';
    ctx.beginPath();
    points.forEach((p, i) => {
      const { x, y } = at(p);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.restore();

    const start = at(points[0]!);
    ctx.fillStyle = this.spell.colour;
    ctx.beginPath();
    ctx.arc(start.x, start.y, 13, 0, Math.PI * 2);
    ctx.fill();

    // The stroke so far.
    if (this.stroke.length > 1) {
      ctx.save();
      ctx.lineWidth = 14;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = this.spell.colour;
      ctx.shadowColor = this.spell.colour;
      ctx.shadowBlur = 18;
      ctx.beginPath();
      ctx.moveTo(this.stroke[0]!.x, this.stroke[0]!.y);
      for (const p of this.stroke.slice(1)) ctx.lineTo(p.x, p.y);
      ctx.stroke();
      ctx.restore();
    }
  }
}
