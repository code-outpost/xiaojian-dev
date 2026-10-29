'use strict';
/**
 * 活体引擎 · 原立绘驱动（puppet）
 *
 * 设计原则：**绝不重画形象**。
 * 之前那版用程序化 SVG 骨骼「重新捏」了一只，结果和大家熟悉的立绘完全不像，还被吐槽难看。
 * 现在改成：把原来的两层 <img class="layer"> 包进一个容器，只对它做整体变换
 * （位移 / 旋转 / 挤压拉伸），于是「形象还是原来那个，只不过活了」。
 *
 * 情绪（PAD）→ 呼吸、摇晃、倾斜、弹跳；
 * 动作（挥手/欢呼/跳跃/跳舞…）→ 身体级的小表演；
 * 摄像头手势 → 整只宠物跟着你的手左右移动、跟着抬手上下起伏、跟着倾斜。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LivePet = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ⚠️ 不能用外层 IIFE 的形参 root（不在 factory 闭包内），浏览器里取全局 self
  const G = (typeof self !== 'undefined' ? self : globalThis);
  const M = (typeof require !== 'undefined') ? require('./math.js') : G.LiveMath;
  const Emotion = (typeof require !== 'undefined') ? require('./emotion.js') : G.LiveEmotion;
  const A = (typeof require !== 'undefined') ? require('./actions.js') : G.LiveActions;
  const { ACTIONS, DEFAULT_DUR, IdleScheduler } = A;
  const { clamp, lerp, damp, osc } = M;

  const PI = Math.PI;
  const sin = Math.sin, abs = Math.abs;

  function LivePet(container, char) {
    if (!container) throw new Error('活体引擎缺少容器');

    // ---- 先做校验，别在动过 DOM 之后再抛 ----
    const layers = Array.from(container.querySelectorAll('.layer'));
    if (!layers.length) throw new Error('没有找到立绘层（.layer），活体模式不适用');

    this.container = container;
    this.char = char;
    this.layers = layers;

    // 只包一层，不动 <img> 的 src/class —— 状态切换与淡入淡出全部照旧
    const body = document.createElement('div');
    body.className = 'live-body';
    container.insertBefore(body, container.firstChild);
    layers.forEach(l => body.appendChild(l));
    this.body = body;

    this.emotion = new Emotion();
    this.scheduler = new IdleScheduler();
    this.t = 0;
    this.running = false;
    this.raf = 0;
    this.last = 0;

    // 摄像头手势
    this.cameraMirror = false;
    this.hand = null;
    this.handStamp = -99;
    this.handMix = 0;          // 手势权重 0..1（有手时淡入，离开时淡出）

    // 状态
    this.walking = false;
    this.dragging = false;
    this.sleeping = false;

    // 平滑后的最终形变量（全部为有限数值）
    this.s = { x: 0, y: 0, rot: 0, sx: 1, sy: 1, breath: 1, bob: 0 };

    this.body.style.transformOrigin = '50% 92%';
    this.body.style.willChange = 'transform';
    this._apply();

    this.signEl = null;
    this._signText = '';
  }

  /* ---------------- 主循环 ---------------- */
  LivePet.prototype.start = function () {
    if (this.running) return;
    this.running = true;
    this.last = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const loop = (now) => {
      if (!this.running) return;
      const dt = Math.min(0.05, Math.max(0, (now - this.last) / 1000));
      this.last = now;
      try {
        this.frame(dt);
      } catch (e) {
        // 单帧出错不能让整只宠物消失：停掉引擎并让 pet.js 回退
        console.error('[mochi] 活体引擎单帧异常，已停止：', e);
        this.destroy();
        return;
      }
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  };

  LivePet.prototype.stop = function () {
    this.running = false;
    if (this.raf) { try { cancelAnimationFrame(this.raf); } catch (_) {} this.raf = 0; }
  };

  LivePet.prototype.destroy = function () {
    this.stop();
    if (this.signEl && this.signEl.parentNode) this.signEl.parentNode.removeChild(this.signEl);
    this.signEl = null;
    // 把立绘放回原位，保证退回静态模式时结构完全复原
    try {
      if (this.body) {
        // 反向插到最前面，最终顺序仍是 layerA, layerB, .zzz, .hearts
        this.layers.slice().reverse().forEach(l => {
          if (l && this.body.contains(l)) this.container.insertBefore(l, this.container.firstChild);
        });
        this.body.style.transform = '';
        if (this.body.parentNode) this.body.parentNode.removeChild(this.body);
      }
    } catch (_) { /* ignore */ }
    this.body = null;
  };

  /* ---------------- 外部接口（保持与旧引擎一致） ---------------- */
  LivePet.prototype.setStats = function (st) { this.emotion.setStats(st); };
  LivePet.prototype.impulse = function (name, amt) { this.emotion.impulse(name, amt); };
  LivePet.prototype.setSleeping = function (on) { this.sleeping = !!on; this.emotion.setSleeping(!!on); };
  LivePet.prototype.setWalking = function (on) { this.walking = !!on; if (on) this.scheduler.force('walk', 0.6); };
  LivePet.prototype.setDragging = function (on) { this.dragging = !!on; };
  LivePet.prototype.action = function (name, dur) {
    if (name === 'holdSign') this.showSign(this._signText || '');
    else this.hideSign();
    if (ACTIONS[name]) this.scheduler.force(name, dur);
  };
  LivePet.prototype.setSign = function (text) { this._signText = text || ''; };
  LivePet.prototype.clearAction = function () { this.scheduler.clear(); this.hideSign(); };
  LivePet.prototype.setCameraMirror = function (on) {
    this.cameraMirror = !!on;
    if (!on) { this.hand = null; this.handMix = 0; }
  };
  LivePet.prototype.reactToHand = function (h) {
    const wasOn = !!(this.hand && this.hand.present) && (this.t - this.handStamp) <= 0.45;
    this.hand = h;
    this.handStamp = this.t;
    // 手刚进入画面的那一帧给个「打招呼」冲量，让「它看见你了」这件事一眼能看出来
    if (!wasOn && h && h.present && this.cameraMirror) this.emotion.impulse('greet', 0.7);
  };

  /* ---------------- 每帧 ---------------- */
  LivePet.prototype.frame = function (dt) {
    this.t += dt;
    const emo = this.emotion.update(dt);

    // 自发 / 指定动作
    const act = this.scheduler.update(dt, emo);
    const ov = (act && ACTIONS[act.name])
      ? (ACTIONS[act.name](clamp(act.t / act.dur, 0, 1), {}) || {})
      : {};

    // 情绪基底：呼吸起伏 / 摇晃 / 倾斜
    const asleep = this.sleeping || emo.asleep;
    const breathAmp = asleep ? 0.012 : 0.022;
    const breath = 1 + osc(this.t, Math.max(0.35, emo.bobFreq * 0.5)) * breathAmp;
    const bobFreq = asleep ? 0.4 : emo.bobFreq;
    const bobAmp = asleep ? 0.8 : emo.bobAmp;
    const walkBob = this.walking ? abs(osc(this.t, 3.2)) * 5 : 0;

    let x = emo.swayAmp * osc(this.t, emo.swayFreq, 0.3) * 0.5;
    let y = -bobAmp * osc(this.t, bobFreq) * 0.45 - walkBob + (asleep ? 5 : 0);
    let rot = emo.lean * 0.42 + (this.dragging ? -3 : 0);
    let sx = 1, sy = breath;

    // 动作叠加
    if (ov.x) x += ov.x;
    if (ov.y) y += ov.y;
    if (ov.rot) rot += ov.rot;
    if (ov.sx) sx *= ov.sx;
    if (ov.sy) sy *= ov.sy;

    // ---- 摄像头手势：整只跟着你的手走 ----
    const h = this.handTarget();
    const wantMix = h ? 1 : 0;
    this.handMix = damp(this.handMix, wantMix, 6, dt);
    if (h && this.handMix > 0.001) {
      const k = this.handMix;
      x = lerp(x, h.x, k);
      y = lerp(y, h.y, k);
      rot = lerp(rot, h.rot, k);
      sx = lerp(sx, h.sx, k);
      sy = lerp(sy, h.sy, k);
    }

    // ---- 平滑（阻尼，让动作有惯性而不是硬跳）----
    const s = this.s, L = 11;
    s.x = damp(s.x, x, L, dt);
    s.y = damp(s.y, y, L, dt);
    s.rot = damp(s.rot, rot, L, dt);
    s.sx = damp(s.sx, clamp(sx, 0.6, 1.6), L, dt);
    s.sy = damp(s.sy, clamp(sy, 0.6, 1.6), L, dt);
    s.breath = breath;
    s.bob = bobAmp;

    this._apply();

    if (this.signEl && this.signEl.style.display !== 'none') this.positionSign();
  };

  /** 把手势映射成整体形变目标；没有手 / 关闭镜像 / 手已离开时返回 null */
  LivePet.prototype.handTarget = function () {
    if (!this.cameraMirror) return null;
    const h = this.hand;
    if (!h || !h.present) return null;
    if ((this.t - this.handStamp) > 0.45) return null;   // 手离开画面一会儿就交还情绪驱动

    const hx = clamp(h.palmX || 0, -1, 1);
    const hy = clamp(h.palmY || 0, -1, 1);               // +1 = 手举高
    const open = clamp(h.openness != null ? h.openness : 0.5, 0, 1);

    // 幅度要够大才看得出来（之前 ±30px / ±10° 太含蓄，用户以为没反应）：
    // 手移到右边 → 整只往右挪 + 右倾（像照镜子）；手举高 → 踮起来并拉长；
    // 张开手 → 显得更「精神」（略微放大）；握拳/捏合 → 缩一点。
    const po = h.pointing ? 1 : 0;
    const pi = h.pinch ? 1 : 0;
    return {
      x: hx * 52 + po * hx * 10,
      y: -hy * 30 + (open - 0.5) * -6,
      rot: hx * 16 + po * (hx >= 0 ? 5 : -5),
      sy: 1 + hy * 0.10 + (open - 0.5) * 0.12 - pi * 0.05,
      sx: 1 - hy * 0.06 + (open - 0.5) * 0.08 - pi * 0.04
    };
  };

  LivePet.prototype._apply = function () {
    if (!this.body) return;
    const s = this.s;
    this.body.style.transform =
      'translate3d(' + s.x.toFixed(2) + 'px,' + s.y.toFixed(2) + 'px,0)' +
      ' rotate(' + s.rot.toFixed(2) + 'deg)' +
      ' scale(' + s.sx.toFixed(4) + ',' + s.sy.toFixed(4) + ')';
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
    this.signEl.style.left = '62%';
    this.signEl.style.top = '6%';
  };

  LivePet.ACTIONS = ACTIONS;
  return LivePet;
});
