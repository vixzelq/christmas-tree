/* 礼盒：圆角盒子 + 缎带 + 蝴蝶结，随鼓点轻跳 */

import * as THREE from '../vendor/three/build/three.module.js';
import { RoundedBoxGeometry } from '../vendor/three/addons/geometries/RoundedBoxGeometry.js';
import { GIFT_STYLES } from './config.js';
import { rand, damp, radialGroundTexture } from './utils.js';

export class GiftBoxes {
  constructor(scene, { style = 'classic', count = 7 } = {}) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.position.y = 0;
    scene.add(this.group);
    this.styleName = style;
    this.style = GIFT_STYLES[style] || GIFT_STYLES.classic;
    this.count = count;
    this.boxes = [];
    this._build();
  }

  _build() {
    this.group.clear();
    this.boxes = [];
    const style = this.style;
    const colors = [style.box, style.boxDeep];

    if (!this.glowTex) {
      this.glowTex = new THREE.CanvasTexture(radialGroundTexture(128));
      this.glowTex.colorSpace = THREE.SRGBColorSpace;
    }

    // 全部摆在树的前半圈，让礼盒的底部与地面光晕都看得见
    const layout = [
      { a: 0.45, r: 3.4, s: 0.72 },
      { a: 0.9, r: 3.95, s: 0.55 },
      { a: 1.28, r: 3.25, s: 0.9 },
      { a: 1.74, r: 3.6, s: 0.62 },
      { a: 2.14, r: 3.2, s: 0.8 },
      { a: 2.52, r: 3.9, s: 0.56 },
      { a: 2.92, r: 3.45, s: 0.7 },
      { a: 3.3, r: 4.0, s: 0.5 }
    ].slice(0, this.count);

    for (let i = 0; i < layout.length; i++) {
      const cfg = layout[i];
      const size = cfg.s;
      const holder = new THREE.Group();
      holder.position.set(Math.cos(cfg.a) * cfg.r, 0, Math.sin(cfg.a) * cfg.r * 0.85);
      holder.rotation.y = -cfg.a + rand(-0.35, 0.35);

      const boxMat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(i % 3 === 2 ? colors[1] : colors[0]),
        roughness: 0.55,
        metalness: 0.12,
        emissive: new THREE.Color(style.glow),
        emissiveIntensity: 0.025
      });

      const ribbonMat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(style.ribbon),
        roughness: 0.32,
        metalness: 0.6,
        emissive: new THREE.Color(style.ribbon),
        emissiveIntensity: 0.09
      });

      const body = new THREE.Mesh(new RoundedBoxGeometry(size, size * 0.82, size, 4, size * 0.06), boxMat);
      body.position.y = size * 0.41;
      body.castShadow = false;
      holder.add(body);

      const lid = new THREE.Mesh(
        new RoundedBoxGeometry(size * 1.08, size * 0.18, size * 1.08, 4, size * 0.05),
        boxMat
      );
      lid.position.y = size * 0.82;
      holder.add(lid);

      // 交叉缎带
      const ribbonA = new THREE.Mesh(new THREE.BoxGeometry(size * 0.16, size * 1.02, size * 1.09), ribbonMat);
      ribbonA.position.y = size * 0.41;
      holder.add(ribbonA);

      const ribbonB = new THREE.Mesh(new THREE.BoxGeometry(size * 1.09, size * 1.02, size * 0.16), ribbonMat);
      ribbonB.position.y = size * 0.41;
      holder.add(ribbonB);

      // 蝴蝶结
      const bow = new THREE.Group();
      const loopGeo = new THREE.TorusGeometry(size * 0.2, size * 0.055, 8, 20);
      const loopL = new THREE.Mesh(loopGeo, ribbonMat);
      loopL.rotation.set(Math.PI / 2, 0, Math.PI / 4);
      loopL.position.set(-size * 0.16, size * 0.94, 0);
      loopL.scale.set(1, 1, 0.7);
      bow.add(loopL);
      const loopR = loopL.clone();
      loopR.position.x = size * 0.16;
      loopR.rotation.z = -Math.PI / 4;
      bow.add(loopR);
      const knot = new THREE.Mesh(new THREE.SphereGeometry(size * 0.075, 10, 10), ribbonMat);
      knot.position.y = size * 0.94;
      bow.add(knot);
      holder.add(bow);

      holder.userData = {
        baseY: 0,
        phase: rand(0, Math.PI * 2),
        speed: rand(0.5, 0.9),
        squash: 0,
        size,
        boxMat,
        ribbonMat
      };

      // 接触光晕：让礼盒稳稳落在地面上
      const halo = new THREE.Mesh(
        new THREE.PlaneGeometry(size * 3.4, size * 3.4),
        new THREE.MeshBasicMaterial({
          map: this.glowTex,
          color: new THREE.Color(style.glow),
          transparent: true,
          opacity: 0.26,
          blending: THREE.AdditiveBlending,
          depthWrite: false
        })
      );
      halo.rotation.x = -Math.PI / 2;
      halo.position.set(holder.position.x, 0.02, holder.position.z);
      halo.renderOrder = 1;
      holder.userData.halo = halo;

      this.group.add(holder);
      this.group.add(halo);
      this.boxes.push(holder);
    }
  }

  setStyle(name) {
    const style = GIFT_STYLES[name];
    if (!style || name === this.styleName) return;
    this.styleName = name;
    this.style = style;
    const colors = [style.box, style.boxDeep];
    this.boxes.forEach((holder, i) => {
      const { boxMat, ribbonMat, halo } = holder.userData;
      boxMat.color.set(i % 3 === 2 ? colors[1] : colors[0]);
      boxMat.emissive.set(style.glow);
      ribbonMat.color.set(style.ribbon);
      ribbonMat.emissive.set(style.ribbon);
      halo?.material.color.set(style.glow);
    });
  }

  /** 鼓点时轻轻一跳 */
  bounce(strength = 1) {
    for (const holder of this.boxes) {
      holder.userData.squash = Math.max(holder.userData.squash, 0.5 + Math.random() * 0.5 * strength);
    }
  }

  update(dt, time, audio = { energy: 0, beat: 0 }) {
    const energy = audio.energy || 0;
    for (const holder of this.boxes) {
      const d = holder.userData;
      d.squash = Math.max(0, d.squash - dt * 3.2);
      const bob = Math.sin(time * d.speed + d.phase) * 0.02 + d.squash * 0.12;
      holder.position.y = d.baseY + bob + energy * 0.05;
      const pop = 1 + d.squash * 0.06;
      holder.scale.set(pop, 1 - d.squash * 0.04 + energy * 0.02, pop);
      holder.rotation.y += dt * 0.04 * Math.sin(time * 0.3 + d.phase);
    }
  }
}
