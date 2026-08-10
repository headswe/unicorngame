/**
 * The soft blob of shade under everything that stands in the meadow.
 *
 * Drawn on a canvas rather than generated as art: it is a plain radial falloff,
 * it has to tint cleanly against any ground colour, and it would be a waste of
 * an image credit.
 */

import * as THREE from 'three';

import type { Part } from '../engine/assets.ts';

let cached: Part | null = null;

export function shadowTexture(): Part | null {
  if (cached) return cached;
  if (typeof document === 'undefined') return null;

  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(31, 56, 46, 0.95)');
  gradient.addColorStop(0.55, 'rgba(31, 56, 46, 0.5)');
  gradient.addColorStop(1, 'rgba(31, 56, 46, 0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;

  cached = {
    id: '__shadow',
    kind: 'decor',
    label: 'Skugga',
    url: '',
    width: size,
    height: size,
    // Flattened into an ellipse, because the ground is seen at a low angle.
    aspect: 2.6,
    worldHeight: 0.25,
    tintable: false,
    texture,
  };
  return cached;
}
