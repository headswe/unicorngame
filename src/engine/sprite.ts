/**
 * Anchored sprite quads.
 *
 * Everything in the meadow stands on the ground, so sprites default to a
 * bottom-centre pivot: put the mesh at a world position and the sprite's feet
 * land there.
 */

import * as THREE from 'three';

import type { Part } from './assets.ts';
import { createSpriteMaterial, type SpriteMaterial, type SpriteMaterialOptions } from './sprite-material.ts';

const geometryCache = new Map<string, THREE.PlaneGeometry>();

/** A region of a texture, 0..1, origin bottom-left. */
export interface UvRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Quad of the given size whose origin sits at (pivotX, pivotY) in 0..1 space.
 *
 * `uv` narrows the quad to a region of its texture instead of the whole image —
 * how the ear patch re-uses a slice of the body drawing.
 */
export function anchoredQuad(
  width: number,
  height: number,
  pivotX = 0.5,
  pivotY = 0,
  uv?: UvRect,
): THREE.PlaneGeometry {
  const uvKey = uv ? `${uv.x}:${uv.y}:${uv.width}:${uv.height}` : '-';
  const key = `${width.toFixed(4)}:${height.toFixed(4)}:${pivotX}:${pivotY}:${uvKey}`;
  let geo = geometryCache.get(key);
  if (!geo) {
    geo = new THREE.PlaneGeometry(width, height);
    geo.translate(width * (0.5 - pivotX), height * (0.5 - pivotY), 0);
    // Keep the plain 0..1 corner coordinates around: once `uv` narrows the real
    // uv attribute to a slice of the texture, it can no longer tell the shader
    // how close a pixel is to the edge of the quad.
    const base = (geo.attributes.uv as THREE.BufferAttribute).clone();
    geo.setAttribute('quadUv', base);
    if (uv) {
      const attr = geo.attributes.uv as THREE.BufferAttribute;
      for (let i = 0; i < attr.count; i++) {
        attr.setXY(i, uv.x + attr.getX(i) * uv.width, uv.y + attr.getY(i) * uv.height);
      }
      attr.needsUpdate = true;
    }
    geometryCache.set(key, geo);
  }
  return geo;
}

export interface SpriteOptions extends Omit<SpriteMaterialOptions, 'map'> {
  /** Height in world units. Defaults to the part's nominal worldHeight. */
  height?: number;
  pivotX?: number;
  pivotY?: number;
  /** Draw only this region of the texture. */
  uv?: UvRect;
}

export interface Sprite extends THREE.Mesh {
  material: SpriteMaterial;
}

export function createSprite(part: Part, opts: SpriteOptions = {}): Sprite {
  const height = opts.height ?? part.worldHeight;
  // A uv slice already carries its own proportions; the caller sizes it.
  const width = opts.uv ? height * part.aspect * (opts.uv.width / opts.uv.height) : height * part.aspect;
  const geometry = anchoredQuad(width, height, opts.pivotX ?? 0.5, opts.pivotY ?? 0, opts.uv);
  const material = createSpriteMaterial({ ...opts, map: part.texture });
  const mesh = new THREE.Mesh(geometry, material) as Sprite;
  mesh.name = part.id;
  mesh.frustumCulled = false;
  return mesh;
}

/** Size a sprite would occupy, without building it. */
export function spriteSize(part: Part, height = part.worldHeight): { width: number; height: number } {
  return { width: height * part.aspect, height };
}
