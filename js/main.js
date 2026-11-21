/* 主程序：场景编排、状态机与交互 */

import * as THREE from '../vendor/three/build/three.module.js';
import { EffectComposer } from '../vendor/three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from '../vendor/three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from '../vendor/three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from '../vendor/three/addons/postprocessing/OutputPass.js';

import { ChristmasTree } from './tree.js';
import { GiftBoxes } from './gifts.js';
import { PhotoLayer } from './photos.js';
import { Snowfall } from './snowfall.js';
import { Fireworks } from './fireworks.js';
import { AudioEngine } from './audio.js';
import { HandTracker } from './gestures.js';
import { UI } from './ui.js';
import {
  loadSettings,
  saveSettings,
  listPhotos,
  addPhoto,
  removePhoto,
  clearPhotos,
  saveMusic,
  loadMusic
} from './store.js';
import { DEFAULTS, MAX_PHOTOS, PALETTES, GIFT_STYLES, FRAME_STYLES, COLOR_PAIRS } from './config.js';
import { compressImage, clamp, damp, isMobile } from './utils.js';

const state = {
  settings: { ...DEFAULTS },
  photos: [],
  music: null,
  assembled: true,
  time: 0,
  started: false,
  handAt: 0,
  lastPinchAt: 0,
  pointer: { x: 0, y: 0, has: false },
  view: { zoom: 1, pitch: 0, zoomTarget: 1, pitchTarget: 0 },
  gesture: 'idle',
  snowing: true,
  fireworks: false,
  cursor: { x: 0, y: 0, targetX: 0, targetY: 0, visible: false, pinch: false, prevX: null, prevY: null },
  dwellIndex: -1,
  dwellSince: 0,
  pinchLock: false,
  lastActionAt: {},
  perf: { level: 0, acc: 0, frames: 0, avgFps: 60, auto: true }
};

let renderer, scene, camera, composer, bloomPass, tree, gifts, photos, snow, audio, tracker, ui;
let fireworks, cursorEl;
const photoUrls = new Map();
let saveTimer = 0;
let eqTimer = 0;
let lastBeat = 0;
let lastFrameTime = 0;

/* ------------------------------------------------------------------ */
/* 场景初始化                                                          */
/* ------------------------------------------------------------------ */

function createScene() {
  const canvas = document.getElementById('scene');
  renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    alpha: true,
    powerPreference: 'high-performance'
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.92;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  scene = new THREE.Scene();

  camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 200);
  camera.position.set(0, 3.6, 15.4);
  camera.lookAt(0, 3.8, 0);

  const hemi = new THREE.HemisphereLight(0x7f9cc9, 0x0b0d18, 0.55);
  scene.add(hemi);

  const key = new THREE.PointLight(0xffcf8e, 70, 40, 2);
  key.position.set(2.6, 7.2, 6.2);
  scene.add(key);

  const rim = new THREE.PointLight(0x7fb2ff, 34, 34, 2);
  rim.position.set(-6.5, 3.4, -5.5);
  scene.add(rim);

  const fill = new THREE.PointLight(0xff8f9a, 16, 26, 2);
  fill.position.set(5.5, 1.4, -6);
  scene.add(fill);

  const count = isMobile()
    ? Math.min(7000, state.settings.particleCount)
    : state.settings.particleCount;

  tree = new ChristmasTree(scene, { count, palette: state.settings.palette });
  gifts = new GiftBoxes(scene, { style: state.settings.gift, count: isMobile() ? 5 : 7 });

  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const pr = renderer.getPixelRatio();
  bloomPass = new UnrealBloomPass(
    new THREE.Vector2((window.innerWidth * pr) / 2, (window.innerHeight * pr) / 2),
    0.8,
    0.82,
    0.22
  );
  composer.addPass(bloomPass);
  composer.addPass(new OutputPass());
  composer.setSize(window.innerWidth, window.innerHeight);

  applyGlow(state.settings.glow);
  tree.setGlow(state.settings.glow / 100);
  tree.resize(window.innerHeight);

  window.addEventListener('resize', onResize);
}

/* ------------------------------------------------------------------ */
/* 相机取景                                                            */
/* ------------------------------------------------------------------ */

function fitCamera() {
  const aspect = window.innerWidth / window.innerHeight;
  camera.aspect = aspect;
  const vFov = (camera.fov * Math.PI) / 180;
  const halfH = 6.4;
  const halfW = 4.05;
  const distH = halfH / Math.tan(vFov / 2);
  const distW = halfW / (Math.tan(vFov / 2) * aspect);
  const dist = Math.max(distH, distW);
  state.view.baseDist = dist;
  state.view.lookY = aspect < 1 ? 4.7 : 3.8;
  if (gifts) gifts.group.scale.setScalar(aspect < 1 ? 0.92 : 1);
  applyCamera();
  camera.updateProjectionMatrix();
}

function applyCamera() {
  const dist = (state.view.baseDist || 15.4) * state.view.zoom;
  const lookY = state.view.lookY || 3.8;
  camera.position.set(0, lookY - 0.2 + state.view.pitch * 5.5, dist);
  camera.lookAt(0, lookY + state.view.pitch * 2.2, 0);
}

function onResize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  composer.setSize(w, h);
  tree.resize(h);
  fitCamera();
}

/* ------------------------------------------------------------------ */
/* 声音与光束                                                          */
/* ------------------------------------------------------------------ */

function applyGlow(glow) {
  const t = clamp(glow / 100);
  const palette = PALETTES[state.settings.palette] || PALETTES.gold;
  const base = 0.3 + t * 0.7 * (palette.bloom || 0.9);
  state.bloomBase = base;
  bloomPass.strength = base;
  bloomPass.radius = 0.35 + t * 0.35;
  bloomPass.threshold = 0.62 - t * 0.24;
  bloomPass.enabled = glow > 2;
}

/* ------------------------------------------------------------------ */
/* 设置                                                                */
/* ------------------------------------------------------------------ */

function mergeSettings(stored) {
  const merged = { ...DEFAULTS, ...(stored || {}) };
  if (!PALETTES[merged.palette]) merged.palette = DEFAULTS.palette;
  if (!GIFT_STYLES[merged.gift]) merged.gift = DEFAULTS.gift;
  if (!FRAME_STYLES[merged.frame]) merged.frame = DEFAULTS.frame;
  const num = (value, fallback) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  };
  merged.particleCount = clamp(num(merged.particleCount, DEFAULTS.particleCount), 2500, 16000);
  merged.volume = clamp(num(merged.volume, DEFAULTS.volume), 0, 100);
  merged.sensitivity = clamp(num(merged.sensitivity, DEFAULTS.sensitivity), 0, 100);
  merged.glow = clamp(num(merged.glow, DEFAULTS.glow), 0, 100);
  merged.snowfall = clamp(num(merged.snowfall, DEFAULTS.snowfall), 0, 100);
  merged.gestureSensitivity = clamp(num(merged.gestureSensitivity, DEFAULTS.gestureSensitivity), 0, 100);
  merged.mirror = merged.mirror !== false;
  merged.autoPhoto = merged.autoPhoto !== false;
  return merged;
}

function saveSettingsSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveSettings(state.settings).catch(() => {});
  }, 320);
}

function updateSetting(patch) {
  Object.assign(state.settings, patch);
  ui.applySettings(state.settings);
  saveSettingsSoon();
}

/* ------------------------------------------------------------------ */
/* 照片                                                                */
/* ------------------------------------------------------------------ */

function buildPhotoView(records) {
  return records.map((record) => ({
    id: record.id,
    name: record.name,
    blob: record.blob,
    thumbBlob: record.thumbBlob,
    url: photoUrls.get(record.id)?.url,
    thumbUrl: photoUrls.get(record.id)?.thumbUrl
  }));
}

function refreshPhotoUrls() {
  const alive = new Set();
  for (const record of state.photos) {
    alive.add(record.id);
    if (!photoUrls.has(record.id)) {
      photoUrls.set(record.id, {
        url: URL.createObjectURL(record.blob),
        thumbUrl: URL.createObjectURL(record.thumbBlob || record.blob)
      });
    }
  }
  for (const [id, urls] of [...photoUrls.entries()]) {
    if (!alive.has(id)) {
      URL.revokeObjectURL(urls.url);
      URL.revokeObjectURL(urls.thumbUrl);
      photoUrls.delete(id);
    }
  }
}

function syncPhotos() {
  refreshPhotoUrls();
  const view = buildPhotoView(state.photos);
  photos.setPhotos(view);
  ui.setPhotos(view, MAX_PHOTOS);
  photos.setFrame(state.settings.frame);
}

async function handlePhotoFiles(files) {
  const remaining = MAX_PHOTOS - state.photos.length;
  if (remaining <= 0) {
    ui.toast(`最多放 ${MAX_PHOTOS} 张照片哦`);
    return;
  }
  const accepted = files.filter((f) => f.type.startsWith('image/')).slice(0, remaining);
  if (!accepted.length) {
    ui.toast('请选择图片文件');
    return;
  }
  ui.toast(`正在处理 ${accepted.length} 张照片…`, 1800);
  let added = 0;
  for (const file of accepted) {
    try {
      const blob = await compressImage(file, 1440, 0.87);
      const thumbBlob = await compressImage(blob, 460, 0.8);
      const record = {
        id: `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
        name: file.name?.replace(/\.[^.]+$/, '') || '',
        blob,
        thumbBlob,
        createdAt: Date.now()
      };
      await addPhoto(record);
      state.photos.push(record);
      added++;
    } catch (err) {
      console.warn('[photos] 处理失败', err);
    }
  }
  syncPhotos();
  if (added) {
    tree.pulse(1.2);
    ui.toast(`已点亮 ${added} 张照片 · 捏指或按 P 查看`);
  } else {
    ui.toast('照片处理失败，换一张试试');
  }
}

async function handleDeletePhoto(id) {
  await removePhoto(id);
  state.photos = state.photos.filter((p) => p.id !== id);
  syncPhotos();
  ui.toast('已移除这张照片');
}

async function handleClearPhotos() {
  if (!state.photos.length) return;
  const ok = window.confirm('确定清空所有照片吗？可从浏览器缓存中一并删除。');
  if (!ok) return;
  await clearPhotos();
  state.photos = [];
  syncPhotos();
  ui.toast('照片已清空');
}

/* ------------------------------------------------------------------ */
/* 音乐                                                                */
/* ------------------------------------------------------------------ */

function musicStatePayload() {
  return {
    track: audio.currentTrack,
    playing: audio.playing,
    fileName: state.music?.name || audio.fileName,
    customReady: !!state.music
  };
}

function syncMusicUI() {
  ui.setMusicState(musicStatePayload());
}

async function startMusic(trackId = state.settings.track) {
  try {
    audio.setVolume(state.settings.volume);
    audio.setSensitivity(state.settings.sensitivity);
    if (trackId === 'custom' && state.music) {
      const file = new File([state.music.blob], state.music.name || 'music.mp3', {
        type: state.music.type || 'audio/mpeg'
      });
      await audio.playFile(file);
    } else {
      await audio.playSynth(SONGS_SAFE(trackId));
    }
    syncMusicUI();
    return true;
  } catch (err) {
    console.warn('[music] 播放失败', err);
    ui.toast('音乐播放被浏览器拦截，点右上角音符再试一次', 3600);
    syncMusicUI();
    return false;
  }
}

const SONGS_SAFE = (id) => (id === 'silent' ? 'silent' : 'jingle');

async function handleMusicToggle() {
  if (!state.started) return;
  try {
    if (!audio.ready) {
      await startMusic();
      return;
    }
    await audio.toggle();
    syncMusicUI();
  } catch (err) {
    console.warn(err);
    ui.toast('音乐暂时无法播放');
  }
}

async function handleMusicTrack(track) {
  if (track === 'custom') {
    if (!state.music) {
      document.getElementById('music-input')?.click();
      return;
    }
    const file = new File([state.music.blob], state.music.name || 'music.mp3', {
      type: state.music.type || 'audio/mpeg'
    });
    await audio.playFile(file);
  } else {
    await audio.playSynth(track);
  }
  updateSetting({ track });
  syncMusicUI();
}

async function handleMusicFile(file) {
  if (!file || !file.type.startsWith('audio/')) {
    ui.toast('请选择音频文件');
    return;
  }
  ui.toast('正在载入音乐…', 1600);
  state.music = {
    name: file.name,
    type: file.type,
    blob: file,
    savedAt: Date.now()
  };
  try {
    await saveMusic(state.music);
  } catch (err) {
    console.warn('[music] 缓存失败', err);
  }
  await audio.playFile(file);
  updateSetting({ track: 'custom' });
  syncMusicUI();
  ui.toast(`正在播放：${file.name}`);
}

/* ------------------------------------------------------------------ */
/* 手势                                                                */
/* ------------------------------------------------------------------ */

function applyAssembled(assembled, source = '') {
  if (state.assembled === assembled) return;
  state.assembled = assembled;
  tree.setAssembled(assembled);
  tree.pulse(assembled ? 1.1 : 0.7);
  if (!assembled) gifts.bounce(0.6);
  if (source) ui.toast(assembled ? '星光聚拢 · 圣诞树成形' : '星尘散开 · 飞向夜空', 1600);
}

function triggerPhoto() {
  if (!state.photos.length) {
    ui.toast('先在设置里添加几张照片，捏指就能看到它们');
    return;
  }
  if (photos.isOpen) {
    photos.close();
  } else {
    photos.open();
    tree.pulse(1.6);
    gifts.bounce(1.2);
    ui.setDimmed(true);
  }
}

/* ---------------- 一指 / 两指 / 三指 手势动作 ---------------- */

function cycleColors() {
  const now = performance.now();
  if (now - (state.lastActionAt.point || 0) < 1200) return;
  state.lastActionAt.point = now;
  const current = COLOR_PAIRS.findIndex((p) => p.palette === state.settings.palette);
  const next = COLOR_PAIRS[(current + 1) % COLOR_PAIRS.length];
  tree.setPalette(next.palette);
  gifts.setStyle(next.gift);
  updateSetting({ palette: next.palette, gift: next.gift });
  applyGlow(state.settings.glow);
  tree.pulse(1);
  gifts.bounce(0.8);
  ui.toast(`换色 · ${next.label}`, 1900);
}

function toggleSnow() {
  const now = performance.now();
  if (now - (state.lastActionAt.peace || 0) < 1000) return;
  state.lastActionAt.peace = now;
  state.snowing = !state.snowing;
  snow.setEnabled(state.snowing);
  if (state.snowing) snow.setDensity(Math.max(45, state.settings.snowfall));
  ui.toast(state.snowing ? '下雪了 ❄' : '雪停了', 1700);
  ui.setGuideEffects({ snowing: state.snowing, fireworks: state.fireworks });
}

function toggleFireworks() {
  const now = performance.now();
  if (now - (state.lastActionAt.three || 0) < 1000) return;
  state.lastActionAt.three = now;
  state.fireworks = !state.fireworks;
  fireworks.setActive(state.fireworks);
  tree.pulse(state.fireworks ? 1.2 : 0.4);
  ui.toast(state.fireworks ? '烟花开始 · 抬头看' : '烟花结束', 1700);
  ui.setGuideEffects({ snowing: state.snowing, fireworks: state.fireworks });
}

/** 从光标指向的照片位置放大 */
function openPhotoAt(index) {
  const item = photos.items[index];
  if (!item) return;
  photos.highlight(-1);
  photos.open(index, {
    origin: { x: item.screenX, y: item.screenY, scale: (item.screenScale || 0.8) * 0.5 }
  });
  tree.pulse(1.6);
  gifts.bounce(1.1);
  state.pinchLock = true;
  state.dwellIndex = -1;
}

function onHandFrame({ analysis, stable, hasHand }) {
  if (!hasHand) {
    state.cursor.visible = false;
    state.cursor.prevX = null;
    state.cursor.prevY = null;
    photos.highlight(-1);
    state.dwellIndex = -1;
    if (state.gesture !== 'idle') {
      state.gesture = 'idle';
      ui.setGesture('idle', 0);
    }
    return;
  }

  state.handAt = performance.now();
  const pointer = analysis.pointer || analysis.palm;
  state.cursor.targetX = (1 - pointer.x) * window.innerWidth;
  state.cursor.targetY = pointer.y * window.innerHeight;
  state.cursor.visible = true;

  const gesture = stable === 'none' ? 'idle' : stable;
  state.cursor.pinch = gesture === 'pinch';
  if (gesture !== 'pinch') state.pinchLock = false;

  if (gesture === 'fist') {
    tree.setHand((0.5 - analysis.palm.x) * 1.9, (0.5 - analysis.palm.y) * 1.9);
  }

  if (gesture !== state.gesture) {
    state.gesture = gesture;
    switch (gesture) {
      case 'fist':
        applyAssembled(true);
        break;
      case 'palm':
        applyAssembled(false);
        break;
      case 'point':
        cycleColors();
        break;
      case 'peace':
        toggleSnow();
        break;
      case 'three':
        toggleFireworks();
        break;
      case 'pinch': {
        if (photos.isOpen) {
          const now = performance.now();
          if (now - (state.lastActionAt.pinch || 0) > 900) {
            state.lastActionAt.pinch = now;
            photos.close();
          }
        } else if (!state.photos.length) {
          ui.toast('先在设置里添加照片，捏指就能选中它们', 2200);
        }
        break;
      }
      default:
        break;
    }
  }
  ui.setGesture(gesture, analysis.score);
}

async function startCamera({ auto = false } = {}) {
  if (!tracker || tracker.active) return;
  ui.setCameraState('loading');
  ui.showCameraCard(true);
  ui.toast('正在唤醒摄像头与手势模型（首次约需数秒）…', 3200);
  try {
    await tracker.start();
    ui.setCameraState('ready');
    ui.showCameraCard(true);
    ui.toast('准备好了 · 手势说明在右侧，握拳成树，捏指选照片', 3600);
  } catch (err) {
    console.warn('[camera]', err);
    ui.setCameraState('idle');
    ui.showCameraCard(false);
    const name = err?.name || '';
    let msg = '摄像头开启失败';
    if (name === 'NotAllowedError' || name === 'SecurityError') msg = '摄像头权限被拒绝，可在浏览器地址栏重新授权';
    else if (name === 'NotFoundError' || name === 'OverconstrainedError') msg = '没有找到可用的摄像头';
    else if (name === 'NotReadableError') msg = '摄像头被其他程序占用，请关闭后重试';
    else if (err?.message) msg = err.message;
    ui.toast(msg, 5200);
    if (auto) ui.toast('已切换到鼠标模式：空格汇聚/散开，P 看照片', 4200);
  }
}

function stopCamera() {
  if (!tracker) return;
  tracker.stop();
  state.cursor.visible = false;
  cursorEl?.classList.remove('is-visible', 'is-pinching');
  photos.highlight(-1);
  ui.setCameraState('idle');
  ui.showCameraCard(false);
  ui.setGuideGesture('idle');
  ui.toast('摄像头已关闭', 1800);
}

/* ------------------------------------------------------------------ */
/* 主循环                                                              */
/* ------------------------------------------------------------------ */

function animate(now = performance.now()) {
  requestAnimationFrame(animate);
  if (!lastFrameTime) lastFrameTime = now;
  const dt = Math.min(Math.max((now - lastFrameTime) / 1000, 0), 0.05);
  lastFrameTime = now;
  state.time += dt;
  trackPerformance(dt);

  const metrics = audio.ready ? audio.update(dt) : { energy: 0, bass: 0, mid: 0, treble: 0, beat: 0 };

  if (metrics.beat > 0.85 && lastBeat <= 0.85) {
    gifts.bounce(metrics.beat);
    tree.pulse(0.35);
  }
  lastBeat = metrics.beat;

  tree.update(dt, state.time, metrics);
  gifts.update(dt, state.time, metrics);

  if (bloomPass.enabled) {
    bloomPass.strength = state.bloomBase + metrics.energy * 0.28;
  }

  // 手势或指针的轻微视差
  if (performance.now() - state.handAt > 900 && state.pointer.has && !tracker?.active) {
    tree.setHand(state.pointer.x * 0.8, state.pointer.y * 0.8);
  }

  // 相机缓动
  state.view.zoom = damp(state.view.zoom, state.view.zoomTarget, 6, dt);
  state.view.pitch = damp(state.view.pitch, state.view.pitchTarget, 4, dt);
  applyCamera();

  photos.update(dt, state.time, tree.assemble);
  snow.update(dt);
  if (fireworks) fireworks.update(dt);
  updateHandCursor(dt);
  updatePinchDwell();

  composer.render();

  if (ui.panel?.classList.contains('is-open')) {
    eqTimer += dt;
    if (eqTimer > 0.08) {
      eqTimer = 0;
      ui.setEQ(audio.ready ? audio.getSpectrum(26) : new Array(26).fill(0));
    }
  }
}

/* ------------------------------------------------------------------ */
/* 自适应性能：低帧率时自动降级，保证低配电脑不卡死                        */
/* ------------------------------------------------------------------ */

function applyPerfLevel(level, silent = false) {
  if (!tree) return;
  const base = isMobile() ? Math.min(7000, state.settings.particleCount) : state.settings.particleCount;
  if (level === 1) {
    tree.setCount(Math.max(2500, Math.round(base * 0.62)));
    if (bloomPass.enabled) bloomPass.strength *= 0.85;
    if (snow) snow.setDensity(Math.min(state.settings.snowfall, 40));
    if (fireworks) fireworks.maxSparks = 900;
  } else if (level >= 2) {
    tree.setCount(Math.max(2500, Math.round(base * 0.42)));
    bloomPass.enabled = false;
    renderer.setPixelRatio(1.25);
    composer.setSize(window.innerWidth, window.innerHeight);
    tree.resize(window.innerHeight);
    if (fireworks) fireworks.maxSparks = 520;
    if (tracker) tracker.detectInterval = Math.max(tracker.detectInterval, 90);
  } else {
    return;
  }
  state.perf.level = level;
  if (!silent) ui?.toast('已自动切换到性能模式，画面会更流畅', 2600);
}

function trackPerformance(dt) {
  if (!state.perf.auto) return;
  state.perf.acc += dt;
  state.perf.frames++;
  if (state.perf.acc < 2.5) return;
  const fps = state.perf.frames / state.perf.acc;
  state.perf.avgFps = state.perf.avgFps * 0.4 + fps * 0.6;
  state.perf.acc = 0;
  state.perf.frames = 0;

  // 跳过前几秒的模型加载 / 编译抖动
  if (state.time < 6) return;
  const avg = state.perf.avgFps;
  if (state.perf.level === 0 && avg < 40) {
    applyPerfLevel(1);
  } else if (state.perf.level === 1 && avg < 30) {
    applyPerfLevel(2);
  }
}

/* ------------------------------------------------------------------ */
/* 虚拟光标 & 捏指选照片                                                */
/* ------------------------------------------------------------------ */

function updateHandCursor(dt) {
  const c = state.cursor;
  if (photos.isOpen) c.visible = false;
  c.x = damp(c.x, c.targetX, 16, dt);
  c.y = damp(c.y, c.targetY, 16, dt);

  if (cursorEl) {
    cursorEl.style.transform = `translate3d(${c.x.toFixed(1)}px, ${c.y.toFixed(1)}px, 0) translate(-50%, -50%)`;
    cursorEl.classList.toggle('is-visible', c.visible);
    cursorEl.classList.toggle('is-pinching', c.visible && c.pinch);
  }

  // 握拳时：手掌左右移动旋转树，上下移动改变俯仰
  if (state.gesture === 'fist' && c.visible && c.prevX !== null) {
    const dx = c.x - c.prevX;
    const dy = c.y - c.prevY;
    if (Math.abs(dx) > 0.35) tree.setSpin(-dx * 0.0045);
    if (Math.abs(dy) > 0.35) {
      state.view.pitchTarget = clamp(state.view.pitchTarget + dy * 0.0011, -0.22, 0.22);
    }
  }
  if (c.visible) {
    c.prevX = c.x;
    c.prevY = c.y;
  }
}

function updatePinchDwell() {
  if (
    !state.settings.autoPhoto ||
    !state.cursor.visible ||
    state.gesture !== 'pinch' ||
    photos.isOpen ||
    state.pinchLock
  ) {
    if (state.dwellIndex !== -1) {
      photos.highlight(-1);
      state.dwellIndex = -1;
    }
    return;
  }
  const hit = photos.findNearest(state.cursor.x, state.cursor.y, 250);
  if (!hit) {
    photos.highlight(-1);
    state.dwellIndex = -1;
    return;
  }
  if (state.dwellIndex !== hit.index) {
    state.dwellIndex = hit.index;
    state.dwellSince = performance.now();
    photos.highlight(hit.index);
  } else if (performance.now() - state.dwellSince > 380) {
    openPhotoAt(hit.index);
  }
}

/* ------------------------------------------------------------------ */
/* 交互                                                                */
/* ------------------------------------------------------------------ */

function bindInteractions() {
  const canvas = document.getElementById('scene');
  let dragging = false;
  let lastX = 0;
  let lastY = 0;

  canvas.addEventListener('pointerdown', (e) => {
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    canvas.setPointerCapture?.(e.pointerId);
  });

  canvas.addEventListener('pointermove', (e) => {
    state.pointer.x = (e.clientX / window.innerWidth - 0.5) * 2;
    state.pointer.y = (e.clientY / window.innerHeight - 0.5) * 2;
    state.pointer.has = true;
    if (!dragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    tree.setSpin(dx * 0.0055);
    state.view.pitchTarget = clamp(state.view.pitchTarget + dy * 0.0016, -0.22, 0.22);
  });

  const endDrag = () => {
    dragging = false;
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('pointerleave', () => {
    state.pointer.has = false;
  });

  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const next = clamp(state.view.zoomTarget + e.deltaY * 0.0009, 0.72, 1.55);
      state.view.zoomTarget = next;
    },
    { passive: false }
  );

  const pinchKeys = new Set();
  canvas.addEventListener(
    'touchmove',
    (e) => {
      if (e.touches.length !== 2) return;
      const [a, b] = e.touches;
      const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      if (pinchKeys.size === 0) {
        state._pinchStart = d;
        state._pinchZoom = state.view.zoomTarget;
      }
      pinchKeys.add('two');
      if (state._pinchStart) {
        state.view.zoomTarget = clamp(state._pinchZoom * (state._pinchStart / d), 0.72, 1.6);
      }
    },
    { passive: true }
  );
  canvas.addEventListener('touchend', () => {
    pinchKeys.clear();
    state._pinchStart = 0;
  });

  document.addEventListener('keydown', (e) => {
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if (e.key === ' ' || e.code === 'Space') {
      e.preventDefault();
      applyAssembled(!state.assembled);
    } else if (e.key === 'p' || e.key === 'P') {
      triggerPhoto();
    } else if (e.key === 'm' || e.key === 'M') {
      handleMusicToggle();
    } else if (e.key === 'f' || e.key === 'F') {
      toggleFullscreen();
    } else if (e.key === 'g' || e.key === 'G') {
      ui.togglePanel();
    } else if (e.key === 's' || e.key === 'S') {
      if (state.started) toggleSnow();
    } else if (e.key === 'x' || e.key === 'X') {
      if (state.started) toggleFireworks();
    } else if (e.key === 'Escape') {
      if (photos.isOpen) photos.close();
      else ui.closePanel();
    }
  });

  window.addEventListener('visibilitychange', () => {
    if (document.hidden && photos?.isOpen) photos.close();
  });
}

function toggleFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen?.().catch(() => {});
  } else {
    document.exitFullscreen?.().catch(() => {});
  }
}

/* ------------------------------------------------------------------ */
/* 启动                                                                */
/* ------------------------------------------------------------------ */

function createUI() {
  ui = new UI({
    onPhotoFiles: handlePhotoFiles,
    onDeletePhoto: handleDeletePhoto,
    onClearPhotos: handleClearPhotos,
    onFrameChange: (frame) => {
      photos.setFrame(frame);
      updateSetting({ frame });
    },
    onRequestMusicFile: () => document.getElementById('music-input')?.click(),
    onMusicFile: handleMusicFile,
    onMusicTrack: handleMusicTrack,
    onMusicToggle: handleMusicToggle,
    onVolume: (v) => {
      audio.setVolume(v);
      updateSetting({ volume: v });
    },
    onSensitivity: (v) => {
      audio.setSensitivity(v);
      updateSetting({ sensitivity: v });
    },
    onPalette: (name) => {
      tree.setPalette(name);
      updateSetting({ palette: name });
      applyGlow(state.settings.glow);
      const palette = PALETTES[name];
      if (palette) document.documentElement.style.setProperty('--accent', palette.accent);
    },
    onCount: (n) => {
      const capped = isMobile() ? Math.min(n, 9000) : n;
      tree.setCount(capped);
      updateSetting({ particleCount: n });
    },
    onGlow: (v) => {
      applyGlow(v);
      tree.setGlow(v / 100);
      updateSetting({ glow: v });
    },
    onSnow: (v) => {
      snow.setDensity(v);
      updateSetting({ snowfall: v });
    },
    onGift: (name) => {
      gifts.setStyle(name);
      updateSetting({ gift: name });
    },
    onCameraToggle: () => {
      if (tracker?.active) stopCamera();
      else startCamera({ auto: true });
    },
    onCameraStop: () => stopCamera(),
    onGestureSensitivity: (v) => {
      tracker?.setSensitivity(v);
      updateSetting({ gestureSensitivity: v });
    },
    onMirror: (v) => {
      tracker?.setMirror(v);
      document.getElementById('camera-card')?.classList.toggle('is-mirrored', v);
      updateSetting({ mirror: v });
    },
    onAutoPhoto: (v) => updateSetting({ autoPhoto: v }),
    onQuickAction: (action) => {
      if (!state.started) return;
      if (action === 'gather') applyAssembled(true);
      else if (action === 'scatter') applyAssembled(false);
      else if (action === 'photo') triggerPhoto();
    },
    onFullscreen: toggleFullscreen,
    onStartCamera: async () => {
      ui.enterExperience();
      await beginExperience();
      await startCamera({ auto: true });
    },
    onStartMouse: async () => {
      ui.enterExperience();
      await beginExperience();
      ui.toast('已进入鼠标模式 · 空格汇聚/散开，P 弹出照片，G 打开设置', 4800);
    },
    onReset: () => {
      const appearance = {
        palette: DEFAULTS.palette,
        particleCount: DEFAULTS.particleCount,
        glow: DEFAULTS.glow,
        snowfall: DEFAULTS.snowfall,
        frame: DEFAULTS.frame,
        gift: DEFAULTS.gift
      };
      Object.assign(state.settings, appearance);
      tree.setPalette(appearance.palette);
      tree.setCount(isMobile() ? Math.min(6000, appearance.particleCount) : appearance.particleCount);
      tree.setGlow(appearance.glow / 100);
      applyGlow(appearance.glow);
      state.snowing = appearance.snowfall > 0;
      snow.setEnabled(state.snowing);
      snow.setDensity(appearance.snowfall);
      gifts.setStyle(appearance.gift);
      photos.setFrame(appearance.frame);
      ui.applySettings(state.settings);
      ui.setGuideEffects({ snowing: state.snowing, fireworks: state.fireworks });
      saveSettingsSoon();
      ui.toast('已恢复默认外观');
    }
  });

  ui.loaderVisible = false;
  ui.applySettings(state.settings);
  ui.setFrame(state.settings.frame);
  ui.setCameraState('idle');
  ui.setMusicState({
    track: null,
    playing: false,
    fileName: state.music?.name,
    customReady: !!state.music
  });
}

async function beginExperience() {
  if (state.started) return;
  state.started = true;
  // 用户点击后解锁音频
  await startMusic();
  setTimeout(() => {
    if (audio.playing) ui.toast('音乐已开启 · 按 M 可静音', 2600);
  }, 900);
}

async function boot() {
  // 读取缓存
  const [storedSettings, storedPhotos, storedMusic] = await Promise.all([
    loadSettings(),
    listPhotos(),
    loadMusic()
  ]);
  state.settings = mergeSettings(storedSettings);
  state.photos = storedPhotos || [];
  state.music = storedMusic || null;

  try {
    createScene();
  } catch (err) {
    console.error('[scene] 初始化失败', err);
    document.getElementById('loader').innerHTML =
      '<p style="color:#ffd9a0;font-size:14px">当前浏览器无法启用 WebGL，请更换 Chrome / Edge / Safari 最新版</p>';
    return;
  }

  // 照片 3D 层
  photos = new PhotoLayer({
    layer: document.getElementById('photo-layer'),
    stage: document.getElementById('photo-stage'),
    stageImage: document.getElementById('pop-image'),
    stageCaption: document.getElementById('pop-caption'),
    camera,
    tree,
    onOpen: () => {
      ui.setDimmed(true);
    },
    onClose: () => {
      ui.setDimmed(false);
      state.dwellIndex = -1;
      if (state.gesture !== 'pinch') state.pinchLock = false;
    }
  });
  photos.setFrame(state.settings.frame);

  snow = new Snowfall(document.getElementById('snow'), { density: state.settings.snowfall });
  fireworks = new Fireworks(document.getElementById('fireworks'));
  cursorEl = document.getElementById('hand-cursor');
  audio = new AudioEngine({ volume: state.settings.volume, sensitivity: state.settings.sensitivity });

  tracker = new HandTracker({
    video: document.getElementById('camera'),
    canvas: document.getElementById('camera-overlay'),
    onFrame: onHandFrame,
    onStatus: (status) => {
      if (status === 'ready') ui.setCameraState('ready');
    }
  });
  tracker.setMirror(state.settings.mirror);
  tracker.setSensitivity(state.settings.gestureSensitivity);
  document.getElementById('camera-card')?.classList.toggle('is-mirrored', state.settings.mirror);

  createUI();
  syncPhotos();
  bindInteractions();
  fitCamera();
  state.perf.auto = !new URLSearchParams(location.search).has('perf-off');
  if (state.perf.auto && (navigator.hardwareConcurrency || 8) <= 4) {
    applyPerfLevel(1, true);
  }
  state.snowing = state.settings.snowfall > 0;
  snow.setEnabled(state.snowing);
  ui.setGuideEffects({ snowing: state.snowing, fireworks: false });

  // 初始就展示树（未开始交互时也缓缓聚拢）
  tree.setAssembled(true);
  tree.assemble = 0;
  tree.target = 1;
  tree.setGlow(state.settings.glow / 100);
  tree.setPalette(state.settings.palette);

  if (!window.isSecureContext) {
    ui.setIntroWarning('当前不是 HTTPS 页面，摄像头可能无法开启；可先用鼠标模式体验。');
  } else if (!navigator.mediaDevices?.getUserMedia) {
    ui.setIntroWarning('浏览器不支持摄像头，可先用鼠标模式体验。');
  }

  ui.hideLoader();
  ui.markReady();
  requestAnimationFrame(animate);

  // 调试入口，方便自动化测试
  window.__xmas = {
    state,
    tree,
    gifts,
    photos,
    audio,
    ui,
    tracker,
    fireworks,
    cycleColors,
    toggleSnow,
    toggleFireworks,
    openPhotoAt,
    applyPerfLevel,
    applyAssembled,
    triggerPhoto,
    handlePhotoFiles,
    startCamera,
    stopCamera,
    onHandFrame
  };
}

boot().catch((err) => {
  console.error('[boot]', err);
  const loader = document.getElementById('loader');
  if (loader) {
    loader.innerHTML = `<p style="color:#ffd9a0;font-size:14px">启动失败：${String(err?.message || err)}</p>`;
    loader.classList.remove('is-gone');
  }
});
