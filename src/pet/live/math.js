'use strict';
/**
 * 活体引擎 · 数学与插值工具（纯函数，无 DOM 依赖，可 Node 单测）
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LiveMath = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const inv = (v, a, b) => (b === a ? 0 : (v - a) / (b - a));
  const map = (v, a, b, c, d) => lerp(c, d, clamp(inv(v, a, b), 0, 1));

  /** 指数阻尼：把 cur 朝 target 平滑逼近，lambda 越大越快（与帧率无关） */
  function damp(cur, target, lambda, dt) {
    if (dt <= 0) return target;
    return lerp(cur, target, 1 - Math.exp(-lambda * dt));
  }

  /** 角度阻尼（处理 -180/180 环绕） */
  function dampAngle(cur, target, lambda, dt) {
    let d = ((target - cur + 540) % 360) - 180;
    return cur + d * (1 - Math.exp(-lambda * dt));
  }

  const easeInOut = t => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
  const easeOut = t => 1 - Math.pow(1 - t, 3);
  const easeOutBack = t => {
    const c1 = 1.70158, c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  };
  const easeInBack = t => {
    const c1 = 1.70158, c3 = c1 + 1;
    return c3 * t * t * t - c1 * t * t;
  };

  /** 由「时长 + 已用时间」得到 0..1 进度，out=true 时返回缓动后的值 */
  function phase(elapsed, dur, ease) {
    const t = clamp(elapsed / Math.max(1, dur), 0, 1);
    if (ease === 'out') return easeOut(t);
    if (ease === 'inBack') return easeInBack(t);
    if (ease === 'outBack') return easeOutBack(t);
    return easeInOut(t);
  }

  /** 二阶弹簧（用于有弹性的运动），返回 [pos, vel] */
  function spring(prevPos, prevVel, target, stiffness, damping, dt) {
    const force = (target - prevPos) * stiffness - prevVel * damping;
    const vel = prevVel + force * dt;
    const pos = prevPos + vel * dt;
    return [pos, vel];
  }

  /** 把 0..1 进度映射到「来回一次」的 sin 摆幅（用于呼吸/摇摆） */
  function osc(t, freq, phaseOff = 0) {
    return Math.sin((t * freq + phaseOff) * Math.PI * 2);
  }

  return { clamp, lerp, inv, map, damp, dampAngle, easeInOut, easeOut, easeOutBack, easeInBack, phase, spring, osc };
});
