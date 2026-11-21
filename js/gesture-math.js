/* 手势数学 v2：为每根手指打分，再给每个手势打分，取最高分
   支持：握拳 / 摊手 / 捏指 / 一指 / 二指 / 三指
   纯函数，便于单元测试与调参 */

const FINGERS = [
  { name: 'thumb', chain: [1, 2, 3, 4] },
  { name: 'index', chain: [5, 6, 7, 8] },
  { name: 'middle', chain: [9, 10, 11, 12] },
  { name: 'ring', chain: [13, 14, 15, 16] },
  { name: 'pinky', chain: [17, 18, 19, 20] }
];

export const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17]
];

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, (a.z - b.z) * 0.55);
const mean = (arr) => arr.reduce((s, v) => s + v, 0) / arr.length;

function toPoints(landmarks, aspect) {
  return landmarks.map((p) => ({ x: p.x * aspect, y: p.y, z: (p.z || 0) * aspect }));
}

/** 手指伸直程度 0（蜷曲）→ 1（笔直） */
function fingerScore(pts, chain, wrist) {
  const [mcp, pip, , tip] = chain.map((i) => pts[i]);
  const u = { x: mcp.x - pip.x, y: mcp.y - pip.y, z: mcp.z - pip.z };
  const v = { x: tip.x - pip.x, y: tip.y - pip.y, z: tip.z - pip.z };
  const lu = Math.hypot(u.x, u.y, u.z) || 1e-6;
  const lv = Math.hypot(v.x, v.y, v.z) || 1e-6;
  const cos = (u.x * v.x + u.y * v.y + u.z * v.z) / (lu * lv);
  const straight = clamp01((-cos + 0.1) / 0.9);

  const reach = dist(tip, wrist) / (dist(pip, wrist) || 1e-6);
  const reachScore = clamp01((reach - 0.98) / 0.5);

  const tipToPalm = dist(tip, wrist) / (dist(pip, wrist) || 1e-6);
  const tipScore = clamp01((tipToPalm - 0.9) / 0.7);

  return clamp01(straight * 0.72 + reachScore * 0.18 + tipScore * 0.1);
}

/** 拇指是否离开掌心（用于区分「一指」和「捏指」） */
function thumbOutScore(pts, palmSize) {
  const t = dist(pts[4], pts[9]) / palmSize; // 拇指尖到中指根
  return clamp01((t - 0.35) / 0.55);
}

/**
 * 分析一只手的姿态
 * @returns {{gesture:'fist'|'palm'|'pinch'|'point'|'peace'|'three'|'none',
 *   score:number, scores:Object, fingers:number[], extended:number,
 *   pinchRatio:number, pointer:{x:number,y:number}, palm:{x:number,y:number},
 *   palmSize:number}}
 */
export function analyzeHand(landmarks, aspect = 4 / 3) {
  const empty = {
    gesture: 'none',
    score: 0,
    scores: {},
    fingers: [0, 0, 0, 0, 0],
    extended: 0,
    pinchRatio: 1,
    pointer: { x: 0.5, y: 0.5 },
    palm: { x: 0.5, y: 0.5 },
    palmSize: 0
  };
  if (!landmarks || landmarks.length < 21) return empty;

  const pts = toPoints(landmarks, aspect);
  const wrist = pts[0];
  const palmSize = Math.max(0.02, dist(wrist, pts[9]));
  const fingers = FINGERS.map((f) => fingerScore(pts, f.chain, wrist));
  const [, indexS, middleS, ringS, pinkyS] = fingers;
  const ext = [indexS, middleS, ringS, pinkyS];
  const avg = mean(ext);
  const min = Math.min(...ext);
  const max = Math.max(...ext);

  const pinchRatio = dist(pts[4], pts[8]) / palmSize; // 拇指尖 ↔ 食指尖
  const thumbOut = thumbOutScore(pts, palmSize);
  const extended = ext.filter((s) => s > 0.6).length;

  const clampedPinch = clamp01((0.48 - pinchRatio) / 0.3);
  const scores = {
    pinch: clampedPinch * clamp01(indexS / 0.45) * (0.55 + 0.45 * clamp01(thumbOut + 0.4)),
    fist: clamp01(1 - (0.35 * avg + 0.65 * max)),
    palm: clamp01(0.4 * avg + 0.6 * min),
    point: indexS * (1 - middleS) * (1 - ringS) * (1 - pinkyS) * clamp01((pinchRatio - 0.4) / 0.22),
    peace: indexS * middleS * (1 - ringS) * (1 - pinkyS),
    three: indexS * middleS * ringS * (1 - pinkyS)
  };

  let gesture = 'none';
  let best = 0.34;
  for (const key of ['pinch', 'three', 'peace', 'point', 'palm', 'fist']) {
    if (scores[key] > best) {
      best = scores[key];
      gesture = key;
    }
  }
  // 握拳时拇指常压住手指，捏指必须食指仍是伸展的，避免误判
  if (gesture === 'pinch' && indexS < 0.4) {
    gesture = scores.fist > 0.4 ? 'fist' : 'none';
    best = scores[gesture] || 0;
  }

  const palm = {
    x: (wrist.x + pts[5].x + pts[9].x + pts[13].x + pts[17].x) / 5,
    y: (wrist.y + pts[5].y + pts[9].y + pts[13].y + pts[17].y) / 5
  };
  const pointer = {
    x: (pts[4].x + pts[8].x) / 2,
    y: (pts[4].y + pts[8].y) / 2
  };

  return {
    gesture,
    score: clamp01(best),
    scores,
    fingers,
    extended,
    pinchRatio,
    pointer,
    palm,
    palmSize
  };
}

/** 手势稳定器：多数表决 + 迟滞，避免画面抖动导致状态乱跳 */
export class GestureStabilizer {
  constructor({ windowSize = 7, threshold = 4 } = {}) {
    this.windowSize = windowSize;
    this.threshold = threshold;
    this.history = [];
    this.current = 'none';
  }

  push(gesture) {
    this.history.push(gesture);
    if (this.history.length > this.windowSize) this.history.shift();

    const counts = {};
    for (const g of this.history) counts[g] = (counts[g] || 0) + 1;
    let best = this.current;
    let bestCount = 0;
    for (const [g, c] of Object.entries(counts)) {
      if (c > bestCount) {
        best = g;
        bestCount = c;
      }
    }
    if (bestCount >= this.threshold && best !== this.current) {
      this.current = best;
    }
    return this.current;
  }

  reset() {
    this.history = [];
    this.current = 'none';
  }
}
