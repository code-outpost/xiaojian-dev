'use strict';
/**
 * 活体引擎 · 动作库 + 自发调度器
 *
 * 宠物形象用的是**原始立绘**（一张张静态图），没有关节可以单独驱动，
 * 所以动作全部表达为「整体形变」：位移 / 旋转 / 挤压拉伸。
 * 别小看这四样——squash & stretch（挤压拉伸）做对了，静态图也会有重量感和生命感。
 *
 * 每个动作 sample(t, ctx)：t 是 0..1 的进度，返回相对「情绪基底」的增量：
 *   x/y   像素位移（y 为负 = 向上）
 *   rot   旋转角度（度）
 *   sx/sy 水平 / 垂直缩放
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LiveActions = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const TAU = Math.PI * 2, PI = Math.PI;
  const sin = Math.sin, abs = Math.abs;

  const ACTIONS = {
    // 挥手：左右摇摆 + 轻弹
    wave(t) { const w = sin(t * TAU * 2.2); return { x: w * 7, rot: w * 6, y: -abs(w) * 3 }; },

    // 欢呼：连蹦两下
    cheer(t) { const b = abs(sin(t * PI * 2)); return { y: -b * 18, sy: 1 + b * 0.035, sx: 1 - b * 0.025 }; },

    // 跳跃：起跳拉伸、落地压扁（「有重量感」的关键）
    jump(t) {
      const up = sin(t * PI);
      const land = t < 0.12 ? (0.12 - t) / 0.12 : (t > 0.88 ? (t - 0.88) / 0.12 : 0);
      return {
        y: -Math.max(0, up) * 46 - land * 3,
        sy: (up > 0 ? 1 + up * 0.075 : 1) - land * 0.09,
        sx: (up > 0 ? 1 - up * 0.045 : 1) + land * 0.07
      };
    },

    // 跳舞：横挪 + 扭身
    dance(t) { const s = sin(t * TAU * 2.4); return { x: s * 11, rot: s * 9, y: -abs(s) * 5 }; },

    // 伸懒腰：向上拉长
    stretch(t) { const e = sin(t * PI); return { y: -e * 10, sy: 1 + e * 0.08, sx: 1 - e * 0.04 }; },

    // 鞠躬：前倾下压
    bow(t) { const e = sin(t * PI); return { y: e * 7, rot: e * 7, sy: 1 - e * 0.05, sx: 1 + e * 0.03 }; },

    // 偷看：探身 + 歪身
    peek(t) { const s = sin(t * TAU * 1.4); return { x: 9 + s * 4, rot: 8 + s * 3 }; },

    // 转圈：2D 立绘不做真旋转（会翻成背面很难看），改成左右大摆
    spin(t) { const s = sin(t * TAU); return { rot: s * 16, x: s * 8, y: -abs(s) * 6 }; },

    // 打哈欠：下沉 + 舒展
    yawn(t) { const e = sin(t * PI); return { y: e * 8, sy: 1 + e * 0.04, rot: -e * 3 }; },

    // 举牌（提醒）
    holdSign() { return { rot: 2, y: -2 }; },

    // 打字：极小幅高频抖动
    type(t) { const s = sin(t * TAU * 6); return { x: s * 1.4, y: abs(s) * 1.2 }; },

    // 被戳：弹性压扁再回弹
    pop(t) { const e = Math.exp(-t * 5) * sin(t * PI * 3); return { sx: 1 + e * 0.1, sy: 1 - e * 0.09 }; },

    // 比心：轻轻上弹
    heart(t) { const e = sin(t * PI); return { y: -e * 9, sx: 1 + e * 0.045, rot: -e * 3 }; },

    // 呼噜：细碎摇晃
    purr(t) { const s = sin(t * TAU * 1.6); return { x: s * 2.4, sy: 1 + s * 0.02 }; },

    // 指向：微侧身
    point(t) { const e = sin(t * PI); return { rot: -4 * e, x: -4 * e }; },

    // 坐下：整体下沉、压扁
    sit(t) { const e = sin(t * PI); return { y: e * 16, sy: 1 - e * 0.09, sx: 1 + e * 0.03 }; }
  };

  const DEFAULT_DUR = {
    wave: 1.6, cheer: 1.2, jump: 0.9, dance: 2.4, stretch: 2.0, bow: 1.4,
    peek: 1.8, spin: 1.2, yawn: 2.2, holdSign: 9999, type: 1.0, pop: 0.4,
    heart: 1.6, purr: 1.8, point: 1.4, sit: 1.6
  };

  /** 自发动作调度：没被指定动作时，按情绪择机做点小动作，让宠物「自己会动」 */
  function IdleScheduler() {
    this.current = null;     // { name, t, dur }
    this.cooldown = 3.5;
  }

  IdleScheduler.prototype.force = function (name, dur) {
    const d = dur || DEFAULT_DUR[name] || 1.6;
    this.current = { name, t: 0, dur: d };
  };

  IdleScheduler.prototype.clear = function () { this.current = null; };

  IdleScheduler.prototype.update = function (dt, emo) {
    if (this.current) {
      this.current.t += dt;
      if (this.current.t >= this.current.dur) this.current = null;
      else return this.current;
    }
    this.cooldown -= dt;
    if (this.cooldown > 0) return null;
    const a = emo.a, p = emo.p;
    let pool;
    if (a > 0.45) pool = ['jump', 'cheer', 'dance', 'wave'];
    else if (p > 0.4) pool = ['wave', 'heart', 'stretch', 'peek'];
    else if (a < -0.3) pool = ['yawn', 'sit', 'stretch'];
    else pool = ['peek', 'stretch', 'wave', 'sit'];
    const name = pool[Math.floor(Math.random() * pool.length)];
    this.force(name, DEFAULT_DUR[name] || 1.6);
    this.cooldown = 4 + Math.random() * 6;
    return this.current;
  };

  return { ACTIONS, IdleScheduler, DEFAULT_DUR };
});
