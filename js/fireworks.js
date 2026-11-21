/* 2D 烟花：火箭升空 + 星火炸开，透明画布上叠加 */

import { rand, clamp } from './utils.js';

const COLORS = ['#ffd98a', '#ffe9c4', '#ff7a8a', '#7cf2d4', '#9fb4ff', '#ffffff', '#ffb15a'];

export class Fireworks {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas ? canvas.getContext('2d') : null;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = 0;
    this.height = 0;
    this.active = false;
    this.sparks = [];
    this.rockets = [];
    this.nextLaunch = 0;
    this.time = 0;
    this.maxSparks = 1600;
    this._resize();
    window.addEventListener('resize', () => this._resize());
  }

  _resize() {
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    if (!this.canvas) return;
    this.canvas.width = Math.floor(this.width * this.dpr);
    this.canvas.height = Math.floor(this.height * this.dpr);
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  setActive(active) {
    this.active = active;
    if (active) {
      this.nextLaunch = 0.05;
      setTimeout(() => {
        if (!this.active) return;
        this.burst(rand(this.width * 0.2, this.width * 0.8), rand(this.height * 0.15, this.height * 0.4), null, 130);
      }, 150);
    } else {
      this.sparks.length = 0;
      this.rockets.length = 0;
      this._clear();
    }
  }

  _clear() {
    if (!this.ctx) return;
    this.ctx.clearRect(0, 0, this.width, this.height);
  }

  _launch() {
    const x = rand(this.width * 0.12, this.width * 0.88);
    const targetY = rand(this.height * 0.08, this.height * 0.42);
    this.rockets.push({
      x,
      y: this.height + 10,
      vx: rand(-24, 24),
      vy: -rand(520, 700),
      targetY,
      color: COLORS[Math.floor(Math.random() * COLORS.length)]
    });
  }

  burst(x, y, color, count = 140) {
    const base = color || COLORS[Math.floor(Math.random() * COLORS.length)];
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = rand(60, 340) * (Math.random() < 0.15 ? 0.4 : 1);
      const hueShift = Math.random() < 0.3;
      this.sparks.push({
        x,
        y,
        px: x,
        py: y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 20,
        life: rand(0.9, 1.9),
        maxLife: 1.9,
        color: hueShift ? COLORS[Math.floor(Math.random() * COLORS.length)] : base,
        width: rand(1.2, 2.8)
      });
    }
    if (this.sparks.length > this.maxSparks) this.sparks.splice(0, this.sparks.length - this.maxSparks);
  }

  update(dt) {
    if (!this.ctx) return;
    this.time += dt;

    if (this.active && this.time > this.nextLaunch) {
      this._launch();
      if (Math.random() < 0.45) setTimeout(() => this.active && this._launch(), 180);
      this.nextLaunch = this.time + rand(0.35, 0.8);
    }

    // 用 destination-out 淡出上一帧，保留拖尾又不会遮住背景
    this.ctx.globalCompositeOperation = 'destination-out';
    this.ctx.fillStyle = 'rgba(0,0,0,0.22)';
    this.ctx.fillRect(0, 0, this.width, this.height);
    this.ctx.globalCompositeOperation = 'lighter';

    // 火箭
    for (let i = this.rockets.length - 1; i >= 0; i--) {
      const r = this.rockets[i];
      r.x += r.vx * dt;
      r.y += r.vy * dt;
      r.vy += 220 * dt;
      this.ctx.beginPath();
      this.ctx.strokeStyle = r.color;
      this.ctx.lineWidth = 1.8;
      this.ctx.moveTo(r.x, r.y);
      this.ctx.lineTo(r.x - r.vx * 0.02, r.y - r.vy * 0.02);
      this.ctx.stroke();
      if (r.y <= r.targetY || r.vy >= 0) {
        this.burst(r.x, r.y, r.color, 150);
        this.rockets.splice(i, 1);
      }
    }

    // 星火
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i];
      s.life -= dt;
      if (s.life <= 0) {
        this.sparks.splice(i, 1);
        continue;
      }
      s.px = s.x;
      s.py = s.y;
      s.vy += 120 * dt;
      s.vx *= 0.985;
      s.vy *= 0.985;
      s.x += s.vx * dt;
      s.y += s.vy * dt;

      const alpha = clamp(s.life / s.maxLife) ** 0.7;
      this.ctx.strokeStyle = s.color;
      this.ctx.globalAlpha = alpha;
      this.ctx.lineWidth = s.width;
      this.ctx.beginPath();
      this.ctx.moveTo(s.px, s.py);
      this.ctx.lineTo(s.x, s.y);
      this.ctx.stroke();
    }
    this.ctx.globalAlpha = 1;
    this.ctx.globalCompositeOperation = 'source-over';
  }
}
