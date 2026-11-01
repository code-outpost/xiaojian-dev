'use strict';
/**
 * 活体引擎 · 纯逻辑 / 无头运行单测（Node）
 * 验证：数学、情绪映射、手势分析、动作库，以及（用桩 DOM 跑通）引擎每帧不抛错且数值有限。
 *
 * 注意：引擎现在驱动的是**原始立绘**（把 .layer 包进 .live-body 做整体形变），
 * 所以这里只需要一个够用的假 DOM，不再需要 SVG 相关桩。
 */
const path = require('path');
const DIR = path.join(__dirname, '..', 'src', 'pet', 'live');

const M = require(path.join(DIR, 'math.js'));
const Emotion = require(path.join(DIR, 'emotion.js'));
const G = require(path.join(DIR, 'gesture.js'));
const { ACTIONS, IdleScheduler, DEFAULT_DUR } = require(path.join(DIR, 'actions.js'));
const Engine = require(path.join(DIR, 'engine.js'));

let fails = 0;
function ok(name, cond) { console.log((cond ? 'PASS ' : 'FAIL ') + name); if (!cond) fails++; }
function finite(o, name) {
  let all = true; const bad = [];
  (function walk(v, k) {
    if (typeof v === 'number') { if (!Number.isFinite(v)) { all = false; bad.push(k); } }
    else if (v && typeof v === 'object') for (const kk in v) walk(v[kk], (k ? k + '.' : '') + kk);
  })(o);
  ok(name + ' 全部数值有限' + (all ? '' : '  坏值:' + bad.join(',')), all);
}

/* ---- math ---- */
ok('clamp', M.clamp(5, 0, 1) === 1 && M.clamp(-5, 0, 1) === 0);
ok('lerp', M.lerp(0, 10, 0.5) === 5);
ok('damp 收敛', Math.abs(M.damp(0, 100, 5, 1) - 100) < 1);

/* ---- emotion ---- */
const em = new Emotion();
em.setStats({ mood: 90, energy: 80, intimacy: 50 });
let tgt = em.update(0.1);
ok('emotion 字段齐全', ['eyeOpen', 'mouthCurve', 'brow', 'blush', 'bobAmp', 'lean', 'tailWag'].every(k => k in tgt));
ok('emotion 高心情→微笑', tgt.mouthCurve > 0.3);
ok('emotion 高精力→睁眼', tgt.eyeOpen > 0.6);
em.impulse('sad', 3);
let baseMouth = em.update(0.1).mouthCurve;
for (let i = 0; i < 4; i++) tgt = em.update(0.1);
ok('emotion 悲伤冲量→嘴角下弯（相对基线）', tgt.mouthCurve < baseMouth - 0.1);
em.setSleeping(true);
for (let i = 0; i < 30; i++) tgt = em.update(0.1);
ok('emotion 睡眠→眼半闭', tgt.eyeOpen < 0.3);
finite(tgt, 'emotion.target');

/* ---- gesture ---- */
function handLandmarks(open) {
  const wrist = { x: 0.5, y: 0.85 };
  const lm = new Array(21);
  lm[0] = wrist;
  const dirs = [[0, -1], [-0.18, -1], [0, -1], [0.18, -1], [0.32, -1]];
  for (let f = 0; f < 5; f++) {
    const d = dirs[f];
    const mcp = { x: wrist.x + d[0] * 0.04, y: wrist.y + d[1] * 0.04 };
    const pip = { x: wrist.x + d[0] * 0.06, y: wrist.y + d[1] * (open ? 0.10 : 0.05) };
    const tip = { x: wrist.x + d[0] * 0.07, y: wrist.y + d[1] * (open ? 0.16 : 0.06) };
    const base = 1 + f * 4;
    lm[base] = mcp; lm[base + 1] = { x: (mcp.x + pip.x) / 2, y: (mcp.y + pip.y) / 2 }; lm[base + 2] = pip;
    lm[base + 3] = { x: (pip.x + tip.x) / 2, y: (pip.y + tip.y) / 2 }; lm[base + 4] = tip;
  }
  return lm;
}
const openHand = G.analyze([handLandmarks(true)]);
const fist = G.analyze([handLandmarks(false)]);
ok('手势 张开手 openness 高', openHand.present && openHand.openness > 0.5);
ok('手势 握拳 openness 低', fist.present && fist.openness < 0.4);
ok('手势 张开 vs 握拳 有区分', openHand.openness > fist.openness + 0.2);
finite(openHand, 'gesture.openHand');

/* ---- 动作库 ---- */
const ACTION_NAMES = ['wave', 'cheer', 'jump', 'dance', 'stretch', 'bow', 'peek', 'spin',
  'yawn', 'holdSign', 'type', 'pop', 'heart', 'purr', 'point', 'sit'];
ACTION_NAMES.forEach(n => {
  let bad = false, maxV = 0;
  try {
    for (let i = 0; i <= 10; i++) {
      const r = ACTIONS[n](i / 10, {});
      if (!r || typeof r !== 'object') { bad = true; break; }
      for (const k of ['x', 'y', 'rot', 'sx', 'sy']) {
        if (r[k] !== undefined) {
          if (!Number.isFinite(r[k])) { bad = true; break; }
          maxV = Math.max(maxV, Math.abs(r[k]));
        }
      }
    }
  } catch (e) { bad = true; }
  ok('动作 ' + n + ' 全程数值有限' + (bad ? ' (异常)' : '') + '  峰值=' + maxV.toFixed(1), !bad);
});
ok('动作库都有时长', ACTION_NAMES.every(n => DEFAULT_DUR[n] > 0 || n === 'holdSign'));

const sch = new IdleScheduler();
sch.force('jump');
ok('调度器 动作播完清空', (function () { for (let i = 0; i < 25; i++) sch.update(0.05, { a: 0.5, p: 0.5 }); return sch.current === null; })());

/* ---- 引擎：桩 DOM 跑通 ---- */
function fakeEl(tag) {
  const e = {
    tag, children: [], parentNode: null, style: {}, dataset: {}, className: '', textContent: '',
    classList: { add() {}, remove() {}, toggle() {} },
    setAttribute() {}, getAttribute() { return null; },
    appendChild(c) {
      if (c.parentNode) c.parentNode.removeChild(c);   // 真 DOM 会重新挂载，桩也要照做
      c.parentNode = e; e.children.push(c); return c;
    },
    insertBefore(c, ref) {
      c.parentNode = e;
      const i = ref ? e.children.indexOf(ref) : 0;
      e.children.splice(i < 0 ? 0 : i, 0, c);
      return c;
    },
    removeChild(c) { const i = e.children.indexOf(c); if (i >= 0) e.children.splice(i, 1); c.parentNode = null; return c; },
    remove() { if (e.parentNode) e.parentNode.removeChild(e); },
    contains(c) { let p = c; while (p) { if (p === e) return true; p = p.parentNode; } return false; },
    querySelector(sel) { return e.querySelectorAll(sel)[0] || null; },
    querySelectorAll(sel) {
      const cls = sel.startsWith('.') ? sel.slice(1) : null;
      const out = [];
      (function walk(n) {
        n.children.forEach(ch => {
          const okCls = cls ? String(ch.className || '').split(/\s+/).indexOf(cls) >= 0 : true;
          if (okCls) out.push(ch);
          walk(ch);
        });
      })(e);
      return out;
    },
    addEventListener() {}
  };
  return e;
}
global.document = { createElement: (t) => fakeEl(t), createElementNS: (ns, t) => fakeEl(t) };
global.performance = global.performance || { now: () => Date.now() };

const char = { id: 'cat', color: '#FFB6C1', colorDeep: '#F58BA8', colorSoft: '#FFE3EC' };
const container = fakeEl('div');
const layerA = fakeEl('img'); layerA.className = 'layer';
const layerB = fakeEl('img'); layerB.className = 'layer';
container.appendChild(layerA); container.appendChild(layerB);

let live = null, threw = null;
try {
  live = new Engine(container, char);
} catch (e) { threw = e; }
ok('引擎构造成功', !threw && !!live);
if (threw) console.log('  错误:', threw.message);

if (live) {
  ok('立绘被包进 .live-body', !!container.querySelector('.live-body')
    && container.querySelector('.live-body').contains(layerA));
  ok('立绘数量不变（2 层都在）', container.querySelectorAll('.layer').length === 2);

  live.setStats({ mood: 80, energy: 70, intimacy: 30 });
  live.setCameraMirror(true);
  live.reactToHand({ present: true, palmX: 0.6, palmY: 0.5, openness: 0.8, pointing: false });

  let frameErr = null;
  try {
    for (let i = 0; i < 180; i++) {
      live.action(ACTION_NAMES[i % ACTION_NAMES.length], 1);
      live.frame(0.016);
    }
    live.setSleeping(true);
    for (let i = 0; i < 60; i++) live.frame(0.016);
    live.reactToHand({ present: false });
    for (let i = 0; i < 40; i++) live.frame(0.016);
  } catch (e) { frameErr = e; }
  ok('引擎跑 280 帧无异常', !frameErr);
  if (frameErr) console.log('  错误:', frameErr && frameErr.stack || frameErr);

  finite(live.s, 'engine.state');
  ok('产出 transform 字符串', typeof live.body.style.transform === 'string'
    && /translate3d\(.+\) rotate\(.+\) scale\(.+\)/.test(live.body.style.transform),
    live.body.style.transform);

  // 手势镜像：手移到右边，宠物应该往右挪并右倾
  // ⚠️ 真实链路里 IPC 约 16fps 持续送帧，这里必须每帧都刷新，否则手会被判定成「已离开」
  live.setSleeping(false);
  live.setCameraMirror(true);
  for (let i = 0; i < 90; i++) {
    live.reactToHand({ present: true, palmX: 1, palmY: 0.8, openness: 1 });
    live.frame(0.016);
  }
  ok('手势右移→身体右移', live.s.x > 8, 'x=' + live.s.x.toFixed(1));
  ok('手势右移→身体右倾', live.s.rot > 2, 'rot=' + live.s.rot.toFixed(1));
  ok('手势抬高→身体上浮', live.s.y < -3, 'y=' + live.s.y.toFixed(1));

  // 手离开后应回到情绪驱动（不再被手势钉住）
  const handY = live.s.y;
  for (let i = 0; i < 120; i++) live.frame(0.016);
  ok('手离开→手势权重归零', live.handMix < 0.05, 'mix=' + live.handMix.toFixed(3));
  ok('手离开→姿态回落到情绪基线', Math.abs(live.s.y) > 0.01 || Math.abs(live.s.x) < 20);

  live.destroy();
  ok('销毁后 .live-body 已移除', !container.querySelector('.live-body'));
  ok('销毁后立绘回到容器', container.querySelectorAll('.layer').length === 2);
  ok('销毁后 transform 已清空', live.body === null);
}

console.log('\n' + (fails === 0 ? '全部通过 ✅' : (fails + ' 项失败 ❌')));
process.exit(fails === 0 ? 0 : 1);
