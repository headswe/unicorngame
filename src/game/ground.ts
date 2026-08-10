/**
 * The meadow floor.
 *
 * Painted by a shader rather than assembled from tiles: a big field of grass
 * has to stretch further than any texture would without showing a seam, and the
 * speckled gouache look in the reference art is really just two frequencies of
 * noise over a green wash. It also costs one draw call.
 */

import * as THREE from 'three';

import { DEPTH_SQUASH, LAYER_ORDER, projectY } from '../engine/view.ts';

const VERTEX = /* glsl */ `
  varying vec2 vWorld;
  uniform float depthSquash;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    // Undo the projection squash so the grass texture stays circular rather
    // than smeared along the depth axis.
    vWorld = vec2(world.x, world.y / depthSquash);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const FRAGMENT = /* glsl */ `
  precision highp float;

  uniform vec3 grassLight;
  uniform vec3 grassDark;
  uniform vec3 fleck;
  uniform vec3 hazeColour;
  uniform float horizon;
  uniform float hazeDepth;

  varying vec2 vWorld;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
      mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
      u.y
    );
  }

  void main() {
    // Broad patches of lighter and darker grass.
    float blend = noise(vWorld * 0.28) * 0.65 + noise(vWorld * 0.85) * 0.35;
    vec3 col = mix(grassDark, grassLight, blend);

    // Two speckle passes: pale flecks and a scatter of deeper green.
    col = mix(col, fleck, step(0.88, noise(vWorld * 13.0)) * 0.30);
    col = mix(col, grassDark * 0.82, step(0.90, noise(vWorld * 6.0 + 41.3)) * 0.35);

    // Everything fades into haze as it approaches the far edge, so the meadow
    // meets the hills instead of stopping dead against them.
    float haze = smoothstep(horizon - hazeDepth, horizon, vWorld.y);
    col = mix(col, hazeColour, haze * 0.85);

    gl_FragColor = vec4(col, 1.0);
  }
`;

export interface GroundOptions {
  /** Playable bounds; the mesh is drawn generously larger than these. */
  minX: number;
  maxX: number;
  minY: number;
  /** Depth at which the grass has faded fully into haze. */
  horizonY: number;
}

export function createGround(opts: GroundOptions): THREE.Mesh {
  const overhangX = 30;
  const overhangSouth = 20;

  const left = opts.minX - overhangX;
  const right = opts.maxX + overhangX;
  const bottom = projectY(opts.minY - overhangSouth);
  // The far edge runs on past the horizon so it can hide behind the hills —
  // a plane that stopped exactly at the horizon would show its own straight cut.
  const top = projectY(opts.horizonY + 2);

  const geometry = new THREE.PlaneGeometry(right - left, top - bottom);
  geometry.translate((left + right) / 2, (bottom + top) / 2, 0);

  const material = new THREE.ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    depthWrite: false,
    depthTest: false,
    uniforms: {
      depthSquash: { value: DEPTH_SQUASH },
      grassLight: { value: new THREE.Color(0x8fc2a1) },
      grassDark: { value: new THREE.Color(0x6ba284) },
      fleck: { value: new THREE.Color(0xd9efdc) },
      // Matched to the foot of the hills sprite, so the two meet in the middle.
      hazeColour: { value: new THREE.Color(0x549b86) },
      horizon: { value: opts.horizonY },
      hazeDepth: { value: 13 },
    },
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = LAYER_ORDER.ground;
  mesh.frustumCulled = false;
  mesh.name = 'ground';
  return mesh;
}
