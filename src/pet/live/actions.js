'use strict';
/**
 * 活体引擎 · 动作库 + 自发调度器
 * 每个动作是一个采样函数：给定进度 t(0..1) 与上下文，返回对「情绪基底姿态」的覆盖量。
 * 引擎把这些覆盖叠加到情绪目标之上，于是宠物会招手/跳跃/跳舞/伸懒腰/鞠躬/比心……
 * ——「像动物或人一样进行各种动作」。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LiveActions = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const TAU = Math.PI * 2;
  const sin = Math.sin, cos = Math.cos, PI = Math.PI;

  // 工具：手臂姿态
  const arm = (sh, el, open) => ({ sh, el, open: open == null ? 0.8 : open });

  // 动作表：sample(t, ctx) -> 覆盖对象
  const ACTIONS = {
    wave(t) {
      const w = sin(t * TAU * 2.2);
      return { armR: arm(150 + w * 8, 28 + w * 14, 0.95), bob: 1 + Math.abs(w) * 1.5 };
    },
    cheer(t) {
      const b = Math.abs(sin(t * PI));
      return { armL: arm(-162, 6, 1), armR: arm(162, 6, 1), bob: -b * 10, mouthCurve: 1, mouthOpen: 0.25 };
    },
    jump(t) {
      const up = Math.abs(sin(t * PI));
      return { armL: arm(-168, 0, 1), armR: arm(168, 0, 1), bob: -up * 42, mouthOpen: 0.2 * up };
    },
    dance(t) {
      const s = sin(t * TAU * 2.4);
      return {
        swayAdd: s * 20, bob: Math.abs(s) * 3,
        armL: arm(-150 + s * 30, 20, 0.9), armR: arm(150 - s * 30, 20, 0.9),
        mouthCurve: 0.7, headTilt: s * 6
      };
    },
    stretch(t) {
      const e = sin(t * PI);
      return { armL: arm(-176, 0, 1), armR: arm(176, 0, 1), breath: 1 + e * 0.07, mouthOpen: e * 0.3 };
    },
    bow(t) {
      const e = sin(t * PI);
      return { rot: e * 22, headTilt: e * 12, armL: arm(-20, 60, 0.5), armR: arm(20, 60, 0.5) };
    },
    peek(t) {
      const s = sin(t * TAU * 1.4);
      return { swayAdd: s * 7, headTilt: 10 + s * 4, wink: s > 0.6 ? 'R' : null, mouthCurve: 0.4 };
    },
    spin(t) { return { spin: t * 360, armL: arm(-150, 10, 0.9), armR: arm(150, 10, 0.9), bob: -Math.abs(sin(t * PI)) * 8 }; },
    yawn(t) {
      const e = sin(t * PI);
      return { mouthOpen: e * 0.95, eyeOpen: 0.45 - e * 0.2, armL: arm(-165, 5, 1), armR: arm(165, 5, 1), breath: 1 + e * 0.04 };
    },
    holdSign() {
      return { armR: arm(150, 34, 0.35), sign: true, mouthCurve: 0.2, rot: 2 };
    },
    type(t) {
      const s = sin(t * TAU * 6);
      return { armL: arm(8, 72 + s * 10, 0.4), armR: arm(-8, 72 - s * 10, 0.4), bob: 0.5, mouthCurve: 0.1 };
    },
    pop(t) {
      const squash = (1 - t) * 0.12;
      return { breath: 1 + squash, mouthCurve: 0.6, brow: -0.2 };
    },
    heart(t) {
      const e = sin(t * PI);
      return {
        armL: arm(-150, -18, 0.6), armR: arm(150, -18, 0.6),
        bob: -e * 6, mouthCurve: 1, mouthOpen: 0.3 * e, breath: 1 + e * 0.03
      };
    },
    purr(t) {
      const s = sin(t * TAU * 1.6);
      return { breath: 1 + s * 0.05, bob: s * 1.6, mouthCurve: 0.6, rot: 0 };
    },
    point(t) {
      return { armR: arm(12, 84, 0.18), mouthCurve: 0.3, headTilt: -4 };
    },
    sit(t) {
      const e = sin(t * PI);
      return { bob: e * 14, legsL: { sh: 0, el: 70 }, legsR: { sh: 0, el: 70 }, breath: 1 + e * 0.02 };
    }
  };

  /** 自发动作调度：在没被指定动作时，按情绪择机做点小动作，让宠物「自己会动」 */
  function IdleScheduler() {
    this.current = null;     // { name, t, dur }
    this.cooldown = 3.5;     // 距下次自发动作的秒数
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
    // 冷却中
    this.cooldown -= dt;
    if (this.cooldown > 0) return null;
    // 依据情绪挑选自发动作
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

  const DEFAULT_DUR = {
    wave: 1.6, cheer: 1.2, jump: 0.9, dance: 2.4, stretch: 2.0, bow: 1.4,
    peek: 1.8, spin: 1.2, yawn: 2.2, holdSign: 9999, type: 1.0, pop: 0.4,
    heart: 1.6, purr: 1.8, point: 1.4, sit: 1.6
  };

  return { ACTIONS, IdleScheduler, DEFAULT_DUR };
});
