'use strict';
/**
 * 活体引擎 · 手势语义分析（纯函数）
 * 输入 MediaPipe Hands 的 21 个手部关键点（归一化 x,y ∈ [0,1]，y 向下），
 * 输出一组「手势语义」参数，交给活体引擎映射到宠物手臂骨骼。
 * 不含任何 DOM / 摄像头依赖，可 Node 单测。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LiveGesture = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const M = (typeof require !== 'undefined') ? require('./math.js') : (root.LiveMath);
  const { clamp, map } = M;

  // 关键点的指节索引
  const WRIST = 0, MIDDLE_MCP = 9;
  const FINGER_TIPS = [4, 8, 12, 16, 20];
  const FINGER_PIPS = [3, 6, 10, 14, 18]; // 指尖到 PIP 的延伸度衡量

  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

  /** 由单只手的关键点推导手势语义 */
  function analyzeHand(lm) {
    if (!lm || lm.length < 21) return { present: false };

    const wrist = lm[WRIST];
    const midMcp = lm[MIDDLE_MCP];
    const handScale = Math.max(1e-4, dist(wrist, midMcp));

    // 手掌中心（腕 + 四指 MCP 平均）
    const palmPts = [wrist, lm[5], lm[9], lm[13], lm[17]];
    let cx = 0, cy = 0;
    for (const p of palmPts) { cx += p.x; cy += p.y; }
    cx /= palmPts.length; cy /= palmPts.length;

    // 开合度：指尖到腕的距离 / 手掌尺度。张开手大、握拳小。
    let ext = 0;
    for (const tip of FINGER_TIPS) ext += dist(lm[tip], wrist) / handScale;
    ext /= FINGER_TIPS.length; // ≈ 0.9(拳) .. 2.4(张开)
    const openness = clamp(map(ext, 0.9, 2.4, 0, 1), 0, 1);

    // 各指伸展比（指尖-PIP 距离 / 手掌尺度）
    const fingerExt = FINGER_TIPS.map((tip, i) => dist(lm[tip], lm[FINGER_PIPS[i]]) / handScale);
    // 食指是否明显伸出、其余收拢 → 指向
    const indexOut = fingerExt[1], othersIn = (fingerExt[2] + fingerExt[3] + fingerExt[4]) / 3;
    const pointing = indexOut > 0.9 && othersIn < 0.7;

    // 捏合 / 比心：拇指尖(4)与食指尖(8)距离很小
    const pinch = dist(lm[4], lm[8]) / handScale;

    // 手腕朝向角（腕 → 中指 MCP），屏幕坐标 y 向下，返回度数
    const ang = Math.atan2(midMcp.y - wrist.y, midMcp.x - wrist.x) * 180 / Math.PI;

    // 归一化位置：+x = 画面右，+y = 上（抬起为正）。后续引擎再决定镜像。
    const palmX = clamp((cx - 0.5) * 2, -1, 1);
    const palmY = clamp((0.5 - cy) * 2, -1, 1);

    return {
      present: true,
      openness,
      pointing,
      pinch: pinch < 0.45,
      wristAngle: ang,
      palmX,
      palmY,
      confidence: 1
    };
  }

  /**
   * 由一帧（可能多只手）得到「主手」手势。
   * 默认取离画面中心最近 / 最大的那只，简化实现取第一只。
   */
  function analyze(hands) {
    if (!hands || !hands.length) return { present: false };
    return analyzeHand(hands[0]);
  }

  return { analyze, analyzeHand };
});
