/**
 * Loads the generated sprite atlas described by src/generated/parts-manifest.json.
 */

import * as THREE from 'three';

import manifest from '../generated/parts-manifest.json';

export type PartKind =
  | 'body'
  | 'horn'
  | 'mane'
  | 'tail'
  | 'pattern'
  | 'decor'
  | 'prop'
  | 'cloud'
  | 'icon';

export interface PartInfo {
  id: string;
  kind: PartKind;
  label: string;
  url: string;
  width: number;
  height: number;
  aspect: number;
  worldHeight: number;
  tintable: boolean;
}

export interface Part extends PartInfo {
  texture: THREE.Texture;
}

// Icons are HUD chrome shown by the DOM as ordinary images, so they are in the
// manifest — that is what tells the HUD where to find them — but there is no
// reason to spend GPU memory uploading them as sprite textures.
const PARTS = (manifest as PartInfo[]).filter((p) => p.kind !== 'icon');

/**
 * Where a part's PNG lives, for the bits of the game that are not sprites.
 *
 * Resolved against the document base, the same as `loadAll` does, because the
 * game is served from a subdirectory on GitHub Pages and a bare relative path
 * would look for it beside whatever page happened to load.
 */
export function partUrl(id: string, baseUrl = document.baseURI): string | null {
  const url = (manifest as PartInfo[]).find((p) => p.id === id)?.url;
  return url ? new URL(url, baseUrl).href : null;
}

export class AssetLibrary {
  private readonly parts = new Map<string, Part>();

  /** Every part that was successfully loaded, in manifest order. */
  readonly loaded: Part[] = [];

  get(id: string): Part {
    const part = this.parts.get(id);
    if (!part) throw new Error(`unknown part "${id}" — run npm run gen:assets`);
    return part;
  }

  has(id: string): boolean {
    return this.parts.has(id);
  }

  ofKind(kind: PartKind): Part[] {
    return this.loaded.filter((p) => p.kind === kind);
  }

  /**
   * Loads every part in the manifest. A part that fails to load is skipped with
   * a warning rather than taking the whole game down — a missing bush should
   * not stop a six-year-old from playing.
   */
  async loadAll(baseUrl: string, onProgress?: (done: number, total: number) => void): Promise<void> {
    const loader = new THREE.TextureLoader();
    let done = 0;

    await Promise.all(
      PARTS.map(async (info) => {
        try {
          const texture = await loader.loadAsync(new URL(info.url, baseUrl).href);
          // The whole renderer works in sRGB byte space (see sprite-material),
          // so textures are handed to the shader exactly as they were drawn.
          texture.colorSpace = THREE.NoColorSpace;
          texture.minFilter = THREE.LinearMipmapLinearFilter;
          texture.magFilter = THREE.LinearFilter;
          if (info.kind === 'pattern') {
            // Coat patterns are sampled several times across a body, so they
            // have to tile. Mirroring rather than plain repeating means the
            // generated tiles do not need to be perfectly seamless — the joins
            // fold back on themselves and disappear.
            texture.wrapS = THREE.MirroredRepeatWrapping;
            texture.wrapT = THREE.MirroredRepeatWrapping;
          }
          texture.generateMipmaps = true;
          texture.anisotropy = 4;
          this.parts.set(info.id, { ...info, texture });
        } catch {
          console.warn(`could not load sprite "${info.id}" from ${info.url}`);
        } finally {
          done++;
          onProgress?.(done, PARTS.length);
        }
      }),
    );

    // Preserve manifest order regardless of which promise settled first.
    for (const info of PARTS) {
      const part = this.parts.get(info.id);
      if (part) this.loaded.push(part);
    }
  }
}
