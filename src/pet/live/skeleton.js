'use strict';
/**
 * 活体引擎 · 骨骼渲染（SVG）
 * 用一组可动关节（身体/头/耳/眼/眉/嘴/臂/腿/尾）程序化画出一只「生物」，
 * 由 pose() 每帧写入角度/坐标。无任何外部依赖。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LiveSkeleton = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SVGNS = 'http://www.w3.org/2000/svg';
  function mk(tag, attrs, parent) {
    const e = document.createElementNS(SVGNS, tag);
    if (attrs) for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }

  // 颜色工具
  function hexToRgb(h) {
    h = h.replace('#', '');
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rgbToHex(r, g, b) {
    const f = v => ('0' + Math.max(0, Math.min(255, Math.round(v))).toString(16)).slice(-2);
    return '#' + f(r) + f(g) + f(b);
  }
  function lighten(h, amt) {
    const [r, g, b] = hexToRgb(h);
    return rgbToHex(r + (255 - r) * amt, g + (255 - g) * amt, b + (255 - b) * amt);
  }
  function darken(h, amt) { return lighten(h, -amt); }

  function Skeleton(svg, rig, colors) {
    this.svg = svg;
    this.rig = rig;
    this.colors = colors; // {body, deep, soft}
    this.refs = {};
    this.build();
  }

  Skeleton.prototype.build = function () {
    const rig = this.rig, c = this.colors;
    const svg = this.svg;
    svg.setAttribute('viewBox', '0 0 200 220');
    svg.setAttribute('preserveAspectRatio', 'xMidYMax meet');
    svg.innerHTML = '';

    const root = mk('g', { id: 'root' }, svg);
    this.refs.root = root;

    // 影子
    mk('ellipse', { cx: 100, cy: 208, rx: rig.bodyW * 0.9, ry: 7, fill: 'rgba(28,38,58,0.18)' }, root);

    // 尾巴（在身体后面）：组直接定位到身体后下方的锚点，路径相对该锚点绘制
    if (rig.tail) {
      const ax = 100 + rig.bodyW * 0.7, ay = 170;
      const tail = mk('g', { id: 'tail', transform: `translate(${ax},${ay})` }, root);
      mk('path', { d: 'M0 0 q 26 -6 30 -34', fill: 'none', stroke: c.deep, 'stroke-width': 11, 'stroke-linecap': 'round' }, tail);
      mk('path', { d: 'M0 0 q 26 -6 30 -34', fill: 'none', stroke: c.body, 'stroke-width': 6, 'stroke-linecap': 'round' }, tail);
      this.refs.tail = tail;
    }

    // 腿
    this.refs.legL = this.buildLimb(root, 'legL', rig.leg, true);
    this.refs.legR = this.buildLimb(root, 'legR', rig.leg, true);

    // 身体
    const body = mk('g', { id: 'body' }, root);
    mk('ellipse', { cx: 100, cy: 142, rx: rig.bodyW, ry: rig.bodyH, fill: c.body, stroke: c.deep, 'stroke-width': 2 }, body);
    mk('ellipse', { cx: 100, cy: 150, rx: rig.bodyW * 0.62, ry: rig.bodyH * 0.7, fill: c.soft, opacity: 0.85 }, body);
    this.refs.body = body;

    // 手臂（在身体前面，便于看到手）
    this.refs.armL = this.buildLimb(root, 'armL', rig.arm, false);
    this.refs.armR = this.buildLimb(root, 'armR', rig.arm, false);

    // 头
    const head = mk('g', { id: 'head' }, root);
    this.refs.head = head;
    const hy = 64 + (rig.headDY || 0);

    // 头发（女孩在头后）
    if (rig.hair) {
      mk('path', {
        d: `M${100 - rig.headR - 6} ${hy - 6} q 6 -54 ${rig.headR + 6} -54 q ${rig.headR + 6} 0 ${rig.headR + 6} 54 q -10 14 -${rig.headR + 6} 6 q -2 -22 -${rig.headR + 6} 6 z`,
        fill: c.deep, opacity: 0.92
      }, head);
    }

    // 耳朵
    this.buildEars(head, rig, c, hy);

    // 脸
    mk('circle', { cx: 100, cy: hy, r: rig.headR, fill: c.body, stroke: c.deep, 'stroke-width': 2 }, head);
    if (rig.snout) {
      mk('ellipse', { cx: 100, cy: hy + rig.headR * 0.42, rx: rig.headR * 0.5, ry: rig.headR * 0.36, fill: c.soft }, head);
      mk('path', { d: `M100 ${hy + rig.headR * 0.42} l -5 7 l 10 0 z`, fill: c.deep }, head); // 鼻
    }

    // 腮红
    if (rig.cheeks) {
      this.refs.blushL = mk('ellipse', { cx: 100 - rig.headR * 0.62, cy: hy + 6, rx: rig.headR * 0.22, ry: rig.headR * 0.14, fill: '#FF8FB0', opacity: 0 }, head);
      this.refs.blushR = mk('ellipse', { cx: 100 + rig.headR * 0.62, cy: hy + 6, rx: rig.headR * 0.22, ry: rig.headR * 0.14, fill: '#FF8FB0', opacity: 0 }, head);
    }

    // 眼睛（带眨眼的缩放组）
    this.refs.eyeL = this.buildEye(head, 100 - rig.headR * 0.4, hy - 2, rig.headR);
    this.refs.eyeR = this.buildEye(head, 100 + rig.headR * 0.4, hy - 2, rig.headR);

    // 眉毛
    this.refs.browL = mk('g', { transform: `translate(${100 - rig.headR * 0.42}, ${hy - rig.headR * 0.42})` }, head);
    mk('path', { d: 'M-9 0 q 9 -5 18 0', stroke: c.deep, 'stroke-width': 3, fill: 'none', 'stroke-linecap': 'round' }, this.refs.browL);
    this.refs.browR = mk('g', { transform: `translate(${100 + rig.headR * 0.42}, ${hy - rig.headR * 0.42})` }, head);
    mk('path', { d: 'M-9 0 q 9 -5 18 0', stroke: c.deep, 'stroke-width': 3, fill: 'none', 'stroke-linecap': 'round' }, this.refs.browR);

    // 嘴
    this.refs.mouth = mk('path', { d: '', stroke: c.deep, 'stroke-width': 3, fill: 'none', 'stroke-linecap': 'round' }, head);
    this.refs.mouthFill = mk('path', { d: '', fill: '#C0496B', opacity: 0 }, head);
  };

  // 构建一只眼睛（缩放组：垂直缩放即眨眼）
  Skeleton.prototype.buildEye = function (parent, x, y, r) {
    const g = mk('g', { transform: `translate(${x},${y}) scale(1,1)` }, parent);
    mk('ellipse', { cx: 0, cy: 0, rx: r * 0.2, ry: r * 0.26, fill: '#fff' }, g);
    mk('circle', { cx: 0, cy: r * 0.04, r: r * 0.13, fill: '#2B3242' }, g); // 瞳孔
    mk('circle', { cx: -r * 0.05, cy: -r * 0.04, r: r * 0.045, fill: '#fff' }, g); // 高光
    this.refs['pupil_' + (x < 100 ? 'L' : 'R')] = g.querySelector('circle');
    return g;
  };

  Skeleton.prototype.buildEars = function (head, rig, c, hy) {
    if (rig.ear === 'cat') {
      for (const s of [-1, 1]) {
        mk('path', { d: `M${100 + s * rig.headR * 0.5} ${hy - rig.headR * 0.6} l ${s * 6} -${rig.headR * 0.8} l ${s * rig.headR * 0.45} ${rig.headR * 0.5} z`, fill: c.body, stroke: c.deep, 'stroke-width': 2 }, head);
        mk('path', { d: `M${100 + s * rig.headR * 0.55} ${hy - rig.headR * 0.7} l ${s * 3} -${rig.headR * 0.5} l ${s * rig.headR * 0.2} ${rig.headR * 0.35} z`, fill: c.soft }, head);
      }
      this.refs.earL = mk('g', {}, head); this.refs.earR = mk('g', {}, head);
    } else if (rig.ear === 'dog') {
      for (const s of [-1, 1]) {
        mk('path', { d: `M${100 + s * rig.headR * 0.7} ${hy - rig.headR * 0.4} q ${s * rig.headR * 0.7} ${rig.headR * 0.2} ${s * rig.headR * 0.35} ${rig.headR * 0.9} q ${s * -rig.headR * 0.2} ${rig.headR * 0.2} ${s * -rig.headR * 0.4} ${rig.headR * 0.2} z`, fill: c.deep, opacity: 0.85 }, head);
      }
    }
    // 'hair' 与 'none' 不画独立耳朵
  };

  /** 构建一条 2 段肢体（上臂+前臂，嵌套旋转组）。leg=true 时末端画脚 */
  Skeleton.prototype.buildLimb = function (parent, id, style, leg) {
    if (style === 'none') { const g = mk('g', { id }, parent); g.style.display = 'none'; return { g, none: true }; }
    const rig = this.rig;
    let L1, L2, anchorX, anchorY, w;
    if (leg) {
      L1 = rig.limbLen * 0.55; L2 = rig.limbLen * 0.6; w = 9;
      anchorX = 100 + (id === 'legL' ? -rig.bodyW * 0.42 : rig.bodyW * 0.42);
      anchorY = 176;
    } else {
      L1 = rig.limbLen * 0.55; L2 = rig.limbLen * 0.6; w = 8;
      anchorX = 100 + (id === 'armL' ? -rig.bodyW * 0.82 : rig.bodyW * 0.82);
      anchorY = 120;
    }
    const g = mk('g', { id, transform: `translate(${anchorX},${anchorY})` }, parent);
    g._ax = anchorX; g._ay = anchorY; // 锚点缓存，pose 时仅追加旋转
    const upper = mk('line', { x1: 0, y1: 0, x2: 0, y2: L1, stroke: this.colors.deep, 'stroke-width': w, 'stroke-linecap': 'round' }, g);
    mk('line', { x1: 0, y1: 0, x2: 0, y2: L1, stroke: this.colors.body, 'stroke-width': w - 3, 'stroke-linecap': 'round' }, g);
    const fore = mk('g', { transform: `translate(0,${L1})` }, g);
    mk('line', { x1: 0, y1: 0, x2: 0, y2: L2, stroke: this.colors.deep, 'stroke-width': w, 'stroke-linecap': 'round' }, fore);
    mk('line', { x1: 0, y1: 0, x2: 0, y2: L2, stroke: this.colors.body, 'stroke-width': w - 3, 'stroke-linecap': 'round' }, fore);
    const hand = mk('circle', { cx: 0, cy: L2, r: (style === 'hand' ? this.rig.handSize : this.rig.pawSize), fill: this.colors.deep }, fore);
    if (style === 'paw') { hand.setAttribute('fill', this.colors.body); hand.setAttribute('stroke', this.colors.deep); hand.setAttribute('stroke-width', 2); }
    return { g, upper, fore, hand, L1, L2, w, isArm: id.indexOf('arm') === 0, _ax: anchorX, _ay: anchorY };
  };

  /** 每帧写入姿态。pose 字段见 engine 注释。 */
  Skeleton.prototype.pose = function (p) {
    const r = this.refs, rig = this.rig, c = this.colors;

    // 根部：落脚点为支点旋转（lean+sway），再整体上下 bob
    const lean = p.lean || 0, sway = p.sway || 0, bob = p.bob || 0;
    r.root.setAttribute('transform', `translate(100,206) rotate(${lean + sway}) translate(0,${bob}) translate(-100,-206)`);

    // 身体呼吸
    const br = p.breath != null ? p.breath : 1;
    r.body.setAttribute('transform', `translate(100,142) scale(1,${br}) translate(-100,-142)`);

    // 头
    const ht = p.headTilt || 0;
    r.head.setAttribute('transform', `translate(100,${64 + (rig.headDY || 0)}) rotate(${ht}) translate(-100,${-(64 + (rig.headDY || 0))})`);

    // 眼睛：垂直缩放 = 睁闭；瞳孔随视线微移
    const eo = p.eyeOpen != null ? p.eyeOpen : 1;
    const wink = p.wink;
    const eoL = wink === 'L' ? 0.08 : eo, eoR = wink === 'R' ? 0.08 : eo;
    const eyeY = 64 - 2;
    this._poseEye(r.eyeL, 100 - rig.headR * 0.4, eyeY, eoL, p);
    this._poseEye(r.eyeR, 100 + rig.headR * 0.4, eyeY, eoR, p);

    // 眉毛：brow>0 严肃/怒（内端上挑），<0 放松
    const b = p.brow || 0;
    r.browL.setAttribute('transform', `translate(${100 - rig.headR * 0.42},${64 + (rig.headR ? 0 : 0) - rig.headR * 0.42}) rotate(${b * -14})`);
    r.browR.setAttribute('transform', `translate(${100 + rig.headR * 0.42},${64 + (rig.headR ? 0 : 0) - rig.headR * 0.42}) rotate(${b * 14})`);

    // 嘴
    const mc = p.mouthCurve != null ? p.mouthCurve : 0;
    const mo = p.mouthOpen || 0;
    const mw = rig.headR * 0.42;
    const cx = 100, cy = 64 + 2 - 2 + rig.headR * 0.42;
    const ctrlY = cy + mc * rig.headR * 0.32;
    r.mouth.setAttribute('d', `M${cx - mw} ${cy} Q ${cx} ${ctrlY} ${cx + mw} ${cy}`);
    if (mo > 0.02) {
      const h = mo * rig.headR * 0.5;
      r.mouthFill.setAttribute('d', `M${cx - mw * 0.7} ${cy} Q ${cx} ${ctrlY} ${cx + mw * 0.7} ${cy} L ${cx + mw * 0.7} ${cy + h} Q ${cx} ${cy + h + 4} ${cx - mw * 0.7} ${cy + h} z`);
      r.mouthFill.setAttribute('opacity', 0.9);
    } else r.mouthFill.setAttribute('opacity', 0);

    // 腮红
    if (r.blushL) { const bl = p.blush || 0; r.blushL.setAttribute('opacity', bl * 0.8); r.blushR.setAttribute('opacity', bl * 0.8); }

    // 尾巴摆动：围绕身体后下方的固定锚点旋转
    if (r.tail) {
      const tAx = 100 + rig.bodyW * 0.7, tAy = 170;
      r.tail.setAttribute('transform', `translate(${tAx},${tAy}) rotate(${p.tailWag || 0})`);
    }

    // 腿（静置或动作）
    this._poseLimb(r.legL, p.legs && p.legs.L, rig);
    this._poseLimb(r.legR, p.legs && p.legs.R, rig);
    this._poseLimb(r.armL, p.armL, rig);
    this._poseLimb(r.armR, p.armR, rig);

    // 情绪提亮：整体往亮调偏
    if (p.glow != null && Math.abs(p.glow) > 0.01) {
      const bodyFill = p.glow > 0 ? lighten(c.body, p.glow * 0.35) : darken(c.body, -p.glow * 0.25);
      r.body.firstChild.setAttribute('fill', bodyFill);
    } else {
      r.body.firstChild.setAttribute('fill', c.body);
    }
  };

  Skeleton.prototype._poseEye = function (g, x, y, open, p) {
    g.setAttribute('transform', `translate(${x},${y}) scale(1,${Math.max(0.06, open)})`);
    const pupil = g.querySelector('circle:nth-child(2)');
    if (pupil) pupil.setAttribute('cx', (p.gazeX || 0) * 2.2);
  };

  Skeleton.prototype._poseLimb = function (limb, t, rig) {
    if (!limb || !limb.g || limb.g.style.display === 'none') return;
    const sh = t ? (t.sh || 0) : 0;
    const el = t ? (t.el || 0) : 0;
    // anchor（_ax/_ay）固定，仅追加旋转；前臂相对上臂末端再旋转
    limb.g.setAttribute('transform', `translate(${limb._ax},${limb._ay}) rotate(${sh})`);
    limb.fore.setAttribute('transform', `translate(0,${limb.L1}) rotate(${el})`);
    if (t && t.open != null) {
      const base = limb.isArm ? this.rig.handSize : this.rig.pawSize;
      limb.hand.setAttribute('r', base * (0.7 + t.open * 0.5));
    }
  };

  return Skeleton;
});
