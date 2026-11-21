/* 摄像头 + MediaPipe 手部识别（模型与 wasm 全部本地加载，可离线） */

import { FilesetResolver, HandLandmarker } from '../vendor/mediapipe/vision_bundle.mjs';
import { analyzeHand, GestureStabilizer, HAND_CONNECTIONS } from './gesture-math.js';

const WASM_PATH = new URL('../vendor/mediapipe/wasm', import.meta.url).href;
const MODEL_PATH = new URL('../assets/hand_landmarker.task', import.meta.url).href;

export class HandTracker {
  constructor({ video, canvas, onFrame, onStatus, onError } = {}) {
    this.video = video;
    this.canvas = canvas;
    this.ctx = canvas ? canvas.getContext('2d') : null;
    this.onFrame = onFrame || (() => {});
    this.onStatus = onStatus || (() => {});
    this.onError = onError || (() => {});

    this.landmarker = null;
    this.stream = null;
    this.running = false;
    this.detectInterval = 45;
    this.lastDetect = 0;
    this.lastSeen = 0;
    this.mirror = true;
    this._smooth = null;
    this.stabilizer = new GestureStabilizer({ windowSize: 9, threshold: 5 });
    this.lastStable = 'none';
    this._raf = 0;
    this._resizeObserver = null;
  }

  get active() {
    return this.running;
  }

  async _ensureLandmarker() {
    if (this.landmarker) return this.landmarker;
    this.onStatus('loading');
    const fileset = await FilesetResolver.forVisionTasks(WASM_PATH);
    const create = (delegate) =>
      HandLandmarker.createFromOptions(fileset, {
        baseOptions: {
          modelAssetPath: MODEL_PATH,
          delegate
        },
        runningMode: 'VIDEO',
        numHands: 1,
        minHandDetectionConfidence: 0.6,
        minHandPresenceConfidence: 0.6,
        minTrackingConfidence: 0.6
      });

    try {
      this.landmarker = await create('GPU');
    } catch (err) {
      console.warn('[gesture] GPU 初始化失败，改用 CPU', err);
      this.landmarker = await create('CPU');
    }
    return this.landmarker;
  }

  async start() {
    if (this.running) return true;
    if (!window.isSecureContext) {
      throw new Error('需要 HTTPS 或 localhost 才能使用摄像头');
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('当前浏览器不支持摄像头');
    }

    this.onStatus('camera');
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: 'user',
        width: { ideal: 640 },
        height: { ideal: 480 },
        frameRate: { ideal: 30, max: 30 }
      },
      audio: false
    });

    this.video.srcObject = this.stream;
    this.video.muted = true;
    this.video.playsInline = true;
    await this.video.play().catch(() => {});

    try {
      await this._ensureLandmarker();
    } catch (err) {
      // 模型加载失败时释放摄像头，避免指示灯一直亮着
      this.stop();
      throw err;
    }
    this.onStatus('ready');

    this.running = true;
    this.stabilizer.reset();
    this.lastSeen = performance.now();
    this._setupCanvas();
    this._loop();
    return true;
  }

  _setupCanvas() {
    if (!this.canvas || !this.video) return;
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = this.video.getBoundingClientRect();
      const w = Math.max(1, rect.width || 160);
      const h = Math.max(1, rect.height || 120);
      this.canvas.width = Math.floor(w * dpr);
      this.canvas.height = Math.floor(h * dpr);
      this.canvas.style.width = `${w}px`;
      this.canvas.style.height = `${h}px`;
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    if ('ResizeObserver' in window) {
      this._resizeObserver = new ResizeObserver(resize);
      this._resizeObserver.observe(this.video);
    }
  }

  _loop = () => {
    if (!this.running) return;
    this._raf = requestAnimationFrame(this._loop);
    const now = performance.now();
    if (!this.video || this.video.readyState < 2) return;
    if (now - this.lastDetect < this.detectInterval) return;
    this.lastDetect = now;

    let result = null;
    try {
      result = this.landmarker.detectForVideo(this.video, now);
    } catch (err) {
      console.warn('[gesture] 检测失败', err);
      return;
    }

    if (result && result.landmarks && result.landmarks.length > 0) {
      this.lastSeen = now;
      const landmarks = this._smoothLandmarks(result.landmarks[0]);
      const aspect = (this.video.videoWidth || 4) / (this.video.videoHeight || 3);
      const analysis = analyzeHand(landmarks, aspect);
      const stable = this.stabilizer.push(analysis.gesture);
      const handedness = result.handednesses?.[0]?.[0]?.categoryName || '';
      if (stable !== this.lastStable) this.lastStable = stable;
      this.onFrame({ landmarks, analysis, stable, handedness, hasHand: true });
      this._draw(landmarks, analysis);
    } else if (now - this.lastSeen > 700) {
      this._smooth = null;
      this.stabilizer.push('none');
      this.onFrame({ landmarks: null, analysis: analyzeHand(null), stable: 'none', handedness: '', hasHand: false });
      this._clear();
    }
  };

  /** 关键点低通滤波：减少抖动，提高手势稳定性 */
  _smoothLandmarks(landmarks) {
    const alpha = 0.45;
    if (!this._smooth) {
      this._smooth = landmarks.map((p) => ({ x: p.x, y: p.y, z: p.z || 0 }));
      return this._smooth;
    }
    for (let i = 0; i < landmarks.length; i++) {
      const p = landmarks[i];
      const s = this._smooth[i];
      s.x = s.x * alpha + p.x * (1 - alpha);
      s.y = s.y * alpha + p.y * (1 - alpha);
      s.z = s.z * alpha + (p.z || 0) * (1 - alpha);
    }
    return this._smooth;
  }

  _draw(landmarks, analysis) {
    const ctx = this.ctx;
    if (!ctx) return;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    ctx.clearRect(0, 0, w, h);
    const mx = (x) => (this.mirror ? 1 - x : x) * w;
    const my = (y) => y * h;

    const active = analysis && analysis.gesture !== 'none';
    ctx.lineWidth = 1.3;
    ctx.strokeStyle = active ? 'rgba(255,217,138,.75)' : 'rgba(150,230,210,.42)';
    ctx.beginPath();
    for (const [a, b] of HAND_CONNECTIONS) {
      const p = landmarks[a];
      const q = landmarks[b];
      ctx.moveTo(mx(p.x), my(p.y));
      ctx.lineTo(mx(q.x), my(q.y));
    }
    ctx.stroke();

    for (let i = 0; i < landmarks.length; i++) {
      const p = landmarks[i];
      const isTip = [4, 8, 12, 16, 20].includes(i);
      ctx.beginPath();
      ctx.arc(mx(p.x), my(p.y), isTip ? 2.1 : 1.3, 0, Math.PI * 2);
      ctx.fillStyle = isTip ? 'rgba(255,232,186,.95)' : 'rgba(210,245,235,.55)';
      ctx.fill();
    }

    // 捏合指示：拇指与食指之间的短线
    if (analysis && analysis.pinchDist < 0.9 && analysis.fingers[1] > 0.2) {
      const thumb = landmarks[4];
      const index = landmarks[8];
      ctx.beginPath();
      ctx.setLineDash([2, 3]);
      ctx.moveTo(mx(thumb.x), my(thumb.y));
      ctx.lineTo(mx(index.x), my(index.y));
      ctx.strokeStyle = `rgba(255,217,138,${0.2 + analysis.pinch * 0.7})`;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  _clear() {
    if (!this.ctx) return;
    this.ctx.clearRect(0, 0, this.canvas.clientWidth, this.canvas.clientHeight);
  }

  setMirror(mirror) {
    this.mirror = !!mirror;
  }

  /** 灵敏度：越高反应越快，也越容易触发 */
  setSensitivity(value) {
    const t = Math.min(1, Math.max(0, value / 100));
    this.stabilizer.threshold = Math.max(3, Math.round(6 - t * 2.6));
    this.detectInterval = Math.round(40 + (1 - t) * 20);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this._raf);
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
    }
    if (this.stream) {
      for (const track of this.stream.getTracks()) track.stop();
      this.stream = null;
    }
    if (this.video) {
      this.video.srcObject = null;
    }
    this._clear();
    this.stabilizer.reset();
    this.onStatus('idle');
  }

  destroy() {
    this.stop();
    if (this.landmarker) {
      try {
        this.landmarker.close();
      } catch {
        /* noop */
      }
      this.landmarker = null;
    }
  }
}
