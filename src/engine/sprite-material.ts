/**
 * The one material every sprite in the game uses.
 *
 * Unicorn parts are drawn near-white so they can be recoloured here: the tint
 * is a plain multiply, which keeps the dark hand-drawn outlines dark and turns
 * the cream coat into whatever colour the unicorn happens to be. Coat patterns
 * are multiplied through the same shading so the stars and hearts sit *in* the
 * fur instead of floating on top of it.
 *
 * Everything stays in sRGB byte space end to end — no linear working space, no
 * tone mapping. For flat illustrated art that is both what the artist drew and
 * what gives the punchiest colours.
 */

import * as THREE from 'three';

const VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAGMENT = /* glsl */ `
  precision highp float;

  uniform sampler2D map;
  uniform vec3 tint;
  uniform float opacity;

  uniform sampler2D patternMap;
  uniform float patternAmount;
  uniform vec3 patternTint;
  uniform vec2 patternRepeat;
  uniform vec2 patternOffset;

  uniform vec3 glowColor;
  uniform float glowAmount;

  varying vec2 vUv;

  void main() {
    vec4 base = texture2D(map, vUv);
    if (base.a < 0.004) discard;

    vec3 col = base.rgb * tint;

    if (patternAmount > 0.0) {
      vec4 pat = texture2D(patternMap, vUv * patternRepeat + patternOffset);
      col = mix(col, base.rgb * patternTint, pat.a * patternAmount);
    }

    col = mix(col, glowColor, glowAmount);

    gl_FragColor = vec4(col, base.a * opacity);
  }
`;

let blankTexture: THREE.Texture | null = null;

/** 1×1 fully transparent texture, so the pattern sampler is never left unbound. */
function blank(): THREE.Texture {
  if (!blankTexture) {
    blankTexture = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
    blankTexture.needsUpdate = true;
  }
  return blankTexture;
}

export interface SpriteMaterialOptions {
  map: THREE.Texture;
  tint?: THREE.ColorRepresentation;
  opacity?: number;
  patternMap?: THREE.Texture;
  patternTint?: THREE.ColorRepresentation;
  patternAmount?: number;
  patternRepeat?: THREE.Vector2;
  patternOffset?: THREE.Vector2;
}

export type SpriteMaterial = THREE.ShaderMaterial;

export function createSpriteMaterial(opts: SpriteMaterialOptions): SpriteMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    side: THREE.DoubleSide,
    uniforms: {
      map: { value: opts.map },
      tint: { value: new THREE.Color(opts.tint ?? 0xffffff) },
      opacity: { value: opts.opacity ?? 1 },
      patternMap: { value: opts.patternMap ?? blank() },
      patternAmount: { value: opts.patternMap ? (opts.patternAmount ?? 1) : 0 },
      patternTint: { value: new THREE.Color(opts.patternTint ?? 0xffffff) },
      patternRepeat: { value: opts.patternRepeat ?? new THREE.Vector2(1, 1) },
      patternOffset: { value: opts.patternOffset ?? new THREE.Vector2(0, 0) },
      glowColor: { value: new THREE.Color(0xffffff) },
      glowAmount: { value: 0 },
    },
  });
}

export function setGlow(material: SpriteMaterial, amount: number, color = 0xffffff): void {
  material.uniforms.glowAmount!.value = amount;
  (material.uniforms.glowColor!.value as THREE.Color).set(color);
}
