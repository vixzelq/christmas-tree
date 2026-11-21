/* 粒子圣诞树：树形散布、散开、律动、星星与地面光池 */

import * as THREE from '../vendor/three/build/three.module.js';
import { PALETTES, TREE } from './config.js';
import {
  clamp,
  smoothstep,
  damp,
  rand,
  mulberry32,
  glowTexture,
  starTexture,
  radialGroundTexture,
  hexToRgb
} from './utils.js';

const VERT = /* glsl */ `
  uniform float uTime;
  uniform float uPixelRatio;
  uniform float uAudio;
  uniform float uSize;
  uniform float uScale;
  uniform float uOpacity;

  attribute float aSize;
  attribute float aPhase;
  attribute float aSeed;
  attribute float aAlpha;
  attribute vec3 aColor;

  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    vec3 p = position;
    float t = uTime;
    p.x += sin(t * 0.7 + aSeed * 41.0) * 0.05;
    p.z += cos(t * 0.61 + aSeed * 27.0) * 0.05;
    p.y += sin(t * 0.47 + aPhase * 9.0) * 0.055;

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;

    float twinkle = 0.62 + 0.38 * sin(t * 1.9 + aPhase * 23.0);
    twinkle = mix(twinkle, 1.0, 0.4 * uAudio);

    float size = aSize * uSize * uScale * (1.0 + 0.38 * uAudio);
    gl_PointSize = max(1.3 * uPixelRatio, size * uPixelRatio * (270.0 / max(0.6, -mv.z)) * twinkle);
    gl_PointSize = min(gl_PointSize, 90.0 * uPixelRatio);

    vColor = aColor * (0.9 + 0.35 * twinkle);
    vAlpha = aAlpha * uOpacity * (0.5 + 0.5 * twinkle);
  }
`;

const FRAG = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    if (d > 0.5) discard;
    float core = smoothstep(0.5, 0.0, d);
    float a = pow(core, 3.2);
    vec3 col = mix(vColor, vec3(1.0), a * 0.28);
    gl_FragColor = vec4(col * (0.8 + 0.6 * a), a * vAlpha);
  }
`;

const EMBER_VERT = /* glsl */ `
  uniform float uTime;
  uniform float uPixelRatio;
  uniform float uAudio;
  attribute float aSpeed;
  attribute float aPhase;
  attribute float aSize;
  attribute vec3 aColor;
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    float span = 11.0;
    float y = mod(position.y + uTime * aSpeed * (1.0 + uAudio * 0.8), span);
    vec3 p = vec3(
      position.x + sin(uTime * 0.5 + aPhase * 6.28) * 0.55,
      y + 0.2,
      position.z + cos(uTime * 0.42 + aPhase * 6.28) * 0.55
    );
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    float tw = 0.35 + 0.65 * sin(uTime * 2.4 + aPhase * 18.0);
    gl_PointSize = max(1.0, aSize * uPixelRatio * (200.0 / max(1.0, -mv.z)) * (0.7 + tw));
    vColor = aColor;
    vAlpha = (0.15 + 0.5 * tw) * (1.0 - smoothstep(8.0, 11.0, y));
  }
`;

const EMBER_FRAG = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;
    float a = pow(smoothstep(0.5, 0.0, d), 2.0);
    gl_FragColor = vec4(vColor, a * vAlpha);
  }
`;

export class ChristmasTree {
  constructor(scene, { count = 9000, palette = 'gold', quality = 1 } = {}) {
    this.scene = scene;
    this.quality = quality;
    this.paletteName = palette;
    this.palette = PALETTES[palette] || PALETTES.gold;
    this.count = count;
    this.time = 0;
    this.assemble = 0;
    this.target = 1;
    this.impulse = 0;
    this.audioEnergy = 0;
    this.hand = new THREE.Vector2(0, 0);
    this.tilt = new THREE.Vector2(0, 0);
    this.spin = 0;
    this.baseSpinSpeed = 0.055;
    this.userSpin = 0;

    this.group = new THREE.Group();
    this.group.position.y = 0;
    this.scene.add(this.group);

    this.inner = new THREE.Group();
    this.group.add(this.inner);

    this._build();
    this._buildBody();
    this._buildStar();
    this._buildGround();

    this.pulseColor = new THREE.Color('#ffe6b0');
    this.flash = 0;
  }

  /* ------------------------------------------------------------
     构建粒子几何体
     ------------------------------------------------------------ */
  _build() {
    this._disposePoints();
    this._lastAssemble = -1;
    this._colorLerp = false;
    const count = this.count;
    // 只保留圣诞树本身的粒子：树冠 + 树干
    const nTree = Math.round(count * 0.95);
    const nTrunk = count - nTree;
    const nGround = 0;
    const nDust = 0;

    const total = nTree + nTrunk + nGround + nDust;
    const positions = new Float32Array(total * 3);
    const treePos = new Float32Array(total * 3);
    const scatter = new Float32Array(total * 3);
    const colors = new Float32Array(total * 3);
    const targetColors = new Float32Array(total * 3);
    const sizes = new Float32Array(total);
    const phases = new Float32Array(total);
    const seeds = new Float32Array(total);
    const alphas = new Float32Array(total);
    const delays = new Float32Array(total);

    const rnd = mulberry32(20261225);
    const H = TREE.height;
    const R = TREE.radius;
    const trunkTop = TREE.trunkHeight;
    const baseY = 0.62;

    const colorPool = this.palette.colors.map((hex) => hexToRgb(hex));
    const weights = this.palette.weights;

    const pickColor = (prefer) => {
      if (prefer !== undefined && prefer < colorPool.length) return colorPool[prefer];
      let r = rnd();
      for (let i = 0; i < weights.length; i++) {
        r -= weights[i];
        if (r <= 0) return colorPool[i];
      }
      return colorPool[0];
    };

    let i = 0;
    const write = (idx, x, y, z, col, size, alpha, delay) => {
      const p = idx * 3;
      treePos[p] = x;
      treePos[p + 1] = y;
      treePos[p + 2] = z;
      positions[p] = x;
      positions[p + 1] = y;
      positions[p + 2] = z;
      colors[p] = col.r;
      colors[p + 1] = col.g;
      colors[p + 2] = col.b;
      targetColors[p] = col.r;
      targetColors[p + 1] = col.g;
      targetColors[p + 2] = col.b;
      sizes[idx] = size;
      alphas[idx] = alpha;
      delays[idx] = delay;
      phases[idx] = rnd();
      seeds[idx] = rnd();
    };

    // ---- 树冠 ----
    for (; i < nTree; i++) {
      const u = rnd();
      const yFrac = 1 - Math.pow(u, 0.88); // 底部略密
      const y = baseY + yFrac * H;
      const taper = Math.pow(1 - yFrac, 0.92);
      const maxR = R * (0.16 + 0.84 * taper);

      // 分层：雾状树体 / 表面星芒 / 螺旋彩带 / 大颗彩灯
      const roll = rnd();
      const kind = roll < 0.07 ? 'bulb' : roll < 0.2 ? 'garland' : roll < 0.37 ? 'rim' : roll < 0.62 ? 'sparkle' : 'core';

      const onHelix = kind === 'garland' || (kind !== 'core' && kind !== 'rim' && rnd() < 0.4);
      const angle = onHelix
        ? yFrac * Math.PI * 11 + (rnd() - 0.5) * 0.42
        : rnd() * Math.PI * 2;
      const shell = kind === 'core' ? 0.3 + rnd() * 0.6 : kind === 'rim' ? 0.995 : 0.9 + rnd() * 0.1;
      const scallop = 1 + Math.sin(yFrac * Math.PI * 13) * 0.075;
      const r = maxR * shell * scallop;
      const jitter = 0.84 + rnd() * 0.26;

      const x = Math.cos(angle) * r * jitter;
      const z = Math.sin(angle) * r * jitter;
      const yy = y + (rnd() - 0.5) * 0.12;

      let col;
      let size;
      let alpha;
      if (kind === 'bulb') {
        col = pickColor([4, 3, 5, 0, 4, 3][Math.floor(rnd() * 6)]);
        size = 0.16 + rnd() * 0.12;
        alpha = 0.95;
      } else if (kind === 'garland') {
        col = pickColor(rnd() < 0.7 ? 0 : rnd() < 0.55 ? 1 : rnd() < 0.6 ? 3 : 4);
        size = 0.075 + rnd() * 0.065;
        alpha = 0.8 + rnd() * 0.2;
      } else if (kind === 'rim') {
        col = pickColor(rnd() < 0.62 ? 0 : rnd() < 0.6 ? 1 : 3);
        size = 0.05 + rnd() * 0.05;
        alpha = 0.6 + rnd() * 0.4;
      } else if (kind === 'sparkle') {
        col = pickColor(rnd() < 0.55 ? 0 : rnd() < 0.6 ? 1 : rnd() < 0.55 ? 2 : 3);
        size = 0.045 + rnd() * 0.05;
        alpha = 0.42 + rnd() * 0.34;
      } else {
        col = pickColor(rnd() < 0.7 ? 0 : rnd() < 0.7 ? 1 : 3);
        size = 0.026 + rnd() * 0.038;
        alpha = 0.11 + rnd() * 0.18;
      }
      const delay = clamp((1 - yFrac) * 0.55 + rnd() * 0.22, 0, 0.95);

      write(i, x, yy, z, col, size, alpha, delay);
    }

    // ---- 树干 ----
    for (let k = 0; k < nTrunk && i < total; k++, i++) {
      const y = rnd() * trunkTop;
      const a = rnd() * Math.PI * 2;
      const r = 0.16 + rnd() * 0.1;
      const col = pickColor(rnd() < 0.4 ? 3 : 1);
      write(i, Math.cos(a) * r, y, Math.sin(a) * r, col, 0.04 + rnd() * 0.04, 0.4, 0.02 + rnd() * 0.2);
    }

    // ---- 地面雪堆：薄薄一层发光的积雪 ----
    for (let k = 0; k < nGround && i < total; k++, i++) {
      const clump = Math.floor(rnd() * 9);
      const a = (clump / 9) * Math.PI * 2 + (rnd() - 0.5) * 0.75;
      const rr = 1.1 + Math.pow(rnd(), 0.65) * 4.1;
      const x = Math.cos(a) * rr;
      const z = Math.sin(a) * rr * 0.58;
      const y = 0.01 + Math.pow(rnd(), 2) * 0.42;
      const col = pickColor(rnd() < 0.55 ? 2 : rnd() < 0.6 ? 0 : 1);
      write(i, x, y, z, col, 0.035 + rnd() * 0.07, 0.16 + rnd() * 0.38, 0.04 + rnd() * 0.14);
    }

    // ---- 周围飘浮星尘 ----
    for (let k = 0; k < nDust && i < total; k++, i++) {
      const a = rnd() * Math.PI * 2;
      const rr = 1.5 + rnd() * 7.5;
      const x = Math.cos(a) * rr;
      const z = Math.sin(a) * rr;
      const y = rnd() * 9.5;
      const col = pickColor(undefined);
      write(i, x, y, z, col, 0.03 + rnd() * 0.07, 0.1 + rnd() * 0.3, rnd() * 0.6);
    }

    // ---- 散开目标位置 ----
    for (let k = 0; k < total; k++) {
      const a = rnd() * Math.PI * 2;
      const r = 3.2 + Math.pow(rnd(), 0.6) * 10.5;
      scatter[k * 3] = Math.cos(a) * r * (0.8 + rnd() * 0.5);
      scatter[k * 3 + 1] = 1.1 + rnd() * 10.2;
      scatter[k * 3 + 2] = Math.sin(a) * r * (0.8 + rnd() * 0.5);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    geo.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1));

    this.geometry = geo;
    this._posAttr = geo.getAttribute('position');
    this._colorAttr = geo.getAttribute('aColor');
    this.treePos = treePos;
    this.scatterPos = scatter;
    this.colors = colors;
    this.targetColors = targetColors;
    this.delays = delays;
    this.seeds = seeds;
    this.total = total;

    const material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 2) },
        uAudio: { value: 0 },
        uSize: { value: 1 },
        uScale: { value: 1 },
        uOpacity: { value: 0.95 }
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending
    });

    this.points = new THREE.Points(geo, material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
    this.material = material;
    this.inner.add(this.points);
  }

  _buildBody() {
    // 半透明的树体：让星光有依托，也让背后的星空稍微退后
    const geo = new THREE.ConeGeometry(TREE.radius * 0.985, TREE.height, 56, 1, true);
    geo.translate(0, TREE.height / 2, 0);
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTop: { value: new THREE.Color('#02060b') },
        uBottom: { value: new THREE.Color('#0a1a1a') },
        uOpacity: { value: 0.72 }
      },
      vertexShader: /* glsl */ `
        varying float vY;
        void main() {
          vY = clamp(position.y / ${TREE.height.toFixed(3)}, 0.0, 1.0);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uTop;
        uniform vec3 uBottom;
        uniform float uOpacity;
        varying float vY;
        void main() {
          vec3 col = mix(uBottom, uTop, vY);
          float tiers = 0.74 + 0.26 * smoothstep(0.0, 0.45, abs(sin(vY * 3.14159 * 6.5)));
          float baseFade = smoothstep(0.0, 0.05, vY) * (1.0 - smoothstep(0.93, 1.0, vY));
          float a = mix(0.85, 0.1, pow(vY, 0.6)) * baseFade * tiers;
          gl_FragColor = vec4(col, a * uOpacity);
        }
      `,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    this.body = new THREE.Mesh(geo, mat);
    this.body.position.y = 0.62;
    this.body.renderOrder = 0;
    this.inner.add(this.body);

    // 树底的暖光，给深色树体一点点体积感
    const glowTex = new THREE.CanvasTexture(radialGroundTexture(256));
    glowTex.colorSpace = THREE.SRGBColorSpace;
    const baseGlow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTex,
        color: new THREE.Color(this.palette.accent),
        transparent: true,
        opacity: 0.28,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false
      })
    );
    baseGlow.position.set(0, 1.1, 0);
    baseGlow.scale.set(7.5, 7.5, 1);
    baseGlow.renderOrder = 1;
    this.baseGlow = baseGlow;
    this.inner.add(baseGlow);
  }

  _buildStar() {
    const tex = new THREE.CanvasTexture(starTexture(256));
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.SpriteMaterial({
      map: tex,
      color: new THREE.Color(this.palette.star),
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      depthTest: false
    });
    this.star = new THREE.Sprite(mat);
    this.star.position.set(0, TREE.height + 1.05, 0);
    this.star.scale.setScalar(1.65);
    this.star.renderOrder = 4;
    this.inner.add(this.star);

    // 星芒光晕用柔和的径向光斑，而不是再叠一颗星星
    const haloTex = new THREE.CanvasTexture(radialGroundTexture(256));
    haloTex.colorSpace = THREE.SRGBColorSpace;
    const glowMat = new THREE.SpriteMaterial({
      map: haloTex,
      color: new THREE.Color(this.palette.star),
      blending: THREE.AdditiveBlending,
      transparent: true,
      opacity: 0.28,
      depthWrite: false,
      depthTest: false
    });
    this.starGlow = new THREE.Sprite(glowMat);
    this.starGlow.position.copy(this.star.position);
    this.starGlow.scale.setScalar(5.2);
    this.starGlow.renderOrder = 2;
    this.inner.add(this.starGlow);

    this.starLight = new THREE.PointLight(new THREE.Color(this.palette.star), 14, 18, 2);
    this.starLight.position.copy(this.star.position);
    this.inner.add(this.starLight);
  }

  _buildGround() {
    const tex = new THREE.CanvasTexture(radialGroundTexture(512));
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      color: new THREE.Color(this.palette.accent),
      transparent: true,
      opacity: 0.2,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    this.groundGlow = new THREE.Mesh(new THREE.PlaneGeometry(11, 11), mat);
    this.groundGlow.rotation.x = -Math.PI / 2;
    this.groundGlow.position.y = 0.005;
    this.groundGlow.renderOrder = 1;
    this.group.add(this.groundGlow);
  }

  _buildEmbers() {
    const n = Math.round(320 * this.quality);
    const positions = new Float32Array(n * 3);
    const colors = new Float32Array(n * 3);
    const speeds = new Float32Array(n);
    const phases = new Float32Array(n);
    const sizes = new Float32Array(n);
    const pool = this.palette.colors.map((hex) => hexToRgb(hex));

    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 1.2 + Math.random() * 7.5;
      positions[i * 3] = Math.cos(a) * r;
      positions[i * 3 + 1] = Math.random() * 11;
      positions[i * 3 + 2] = Math.sin(a) * r;
      const c = pool[Math.floor(Math.random() * Math.min(4, pool.length))];
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
      speeds[i] = 0.12 + Math.random() * 0.5;
      phases[i] = Math.random();
      sizes[i] = 0.16 + Math.random() * 0.5;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('aSpeed', new THREE.BufferAttribute(speeds, 1));
    geo.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
    geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 2) },
        uAudio: { value: 0 }
      },
      vertexShader: EMBER_VERT,
      fragmentShader: EMBER_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });

    this.embers = new THREE.Points(geo, mat);
    this.embers.frustumCulled = false;
    this.embers.renderOrder = 2;
    this.group.add(this.embers);
  }

  _disposePoints() {
    if (!this.points) return;
    this.inner.remove(this.points);
    this.points.geometry.dispose();
    this.points.material.dispose();
    this.points = null;
  }

  /* ------------------------------------------------------------
     对外接口
     ------------------------------------------------------------ */
  setPalette(name) {
    const palette = PALETTES[name];
    if (!palette) return;
    this.paletteName = name;
    this.palette = palette;

    const colorPool = palette.colors.map((hex) => hexToRgb(hex));
    const weights = palette.weights;
    const rnd = mulberry32(9137);
    const pick = () => {
      let r = rnd();
      for (let i = 0; i < weights.length; i++) {
        r -= weights[i];
        if (r <= 0) return colorPool[i];
      }
      return colorPool[0];
    };

    const n = this.total;
    for (let i = 0; i < n; i++) {
      const c = pick();
      this.targetColors[i * 3] = c.r;
      this.targetColors[i * 3 + 1] = c.g;
      this.targetColors[i * 3 + 2] = c.b;
    }
    this._colorLerp = true;

    if (this.star) this.star.material.color.set(palette.star);
    if (this.starGlow) this.starGlow.material.color.set(palette.star);
    if (this.starLight) this.starLight.color.set(palette.star);
    if (this.groundGlow) this.groundGlow.material.color.set(palette.accent);
    if (this.baseGlow) this.baseGlow.material.color.set(palette.accent);
    if (this.embers) {
      const arr = this.embers.geometry.getAttribute('aColor');
      const pool = palette.colors.map((hex) => hexToRgb(hex));
      for (let i = 0; i < arr.count; i++) {
        const c = pool[Math.floor(Math.random() * Math.min(4, pool.length))];
        arr.setXYZ(i, c.r, c.g, c.b);
      }
      arr.needsUpdate = true;
    }
    this.flash = 1;
  }

  setCount(count) {
    if (count === this.count) return;
    this.count = count;
    this._build();
  }

  setGlow(v) {
    this.glow = v;
    if (this.material) this.material.uniforms.uOpacity.value = 0.85 + v * 0.55;
    if (this.starGlow) this.starGlow.material.opacity = 0.14 + v * 0.28;
    if (this.groundGlow) this.groundGlow.material.opacity = 0.16 + v * 0.32;
  }

  setAssembled(on) {
    this.target = on ? 1 : 0;
  }

  pulse(strength = 1) {
    this.impulse = Math.max(this.impulse, strength);
    this.flash = Math.max(this.flash, 0.8 * strength);
  }

  setHand(x, y) {
    this.hand.set(clamp(x, -1, 1), clamp(y, -1, 1));
  }

  setSpin(delta) {
    this.userSpin += delta;
  }

  /* ------------------------------------------------------------
     每帧
     ------------------------------------------------------------ */
  update(dt, time, audio = { energy: 0, bass: 0, treble: 0 }) {
    this.time = time;
    this.audioEnergy = damp(this.audioEnergy, audio.energy || 0, 8, dt);
    this.impulse = Math.max(0, this.impulse - dt * 2.2);
    this.flash = Math.max(0, this.flash - dt * 1.4);

    const target = this.target;
    this.assemble = damp(this.assemble, target, 2.6, dt);
    if (Math.abs(this.assemble - target) < 0.0015) this.assemble = target;

    const a = this.assemble;
    const positions = this._posAttr.array;
    const n = this.total;
    const treePos = this.treePos;
    const scatter = this.scatterPos;
    const delays = this.delays;
    const seeds = this.seeds;
    const t = this.time;

    const breathe = 1 + this.audioEnergy * 0.04 + Math.sin(t * 0.6) * 0.004;
    this.inner.scale.set(breathe, 1 + this.audioEnergy * 0.025, breathe);

    if (this.body) {
      this.body.material.uniforms.uOpacity.value = 0.62 * smoothstep(0.08, 0.72, a);
    }
    if (this.baseGlow) {
      this.baseGlow.material.opacity = (0.07 + this.audioEnergy * 0.08) * a;
    }

    const needUpdate = Math.abs(a - (this._lastAssemble ?? -1)) > 0.0008 || this.audioEnergy > 0.001;
    if (needUpdate) {
      for (let i = 0; i < n; i++) {
        const p = i * 3;
        const d = delays[i];
        const local = smoothstep(d, d + 0.42, a);
        const inv = 1 - local;

        const sx = scatter[p] + Math.sin(t * 0.32 + seeds[i] * 22) * 0.55;
        const sy = scatter[p + 1] + Math.sin(t * 0.27 + seeds[i] * 13) * 0.5;
        const sz = scatter[p + 2] + Math.cos(t * 0.29 + seeds[i] * 18) * 0.55;

        positions[p] = treePos[p] * local + sx * inv;
        positions[p + 1] = treePos[p + 1] * local + sy * inv;
        positions[p + 2] = treePos[p + 2] * local + sz * inv;
      }
      this._posAttr.needsUpdate = true;
      this._lastAssemble = a;
    }

    // 颜色过渡
    const colorAttr = this._colorAttr;
    if (this._colorLerp) {
      const src = colorAttr.array;
      const dst = this.targetColors;
      let diff = 0;
      for (let i = 0; i < src.length; i++) {
        const v = src[i] + (dst[i] - src[i]) * Math.min(1, dt * 4.5);
        diff += Math.abs(v - src[i]);
        src[i] = v;
      }
      if (diff > 0.0004) {
        colorAttr.needsUpdate = true;
      } else {
        this._colorLerp = false;
      }
    }

    // 旋转与倾斜：手势、指针与自动旋转叠加
    this.spin += this.baseSpinSpeed * dt * (1 + this.audioEnergy * 0.8);
    const tiltX = this.hand.y * 0.075 + this.tilt.x;
    const tiltZ = -this.hand.x * 0.09 + this.tilt.y;
    this.group.rotation.y = this.spin + this.userSpin * 0.6;
    this.group.rotation.x = damp(this.group.rotation.x, tiltX, 3, dt);
    this.group.rotation.z = damp(this.group.rotation.z, tiltZ, 3, dt);

    // 星星
    const pulseScale = 1.62 + this.audioEnergy * 0.38 + this.impulse * 0.7 + Math.sin(t * 1.3) * 0.04;
    this.star.scale.setScalar(pulseScale);
    this.star.material.rotation += dt * 0.12;
    this.starGlow.scale.setScalar(pulseScale * 3.1 + this.audioEnergy * 1.1);
    this.starGlow.material.opacity = 0.2 + this.audioEnergy * 0.24 + this.impulse * 0.2;
    this.starLight.intensity = 10 + this.audioEnergy * 26 + this.impulse * 30;

    // 地面光池随节拍扩散
    const gs = 1 + this.audioEnergy * 0.16 + this.impulse * 0.1;
    this.groundGlow.scale.set(gs, gs, gs);

    // 材质 uniform
    this.material.uniforms.uTime.value = t;
    this.material.uniforms.uAudio.value = this.audioEnergy;
    this.material.uniforms.uSize.value = 1.32 + this.audioEnergy * 0.2 + this.impulse * 0.28;
  }

  resize(rendererHeight) {
    const pr = Math.min(window.devicePixelRatio || 1, 2);
    this.material.uniforms.uPixelRatio.value = pr * (rendererHeight / 900);
  }
}
