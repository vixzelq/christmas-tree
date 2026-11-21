/* 音乐引擎：内置合成颂歌 + 自定义音频 + 频谱分析 */

import { clamp, damp } from './utils.js';

const NOTE_INDEX = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 };

function midiOf(name) {
  const m = /^([A-G]#?)(-?\d)$/.exec(name);
  if (!m) return null;
  return 12 * (Number(m[2]) + 1) + NOTE_INDEX[m[1]];
}

const freqOf = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

/** 解析 "E5:1 E5:2 R:1" 形式的旋律 */
function parseMelody(str) {
  const out = [];
  for (const token of str.trim().split(/\s+/)) {
    const [name, durRaw, gainRaw] = token.split(':');
    const dur = Number(durRaw) || 1;
    const gain = gainRaw ? Number(gainRaw) : 1;
    out.push({ name, dur, gain });
  }
  return out;
}

const JINGLE_MELODY = `
  E5:1 E5:1 E5:2 E5:1 E5:1 E5:2 E5:1 G5:1 C5:1 D5:1 E5:4
  F5:1 F5:1 F5:2 F5:1 E5:1 E5:2 E5:1 D5:1 D5:1 E5:1 D5:2 G5:2
  E5:1 E5:1 E5:2 E5:1 E5:1 E5:2 E5:1 G5:1 C5:1 D5:1 E5:4
  F5:1 F5:1 F5:2 F5:1 E5:1 E5:2 G5:1 G5:1 F5:1 D5:1 C5:4
`;

const JINGLE_CHORDS = ['C4,E4,G4', 'C4,E4,G4', 'C4,E4,G4', 'C4,E4,G4', 'F4,A4,C5', 'C4,E4,G4', 'G3,B3,D4', 'C4,E4,G4',
  'C4,E4,G4', 'C4,E4,G4', 'C4,E4,G4', 'C4,E4,G4', 'F4,A4,C5', 'C4,E4,G4', 'G3,B3,D4', 'C4,E4,G4'];

const JINGLE_BASS = ['C3', 'C3', 'C3', 'C3', 'F2', 'C3', 'G2', 'C3', 'C3', 'C3', 'C3', 'C3', 'F2', 'C3', 'G2', 'C3'];

const SILENT_MELODY = `
  G4:3 A4:1 G4:2 E4:3 G4:1 A4:1 G4:1 E4:3
  A4:3 C5:1 A4:2 F4:3 A4:2 G4:1 F4:3
  D5:3 D5:1 B4:2 G4:3 A4:1 G4:2
  C5:3 B4:1 A4:2 F4:3 D4:2
`;

const SILENT_CHORDS = ['C4,E4,G4', 'C4,E4,G4', 'F4,A4,C5', 'F4,A4,C5', 'G3,B3,D4', 'G3,B3,D4', 'C4,E4,G4', 'C4,E4,G4'];
const SILENT_BASS = ['C3', 'C3', 'F2', 'F2', 'G2', 'G2', 'C3', 'C3'];

const SONGS = {
  jingle: {
    id: 'jingle',
    name: '铃儿响叮当',
    bpm: 108,
    beatsPerBar: 4,
    melody: JINGLE_MELODY,
    chords: JINGLE_CHORDS,
    bass: JINGLE_BASS,
    leadType: 'bell',
    padGain: 0.055,
    leadGain: 0.2,
    bassGain: 0.16,
    swing: 0
  },
  silent: {
    id: 'silent',
    name: '平安夜',
    bpm: 76,
    beatsPerBar: 4,
    melody: SILENT_MELODY,
    chords: SILENT_CHORDS,
    bass: SILENT_BASS,
    leadType: 'soft',
    padGain: 0.075,
    leadGain: 0.17,
    bassGain: 0.13,
    swing: 0
  }
};

function buildSong(song) {
  const events = [];
  let beat = 0;
  const notes = parseMelody(song.melody);
  for (const n of notes) {
    const midi = midiOf(n.name);
    if (midi !== null) {
      events.push({ beat, dur: Math.max(0.25, n.dur * 0.92), type: 'lead', midi, gain: n.gain });
    }
    beat += n.dur;
  }
  const totalBeats = Math.ceil(beat / song.beatsPerBar) * song.beatsPerBar;
  const bars = totalBeats / song.beatsPerBar;
  for (let b = 0; b < bars; b++) {
    const chord = song.chords[b % song.chords.length].split(',');
    const bassNote = song.bass[b % song.bass.length];
    const start = b * song.beatsPerBar;
    events.push({ beat: start, dur: song.beatsPerBar, type: 'pad', midis: chord.map(midiOf), gain: song.padGain });
    events.push({ beat: start, dur: song.beatsPerBar * 0.85, type: 'bass', midi: midiOf(bassNote), gain: song.bassGain });
    if (song.id === 'silent') {
      // 音乐盒式琶音
      const arp = chord.map(midiOf).concat([midiOf(chord[1]) + 12]);
      for (let k = 0; k < song.beatsPerBar; k++) {
        events.push({
          beat: start + k,
          dur: 1.2,
          type: 'lead',
          midi: arp[k % arp.length] + 12,
          gain: 0.055
        });
      }
    } else {
      // 轻巧的铃铛点缀
      events.push({ beat: start + 2, dur: 0.8, type: 'lead', midi: midiOf(song.chords[b % 8].split(',')[2]) + 12, gain: 0.05 });
    }
  }
  events.sort((a, b) => a.beat - b.beat);
  return { events, totalBeats };
}

export class AudioEngine {
  constructor({ volume = 60, sensitivity = 70 } = {}) {
    this.volume = volume / 100;
    this.sensitivity = sensitivity / 100;
    this.ctx = null;
    this.analyser = null;
    this.master = null;
    this.reverb = null;
    this.playing = false;
    this.currentTrack = null; // 'jingle' | 'silent' | 'custom'
    this.fileName = null;
    this.song = null;
    this.timeline = null;
    this.eventIndex = 0;
    this.loopStart = 0;
    this.beatDur = 0.5;
    this.lastBeatAt = 0;
    this.beatPulse = 0;
    this.bassAvg = 0;
    this.metrics = { energy: 0, bass: 0, mid: 0, treble: 0, beat: 0 };
    this.freq = null;
    this.audioEl = null;
    this.mediaSource = null;
    this._schedulerTimer = null;
    this._customObjectUrl = null;
    this._customBlob = null;
    this.synthesisCache = new Map();
    this.onTrackChange = null;
    this.ready = false;
  }

  async ensureContext() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') await this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) throw new Error('当前浏览器不支持 Web Audio');
    const ctx = new Ctx();
    this.ctx = ctx;

    const master = ctx.createGain();
    master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.knee.value = 22;
    comp.ratio.value = 3;
    comp.attack.value = 0.004;
    comp.release.value = 0.22;

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.72;
    this.freq = new Uint8Array(analyser.frequencyBinCount);

    master.connect(comp);
    comp.connect(analyser);
    analyser.connect(ctx.destination);
    this.master = master;
    this.analyser = analyser;

    // 简单混响
    const reverb = ctx.createConvolver();
    reverb.buffer = this._makeImpulse(2.4, 2.1);
    const wet = ctx.createGain();
    wet.gain.value = 0.32;
    reverb.connect(wet);
    wet.connect(master);
    this.reverb = reverb;

    this.ready = true;
    if (ctx.state === 'suspended') await ctx.resume();
  }

  _makeImpulse(seconds, decay) {
    const rate = this.ctx.sampleRate;
    const len = Math.floor(rate * seconds);
    const buffer = this.ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buffer.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay) * (1 - t * 0.15);
      }
    }
    return buffer;
  }

  _ensureSong(songId) {
    if (this.synthesisCache.has(songId)) return this.synthesisCache.get(songId);
    const song = SONGS[songId];
    if (!song) return null;
    const built = { song, ...buildSong(song) };
    this.synthesisCache.set(songId, built);
    return built;
  }

  /* ---------------- 播放控制 ---------------- */

  async playSynth(trackId) {
    await this.ensureContext();
    if (this.audioEl) this.audioEl.pause();
    const built = this._ensureSong(trackId);
    if (!built) return false;
    this.stopScheduler();
    this.currentTrack = trackId;
    this.built = built;
    this.song = built.song;
    this.timeline = built.events;
    this.eventIndex = 0;
    this.beatDur = 60 / this.song.bpm;
    this.loopStart = this.ctx.currentTime + 0.18;
    this.playing = true;
    this._masterRamp(this.volume, 1.2);
    this._startScheduler();
    this.onTrackChange?.(this.currentTrack);
    return true;
  }

  async playFile(file) {
    await this.ensureContext();
    this.stopScheduler();
    if (this.audioEl) {
      this.audioEl.pause();
    }
    if (this._customObjectUrl) URL.revokeObjectURL(this._customObjectUrl);
    this._customObjectUrl = URL.createObjectURL(file);
    const el = new Audio(this._customObjectUrl);
    el.loop = true;
    el.preload = 'auto';
    el.crossOrigin = 'anonymous';

    // 释放上一段音频的节点，避免重复创建 MediaElementSource
    if (this.mediaSource) {
      try {
        this.mediaSource.disconnect();
      } catch {
        /* noop */
      }
      this.mediaSource = null;
    }

    this.audioEl = el;
    this.mediaSource = this.ctx.createMediaElementSource(el);
    this.mediaSource.connect(this.master);
    this.fileName = file.name || '我的音乐';
    this.currentTrack = 'custom';
    this.playing = true;
    this._masterRamp(this.volume, 1.0);
    try {
      await el.play();
    } catch (err) {
      console.warn('[audio] 播放失败', err);
      this.playing = false;
      return false;
    }
    this.onTrackChange?.(this.currentTrack);
    return true;
  }

  _masterRamp(target, seconds = 0.6) {
    if (!this.master) return;
    const now = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setValueAtTime(Math.max(0.0001, this.master.gain.value), now);
    this.master.gain.linearRampToValueAtTime(target, now + seconds);
  }

  setVolume(v) {
    this.volume = clamp(v / 100, 0, 1);
    if (this.playing) this._masterRamp(this.volume, 0.25);
  }

  setSensitivity(v) {
    this.sensitivity = clamp(v / 100, 0, 1);
  }

  async toggle() {
    if (this.playing) {
      await this.pause();
      return false;
    }
    if (this.currentTrack === 'custom') {
      if (this.audioEl) {
        await this.ensureContext();
        this.playing = true;
        this._masterRamp(this.volume, 0.4);
        await this.audioEl.play().catch(() => {});
      } else {
        return false;
      }
    } else if (this.currentTrack && SONGS[this.currentTrack]) {
      await this.playSynth(this.currentTrack);
    } else {
      await this.playSynth('jingle');
    }
    return this.playing;
  }

  async pause() {
    this.playing = false;
    this._masterRamp(0.0001, 0.3);
    if (this.audioEl) this.audioEl.pause();
    if (this.ctx && this.ctx.state === 'running') {
      // 暂停调度，但保留时间基准
      this.stopScheduler();
    }
  }

  async stop() {
    await this.pause();
    this.currentTrack = null;
  }

  /* ---------------- 合成器调度 ---------------- */

  _startScheduler() {
    this._stopFlag = false;
    this._scheduleAhead();
    this._schedulerTimer = setInterval(() => this._scheduleAhead(), 70);
  }

  stopScheduler() {
    this._stopFlag = true;
    if (this._schedulerTimer) clearInterval(this._schedulerTimer);
    this._schedulerTimer = null;
  }

  _scheduleAhead() {
    if (!this.playing || !this.ctx || this._stopFlag) return;
    const ctx = this.ctx;
    const lookahead = 0.28;
    const now = ctx.currentTime;
    const events = this.timeline;
    if (!events || !events.length) return;
    const totalBeats = this.built.totalBeats;

    // 如果落后太多（标签页休眠），直接跳到当前
    if (this.loopStart + totalBeats * this.beatDur < now - 0.5) {
      this.loopStart = now + 0.1;
    }

    let guard = 0;
    while (guard++ < 240) {
      const ev = events[this.eventIndex];
      if (!ev) {
        this.loopStart += totalBeats * this.beatDur;
        this.eventIndex = 0;
        continue;
      }
      const when = this.loopStart + ev.beat * this.beatDur;
      if (when > now + lookahead) break;
      if (when >= now - 0.06) this._scheduleEvent(ev, Math.max(when, now + 0.005));
      this.eventIndex++;
    }
  }

  _scheduleEvent(ev, when) {
    const ctx = this.ctx;
    const dest = this.master;
    const reverb = this.reverb;
    if (!dest) return;

    if (ev.type === 'lead') {
      const freq = freqOf(ev.midi);
      const dur = Math.max(0.18, ev.dur * this.beatDur);
      const gain = ctx.createGain();
      const peak = this.song.leadGain * ev.gain;
      gain.gain.setValueAtTime(0.0001, when);
      gain.gain.linearRampToValueAtTime(peak, when + 0.008);
      gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak * 0.28), when + Math.min(0.35, dur * 0.6));
      gain.gain.exponentialRampToValueAtTime(0.0001, when + dur + 0.5);

      const osc = ctx.createOscillator();
      osc.type = this.song.leadType === 'soft' ? 'triangle' : 'sine';
      osc.frequency.value = freq;

      const shimmer = ctx.createOscillator();
      shimmer.type = 'sine';
      shimmer.frequency.value = freq * 2.002;
      const shimmerGain = ctx.createGain();
      shimmerGain.gain.value = this.song.leadType === 'soft' ? 0.12 : 0.26;

      osc.connect(gain);
      shimmer.connect(shimmerGain).connect(gain);
      gain.connect(dest);
      if (reverb) {
        const send = ctx.createGain();
        send.gain.value = this.song.leadType === 'soft' ? 0.55 : 0.4;
        gain.connect(send).connect(reverb);
      }

      osc.start(when);
      shimmer.start(when);
      osc.stop(when + dur + 0.65);
      shimmer.stop(when + dur + 0.65);
    } else if (ev.type === 'pad') {
      const dur = ev.dur * this.beatDur;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 1100;
      filter.Q.value = 0.4;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, when);
      gain.gain.linearRampToValueAtTime(ev.gain, when + dur * 0.35);
      gain.gain.linearRampToValueAtTime(0.0001, when + dur + 0.9);
      filter.connect(gain).connect(dest);
      if (reverb) {
        const send = ctx.createGain();
        send.gain.value = 0.7;
        gain.connect(send).connect(reverb);
      }
      for (const midi of ev.midis) {
        if (midi == null) continue;
        for (const detune of [-4, 4]) {
          const osc = ctx.createOscillator();
          osc.type = 'triangle';
          osc.frequency.value = freqOf(midi);
          osc.detune.value = detune;
          osc.connect(filter);
          osc.start(when);
          osc.stop(when + dur + 1);
        }
      }
    } else if (ev.type === 'bass') {
      const freq = freqOf(ev.midi);
      const dur = Math.max(0.4, ev.dur * this.beatDur);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, when);
      gain.gain.linearRampToValueAtTime(ev.gain, when + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, when + dur);
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;
      osc.connect(gain).connect(dest);
      osc.start(when);
      osc.stop(when + dur + 0.1);
    }
  }

  /* ---------------- 分析 ---------------- */

  getSpectrum(bars = 28) {
    if (!this.analyser) return new Array(bars).fill(0);
    const data = this.freq;
    this.analyser.getByteFrequencyData(data);
    const out = new Array(bars).fill(0);
    const maxBin = Math.min(data.length, 420);
    for (let i = 0; i < bars; i++) {
      const f0 = Math.floor(Math.pow(i / bars, 1.8) * maxBin);
      const f1 = Math.max(f0 + 1, Math.floor(Math.pow((i + 1) / bars, 1.8) * maxBin));
      let sum = 0;
      for (let k = f0; k < f1; k++) sum += data[k];
      out[i] = sum / (f1 - f0) / 255;
    }
    return out;
  }

  update(dt) {
    if (!this.analyser) return this.metrics;
    this.analyser.getByteFrequencyData(this.freq);
    const data = this.freq;
    const binHz = this.ctx.sampleRate / this.analyser.fftSize;
    const avg = (fromHz, toHz) => {
      const a = Math.max(0, Math.floor(fromHz / binHz));
      const b = Math.min(data.length - 1, Math.floor(toHz / binHz));
      let sum = 0;
      for (let i = a; i <= b; i++) sum += data[i];
      return sum / Math.max(1, b - a + 1) / 255;
    };

    const bass = avg(28, 150);
    const mid = avg(150, 2000);
    const treble = avg(2000, 11000);
    const sens = 0.55 + this.sensitivity * 0.9;

    const targetEnergy = clamp((bass * 0.55 + mid * 0.32 + treble * 0.18) * sens * 1.9);
    this.metrics.energy = damp(this.metrics.energy, this.playing ? targetEnergy : 0, 6, dt);
    this.metrics.bass = damp(this.metrics.bass, clamp(bass * sens * 1.8), 10, dt);
    this.metrics.mid = damp(this.metrics.mid, clamp(mid * sens * 1.8), 10, dt);
    this.metrics.treble = damp(this.metrics.treble, clamp(treble * sens * 2.2), 12, dt);

    // 简易节拍检测
    this.bassAvg = this.bassAvg * (1 - dt * 1.6) + bass * dt * 1.6;
    this.beatPulse = Math.max(0, this.beatPulse - dt * 3.4);
    const now = this.ctx.currentTime;
    if (this.playing && bass > this.bassAvg * 1.35 + 0.04 && bass > 0.18 && now - this.lastBeatAt > 0.24) {
      this.lastBeatAt = now;
      this.beatPulse = 1;
    }
    this.metrics.beat = this.beatPulse;

    if (!this.playing) {
      for (const k of ['bass', 'mid', 'treble']) this.metrics[k] = damp(this.metrics[k], 0, 3, dt);
    }
    return this.metrics;
  }
}
