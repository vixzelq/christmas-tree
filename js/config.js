/* 调色板与外观预设 */

export const PALETTES = {
  gold: {
    name: '金辉圣诞',
    accent: '#ffd98a',
    accentSoft: 'rgba(255,217,138,.16)',
    star: '#ffe7b0',
    ground: 'rgba(255,196,110,.16)',
    colors: ['#ffcb63', '#ffe6b8', '#fff6e6', '#63e6a8', '#ff5e6e', '#c9a0ff'],
    weights: [0.46, 0.18, 0.08, 0.15, 0.08, 0.05],
    bloom: 0.86,
    giftGlow: 0.55
  },
  aurora: {
    name: '极光雪松',
    accent: '#7cf2d4',
    accentSoft: 'rgba(124,242,212,.16)',
    star: '#c9fff0',
    ground: 'rgba(110,230,210,.16)',
    colors: ['#7cf2d4', '#a8ffe8', '#ffffff', '#8ea7ff', '#c98cff', '#ffd98a'],
    weights: [0.4, 0.2, 0.07, 0.2, 0.08, 0.05],
    bloom: 0.92,
    giftGlow: 0.6
  },
  rose: {
    name: '玫瑰颂歌',
    accent: '#ffb3c6',
    accentSoft: 'rgba(255,179,198,.16)',
    star: '#ffe3ea',
    ground: 'rgba(255,160,180,.16)',
    colors: ['#ffb3c6', '#ffd9e2', '#fff5f8', '#ffd98a', '#ff7a8a', '#e8b4ff'],
    weights: [0.4, 0.2, 0.08, 0.18, 0.09, 0.05],
    bloom: 0.88,
    giftGlow: 0.52
  },
  ice: {
    name: '冰晶幻境',
    accent: '#8fd8ff',
    accentSoft: 'rgba(143,216,255,.16)',
    star: '#e6f8ff',
    ground: 'rgba(150,215,255,.16)',
    colors: ['#cfe9ff', '#8fd8ff', '#ffffff', '#e8f6ff', '#9aa8ff', '#ffd98a'],
    weights: [0.34, 0.24, 0.14, 0.14, 0.09, 0.05],
    bloom: 0.95,
    giftGlow: 0.58
  }
};

export const GIFT_STYLES = {
  classic: { name: '红金经典', box: '#c8202f', boxDeep: '#7d0f1c', ribbon: '#ffd98a', glow: '#ffb15a' },
  emerald: { name: '翡翠丝带', box: '#0f5b47', boxDeep: '#073328', ribbon: '#d9f5e6', glow: '#6fe3b0' },
  macaron: { name: '粉雪马卡龙', box: '#f2b5c4', boxDeep: '#c98a9b', ribbon: '#fff0f5', glow: '#ffb9cb' },
  ice: { name: '冰蓝星尘', box: '#8fd8ff', boxDeep: '#4a8fb8', ribbon: '#f4fbff', glow: '#9fe4ff' }
};

export const FRAME_STYLES = {
  polaroid: '宝丽来 · 留白',
  gold: '金边 · 古典',
  glass: '极光玻璃',
  wreath: '花环暗纹'
};

export const PALETTE_KEYS = Object.keys(PALETTES);
export const GIFT_KEYS = Object.keys(GIFT_STYLES);
export const FRAME_KEYS = Object.keys(FRAME_STYLES);

export const DEFAULTS = {
  palette: 'gold',
  particleCount: 9000,
  glow: 70,
  snowfall: 50,
  frame: 'polaroid',
  gift: 'classic',
  volume: 60,
  sensitivity: 70,
  gestureSensitivity: 60,
  mirror: true,
  autoPhoto: true,
  track: 'jingle'
};

export const MAX_PHOTOS = 12;

export const TREE = {
  height: 6.9,
  radius: 3.05,
  trunkHeight: 0.9,
  groundY: -0.02
};

export const COLOR_PAIRS = [
  { palette: 'gold', gift: 'classic', label: '金辉圣诞 · 红金礼盒' },
  { palette: 'aurora', gift: 'emerald', label: '极光雪松 · 翡翠礼盒' },
  { palette: 'rose', gift: 'macaron', label: '玫瑰颂歌 · 粉雪礼盒' },
  { palette: 'ice', gift: 'ice', label: '冰晶幻境 · 冰蓝礼盒' }
];

export const GESTURE_LABELS = {
  fist: { label: '握拳 · 汇聚成树', hint: '左右上下移动手掌，可以旋转圣诞树' },
  palm: { label: '摊手 · 粒子散升', hint: '让星尘飞向夜空' },
  pinch: { label: '捏指 · 选中照片', hint: '把光标移到照片上，照片会飞出来放大' },
  point: { label: '一指 · 换色', hint: '粒子与礼盒一起换一套配色' },
  peace: { label: '两指 · 下雪', hint: '再比一次两指，雪就停了' },
  three: { label: '三指 · 烟花', hint: '再比一次三指，烟花就停了' },
  idle: { label: '等待手势', hint: '握拳成树 · 摊手散开 · 捏指看照片' }
};

export const CAPTIONS = ['Merry Christmas', '愿你所愿皆成真', '把这一刻留给你', '新年快乐', '与你共度的每个冬天'];
