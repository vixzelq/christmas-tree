/* 2D 飘雪：轻盈、分层、可调密度 */

import { rand, glowTexture, isMobile } from './utils.js';

export class Snowfall {
  constructor(canvas, { density = 50 } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.density = density;
    this.flakes = [];
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = 0;
    this.height = 0;
    this.time = 0;
    this.enabled = true;

    this.sprite = this._makeSprite();
    this._resize();
    this._populate();
    window.addEventListener('resize', () => this._resize());
  }

  _makeSprite() {
    const size = 64;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.32, 'rgba(240,248,255,.85)');
    g.addColorStop(0.7, 'rgba(220,238,255,.22)');
    g.addColorStop(1, 'rgba(220,238,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    return c;
  }

  _resize() {
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.canvas.width = Math.floor(this.width * this.dpr);
    this.canvas.height = Math.floor(this.height * this.dpr);
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  _targetCount() {
    const base = isMobile() ? 260 : 430;
    return Math.round((this.density / 100) * base);
  }

  _makeFlake() {
    const depth = Math.random();
    return {
      x: Math.random() * this.width,
      y: Math.random() * this.height,
      r: 0.75 + depth * 2.1,
      vy: 9 + depth * 32,
      vx: -5 + Math.random() * 10,
      phase: rand(0, Math.PI * 2),
      alpha: 0.24 + depth * 0.46,
      depth
    };
  }

  _populate() {
    const target = this._targetCount();
    while (this.flakes.length < target) this.flakes.push(this._makeFlake());
    if (this.flakes.length > target) this.flakes.length = target;
  }

  setDensity(density) {
    this.density = density;
    this._populate();
  }

  setEnabled(on) {
    this.enabled = !!on;
    if (!this.enabled) {
      this.ctx.clearRect(0, 0, this.width, this.height);
    }
  }

  update(dt) {
    if (!this.enabled) return;
    this.time += dt;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, this.height);
    ctx.globalCompositeOperation = 'lighter';

    const target = this._targetCount();
    if (Math.abs(this.flakes.length - target) > 4) this._populate();

    for (const f of this.flakes) {
      f.y += f.vy * dt;
      f.x += (f.vx + Math.sin(this.time * 0.6 + f.phase) * 8 * f.depth) * dt;

      if (f.y > this.height + 8) {
        f.y = -8;
        f.x = Math.random() * this.width;
      }
      if (f.x < -10) f.x = this.width + 10;
      if (f.x > this.width + 10) f.x = -10;

      const size = f.r * 5.6;
      ctx.globalAlpha = f.alpha * (0.8 + 0.2 * Math.sin(this.time * 1.3 + f.phase));
      ctx.drawImage(this.sprite, f.x - size / 2, f.y - size / 2, size, size);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }
}
