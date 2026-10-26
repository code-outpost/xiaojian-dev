'use strict';
/**
 * 活体引擎 · 纯逻辑 / 无头运行单测（Node）
 * 验证：数学、情绪映射、手势分析、动作、以及（用桩 DOM 跑通）引擎每帧不抛错且数值有限。
 */
const path = require('path');
const DIR = path.join(__dirname, '..', 'src', 'pet', 'live');

const M = require(path.join(DIR, 'math.js'));
const Emotion = require(path.join(DIR, 'emotion.js'));
const G = require(path.join(DIR, 'gesture.js'));
const { ACTIONS, IdleScheduler } = require(path.join(DIR, 'actions.js'));
const Skeleton = require(path.join(DIR, 'skeleton.js'));
const Engine = require(path.join(DIR, 'engine.js'));
const Rigs = require(path.join(DIR, 'rigs.js'));

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
  // 简易合成：腕在下方，手指向上展开(open)或收拢(fist)
  const wrist = { x: 0.5, y: 0.85 };
  const lm = new Array(21);
  lm[0] = wrist;
  const dirs = [[0, -1], [-0.18, -1], [0, -1], [0.18, -1], [0.32, -1]];
  for (let f = 0; f < 5; f++) {
    const d = dirs[f];
    const len = open ? 0.18 : 0.05;
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

/* ---- actions ---- */
['wave', 'cheer', 'jump', 'dance', 'stretch', 'bow', 'peek', 'spin', 'yawn', 'holdSign', 'type', 'pop', 'heart', 'purr', 'point', 'sit'].forEach(n => {
  const r = ACTIONS[n](0.5, {});
  ok('动作 ' + n + ' 返回对象', r && typeof r === 'object');
});
const sch = new IdleScheduler();
sch.force('jump');
ok('调度器 动作播完清空', (function () { for (let i = 0; i < 25; i++) sch.update(0.05, { a: 0.5, p: 0.5 }); return sch.current === null; })());

/* ---- engine + skeleton 无头跑通 ---- */
function fakeEl() {
  const e = {
    children: [], firstChild: null, style: {}, dataset: {},
    classList: { add() {}, remove() {}, toggle() {} },
    setAttribute() {}, getAttribute() { return 'translate(0,0)'; },
    appendChild(c) { if (!this.firstChild) this.firstChild = c; this.children.push(c); return c; },
    insertBefore(c) { if (!this.firstChild) this.firstChild = c; this.children.unshift(c); return c; },
    removeChild() {}, querySelector() { return fakeEl(); }, querySelectorAll() { return []; },
    addEventListener() {}, parentNode: null
  };
  return e;
}
global.document = { createElementNS: () => fakeEl(), createElement: () => fakeEl() };
global.performance = { now: () => Date.now() };

const char = { id: 'cat', color: '#FFB6C1', colorDeep: '#F58BA8', colorSoft: '#FFE3EC' };
const container = fakeEl();
const live = new Engine(container, char);
live.setStats({ mood: 80, energy: 70, intimacy: 30 });
live.start && (live.start = () => {}); // 不启动真实 rAF
live.setCameraMirror(true);
live.reactToHand({ present: true, palmX: 0.6, palmY: 0.5, openness: 0.8, pointing: false });
let threw = null;
try {
  for (let i = 0; i < 120; i++) {
    live.action(['wave', 'cheer', 'jump', 'purr', 'holdSign', 'type', 'bow'][i % 7], 1);
    live.frame(0.016);
  }
  live.setSleeping(true);
  for (let i = 0; i < 60; i++) live.frame(0.016);
} catch (e) { threw = e; }
ok('engine 跑 180 帧无异常', !threw);
if (threw) console.log('  错误:', threw && threw.stack);
finite(live.s, 'engine.state');
live.destroy();
ok('engine 销毁无异常', true);

console.log('\n' + (fails === 0 ? '全部通过 ✅' : (fails + ' 项失败 ❌')));
process.exit(fails === 0 ? 0 : 1);
