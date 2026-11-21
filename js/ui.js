/* 界面层：设置面板、照片墙、手势 HUD、提示气泡 */

import { GESTURE_LABELS, MAX_PHOTOS, PALETTES, GIFT_STYLES } from './config.js';
import { clamp } from './utils.js';

export class UI {
  constructor(handlers = {}) {
    this.h = handlers;
    this.$ = (id) => document.getElementById(id);

    this.body = document.body;
    this.intro = this.$('intro');
    this.loader = this.$('loader');
    this.ui = this.$('ui');
    this.panel = this.$('panel');
    this.scrim = this.$('scrim');
    this.gestureHud = this.$('gesture-hud');
    this.handIcon = document.querySelector('.hand-icon');
    this.cameraCard = this.$('camera-card');
    this.photoLayer = this.$('photo-layer');
    this.photoStage = this.$('photo-stage');
    this.photoGrid = this.$('photo-grid');
    this.photoCount = this.$('photo-count');
    this.toastHost = this.$('toasts');
    this.eq = this.$('eq');
    this.guide = this.$('gesture-guide');
    this.guideToggle = this.$('guide-toggle');
    this.speaking = false;
    this._eqBars = [];

    this.buildEQ();
    this.bind();
    this.syncRanges();
    this.setGuideOpen(window.innerWidth > 900, true);
  }

  /* ---------------- DOM 绑定 ---------------- */
  bind() {
    const h = this.h;

    // 顶部按钮
    this.$('btn-panel')?.addEventListener('click', () => this.togglePanel());
    this.$('btn-panel-close')?.addEventListener('click', () => this.closePanel());
    this.$('scrim')?.addEventListener('click', () => this.closePanel());
    this.$('btn-music')?.addEventListener('click', () => h.onMusicToggle?.());
    this.$('btn-full')?.addEventListener('click', () => h.onFullscreen?.());

    // 快捷操作
    document.querySelectorAll('.quick').forEach((btn) => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.action;
        btn.classList.add('is-pressed');
        setTimeout(() => btn.classList.remove('is-pressed'), 260);
        h.onQuickAction?.(action);
      });
    });

    // 照片
    const input = this.$('photo-input');
    input?.addEventListener('change', () => {
      const files = [...(input.files || [])];
      input.value = '';
      if (files.length) h.onPhotoFiles?.(files);
    });
    const dropzone = this.$('dropzone');
    if (dropzone) {
      ['dragenter', 'dragover'].forEach((ev) =>
        dropzone.addEventListener(ev, (e) => {
          e.preventDefault();
          dropzone.classList.add('is-over');
        })
      );
      ['dragleave', 'drop'].forEach((ev) =>
        dropzone.addEventListener(ev, (e) => {
          e.preventDefault();
          if (ev === 'dragleave' && dropzone.contains(e.relatedTarget)) return;
          dropzone.classList.remove('is-over');
        })
      );
      dropzone.addEventListener('drop', (e) => {
        const files = [...(e.dataTransfer?.files || [])].filter((f) => f.type.startsWith('image/'));
        if (files.length) h.onPhotoFiles?.(files);
      });
    }
    this.$('frame-style')?.addEventListener('change', (e) => h.onFrameChange?.(e.target.value));
    this.$('btn-clear-photos')?.addEventListener('click', () => h.onClearPhotos?.());

    // 音乐
    document.querySelectorAll('.track').forEach((btn) => {
      btn.addEventListener('click', () => {
        const track = btn.dataset.track;
        if (track === 'custom' && !this.customReady) {
          h.onRequestMusicFile?.();
          return;
        }
        h.onMusicTrack?.(track);
      });
    });
    this.$('music-input')?.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (file) h.onMusicFile?.(file);
    });
    this.$('volume')?.addEventListener('input', (e) => {
      this.syncRange(e.target);
      this.$('volume-val').textContent = e.target.value;
      h.onVolume?.(Number(e.target.value));
    });
    this.$('sensitivity')?.addEventListener('input', (e) => {
      this.syncRange(e.target);
      this.$('sensitivity-val').textContent = e.target.value;
      h.onSensitivity?.(Number(e.target.value));
    });

    // 粒子
    document.querySelectorAll('[data-palette]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.setPalette(btn.dataset.palette);
        h.onPalette?.(btn.dataset.palette);
      });
    });
    this.$('particle-count')?.addEventListener('input', (e) => {
      this.syncRange(e.target);
      this.$('count-val').textContent = e.target.value;
      h.onCount?.(Number(e.target.value));
    });
    this.$('glow')?.addEventListener('input', (e) => {
      this.syncRange(e.target);
      this.$('glow-val').textContent = e.target.value;
      h.onGlow?.(Number(e.target.value));
    });
    this.$('snowfall')?.addEventListener('input', (e) => {
      this.syncRange(e.target);
      this.$('snow-val').textContent = e.target.value;
      h.onSnow?.(Number(e.target.value));
    });

    // 礼盒
    document.querySelectorAll('[data-gift]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.setGift(btn.dataset.gift);
        h.onGift?.(btn.dataset.gift);
      });
    });

    // 手势
    this.$('btn-camera-toggle')?.addEventListener('click', () => h.onCameraToggle?.());
    this.$('btn-camera-close')?.addEventListener('click', () => h.onCameraStop?.());
    this.$('gesture-sens')?.addEventListener('input', (e) => {
      this.syncRange(e.target);
      this.$('gesture-sens-val').textContent = e.target.value;
      h.onGestureSensitivity?.(Number(e.target.value));
    });
    this.$('mirror')?.addEventListener('change', (e) => h.onMirror?.(e.target.checked));
    this.$('auto-photo')?.addEventListener('change', (e) => h.onAutoPhoto?.(e.target.checked));

    this.$('btn-reset')?.addEventListener('click', () => h.onReset?.());

    // 手势说明
    this.guideToggle?.addEventListener('click', () => {
      this.setGuideOpen(!this.guide?.classList.contains('is-open'));
    });

    // 开场按钮
    this.$('btn-start-camera')?.addEventListener('click', () => h.onStartCamera?.());
    this.$('btn-start-mouse')?.addEventListener('click', () => h.onStartMouse?.());

    // 页面尺寸变化时同步 range 填充
    window.addEventListener('resize', () => this.syncRanges());
  }

  /* ---------------- 开场 / 加载 ---------------- */
  hideLoader() {
    this.loader?.classList.add('is-gone');
    this.body.classList.remove('is-loading');
  }

  markReady() {
    this.body.classList.add('is-ready');
    this.ui?.setAttribute('aria-hidden', 'false');
  }

  enterExperience() {
    this.intro?.classList.add('is-gone');
    this.markReady();
  }

  showCameraCard(show) {
    if (!this.cameraCard) return;
    this.cameraCard.hidden = !show;
    if (show) {
      this.cameraCard.classList.remove('is-entering');
      void this.cameraCard.offsetWidth;
      this.cameraCard.classList.add('is-entering');
    }
  }

  /* ---------------- 面板 ---------------- */
  openPanel() {
    this.panel?.classList.add('is-open');
    this.panel?.setAttribute('aria-hidden', 'false');
    this.$('btn-panel')?.setAttribute('aria-expanded', 'true');
    if (this.scrim) {
      this.scrim.hidden = false;
      requestAnimationFrame(() => this.scrim.classList.add('is-visible'));
    }
  }

  closePanel() {
    this.panel?.classList.remove('is-open');
    this.panel?.setAttribute('aria-hidden', 'true');
    this.$('btn-panel')?.setAttribute('aria-expanded', 'false');
    if (this.scrim) {
      this.scrim.classList.remove('is-visible');
      setTimeout(() => {
        if (!this.panel?.classList.contains('is-open')) this.scrim.hidden = true;
      }, 420);
    }
  }

  togglePanel() {
    if (this.panel?.classList.contains('is-open')) this.closePanel();
    else this.openPanel();
  }

  /* ---------------- 状态同步 ---------------- */
  applySettings(settings) {
    const setVal = (id, value) => {
      const el = this.$(id);
      if (el) {
        el.value = value;
        this.syncRange(el);
      }
    };
    setVal('volume', settings.volume);
    setVal('sensitivity', settings.sensitivity);
    setVal('particle-count', settings.particleCount);
    setVal('glow', settings.glow);
    setVal('snowfall', settings.snowfall);
    setVal('gesture-sens', settings.gestureSensitivity);

    this.$('volume-val').textContent = settings.volume;
    this.$('sensitivity-val').textContent = settings.sensitivity;
    this.$('count-val').textContent = settings.particleCount;
    this.$('glow-val').textContent = settings.glow;
    this.$('snow-val').textContent = settings.snowfall;
    this.$('gesture-sens-val').textContent = settings.gestureSensitivity;

    const frameSel = this.$('frame-style');
    if (frameSel) frameSel.value = settings.frame;

    this.setPalette(settings.palette, false);
    this.setGift(settings.gift, false);

    const mirror = this.$('mirror');
    if (mirror) mirror.checked = !!settings.mirror;
    const autoPhoto = this.$('auto-photo');
    if (autoPhoto) autoPhoto.checked = !!settings.autoPhoto;
  }

  setPalette(name, notifyHandler = true) {
    const palette = PALETTES[name] || PALETTES.gold;
    document.querySelectorAll('[data-palette]').forEach((btn) => {
      btn.dataset.active = String(btn.dataset.palette === name);
    });
    document.documentElement.style.setProperty('--accent', palette.accent);
    document.documentElement.style.setProperty('--accent-soft', palette.accentSoft);
    this.$('palette-meta').textContent = palette.name;
  }

  setGift(name, notifyHandler = true) {
    const style = GIFT_STYLES[name] || GIFT_STYLES.classic;
    document.querySelectorAll('[data-gift]').forEach((btn) => {
      btn.dataset.active = String(btn.dataset.gift === name);
    });
    this.$('gift-meta').textContent = style.name;
  }

  setFrame(frame) {
    this.photoLayer.dataset.frame = frame;
    this.photoStage.dataset.frame = frame;
  }

  setPhotos(records, max = MAX_PHOTOS) {
    if (!this.photoGrid) return;
    this.photoGrid.innerHTML = '';
    records.forEach((record, i) => {
      const cell = document.createElement('div');
      cell.className = 'photo-thumb';
      cell.style.animationDelay = `${i * 40}ms`;
      const img = document.createElement('img');
      img.src = record.thumbUrl || record.url;
      img.alt = record.name || `照片 ${i + 1}`;
      cell.appendChild(img);
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'photo-thumb__del';
      del.setAttribute('aria-label', '删除这张照片');
      del.textContent = '×';
      del.addEventListener('click', () => this.h.onDeletePhoto?.(record.id));
      cell.appendChild(del);
      this.photoGrid.appendChild(cell);
    });
    if (this.photoCount) this.photoCount.textContent = `${records.length} / ${max}`;
    const clearBtn = this.$('btn-clear-photos');
    if (clearBtn) clearBtn.disabled = records.length === 0;
  }

  setCameraState(state) {
    const meta = this.$('gesture-meta');
    const btn = this.$('btn-camera-toggle');
    const labels = {
      idle: ['摄像头关闭', '开启摄像头'],
      loading: ['正在唤醒…', '正在唤醒摄像头…'],
      ready: ['摄像头开启 · 本地识别', '关闭摄像头']
    };
    if (meta) meta.textContent = (labels[state] || labels.idle)[0];
    if (btn) {
      btn.textContent = (labels[state] || labels.idle)[1];
      btn.disabled = state === 'loading';
    }
    if (state !== 'ready') {
      this.setGesture('idle', 0);
      this.gestureHud?.classList.add('is-hidden');
      this.gestureHud?.classList.remove('is-active');
    } else {
      this.gestureHud?.classList.remove('is-hidden');
    }
  }

  setGesture(gesture, score = 0) {
    const info = GESTURE_LABELS[gesture] || GESTURE_LABELS.idle;
    const label = this.$('gesture-label');
    const hint = this.$('gesture-hint');
    if (label) label.textContent = info.label;
    if (hint) hint.textContent = info.hint;
    if (this.handIcon) {
      this.handIcon.dataset.state = gesture === 'pinch' ? 'pinch' : gesture;
    }
    const meter = this.$('gesture-meter');
    if (meter) meter.style.width = `${Math.round(clamp(score) * 100)}%`;
    this.gestureHud?.classList.toggle('is-active', gesture !== 'idle');
    this.setGuideGesture(gesture);
  }

  setGuideOpen(open, silent = false) {
    if (!this.guide) return;
    this.guide.classList.toggle('is-open', !!open);
    this.guideToggle?.setAttribute('aria-expanded', String(!!open));
  }

  setGuideGesture(gesture) {
    if (!this.guide) return;
    this.guide.querySelectorAll('[data-gesture]').forEach((li) => {
      li.classList.toggle('is-active', li.dataset.gesture === gesture);
    });
  }

  setGuideEffects({ snowing = false, fireworks = false } = {}) {
    if (!this.guide) return;
    const peace = this.guide.querySelector('[data-gesture="peace"]');
    const three = this.guide.querySelector('[data-gesture="three"]');
    peace?.classList.toggle('is-on', !!snowing);
    three?.classList.toggle('is-on', !!fireworks);
  }

  setMusicState({ track = null, playing = false, fileName = null, customReady = false } = {}) {
    const meta = this.$('music-meta');
    const btn = this.$('btn-music');
    const nameMap = { jingle: '铃儿响叮当', silent: '平安夜', custom: fileName || '我的音乐' };
    if (meta) meta.textContent = playing ? `正在播放 · ${nameMap[track] || ''}` : '未播放';
    if (btn) btn.setAttribute('aria-pressed', String(!!playing));
    document.querySelectorAll('.track').forEach((el) => {
      el.dataset.active = String(playing && el.dataset.track === track);
    });
    this.customReady = !!customReady;
    const customName = this.$('custom-track-name');
    if (customName) customName.textContent = customReady ? fileName || '我的音乐' : '上传我的音乐';
  }

  setEQ(spectrum) {
    if (!this._eqBars.length) return;
    const bars = spectrum.length;
    for (let i = 0; i < this._eqBars.length; i++) {
      const v = spectrum[Math.min(bars - 1, i)] || 0;
      this._eqBars[i].style.height = `${Math.max(4, Math.round(v * 100))}%`;
    }
  }

  buildEQ() {
    if (!this.eq) return;
    for (let i = 0; i < 26; i++) {
      const bar = document.createElement('i');
      this.eq.appendChild(bar);
      this._eqBars.push(bar);
    }
  }

  toast(message, duration = 2800) {
    if (!this.toastHost) return;
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = message;
    this.toastHost.appendChild(el);
    while (this.toastHost.children.length > 3) this.toastHost.firstElementChild.remove();
    setTimeout(() => {
      el.classList.add('is-out');
      setTimeout(() => el.remove(), 420);
    }, duration);
  }

  setIntroWarning(text) {
    const el = this.$('intro-fineprint');
    if (!el) return;
    el.textContent = text;
    el.classList.add('is-warn');
  }

  setDimmed(dimmed) {
    this.ui?.classList.toggle('is-dimmed', dimmed);
  }

  syncRange(input) {
    if (!input) return;
    const min = Number(input.min) || 0;
    const max = Number(input.max) || 100;
    const value = Number(input.value);
    const p = ((value - min) / (max - min || 1)) * 100;
    input.style.setProperty('--p', `${p}%`);
  }

  syncRanges() {
    document.querySelectorAll('input[type="range"]').forEach((el) => this.syncRange(el));
  }
}
