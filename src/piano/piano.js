'use strict';
/* Mochi · 钢琴模式逻辑（WebAudio 实时合成，无需音频文件） */
(() => {
  const api = window.mochi;
  const D = window.MochiData;
  const Sound = window.MochiSound;

  const WHITE = [
    { key: 'a', note: 'C4', freq: 261.63 },
    { key: 's', note: 'D4', freq: 293.66 },
    { key: 'd', note: 'E4', freq: 329.63 },
    { key: 'f', note: 'F4', freq: 349.23 },
    { key: 'g', note: 'G4', freq: 392.00 },
    { key: 'h', note: 'A4', freq: 440.00 },
    { key: 'j', note: 'B4', freq: 493.88 },
    { key: 'k', note: 'C5', freq: 523.25 },
    { key: 'l', note: 'D5', freq: 587.33 },
    { key: ';', note: 'E5', freq: 659.25 },
    { key: "'", note: 'F5', freq: 698.46 }
  ];

  // at: 位于第 at 个白键之后（0 基）
  const BLACK = [
    { key: 'w', note: 'C#4', freq: 277.18, at: 0 },
    { key: 'e', note: 'D#4', freq: 311.13, at: 1 },
    { key: 't', note: 'F#4', freq: 369.99, at: 3 },
    { key: 'y', note: 'G#4', freq: 415.30, at: 4 },
    { key: 'u', note: 'A#4', freq: 466.16, at: 5 },
    { key: 'o', note: 'C#5', freq: 554.37, at: 7 },
    { key: 'p', note: 'D#5', freq: 622.25, at: 8 }
  ];

  const keysEl = document.getElementById('keys');
  const petImg = document.getElementById('petImg');
  const sayEl = document.getElementById('say');
  const notesEl = document.getElementById('notes');

  const keyMap = new Map();   // key -> { el, freq }
  let activePressed = new Set();
  let sayTimer = null;

  const SAYS = ['叮咚~', '好听！', '再来一个~', '♪', '这个音我喜欢'];

  /* ---------------- 构建键盘 ---------------- */
  function build() {
    WHITE.forEach(w => {
      const el = document.createElement('div');
      el.className = 'wkey';
      el.innerHTML = `<span class="lab">${w.key.toUpperCase()}</span>`;
      el.addEventListener('mousedown', e => { e.preventDefault(); play(w, el); });
      keysEl.appendChild(el);
      keyMap.set(w.key, { el, freq: w.freq });
    });

    const total = WHITE.length;
    BLACK.forEach(b => {
      const el = document.createElement('div');
      el.className = 'bkey';
      const widthPct = (100 / total) * 0.58;
      el.style.width = `${widthPct}%`;
      el.style.left = `calc(${((b.at + 1) / total) * 100}% - ${widthPct / 2}%)`;
      el.title = b.note;
      el.addEventListener('mousedown', e => { e.preventDefault(); play(b, el); });
      keysEl.appendChild(el);
      keyMap.set(b.key, { el, freq: b.freq });
    });
  }

  /* ---------------- 弹奏 ---------------- */
  function play(item, el) {
    Sound.piano(item.freq, 0.15, 1.15);
    const node = el || (keyMap.get(item.key) || {}).el;
    if (node) {
      node.classList.add('on');
      setTimeout(() => node.classList.remove('on'), 145);
    }
    beat();
    if (Math.random() < 0.35) showSay();
  }

  function beat() {
    petImg.classList.add('beat');
    setTimeout(() => petImg.classList.remove('beat'), 120);
  }

  function showSay() {
    const text = SAYS[Math.floor(Math.random() * SAYS.length)];
    sayEl.textContent = text;
    sayEl.classList.add('show');
    clearTimeout(sayTimer);
    sayTimer = setTimeout(() => sayEl.classList.remove('show'), 1100);
  }

  /* ---------------- 键盘事件 ---------------- */
  window.addEventListener('keydown', e => {
    if (e.key === 'Escape') { api.closePiano(); return; }
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    const k = e.key.toLowerCase();
    const hit = keyMap.get(k);
    if (hit) {
      e.preventDefault();
      if (e.repeat) return;
      if (activePressed.has(k)) return;
      activePressed.add(k);
      play({ key: k, freq: hit.freq }, hit.el);
    }
  });

  window.addEventListener('keyup', e => {
    activePressed.delete(e.key.toLowerCase());
  });

  // 鼠标进入窗口时抢回焦点（点击别处后也能继续弹）
  document.addEventListener('mouseenter', () => api.focusPiano());
  window.addEventListener('mousemove', () => { api.focusPiano(); }, { passive: true });

  document.getElementById('btnClose').addEventListener('click', () => api.closePiano());

  /* ---------------- 背景音符 ---------------- */
  function spawnNotes() {
    const glyphs = ['♪', '♫', '♩', '♬', '𝄞'];
    for (let i = 0; i < 12; i++) {
      const s = document.createElement('span');
      s.textContent = glyphs[Math.floor(Math.random() * glyphs.length)];
      s.style.left = `${4 + Math.random() * 92}%`;
      s.style.top = `${40 + Math.random() * 55}%`;
      s.style.fontSize = `${15 + Math.random() * 16}px`;
      s.style.animationDuration = `${7 + Math.random() * 7}s`;
      s.style.animationDelay = `${-Math.random() * 10}s`;
      notesEl.appendChild(s);
    }
  }

  /* ---------------- 初始化 ---------------- */
  (async () => {
    const cfg = await api.getConfig();
    const id = D.CHARACTERS[cfg.character] ? cfg.character : 'cat';
    petImg.src = `../../assets/${id}/happy.png`;
    Sound.setEnabled(cfg.sound !== false);
    build();
    spawnNotes();
    // 首次点击窗口任意位置，解锁音频
    const unlock = () => { Sound.ac(); window.removeEventListener('mousedown', unlock); };
    window.addEventListener('mousedown', unlock);
  })();
})();
