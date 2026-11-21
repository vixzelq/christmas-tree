/* 挂在树上的照片卡片：3D 投影定位 + 捏指弹出 */

import * as THREE from '../vendor/three/build/three.module.js';
import { clamp } from './utils.js';
import { CAPTIONS } from './config.js';

const GOLDEN = Math.PI * (3 - Math.sqrt(5));

export class PhotoLayer {
  constructor({ layer, stage, stageImage, stageCaption, camera, tree, onOpen, onClose, onNext } = {}) {
    this.layer = layer;
    this.stage = stage;
    this.stageImage = stageImage;
    this.stageCaption = stageCaption;
    this.camera = camera;
    this.tree = tree;
    this.onOpen = onOpen;
    this.onClose = onClose;
    this.onNext = onNext;

    this.items = [];
    this.frame = 'polaroid';
    this.openIndex = -1;
    this.isOpen = false;
    this.autoCloseMs = 5200;
    this._autoTimer = null;
    this._vec = new THREE.Vector3();
    this._lastW = window.innerWidth;
    this._lastH = window.innerHeight;

    if (this.stage) {
      this.stage.addEventListener('click', () => this.close());
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && this.isOpen) this.close();
      });
    }
    window.addEventListener('resize', () => this._layout());
  }

  setFrame(frame) {
    this.frame = frame;
    if (this.layer) this.layer.dataset.frame = frame;
    if (this.stage) this.stage.dataset.frame = frame;
  }

  setPhotos(records) {
    this.clear();
    this.records = records;
    this._buildChips();
  }

  _buildChips() {
    const n = this.records.length || 1;
    this.records.forEach((record, i) => {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'photo-chip';
      el.dataset.id = record.id;
      el.setAttribute('aria-label', `查看照片 ${i + 1}`);
      el.innerHTML = `<span class="photo-chip__frame"><img alt="" loading="lazy" /></span>
        <span class="photo-chip__caption"></span>`;
      const img = el.querySelector('img');
      img.src = record.thumbUrl || record.url;
      const caption = el.querySelector('.photo-chip__caption');
      const text = record.caption || CAPTIONS[i % CAPTIONS.length];
      caption.textContent = text;

      // 分布：螺旋挂在树身周围
      const height = 1.9 + (i / Math.max(1, n - 1)) * 4.4;
      const fade = 1 - (height - 1.9) / 5.6;
      const radius = 3.0 + fade * 1.2 + (i % 3) * 0.22;
      const angle = i * GOLDEN + 0.8;
      const anchor = new THREE.Vector3(Math.cos(angle) * radius, height, Math.sin(angle) * radius);
      const drift = new THREE.Vector3(
        Math.cos(angle) * (2.2 + (i % 4) * 0.8),
        1.6 + (i % 5) * 0.9,
        Math.sin(angle) * (2.2 + (i % 3) * 0.9)
      );

      const item = {
        id: record.id,
        record,
        el,
        img,
        caption: text,
        anchor,
        drift,
        width: 92 + ((i * 7) % 26),
        phase: (i * 1.7) % (Math.PI * 2),
        speed: 0.6 + ((i * 3) % 5) * 0.12,
        tilt: (((i * 13) % 14) - 7) * 0.9,
        appear: -0.12 * i,
        visible: false
      };
      el.style.width = `${item.width}px`;
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        this.open(i);
      });
      this.layer.appendChild(el);
      this.items.push(item);
    });
    requestAnimationFrame(() => {
      for (const item of this.items) item.el.classList.add('is-visible');
    });
    this._layout();
  }

  _layout() {
    this._lastW = window.innerWidth;
    this._lastH = window.innerHeight;
  }

  clear() {
    for (const item of this.items) item.el.remove();
    this.items = [];
    this.records = [];
    this.close(true);
  }

  add(record) {
    // 重新排布全部卡片，保持视觉平衡
    const records = [...(this.records || []), record];
    this.setPhotos(records);
  }

  removeById(id) {
    const records = (this.records || []).filter((r) => r.id !== id);
    this.setPhotos(records);
  }

  setHidden(hidden) {
    for (const item of this.items) item.el.classList.toggle('is-hidden', hidden);
  }

  get count() {
    return this.items.length;
  }

  /** 找出离光标最近、并且当前可见的照片卡片 */
  findNearest(x, y, maxDistance = 240) {
    let best = null;
    for (let i = 0; i < this.items.length; i++) {
      const item = this.items[i];
      if (!item.screenVisible) continue;
      const d = Math.hypot(item.screenX - x, item.screenY - y);
      if (d <= maxDistance && (!best || d < best.distance)) {
        best = { index: i, distance: d, item };
      }
    }
    return best;
  }

  highlight(index = -1) {
    for (let i = 0; i < this.items.length; i++) {
      this.items[i].el.classList.toggle('is-target', i === index);
    }
    this.highlightIndex = index;
  }

  open(index = null, options = {}) {
    if (!this.items.length) return false;
    let idx = index;
    if (idx === null || idx === undefined) {
      idx = (this.openIndex + 1) % this.items.length;
    }
    idx = clamp(idx, 0, this.items.length - 1);
    this.openIndex = idx;
    const item = this.items[idx];
    this.stage.hidden = false;
    this.stage.dataset.frame = this.frame;
    this.stageImage.src = item.record.url;
    this.stageImage.alt = item.caption || '圣诞照片';
    this.stageCaption.textContent = item.caption || 'Merry Christmas';
    this.setHidden(true);
    this.highlight(-1);

    const card = this.stage.querySelector('.pop-card');
    const origin = options.origin;
    if (card && origin) {
      // 从光标指向的照片位置「飞」到屏幕中央
      card.style.transition = 'none';
      this.stage.classList.add('is-open');
      const w = window.innerWidth;
      const h = window.innerHeight;
      const dx = origin.x - w / 2;
      const dy = origin.y - h / 2;
      const scale = clamp(origin.scale || 0.3, 0.16, 0.55);
      card
        .animate(
          [
            { transform: `translate(${dx}px, ${dy}px) scale(${scale}) rotate(-5deg)`, opacity: 0.25 },
            { transform: 'translate(0px, 0px) scale(1) rotate(0deg)', opacity: 1 }
          ],
          { duration: 780, easing: 'cubic-bezier(.2,.85,.3,1)', fill: 'none' }
        )
        .finished.finally(() => {
          card.style.transition = '';
        });
    } else {
      requestAnimationFrame(() => this.stage.classList.add('is-open'));
    }
    this.isOpen = true;
    this.onOpen?.(item.record, idx);
    if (this._autoTimer) clearTimeout(this._autoTimer);
    this._autoTimer = setTimeout(() => {
      if (this.isOpen) this.close();
    }, this.autoCloseMs);
    return true;
  }

  next() {
    if (!this.items.length) return false;
    const idx = (this.openIndex + 1) % this.items.length;
    this.openIndex = idx;
    const item = this.items[idx];
    const card = this.stage.querySelector('.pop-card');
    card?.classList.add('is-leaving');
    setTimeout(() => {
      this.stageImage.src = item.record.url;
      this.stageCaption.textContent = item.caption || 'Merry Christmas';
      card?.classList.remove('is-leaving');
      this.onNext?.(item.record, idx);
    }, 220);
    return true;
  }

  close(immediate = false) {
    if (!this.isOpen && !immediate) return;
    if (this._autoTimer) {
      clearTimeout(this._autoTimer);
      this._autoTimer = null;
    }
    this.isOpen = false;
    this.openIndex = -1;
    this.stage.classList.remove('is-open');
    this.setHidden(false);
    this.highlight(-1);
    const hide = () => {
      this.stage.hidden = true;
    };
    if (immediate) hide();
    else setTimeout(hide, 420);
    this.onClose?.();
  }

  update(dt, time, assemble = 1) {
    if (!this.items.length) return;
    const camera = this.camera;
    const tree = this.tree;
    const w = this._lastW;
    const h = this._lastH;
    if (!camera || !tree) return;

    const centerX = w / 2;
    for (let i = 0; i < this.items.length; i++) {
      const item = this.items[i];
      const float = Math.sin(time * item.speed + item.phase) * 0.08;
      const scatterT = 1 - assemble;

      this._vec.copy(item.anchor);
      this._vec.y += float;
      this._vec.x += item.drift.x * scatterT * 0.7;
      this._vec.y += item.drift.y * scatterT * 0.9;
      this._vec.z += item.drift.z * scatterT * 0.7;
      this._vec.applyMatrix4(tree.group.matrixWorld);

      const dist = this._vec.distanceTo(camera.position);
      this._vec.project(camera);

      const behind = this._vec.z > 1 || this._vec.z < -1;
      if (behind) {
        item.el.style.opacity = '0';
        item.screenVisible = false;
        continue;
      }

      const x = (this._vec.x * 0.5 + 0.5) * w;
      const y = (-this._vec.y * 0.5 + 0.5) * h;
      const depthScale = clamp(13 / Math.max(5, dist), 0.55, 1.02);
      const sway = Math.sin(time * 0.5 + item.phase) * 1.4;
      const rotate = item.tilt + (x - centerX) * 0.012;
      const targetOpacity = clamp(1.35 - dist / 26, 0.35, 1);

      item.appear = Math.min(1, item.appear + dt * 1.4);
      const at = clamp(item.appear);
      const fadeIn = at * at * (3 - 2 * at);

      item.screenX = x;
      item.screenY = y;
      item.screenScale = depthScale;
      item.screenVisible = fadeIn > 0.35;

      item.el.style.transform =
        `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -50%) ` +
        `scale(${depthScale.toFixed(3)}) rotate(${(rotate + sway).toFixed(2)}deg)`;
      item.el.style.opacity = (targetOpacity * fadeIn).toFixed(3);
      item.el.style.zIndex = String(Math.round(100 - dist));
    }
  }
}
