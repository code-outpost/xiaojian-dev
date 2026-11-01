'use strict';
/**
 * 活体引擎 · 情绪系统
 * 用 PAD 模型（愉悦 Pleasure / 唤醒 Arousal / 支配 Dominance）把
 * 现有的 mood/energy/intimacy 数值 + 互动事件，变成一个「连续的、会流动的情绪」，
 * 再映射成一组姿势/表情目标参数交给骨架渲染。
 * —— 宠物因此拥有「自己的真实情绪」，而不是死板的几种预设帧。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LiveEmotion = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // 注意：此处不能用外层 IIFE 的形参 root（不在 factory 闭包内），浏览器里取全局 self
  const M = (typeof require !== 'undefined') ? require('./math.js') : (typeof self !== 'undefined' ? self : globalThis).LiveMath;
  const { clamp, map, lerp } = M;

  // 事件 → 对 PAD 的瞬时冲量（被衰减）
  const IMPULSES = {
    petting:  { p: 0.22, a: 0.10, d: 0.12 },
    poke:     { p: 0.10, a: 0.18, d: 0.00 },
    happy:    { p: 0.45, a: 0.30, d: 0.10 },
    excited:  { p: 0.35, a: 0.55, d: 0.05 },
    greet:    { p: 0.30, a: 0.20, d: 0.05 },
    sad:      { p: -0.45, a: -0.10, d: -0.10 },
    scold:    { p: -0.30, a: 0.20, d: -0.20 },
    surprise: { p: 0.15, a: 0.45, d: -0.05 },
    calm:     { p: 0.10, a: -0.25, d: 0.05 },
    sleep:    { p: 0.05, a: -0.80, d: 0.00 },
    wake:     { p: 0.20, a: 0.35, d: 0.10 }
  };

  function Emotion() {
    // 连续 PAD（会被冲量推动，再向基线回归）
    this.p = 0.4; this.a = 0.25; this.d = 0.2;
    // 基线（由 stats 决定，缓慢追随）
    this.baseP = 0.4; this.baseA = 0.25; this.baseD = 0.2;
    this.sleeping = false;
    this.stats = { mood: 82, energy: 68, intimacy: 24 };
    this.impP = 0; this.impA = 0; this.impD = 0;
    this.t = 0;
  }

  Emotion.prototype.setStats = function (s) {
    if (!s) return;
    this.stats = {
      mood: clamp(s.mood ?? this.stats.mood, 0, 100),
      energy: clamp(s.energy ?? this.stats.energy, 0, 100),
      intimacy: clamp(s.intimacy ?? this.stats.intimacy, 0, 100)
    };
    // 基线：心情→愉悦，精力→唤醒，亲密度→支配(自信/亲近)
    this.baseP = map(this.stats.mood, 0, 100, -0.55, 0.85);
    this.baseA = map(this.stats.energy, 0, 100, -0.65, 0.75);
    this.baseD = map(this.stats.intimacy, 0, 100, -0.3, 0.55);
  };

  Emotion.prototype.setSleeping = function (on) {
    if (this.sleeping === on) return;
    this.sleeping = on;
    if (on) this.impulse('sleep'); else this.impulse('wake');
  };

  /** 施加一次情绪冲量（事件驱动）。name 来自 IMPULSES，amt 默认 1 */
  Emotion.prototype.impulse = function (name, amt = 1) {
    const im = IMPULSES[name];
    if (!im) return;
    this.impP += im.p * amt;
    this.impA += im.a * amt;
    this.impD += im.d * amt;
  };

  /**
   * 每帧更新，返回「姿势/表情目标」。dt 秒。
   * 返回的 target 全部是归一化的语义量，由引擎解释成整体形变（位移/旋转/挤压拉伸）。
   */
  Emotion.prototype.update = function (dt) {
    this.t += dt;
    // 冲量衰减
    const decay = Math.exp(-1.1 * dt);
    this.impP *= decay; this.impA *= decay; this.impD *= decay;

    // 当前目标 = 基线 + 冲量，并夹紧
    let tp = clamp(this.baseP + this.impP, -1, 1);
    let ta = clamp(this.baseA + this.impA, -1, 1);
    let td = clamp(this.baseD + this.impD, -1, 1);

    if (this.sleeping) { ta = -0.85; tp = 0.05; td = -0.1; }

    // 平滑追随（让情绪「流动」而非跳变）
    this.p = lerp(this.p, tp, 1 - Math.exp(-3.2 * dt));
    this.a = lerp(this.a, ta, 1 - Math.exp(-4.0 * dt));
    this.d = lerp(this.d, td, 1 - Math.exp(-2.6 * dt));

    return this.target();
  };

  /** 把当前 PAD 转成姿势目标 */
  Emotion.prototype.target = function () {
    const p = this.p, a = this.a, d = this.d;
    const asleep = this.sleeping;

    const eyeOpen = clamp(map(a, -0.8, 0.35, 0.12, 0.92), 0.1, 1);
    const blinkRate = clamp(map(a, -0.6, 0.9, 0.12, 0.9), 0.1, 1.1); // 次/秒基准
    const mouthCurve = clamp(p * 0.9 + (a > 0.5 ? 0.15 : 0), -1, 1);  // 嘴角弧度
    const brow = clamp(-p * 0.8 + (p < -0.2 ? -a * 0.3 : 0), -1, 1);  // 眉：+怒/严肃，-放松愉悦
    const blush = clamp(this.stats.intimacy / 100 * 0.55 + Math.max(0, p) * 0.4, 0, 1);
    const bobAmp = asleep ? 0.6 : clamp(map(a, -0.5, 0.9, 1.2, 9), 0.5, 10);
    const bobFreq = clamp(map(a, -0.5, 0.9, 0.45, 2.2), 0.4, 2.4);
    const lean = clamp(p * 4 + (a > 0.3 ? -2 : 0) + this.stats.intimacy / 100 * 3, -9, 12);
    const swayAmp = asleep ? 0.4 : clamp(map(a, -0.6, 0.9, 0.8, 5), 0.4, 5.5);
    const swayFreq = 0.5 + Math.abs(a) * 0.6;
    const tailWag = asleep ? 0 : clamp(a * 0.5 + Math.max(0, p) * 0.5, 0, 1);
    const earTwitch = clamp(Math.abs(a) * 0.6, 0, 1);
    const armSpread = clamp(map(p, -0.6, 0.9, 0.18, 1), 0.1, 1.1);
    const fidget = asleep ? 0 : clamp(map(a, -0.3, 0.9, 0, 1), 0, 1);
    const glow = clamp(Math.max(0, p) * 0.8 + (asleep ? -0.3 : 0), -0.3, 1); // 配色提亮

    return {
      eyeOpen, blinkRate, mouthCurve, brow, blush,
      bobAmp, bobFreq, lean, swayAmp, swayFreq,
      tailWag, earTwitch, armSpread, fidget, glow,
      asleep
    };
  };

  return Emotion;
});
