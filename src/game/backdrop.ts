/**
 * Sky, hills and clouds behind the meadow.
 *
 * Each band moves at its own fraction of the camera, which is what sells the
 * depth: walk east and the grass rushes past, the hills barely shift, and the
 * sky does not move at all. Clouds drift on top of that at their own speed.
 */

import * as THREE from 'three';

import type { AssetLibrary } from '../engine/assets.ts';
import { makeRng } from '../engine/rng.ts';
import { createSprite } from '../engine/sprite.ts';
import { LAYER_ORDER, projectY } from '../engine/view.ts';

const SKY_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SKY_FRAGMENT = /* glsl */ `
  precision highp float;
  uniform vec3 top;
  uniform vec3 middle;
  uniform vec3 bottom;
  varying vec2 vUv;
  void main() {
    vec3 col = vUv.y > 0.5
      ? mix(middle, top, smoothstep(0.5, 1.0, vUv.y))
      : mix(bottom, middle, smoothstep(0.0, 0.5, vUv.y));
    gl_FragColor = vec4(col, 1.0);
  }
`;

const HAZE_FRAGMENT = /* glsl */ `
  precision highp float;
  uniform vec3 colour;
  uniform float strength;
  varying vec2 vUv;
  void main() {
    // Solid where it meets the hills, gone by the time it reaches the grass.
    gl_FragColor = vec4(colour, smoothstep(0.0, 1.0, vUv.y) * strength);
  }
`;

/**
 * A band that slides horizontally at a fraction of the camera's speed.
 *
 * Only horizontally: the hills sit at the far edge of the meadow and stay
 * there, so walking north really does bring you closer to the horizon instead
 * of dragging it down over the grass.
 */
interface ParallaxLayer {
  group: THREE.Group;
  /** 0 pins the layer to the world, 1 pins it to the camera. */
  factor: number;
  /** Screen-space y the layer is anchored at. */
  anchorY: number;
}

export interface BackdropOptions {
  /** World depth of the far edge of the meadow. */
  horizonY: number;
  worldWidth: number;
  seed?: string;
}

export class Backdrop {
  readonly group = new THREE.Group();

  private readonly layers: ParallaxLayer[] = [];
  private readonly sky: THREE.Mesh;
  private readonly clouds: Array<{ mesh: THREE.Object3D; speed: number; span: number }> = [];
  private readonly horizonScreenY: number;

  constructor(assets: AssetLibrary, opts: BackdropOptions) {
    this.horizonScreenY = projectY(opts.horizonY);
    const rng = makeRng(opts.seed ?? 'himmel');

    // --- sky: one big quad, redrawn under the camera every frame ------------
    this.sky = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.ShaderMaterial({
        vertexShader: SKY_VERTEX,
        fragmentShader: SKY_FRAGMENT,
        depthWrite: false,
        depthTest: false,
        uniforms: {
          top: { value: new THREE.Color(0x8fc9ea) },
          middle: { value: new THREE.Color(0xbfe3f2) },
          bottom: { value: new THREE.Color(0xeaf6ef) },
        },
      }),
    );
    this.sky.renderOrder = LAYER_ORDER.sky;
    this.sky.frustumCulled = false;
    this.group.add(this.sky);

    // --- hills: the same sprite repeated along the horizon -------------------
    const hillsGroup = new THREE.Group();
    const hillsHeight = 4;
    const hillsPivotY = 0.25;
    /** Screen-space y of the straight cut along the bottom of the hills art. */
    const hillsBottom = this.horizonScreenY - hillsHeight * hillsPivotY;

    if (assets.has('kullar')) {
      const hills = assets.get('kullar');
      const height = hillsHeight;
      const width = height * hills.aspect;
      const span = opts.worldWidth + 160;
      const count = Math.ceil(span / width) + 1;
      for (let i = 0; i < count; i++) {
        // Pivoted a quarter of the way up so the base of the hills tucks in
        // under the far edge of the grass and hides the seam.
        const sprite = createSprite(hills, { height, pivotY: hillsPivotY });
        // A hair of overlap between copies, so no hairline shows at the joins.
        sprite.position.x = (i - (count - 1) / 2) * (width - 0.04);
        sprite.renderOrder = LAYER_ORDER.hills;
        hillsGroup.add(sprite);
      }
    }
    this.group.add(hillsGroup);
    this.layers.push({ group: hillsGroup, factor: 0.86, anchorY: this.horizonScreenY });

    // --- clouds --------------------------------------------------------------
    const cloudGroup = new THREE.Group();
    const cloudParts = ['moln_stort', 'moln_litet'].filter((id) => assets.has(id));
    if (cloudParts.length) {
      const span = opts.worldWidth + 120;
      for (let i = 0; i < 9; i++) {
        const part = assets.get(rng.pick(cloudParts));
        const height = rng.range(1.6, 3.2);
        const sprite = createSprite(part, { height, opacity: rng.range(0.75, 1) });
        sprite.position.set(rng.range(-span / 2, span / 2), rng.range(2.4, 9), 0);
        sprite.renderOrder = LAYER_ORDER.clouds + i;
        cloudGroup.add(sprite);
        this.clouds.push({ mesh: sprite, speed: rng.range(0.08, 0.24), span });
      }
    }
    this.group.add(cloudGroup);
    this.layers.push({ group: cloudGroup, factor: 0.7, anchorY: this.horizonScreenY });

    // --- haze band -----------------------------------------------------------
    // The hills sprite ends in a straight cut. Fading a strip of the hills'
    // own colour down over the grass turns that cut into distance.
    const bandHeight = 4;
    const bandWidth = opts.worldWidth + 220;
    const band = new THREE.Mesh(
      new THREE.PlaneGeometry(bandWidth, bandHeight),
      new THREE.ShaderMaterial({
        vertexShader: SKY_VERTEX,
        fragmentShader: HAZE_FRAGMENT,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        uniforms: {
          colour: { value: new THREE.Color(0x549b86) },
          strength: { value: 0.8 },
        },
      }),
    );
    // Topped out just over the cut and fading downhill from there, so it hides
    // the edge without washing the hills out.
    band.position.y = hillsBottom + 0.25 - bandHeight / 2;
    band.renderOrder = LAYER_ORDER.groundDecal;
    band.frustumCulled = false;
    this.group.add(band);
  }

  update(
    dt: number,
    camera: THREE.OrthographicCamera,
    view: { halfWidth: number; halfHeight: number },
  ): void {
    // The sky quad is simply parked over the viewport.
    this.sky.position.set(camera.position.x, camera.position.y, 0);
    this.sky.scale.set(view.halfWidth * 2 + 2, view.halfHeight * 2 + 2, 1);

    for (const layer of this.layers) {
      layer.group.position.x = camera.position.x * layer.factor;
      layer.group.position.y = layer.anchorY;
    }

    // Clouds wrap around rather than running out.
    for (const cloud of this.clouds) {
      cloud.mesh.position.x += cloud.speed * dt;
      if (cloud.mesh.position.x > cloud.span / 2) cloud.mesh.position.x = -cloud.span / 2;
    }
  }
}
