/**
 * The wardrobe: build your own unicorn by swapping parts.
 *
 * This is what the variant system was always for. A `UnicornVariant` is plain
 * data, so editing one is just setting fields and rebuilding — no special
 * "editor mode" in the renderer, and the preview is a real `Unicorn` built by
 * the same code that puts them in the meadow. What you see here is exactly what
 * walks out.
 *
 * One tab per part, each showing that part's shapes *and* its colours, because
 * "pick a mane, pick its colour" is one thought to a child rather than two.
 * Options are pictures of the actual sprites, so nothing depends on reading.
 */

import * as THREE from 'three';

import type { AssetLibrary, Part, PartKind } from '../engine/assets.ts';
import { COATS, HAIR, HORNS, NAMES, PATTERN_COLOURS, RAINBOW, type NamedColour } from './palette.ts';
import { Unicorn } from './unicorn.ts';
import { randomSeed, randomVariant, type UnicornVariant } from './variant.ts';

export interface WardrobeCallbacks {
  /** Called on every change, so the meadow can show the edit immediately. */
  onChange(variant: UnicornVariant): void;
  onClose(variant: UnicornVariant): void;
  onSound(kind: 'swap' | 'open' | 'done'): void;
}

interface Tab {
  id: string;
  label: string;
  icon: string;
  /** Which sprites this tab offers, if any. */
  kind: PartKind | null;
  /** Which colours this tab offers. */
  colours: NamedColour[];
  /** Reads the currently chosen sprite id. */
  getPart(v: UnicornVariant): string | null;
  setPart(v: UnicornVariant, id: string | null): void;
  getColour(v: UnicornVariant): number;
  setColour(v: UnicornVariant, hex: number): void;
  /** Patterns can be switched off entirely. */
  allowNone?: boolean;
}

const TABS: Tab[] = [
  {
    id: 'body',
    label: 'Kropp',
    icon: '🐴',
    kind: 'body',
    colours: COATS,
    getPart: (v) => v.bodyId,
    setPart: (v, id) => {
      if (id) v.bodyId = id;
    },
    getColour: (v) => v.coat,
    setColour: (v, hex) => {
      v.coat = hex;
    },
  },
  {
    id: 'horn',
    label: 'Horn',
    icon: '🦄',
    kind: 'horn',
    colours: HORNS,
    getPart: (v) => v.hornId,
    setPart: (v, id) => {
      if (id) v.hornId = id;
    },
    getColour: (v) => v.hornColour,
    setColour: (v, hex) => {
      v.hornColour = hex;
    },
  },
  {
    id: 'mane',
    label: 'Man',
    icon: '💇',
    kind: 'mane',
    colours: HAIR,
    getPart: (v) => v.maneId,
    setPart: (v, id) => {
      if (id) v.maneId = id;
    },
    getColour: (v) => v.maneColour,
    setColour: (v, hex) => {
      v.maneColour = hex;
    },
  },
  {
    id: 'tail',
    label: 'Svans',
    icon: '🎀',
    kind: 'tail',
    colours: HAIR,
    getPart: (v) => v.tailId,
    setPart: (v, id) => {
      if (id) v.tailId = id;
    },
    getColour: (v) => v.tailColour,
    setColour: (v, hex) => {
      v.tailColour = hex;
    },
  },
  {
    id: 'pattern',
    label: 'Mönster',
    icon: '✨',
    kind: 'pattern',
    colours: PATTERN_COLOURS,
    allowNone: true,
    getPart: (v) => v.patternId,
    setPart: (v, id) => {
      v.patternId = id;
    },
    getColour: (v) => v.patternColour,
    setColour: (v, hex) => {
      v.patternColour = hex;
    },
  },
];

const hex = (value: number) => `#${value.toString(16).padStart(6, '0')}`;

/**
 * A live unicorn on its own little stage.
 *
 * Its own WebGL context, because the meadow's canvas is covered by this
 * overlay. Textures are shared with the main renderer; three re-uploads them
 * per context on its own.
 */
class Preview {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.OrthographicCamera;
  private unicorn: Unicorn | null = null;
  private clock = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.setClearAlpha(0);

    // Shows about two and a half body heights, the unicorn standing on the floor.
    const height = 2.6;
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
    this.camera.position.z = 10;
    this.resize(height);
  }

  private resize(viewHeight = 2.6): void {
    const canvas = this.renderer.domElement;
    const width = canvas.clientWidth || 260;
    const height = canvas.clientHeight || 300;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(width, height, false);

    const half = viewHeight / 2;
    const aspect = width / Math.max(1, height);
    this.camera.left = -half * aspect;
    this.camera.right = half * aspect;
    this.camera.top = half;
    this.camera.bottom = -half;
    // Sit the unicorn on the lower third rather than the middle of the frame.
    this.camera.position.y = half * 0.72;
    this.camera.updateProjectionMatrix();
  }

  show(variant: UnicornVariant, assets: AssetLibrary): void {
    this.unicorn?.dispose();
    this.unicorn = new Unicorn(variant, assets, 1.85);
    this.unicorn.x = 0;
    this.unicorn.y = 0;
    this.scene.add(this.unicorn.group);
    this.unicorn.update(0, false);
  }

  render(dt: number): void {
    if (!this.unicorn) return;
    this.clock += dt;
    this.resize();
    this.unicorn.update(dt, false);
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.unicorn?.dispose();
    this.renderer.dispose();
  }
}

export class Wardrobe {
  private readonly root: HTMLDivElement;
  private readonly preview: Preview;
  private readonly tabBar: HTMLDivElement;
  private readonly options: HTMLDivElement;
  private readonly swatches: HTMLDivElement;
  private readonly nameInput: HTMLInputElement;

  private variant: UnicornVariant;
  private tab: Tab = TABS[0]!;
  private lastFrame = 0;

  open = false;

  constructor(
    parent: HTMLElement,
    private readonly assets: AssetLibrary,
    variant: UnicornVariant,
    private readonly callbacks: WardrobeCallbacks,
  ) {
    this.variant = { ...variant };

    this.root = document.createElement('div');
    this.root.className = 'wardrobe';
    this.root.hidden = true;
    this.root.innerHTML = `
      <div class="wardrobe-panel" role="dialog" aria-modal="true" aria-label="Min enhörning">
        <div class="wardrobe-stage">
          <canvas class="wardrobe-canvas"></canvas>
          <div class="wardrobe-namerow">
            <input class="wardrobe-name" type="text" maxlength="14" aria-label="Namn" />
            <button type="button" class="wardrobe-dice" aria-label="Slumpa en enhörning">🎲</button>
          </div>
          <button type="button" class="wardrobe-done">Klar!</button>
        </div>
        <div class="wardrobe-picker">
          <div class="wardrobe-tabs" role="tablist"></div>
          <div class="wardrobe-options"></div>
          <div class="wardrobe-swatches"></div>
        </div>
      </div>
    `;
    parent.appendChild(this.root);

    const q = <T extends HTMLElement>(sel: string): T => {
      const el = this.root.querySelector<T>(sel);
      if (!el) throw new Error(`wardrobe markup missing ${sel}`);
      return el;
    };

    this.tabBar = q<HTMLDivElement>('.wardrobe-tabs');
    this.options = q<HTMLDivElement>('.wardrobe-options');
    this.swatches = q<HTMLDivElement>('.wardrobe-swatches');
    this.nameInput = q<HTMLInputElement>('.wardrobe-name');
    this.preview = new Preview(q<HTMLCanvasElement>('.wardrobe-canvas'));

    q<HTMLButtonElement>('.wardrobe-done').addEventListener('click', () => {
      this.callbacks.onSound('done');
      this.close();
    });

    q<HTMLButtonElement>('.wardrobe-dice').addEventListener('click', () => {
      const rolled = randomVariant(this.assets, randomSeed());
      this.variant = rolled;
      this.nameInput.value = rolled.name;
      this.refresh();
      this.changed();
    });

    this.nameInput.addEventListener('input', () => {
      this.variant.name = this.nameInput.value.trim() || 'Enhörning';
      this.callbacks.onChange({ ...this.variant });
    });

    this.buildTabs();
  }

  private buildTabs(): void {
    for (const tab of TABS) {
      // A tab with no sprites to offer would be an empty shelf.
      if (tab.kind && !this.assets.ofKind(tab.kind).length) continue;

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'wardrobe-tab';
      button.setAttribute('role', 'tab');
      button.innerHTML = `<span aria-hidden="true">${tab.icon}</span><span>${tab.label}</span>`;
      button.addEventListener('click', () => {
        this.tab = tab;
        this.refresh();
      });
      this.tabBar.appendChild(button);
    }
  }

  /** Card showing a part's actual artwork. */
  private partCard(part: Part | null, selected: boolean, onPick: () => void): HTMLButtonElement {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = `wardrobe-option${selected ? ' selected' : ''}`;
    card.setAttribute('aria-pressed', String(selected));

    if (part) {
      const img = document.createElement('img');
      img.src = new URL(part.url, document.baseURI).href;
      img.alt = part.label;
      img.loading = 'lazy';
      card.append(img, Object.assign(document.createElement('span'), { textContent: part.label }));
    } else {
      card.append(
        Object.assign(document.createElement('span'), { className: 'wardrobe-none', textContent: '∅' }),
        Object.assign(document.createElement('span'), { textContent: 'Inget' }),
      );
    }

    card.addEventListener('click', () => {
      onPick();
      this.callbacks.onSound('swap');
      this.refresh();
      this.changed();
    });
    return card;
  }

  private refresh(): void {
    for (const [i, button] of [...this.tabBar.children].entries()) {
      const active = TABS[i]?.id === this.tab.id;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
    }

    this.options.replaceChildren();
    if (this.tab.kind) {
      if (this.tab.allowNone) {
        this.options.appendChild(
          this.partCard(null, this.tab.getPart(this.variant) === null, () =>
            this.tab.setPart(this.variant, null),
          ),
        );
      }
      for (const part of this.assets.ofKind(this.tab.kind)) {
        this.options.appendChild(
          this.partCard(part, this.tab.getPart(this.variant) === part.id, () =>
            this.tab.setPart(this.variant, part.id),
          ),
        );
      }
    }

    this.swatches.replaceChildren();
    const current = this.tab.getColour(this.variant);
    for (const colour of this.tab.colours) {
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.className = `wardrobe-swatch${colour.hex === current ? ' selected' : ''}`;
      // The rainbow is a marker, not a colour, so its swatch is drawn as one.
      dot.style.background =
        colour.hex === RAINBOW
          ? 'linear-gradient(#f4676f, #ffa94d, #ffdc5e, #6fd39a, #53bcd8, #9a7ce0)'
          : hex(colour.hex);
      dot.title = colour.label;
      dot.setAttribute('aria-label', colour.label);
      dot.setAttribute('aria-pressed', String(colour.hex === current));
      dot.addEventListener('click', () => {
        this.tab.setColour(this.variant, colour.hex);
        this.callbacks.onSound('swap');
        this.refresh();
        this.changed();
      });
      this.swatches.appendChild(dot);
    }

    this.preview.show(this.variant, this.assets);
  }

  private changed(): void {
    this.callbacks.onChange({ ...this.variant });
  }

  show(variant: UnicornVariant): void {
    this.variant = { ...variant };
    // A unicorn that was rolled rather than named keeps whatever it had.
    this.nameInput.value = this.variant.name || NAMES[0]!;
    this.open = true;
    this.root.hidden = false;
    this.lastFrame = performance.now();
    this.callbacks.onSound('open');
    this.refresh();
  }

  close(): void {
    this.open = false;
    this.root.hidden = true;
    this.callbacks.onClose({ ...this.variant });
  }

  /** Driven from the main loop so the preview breathes while you dress it. */
  tick(): void {
    if (!this.open) return;
    const now = performance.now();
    const dt = Math.min((now - this.lastFrame) / 1000, 1 / 20);
    this.lastFrame = now;
    this.preview.render(dt);
  }
}
