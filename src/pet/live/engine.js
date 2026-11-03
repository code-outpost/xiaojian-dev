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
    this._errs = 0;            // 连续异常帧计数（用于退避自动恢复）
    this._okFrames = 0;        // 连续正常帧计数（用于复位退避）
    this._recoverAttempts = 0; // 已尝试自动恢复次数（指数退避上限）
    this._recoverTimer = 0;
    this._degraded = false;    // 是否已因连续异常暂停渲染
    this._destroyed = false;

    // 摄像头手势
    this.cameraMirror = false;
    this.hand = null;
    this.handStamp = -99;
    this.handMix = 0;          // 手势权重 0..1（有手时淡入，离开时淡出）
    this._hx = 0; this._hy = 0; // 上一帧手掌归一化位置，用于放大「小幅移动」

    // 全屏跟随（摄像头镜像开启时，宠物窗口跟随手在整屏范围移动）
    this.followScreen = false;
    this.fx = 0; this.fy = 0;     // 阻尼后的归一化跟随坐标（[-1,1]）
    this.lastPose = null;         // 上一帧手势姿态，用于边沿触发动作
    this.followCb = null;         // 主进程定位回调：followCb(mirrorX, palmY)

    // 手势动态镜像：手横扫/上下挥 → 身体跟着倾/摆（像在跟你一起挥手）
    this._hxRaw = 0; this._hyRaw = 0;   // 上一帧手掌原始归一化位置（未钳制）
    this.handVelX = 0; this.handVelY = 0; // 平滑后的手部速度（用于挥手镜像）
    // 景深（push/pull）：手离摄像头越近 size 越大 → 宠物越大
    this._size = 0.28;            // 平滑后的手掌尺度（0.28≈常见手距，作为景深缩放的 1.0 基准）
    this._handLive = false;       // 上一帧是否检测到手（用于消除「手刚出现」的速度毛刺）

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
    this._degraded = false;
    this._errs = 0;
    this.last = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const loop = (now) => {
      if (!this.running) return;
      const dt = Math.min(0.05, Math.max(0, (now - this.last) / 1000));
      this.last = now;
      try {
        this.frame(dt);
        // 连续正常帧足够久 → 视作已稳定，复位退避计数（避免一次性的偶发抖动后越退越久）
        this._errs = 0;
        if (this._recoverAttempts && ++this._okFrames > 180) {
          this._okFrames = 0;
          this._recoverAttempts = 0;
        }
      } catch (e) {
        this._errs++;
        if (this._errs <= 8) {
          console.warn('[mochi] 活体引擎单帧异常（已跳过该帧，不会停掉整只宠物）：', e);
        }
        // 连续异常过多：暂停渲染并退避后自动重启，而不是永久退化成静态立绘
        if (this._errs > 30) {
          this._suspendForRecovery(e);
          return;
        }
      }
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  };

  /**
   * 连续异常过多时的「优雅暂停 + 自动恢复」：
   * 不清空 DOM、不退化成静态立绘——只暂停渲染循环，退避一段时间后自动 restart()。
   * 退避按指数增长（上限 8s），最多尝试 6 次；仍不行就保持暂停（宠物仍可见，只是暂不动），
   * 不再刷屏；用户重启应用即可彻底恢复。
   */
  LivePet.prototype._suspendForRecovery = function (e) {
    this.running = false;
    this._degraded = true;
    console.error('[mochi] 活体引擎连续异常过多，已暂停渲染并安排自动恢复：', e);
    const backoff = Math.min(8000, 1000 * Math.pow(1.6, this._recoverAttempts || 0));
    this._recoverAttempts = (this._recoverAttempts || 0) + 1;
    if (this._recoverAttempts <= 6) {
      const self = this;
      this._recoverTimer = setTimeout(() => {
        self._recoverTimer = 0;
        if (self._destroyed || !self.body || !self.container) return;
        console.warn('[mochi] 活体引擎自动恢复中（第 ' + self._recoverAttempts + ' 次尝试）');
        self.start();
      }, backoff);
    } else {
      console.error('[mochi] 活体引擎多次自动恢复失败，保持暂停（宠物仍可见，只是暂不动）。重启应用可彻底恢复。');
    }
  };

  LivePet.prototype.stop = function () {
    this.running = false;
    if (this.raf) { try { cancelAnimationFrame(this.raf); } catch (_) {} this.raf = 0; }
  };

  LivePet.prototype.destroy = function () {
    this._destroyed = true;
    this.stop();
    if (this._recoverTimer) { try { clearTimeout(this._recoverTimer); } catch (_) {} this._recoverTimer = 0; }
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
    this.followScreen = !!on;   // 镜像开启 = 宠物满屏跟随手
    if (!on) { this.hand = null; this.handMix = 0; this.lastPose = null; }
  };
  LivePet.prototype.reactToHand = function (h) {
    const wasOn = !!(this.hand && this.hand.present) && (this.t - this.handStamp) <= 0.45;
    this.hand = h;
    this.handStamp = this.t;
    // 手刚进入画面的那一帧给个「打招呼」冲量，让「它看见你了」这件事一眼能看出来
    if (!wasOn && h && h.present && this.cameraMirror) {
      this.emotion.impulse('greet', 1.0);
      this.emotion.impulse('excited', 0.35);
    }
    // 手势姿态切换 → 触发对应动作（边沿触发，避免每帧重复触发）
    const pose = this._poseOf(h);
    if (pose && pose !== this.lastPose) {
      this.lastPose = pose;
      this._triggerPose(pose);
    } else if (!pose) {
      this.lastPose = null;
    }
  };

  /** 由手势语义判断当前「姿态」——用于挑选要表演的动作 */
  LivePet.prototype._poseOf = function (h) {
    if (!h || !h.present) return null;
    if (h.pinch) return 'pinch';                       // 拇指-食指捏合 = 比心
    if (h.pointing) return 'point';                    // 食指伸出 = 指向
    const o = (h.openness != null) ? h.openness : 0.5;
    if (o > 0.72) return 'open';                       // 五指张开 = 挥手
    if (o < 0.28) return 'fist';                       // 握拳 = 跳
    return 'flat';                                     // 中性手势 = 只跟随不表演
  };

  /** 不同姿态触发不同动作，让「多种动作」看得见 */
  LivePet.prototype._triggerPose = function (pose) {
    switch (pose) {
      case 'fist':  this.action('jump');  this.impulse('excited', 0.5); break;
      case 'open':  this.action('wave');  this.impulse('happy', 0.4);   break;
      case 'point': this.action('point'); break;
      case 'pinch': this.action('heart'); this.impulse('petting', 0.5); break;
      default: break;
    }
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

    // ---- 全屏跟随：把手位置交给主进程移动宠物窗口（满屏范围）----
    if (this.followScreen) {
      const f = this.followTarget();
      if (f && this.followCb) this.followCb(f.x, f.y);
    }

    // ---- 平滑（阻尼，让动作有惯性而不是硬跳）----
    const s = this.s, L = 11;
    s.x = damp(s.x, x, L, dt);
    s.y = damp(s.y, y, L, dt);
    s.rot = damp(s.rot, rot, L, dt);
    // 夹到 [0.78, 1.28]：保证「手势景深 + 设置缩放(≤1.4)」叠加后宠物仍完整留在窗口内不被裁切
    s.sx = damp(s.sx, clamp(sx, 0.78, 1.28), L, dt);
    s.sy = damp(s.sy, clamp(sy, 0.78, 1.28), L, dt);
    s.breath = breath;
    s.bob = bobAmp;

    this._apply();

    if (this.signEl && this.signEl.style.display !== 'none') this.positionSign();
  };

  /** 把手势映射成整体形变目标；没有手 / 关闭镜像 / 手已离开时返回 null */
  LivePet.prototype.handTarget = function () {
    if (!this.cameraMirror) return null;
    const h = this.hand;
    if (!h || !h.present) {
      this._hx = 0; this._hy = 0; this._hxRaw = 0; this._hyRaw = 0;
      this._handLive = false;
      return null;
    }
    if ((this.t - this.handStamp) > 0.6) {
      this._hx = 0; this._hy = 0; this._hxRaw = 0; this._hyRaw = 0;
      this._handLive = false;
      return null;
    }

    const hx = clamp(h.palmX || 0, -1, 1);
    const hy = clamp(h.palmY || 0, -1, 1);               // +1 = 手举高
    const mx = hx;                                        // 水平方向保持原约定（窗口/身体一致）
    const open = clamp(h.openness != null ? h.openness : 0.5, 0, 1);

    // 手「刚出现」这一帧：把速度基线直接对齐到当前位置，避免从上一只手/无手状态
    // 跳变过来产生一帧误判的挥手倾斜（真实场景手是连续移动的，不会瞬移）。
    if (!this._handLive) { this._hxRaw = hx; this._hyRaw = hy; this._handLive = true; }

    // 手势动态镜像：手横扫/上下挥 → 身体跟着倾/摆（像在跟你一起挥手）
    // 手静止时速度为 0 → 不产生额外摆动，只有「在动」时才摆，自然得像在回应你。
    const rawVx = hx - this._hxRaw;
    const rawVy = hy - this._hyRaw;
    this._hxRaw = hx; this._hyRaw = hy;
    this.handVelX = this.handVelX * 0.6 + rawVx * 0.4;    // 指数平滑，保留挥手节奏
    this.handVelY = this.handVelY * 0.6 + rawVy * 0.4;

    // 手部移动速度：把小幅、快速的动作也放大，让它「跟手」更灵敏（高敏感）。
    // ⚠️ 速度项要钳制：手突然跳变（快速挥手/测试直跳）时若用原始 delta 会爆冲甚至方向反转，
    // 钳到 ±0.18 既能放大小幅动作，又不会抖。
    const vx = clamp(hx - this._hx, -0.18, 0.18);
    const vy = clamp(hy - this._hy, -0.18, 0.18);
    this._hx = hx; this._hy = hy;
    const move = clamp(Math.hypot(vx, vy) * 5, 0, 1);

    const po = h.pointing ? 1 : 0;
    const pi = h.pinch ? 1 : 0;

    // 全屏跟随开启时，窗口已经在大范围移动，身体只保留「朝手方向的轻微倾斜 + 察觉到你的放大」，
    // 不再做大幅平移（否则窗口和身体的位移会叠加成双倍位移，显得很乱）。
    const LEAN = this.followScreen ? 0.35 : 1;
    const PERK = this.followScreen ? 0.06 : 0.10;

    // 挥手镜像：手横扫 → 身体左右倾 + 轻微横摆；手上下挥 → 上下摆。
    const waveRot = clamp(this.handVelX * 240 * LEAN, -30, 30);
    const waveX = this.handVelX * 26 * LEAN;
    const waveY = this.handVelY * 30 * LEAN;

    const x = mx * 72 * LEAN + vx * 120 * LEAN + po * mx * 14 + waveX;
    const y = -hy * 46 * LEAN + vy * 80 * LEAN + (open - 0.5) * -12 - PERK * 70 + waveY;
    const rot = mx * 22 * LEAN + vx * 28 * LEAN + po * (mx >= 0 ? 6 : -6) + waveRot;
    let sy = 1 + hy * 0.14 + (open - 0.5) * 0.18 + move * 0.08 + PERK - pi * 0.06;
    let sx = 1 - hy * 0.08 + (open - 0.5) * 0.12 + move * 0.05 + PERK - pi * 0.05;

    // 自定义玩法：手推进/拉远 → 宠物放大/缩小（push/pull 景深效果）
    // ⚠️ 以「常见手距 ≈ 0.28」为基准映射到 1.0：远一点略小、近一点略大，
    // 而不是从 0.55 起跳——否则手一进画面宠物先「缩水」一下，且 1.6 倍会超出
    // 宠物窗口被裁切（窗口宽 460 / 宠物 250px，1.6 倍≈400px 已接近溢出）。
    this._size = this._size * 0.85 + (h.size != null ? h.size : 0.28) * 0.15;
    // 常见手距附近 ≈ 1.0，范围约 [0.83, 1.25]；叠加其它形变后再由 frame() 统一夹到 [0.78,1.28]
    const sizeK = clamp(1 + (this._size - 0.28) * 1.7, 0.83, 1.25);
    sx *= sizeK; sy *= sizeK;

    return { x, y, rot, sx, sy };
  };

  /**
   * 全屏跟随：把手的归一化位置（镜像后的水平）映射成 [-1,1] 的整屏坐标，
   * 经 followCb 交给主进程移动宠物窗口。手离开画面 / 关闭镜像时返回 null。
   */
  LivePet.prototype.followTarget = function () {
    if (!this.followScreen || !this.cameraMirror) return null;
    const h = this.hand;
    if (!h || !h.present) return null;
    if ((this.t - this.handStamp) > 0.6) return null;
    const hx = clamp(h.palmX || 0, -1, 1);
    const hy = clamp(h.palmY || 0, -1, 1);
    const mx = hx;  // 水平方向保持原约定（与本地身体平移一致）
    // 阻尼，给一点惯性，避免抖动
    this.fx = lerp(this.fx, mx, 0.2);
    this.fy = lerp(this.fy, hy, 0.2);
    return { x: this.fx, y: this.fy };
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
