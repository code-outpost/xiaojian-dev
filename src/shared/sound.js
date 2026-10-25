/* Mochi 合成音效（无外部音频文件，全部 WebAudio 实时合成） */
(function (root) {
  'use strict';

  let ctx = null;
  let master = null;
  let enabled = true;

  function ac() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.9;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }

  function setEnabled(v) { enabled = !!v; }

  /** 基础音：可渐变、可延迟 */
  function tone(freq, opts = {}) {
    if (!enabled) return;
    const c = ac();
    if (!c) return;
    const {
      dur = 0.18, type = 'triangle', gain = 0.1, when = 0,
      glideTo = null, attack = 0.008, release = 0.16, pan = 0
    } = opts;

    const t0 = c.currentTime + when;
    const osc = c.createOscillator();
    const g = c.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (glideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, glideTo), t0 + dur);

    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur + release);

    let node = osc;
    if (pan && c.createStereoPanner) {
      const p = c.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan));
      osc.connect(p);
      node = p;
    }
    node.connect(g);
    g.connect(master);

    osc.start(t0);
    osc.stop(t0 + dur + release + 0.02);
  }

  /** 被戳/开心：两声上行的啾 */
  function chirp(up = true) {
    const base = up ? 620 : 520;
    tone(base, { dur: 0.08, type: 'triangle', gain: 0.09 });
    tone(base * (up ? 1.5 : 1.25), { dur: 0.1, type: 'triangle', gain: 0.08, when: 0.085 });
  }

  /** 被摸：呼噜感的低频颤动 */
  function purr() {
    if (!enabled) return;
    const c = ac();
    if (!c) return;
    const t0 = c.currentTime;
    const osc = c.createOscillator();
    const lfo = c.createOscillator();
    const lfoGain = c.createGain();
    const g = c.createGain();

    osc.type = 'sine';
    osc.frequency.value = 78;
    lfo.type = 'sine';
    lfo.frequency.value = 22;
    lfoGain.gain.value = 0.035;

    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.07, t0 + 0.12);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.1);

    lfo.connect(lfoGain).connect(g.gain);
    osc.connect(g).connect(master);
    osc.start(t0); lfo.start(t0);
    osc.stop(t0 + 1.2); lfo.stop(t0 + 1.2);
  }

  /** 提醒铃：三声温柔提示 */
  function bell() {
    [784, 988, 1175].forEach((f, i) => {
      tone(f, { dur: 0.34, type: 'sine', gain: 0.075, when: i * 0.16, release: 0.4 });
      tone(f * 2, { dur: 0.2, type: 'sine', gain: 0.02, when: i * 0.16 });
    });
  }

  /** 钢琴音（多振荡器叠加 + 泛音） */
  function piano(freq, gain = 0.16, dur = 1.1) {
    if (!enabled) return;
    const c = ac();
    if (!c) return;
    const t0 = c.currentTime;

    const out = c.createGain();
    out.gain.value = 1;
    out.connect(master);

    const partials = [
      { type: 'triangle', mul: 1, g: 1.0, det: 0 },
      { type: 'sine', mul: 2, g: 0.34, det: 3 },
      { type: 'sine', mul: 3, g: 0.12, det: -4 },
      { type: 'sawtooth', mul: 1, g: 0.05, det: 6 }
    ];

    partials.forEach(p => {
      const osc = c.createOscillator();
      const g = c.createGain();
      osc.type = p.type;
      osc.frequency.value = freq * p.mul;
      osc.detune.value = p.det;

      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain * p.g), t0 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

      osc.connect(g).connect(out);
      osc.start(t0);
      osc.stop(t0 + dur + 0.05);
    });

    // 轻微制音，避免刺耳
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 4200;
    out.disconnect();
    out.connect(lp).connect(master);
  }

  root.MochiSound = { ac, tone, chirp, purr, bell, piano, setEnabled };
})(window);
