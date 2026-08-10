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

/** Quad of the given size whose origin sits at (pivotX, pivotY) in 0..1 space. */
export function anchoredQuad(
  width: number,
  height: number,
  pivotX = 0.5,
  pivotY = 0,
): THREE.PlaneGeometry {
  const key = `${width.toFixed(4)}:${height.toFixed(4)}:${pivotX}:${pivotY}`;
  let geo = geometryCache.get(key);
  if (!geo) {
    geo = new THREE.PlaneGeometry(width, height);
    geo.translate(width * (0.5 - pivotX), height * (0.5 - pivotY), 0);
    geometryCache.set(key, geo);
  }
  return geo;
}

export interface SpriteOptions extends Omit<SpriteMaterialOptions, 'map'> {
  /** Height in world units. Defaults to the part's nominal worldHeight. */
  height?: number;
  pivotX?: number;
  pivotY?: number;
}

export interface Sprite extends THREE.Mesh {
  material: SpriteMaterial;
}

export function createSprite(part: Part, opts: SpriteOptions = {}): Sprite {
  const height = opts.height ?? part.worldHeight;
  const width = height * part.aspect;
  const geometry = anchoredQuad(width, height, opts.pivotX ?? 0.5, opts.pivotY ?? 0);
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
