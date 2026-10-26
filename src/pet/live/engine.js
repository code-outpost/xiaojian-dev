'use strict';
/**
 * 活体引擎 · 主控制器
 * 把「情绪目标 + 自发/指定动作 + 摄像头手势」三路输入融合，每帧平滑插值后交给骨架渲染。
 * 这是把静态立绘变成「会呼吸、会眨眼、有情绪、随你手而动」的活物的总装车间。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LivePet = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const M = (typeof require !== 'undefined')
    ? require('./math.js') : root.LiveMath;
  const Emotion = (typeof require !== 'undefined') ? require('./emotion.js') : root.LiveEmotion;
  const { ACTIONS, IdleScheduler } = (typeof require !== 'undefined') ? require('./actions.js') : root.LiveActions;
  const Skeleton = (typeof require !== 'undefined') ? require('./skeleton.js') : root.LiveSkeleton;
  const Rigs = (typeof require !== 'undefined') ? require('./rigs.js') : root.LiveRigs;
  const { clamp, lerp, damp, dampAngle, osc } = M;

  function LivePet(container, char) {
    this.container = container;
    this.char = char;
    const rig = Rigs.rig(char.id);
    this.rig = rig;

    // 注入 SVG
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'live-svg');
    svg.style.width = '100%';
    svg.style.height = '100%';
    svg.style.position = 'absolute';
    svg.style.inset = '0';
    svg.style.overflow = 'visible';
    // 隐藏旧立绘的两层 img
    const lay = container.querySelectorAll('.layer');
    lay.forEach(l => { l.style.display = 'none'; });
    container.insertBefore(svg, container.firstChild);

    this.skeleton = new Skeleton(svg, rig, {
      body: char.color, deep: char.colorDeep, soft: char.colorSoft
    });

    this.emotion = new Emotion();
    this.scheduler = new IdleScheduler();
    this.t = 0;
    this.running = false;
    this.raf = 0;
    this.last = 0;

    // 摄像头手势
    this.cameraMirror = false;
    this.hand = null;          // 最近一次手势 {present,...}
    this.handStamp = 0;

    // 状态
    this.walking = false;
    this.dragging = false;

    // 平滑态
    this.s = {
      lean: 0, bob: 0, sway: 0, headTilt: 0, spin: 0,
      eyeOpen: 0.9, mouthCurve: 0.2, mouthOpen: 0, brow: -0.2, blush: 0, glow: 0,
      breath: 1, tailWag: 0,
      armL: { sh: -14, el: 14, open: 0.6 }, armR: { sh: 14, el: 14, open: 0.6 },
      legL: { sh: 0, el: 0 }, legR: { sh: 0, el: 0 }, gazeX: 0, gazeY: 0, wink: null
    };

    // 眨眼调度
    this.nextBlink = 2 + Math.random() * 3;
    this.blinkT = 0;

    // 举牌提示（提醒用）
    this.signEl = null;
  }

  LivePet.prototype.start = function () {
    if (this.running) return;
    this.running = true;
    this.last = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const loop = (now) => {
      if (!this.running) return;
      const dt = Math.min(0.05, Math.max(0, (now - this.last) / 1000));
      this.last = now;
      this.frame(dt);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  };

  LivePet.prototype.stop = function () { this.running = false; if (this.raf) cancelAnimationFrame(this.raf); };
  LivePet.prototype.destroy = function () {
    this.stop();
    if (this.signEl && this.signEl.parentNode) this.signEl.parentNode.removeChild(this.signEl);
    const svg = this.container.querySelector('.live-svg');
    if (svg && svg.parentNode) svg.parentNode.removeChild(svg);
    // 恢复旧立绘两层 img 的可见性（退回静态立绘时不再被隐藏）
    this.container.querySelectorAll('.layer').forEach(l => { l.style.display = ''; });
  };

  /* ---------------- 外部接口 ---------------- */
  LivePet.prototype.setStats = function (st) { this.emotion.setStats(st); };
  LivePet.prototype.impulse = function (name, amt) { this.emotion.impulse(name, amt); };
  LivePet.prototype.setSleeping = function (on) { this.emotion.setSleeping(on); };
  LivePet.prototype.setWalking = function (on) { this.walking = !!on; if (on) this.scheduler.force('walk', 0.6); };
  LivePet.prototype.setDragging = function (on) { this.dragging = !!on; };
  LivePet.prototype.action = function (name, dur) {
    if (name === 'holdSign') { this.showSign(this._signText || ''); }
    else this.hideSign();
    this.scheduler.force(name, dur);
  };
  LivePet.prototype.setSign = function (text) { this._signText = text || ''; };
  LivePet.prototype.clearAction = function () { this.scheduler.clear(); this.hideSign(); };
  LivePet.prototype.setCameraMirror = function (on) { this.cameraMirror = !!on; if (!on) this.hand = null; };
  LivePet.prototype.reactToHand = function (h) { this.hand = h; this.handStamp = this.t; };

  /* ---------------- 每帧 ---------------- */
  LivePet.prototype.frame = function (dt) {
    this.t += dt;
    const emo = this.emotion.update(dt);

    // 自发 / 指定动作
    const act = this.scheduler.update(dt, emo);
    let ov = {};
    if (act && ACTIONS[act.name]) ov = ACTIONS[act.name](act.t / act.dur, {}) || {};

    // 手势镜像：覆盖一侧手臂
    let gestureArm = null;
    if (this.cameraMirror && this.hand && this.hand.present && (this.t - this.handStamp) < 0.4) {
      gestureArm = this.applyHandPose(ov);
    }

    // ---- 目标姿态 ----
    const tgt = {
      lean: emo.lean + (ov.rot || 0) + (this.dragging ? -4 : 0),
      bob: emo.bobAmp * osc(this.t, emo.bobFreq) + (ov.bob || 0) + (this.walking ? Math.abs(osc(this.t, 3)) * 4 : 0),
      sway: emo.swayAmp * osc(this.t, emo.swayFreq, 0.3) + (ov.swayAdd || 0),
      spin: ov.spin || 0,
      headTilt: (emo.a > 0.3 ? osc(this.t, 0.7) * 2 : 0) + (ov.headTilt || 0),
      mouthCurve: ov.mouthCurve != null ? ov.mouthCurve : emo.mouthCurve,
      mouthOpen: ov.mouthOpen != null ? ov.mouthOpen : (emo.a > 0.6 ? 0.12 : 0),
      brow: ov.brow != null ? ov.brow : emo.brow,
      blush: emo.blush,
      glow: emo.glow,
      breath: 1 + osc(this.t, emo.bobFreq * 0.5) * 0.022 + ((ov.breath || 1) - 1),
      tailWag: emo.tailWag * osc(this.t, 6) * 16,
      gazeX: this.hand && this.hand.present ? clamp(this.hand.palmX, -1, 1) : (this.walking ? 0 : osc(this.t, 0.2) * 0.3),
      wink: ov.wink || null
    };

    // 手臂：先放休息姿态，再被动作覆盖，再被手势覆盖
    const spread = emo.armSpread;
    let armL = ov.armL || { sh: -12 - spread * 12, el: 14, open: 0.55 + spread * 0.2 };
    let armR = ov.armR || { sh: 12 + spread * 12, el: 14, open: 0.55 + spread * 0.2 };
    if (gestureArm) { if (gestureArm.side === 'L') armL = gestureArm.pose; else armR = gestureArm.pose; }
    if (ov.legsL) tgt.legL = ov.legsL; if (ov.legsR) tgt.legR = ov.legsR;
    tgt.armL = armL; tgt.armR = armR;

    // 腿休息
    tgt.legL = tgt.legL || { sh: 0, el: this.walking ? 18 + Math.abs(osc(this.t, 6)) * 16 : 0 };
    tgt.legR = tgt.legR || { sh: 0, el: this.walking ? 18 + Math.abs(osc(this.t + 0.5, 6)) * 16 : 0 };

    // 眨眼
    this.nextBlink -= dt;
    if (this.nextBlink <= 0 && this.blinkT === 0) { this.blinkT = 0.001; this.nextBlink = 2.5 + Math.random() * 4; }
    let eyeOpen = emo.eyeOpen;
    if (this.blinkT > 0) {
      this.blinkT += dt;
      const bt = this.blinkT / 0.14;
      if (bt >= 1) this.blinkT = 0;
      else eyeOpen = emo.eyeOpen * (1 - Math.sin(bt * Math.PI));
    }
    tgt.eyeOpen = clamp(eyeOpen, 0.05, 1);

    // ---- 阻尼插值后写骨架 ----
    const s = this.s, L = 9;
    s.lean = dampAngle(s.lean, tgt.lean, L, dt);
    s.bob = damp(s.bob, tgt.bob, L, dt);
    s.sway = dampAngle(s.sway, tgt.sway, L, dt);
    s.spin = dampAngle(s.spin, tgt.spin, L, dt);
    s.headTilt = dampAngle(s.headTilt, tgt.headTilt, L, dt);
    s.eyeOpen = damp(s.eyeOpen, tgt.eyeOpen, 14, dt);
    s.mouthCurve = damp(s.mouthCurve, tgt.mouthCurve, 10, dt);
    s.mouthOpen = damp(s.mouthOpen, tgt.mouthOpen, 12, dt);
    s.brow = damp(s.brow, tgt.brow, 8, dt);
    s.blush = damp(s.blush, tgt.blush, 6, dt);
    s.glow = damp(s.glow, tgt.glow, 5, dt);
    s.breath = damp(s.breath, tgt.breath, 8, dt);
    s.tailWag = damp(s.tailWag, tgt.tailWag, 10, dt);
    s.gazeX = damp(s.gazeX, tgt.gazeX, 6, dt);
    s.wink = tgt.wink;

    this.smoothArm(s.armL, tgt.armL, dt);
    this.smoothArm(s.armR, tgt.armR, dt);
    this.smoothArm(s.legL, tgt.legL, dt);
    this.smoothArm(s.legR, tgt.legR, dt);

    const pose = {
      lean: s.lean + s.spin, bob: s.bob, sway: s.sway, headTilt: s.headTilt,
      eyeOpen: s.eyeOpen, mouthCurve: s.mouthCurve, mouthOpen: s.mouthOpen, brow: s.brow,
      blush: s.blush, glow: s.glow, breath: s.breath, tailWag: s.tailWag,
      gazeX: s.gazeX, wink: s.wink,
      armL: s.armL, armR: s.armR, legs: { L: s.legL, R: s.legR }
    };
    this.skeleton.pose(pose);

    // 举牌位置跟随（若显示）
    if (this.signEl && this.signEl.style.display !== 'none') this.positionSign();
  };

  LivePet.prototype.smoothArm = function (cur, tgt, dt) {
    cur.sh = dampAngle(cur.sh, tgt.sh || 0, 11, dt);
    cur.el = dampAngle(cur.el, tgt.el || 0, 11, dt);
    cur.open = damp(cur.open != null ? cur.open : 0.6, tgt.open != null ? tgt.open : 0.6, 11, dt);
  };

  /** 把用户手势映射成宠物一侧手臂姿态（镜像） */
  LivePet.prototype.applyHandPose = function (ov) {
    const h = this.hand;
    const side = h.palmX >= 0 ? 'R' : 'L'; // 屏幕同侧：你抬右手→宠物右侧臂抬起，像照镜子
    // 抬手高度 → 肩角（hand 上为正）；指向 → 前臂前伸
    const sh = 90 + clamp(h.palmY, -1, 1) * 85;
    let el = 18 + (1 - (h.openness != null ? h.openness : 0.6)) * 35;
    let open = h.openness != null ? h.openness : 0.7;
    if (h.pointing) { el = 82; open = 0.15; }
    if (h.pinch) { open = 0.1; }
    return { side, pose: { sh, el, open } };
  };

  /* ---------------- 举牌（提醒） ---------------- */
  LivePet.prototype.showSign = function (text) {
    if (!this.signEl) {
      const el = document.createElement('div');
      el.className = 'live-sign';
      this.container.appendChild(el);
      this.signEl = el;
    }
    this.signEl.textContent = text || '!';
    this.signEl.style.display = 'block';
    this.positionSign();
  };
  LivePet.prototype.hideSign = function () { if (this.signEl) this.signEl.style.display = 'none'; };
  LivePet.prototype.positionSign = function () {
    // 举牌手在宠物一侧上方，牌随其放
    const side = (this.hand && this.hand.present && this.cameraMirror) ? (this.hand.palmX >= 0 ? 'R' : 'L') : 'R';
    const x = side === 'R' ? '62%' : '8%';
    this.signEl.style.left = x;
    this.signEl.style.top = '6%';
  };

  return LivePet;
});
