'use strict';
/* ==========================================================
   Mochi 桌面宠物 · 宠物窗口逻辑
   状态机 / 气泡 / 互动 / 拖拽 / 鼠标穿透 / 提醒
   ========================================================== */
(() => {
  const api = window.mochi;
  const D = window.MochiData;
  const Sound = window.MochiSound;

  const $ = s => document.querySelector(s);
  const stage = $('#stage');
  const bubbleEl = $('#bubble');
  const bubbleText = $('#bubbleText');
  const bubbleActions = $('#bubbleActions');
  const petWrap = $('#petWrap');
  const heartsEl = $('#hearts');
  const statsEl = $('#stats');
  const layers = [document.querySelector('#layerA'), document.querySelector('#layerB')];

  let cfg = null;
  let charId = 'cat';
  let char = D.CHARACTERS.cat;

  let baseState = 'idle';        // idle | sleepy
  let override = null;           // { name, until }
  let overrideTimer = null;
  let visibleState = '';
  let front = 0;

  let dragging = false;
  let walking = false;
  let press = null;
  let ignoreMouse = true;

  let live = null;   // 活体引擎实例（livingPet 开启且非自定义形象时存在）

  let hovering = false;
  let hoverTimer = null;
  let petting = false;
  let pettingTick = null;
  let lastPetBumpAt = 0;

  let typeTimer = null;
  let hideTimer = null;
  let currentRemind = null;

  let lastScene = 'other';
  let scale = 1;

  const ASSET = (state) => D.spriteUrl(char, state);

  /* ---------------- 初始化 ---------------- */
  async function init() {
    cfg = await api.getConfig();
    const map = D.runtimeCharacters(cfg).map;
    charId = map[cfg.character] ? cfg.character : 'cat';
    char = map[charId] || D.CHARACTERS.cat;
    scale = cfg.scale || 1;

    applyCharacter(char);
    applyScale();
    updateStats(cfg.stats, false);

    // 活体引擎：内置角色默认启用（自定义形象无骨骼素材，自动回退静态立绘）
    if (cfg.livingPet !== false && !char.custom) buildLive(char);
    statsEl.classList.toggle('always', !!cfg.showStats);
    Sound.setEnabled(cfg.sound !== false);

    setSprite('idle');
    bindEvents();
    startIdleChatter();
    startTypingFlashes();

    // 预加载 9 个状态，避免切换时闪白
    D.STATE_LIST.forEach(s => { const i = new Image(); i.src = ASSET(s); });

    setTimeout(() => sayRandom(char.idle, 4400), 1400);
  }

  function applyCharacter(c) {
    document.documentElement.style.setProperty('--theme', c.color);
    document.documentElement.style.setProperty('--theme-deep', c.colorDeep);
    document.documentElement.style.setProperty('--theme-soft', c.colorSoft);
  }

  function applyScale() {
    document.documentElement.style.setProperty('--pet-size', `${Math.round(250 * scale)}px`);
  }

  /* ---------------- 状态机 ---------------- */
  function computeState() {
    if (dragging) return 'peek';
    if (walking) return 'peek';
    if (override && performance.now() < override.until) return override.name;
    return baseState;
  }

  function refresh() {
    const s = computeState();
    if (s !== visibleState) setSprite(s);
  }

  function setSprite(state) {
    visibleState = state;
    petWrap.classList.forEach(cls => {
      if (cls.startsWith('state-')) petWrap.classList.remove(cls);
    });
    petWrap.classList.add(`state-${state}`);

    const src = ASSET(state);
    const current = layers[front].getAttribute('src') || '';
    if (current.endsWith(src)) return;

    const apply = s => {
      const back = 1 - front;
      layers[back].src = s;
      layers[back].classList.add('on');
      layers[front].classList.remove('on');
      front = back;
    };

    // 自定义形象的图片可能已被删除 / 路径失效，此时如果不兜底，
    // onload 永远不触发 → 两层 img 都不更新 → 整只宠物变空白。
    const fallback = `../../assets/cat/${state}.png`;

    const probe = new Image();
    probe.onload = () => apply(src);
    probe.onerror = () => {
      probe.onerror = null;
      if (src === fallback) return;      // 兜底图也挂了就别再循环
      const p2 = new Image();
      p2.onload = () => apply(fallback);
      p2.src = fallback;
    };
    probe.src = src;
  }

  function setOverride(name, ms) {
    override = { name, until: performance.now() + ms };
    if (live) livePlay(name);
    clearTimeout(overrideTimer);
    overrideTimer = setTimeout(() => { override = null; refresh(); }, ms + 16);
    refresh();
  }

  function clearOverride() {
    override = null;
    clearTimeout(overrideTimer);
    refresh();
  }

  function setBase(name) {
    baseState = name;
    if (live) liveBase(name);
    refresh();
  }

  /* ---------------- 活体引擎：构建 / 语义映射 ---------------- */
  function buildLive(c) {
    if (live) { live.destroy(); live = null; }
    live = new window.LivePet(petWrap, c);
    petWrap.classList.add('living');
    live.setStats(cfg.stats);
    live.setCameraMirror(!!cfg.cameraMirror);
    live.start();
  }

  /** 把旧逻辑的「状态名」翻译成活体引擎的动作/情绪 */
  function livePlay(name) {
    if (!live) return;
    switch (name) {
      case 'happy': live.action('cheer'); live.impulse('happy'); break;
      case 'excited': live.action('jump'); live.impulse('excited'); break;
      case 'peek': live.action('peek'); live.impulse('surprise'); break;
      case 'petting': live.action('purr'); live.impulse('petting'); break;
      case 'clicking': live.action('pop'); live.impulse('poke'); break;
      case 'typing': live.action('type'); break;
      case 'reminding': live.action('holdSign'); live.impulse('calm'); break;
      default: break;
    }
  }

  function liveBase(name) {
    if (!live) return;
    if (name === 'sleepy') live.setSleeping(true);
    else live.setSleeping(false);
  }

  function liveClear() {
    if (live) live.clearAction();
  }

  /* ---------------- 气泡 ---------------- */
  function say(text, ms = 4200, actions = []) {
    clearInterval(typeTimer);
    clearTimeout(hideTimer);
    bubbleActions.innerHTML = '';
    bubbleActions.classList.remove('show');
    bubbleEl.classList.add('show');

    const speed = Math.max(14, Math.min(30, 820 / Math.max(8, text.length)));
    const caret = document.createElement('span');
    caret.className = 'caret';

    let i = 0;
    bubbleText.textContent = '';
    bubbleText.appendChild(caret);

    typeTimer = setInterval(() => {
      i += 1;
      bubbleText.textContent = text.slice(0, i);
      bubbleText.appendChild(caret);
      if (i >= text.length) {
        clearInterval(typeTimer);
        caret.remove();
        afterTyped();
      }
    }, speed);

    function afterTyped() {
      if (actions.length) {
        bubbleActions.classList.add('show');
        actions.forEach(a => {
          const btn = document.createElement('button');
          btn.textContent = a.label;
          if (a.primary) btn.classList.add('primary');
          btn.addEventListener('click', ev => {
            ev.stopPropagation();
            ev.preventDefault();
            a.on && a.on();
          });
          bubbleActions.appendChild(btn);
        });
      }
      const rest = Math.max(1900, ms - text.length * speed);
      hideTimer = setTimeout(hideBubble, rest);
    }
  }

  function hideBubble() {
    bubbleEl.classList.remove('show');
    bubbleActions.classList.remove('show');
    clearTimeout(hideTimer);
    if (currentRemind) {
      // 没点按钮 = 暂缓，10 分钟后再提醒
      api.snoozeReminder(currentRemind);
      currentRemind = null;
    }
  }

  /** 从台词数组随机说一句，数组为空时跳过（避免空气泡） */
  function sayRandom(arr, ms, actions) {
    const t = D.pick(arr);
    if (t) say(t, ms, actions);
  }

  /* ---------------- 数值 ---------------- */
  let lastStats = {};
  function updateStats(s, animate = true) {
    if (!s) return;
    statsEl.querySelectorAll('.stat').forEach(el => {
      const k = el.dataset.k;
      const v = Math.round(s[k] ?? 0);
      const valEl = el.querySelector('.val');
      if (valEl.textContent !== String(v)) {
        valEl.textContent = v;
        if (animate) {
          el.classList.remove('bump');
          // 强制重排后重新加动画
          void el.offsetWidth;
          el.classList.add('bump');
        }
      }
      lastStats[k] = v;
    });
  }

  /* ---------------- 爱心 ---------------- */
  function emitHearts(n = 1) {
    for (let i = 0; i < n; i++) {
      const h = document.createElement('span');
      h.className = 'heart';
      h.textContent = Math.random() > 0.62 ? '💕' : '💗';
      h.style.left = `${30 + Math.random() * 40}%`;
      h.style.top = `${52 + Math.random() * 18}%`;
      h.style.setProperty('--dx', `${-18 + Math.random() * 36}px`);
      h.style.animationDelay = `${i * 110}ms`;
      heartsEl.appendChild(h);
      setTimeout(() => h.remove(), 1800);
    }
  }

  /* ---------------- 抚摸 ---------------- */
  function startPetting() {
    if (dragging || visibleState === 'reminding' || petting) return;
    petting = true;
    Sound.purr();
    emitHearts(2);
    sayRandom(char.petting, 5200);
    bumpPetting();
    setOverride('petting', 600000);
    if (live) { live.action('purr'); live.impulse('petting'); }
    pettingTick = setInterval(() => {
      emitHearts(1);
      bumpPetting();
    }, 3600);
  }

  function stopPetting() {
    if (!petting) return;
    petting = false;
    clearInterval(pettingTick);
    pettingTick = null;
    clearOverride();
  }

  function bumpPetting() {
    const now = Date.now();
    if (now - lastPetBumpAt < 3000) return;
    lastPetBumpAt = now;
    api.bumpStat('intimacy', 1.1);
    api.bumpStat('mood', 1.4);
    api.addPetting();
  }

  /* ---------------- 点击 ---------------- */
  function onPoke() {
    if (visibleState === 'reminding' && currentRemind) { ackRemind(); return; }
    Sound.chirp();
    emitHearts(1);
    api.bumpStat('mood', 2);
    setOverride(char.handClick ? 'happy' : 'clicking', 1250);
    sayRandom(char.poke, 3000);
    if (live) { live.action(char.handClick ? 'cheer' : 'pop'); live.impulse('poke'); }
  }

  function ackRemind() {
    const t = currentRemind;
    currentRemind = null;
    if (live) liveClear();
    if (t) api.ackReminder(t);
    setOverride('happy', 1800);
    emitHearts(2);
    say(D.pick(['好~真乖', '这就对了！', '记得就好~']), 2600);
  }

  function snoozeRemind() {
    const t = currentRemind;
    currentRemind = null;
    if (live) liveClear();
    if (t) api.snoozeReminder(t);
    say('好，10 分钟后再提醒你。', 3200);
  }

  /* ---------------- 事件绑定 ---------------- */
  function bindEvents() {
    layers.forEach(img => { img.draggable = false; });

    petWrap.addEventListener('mouseenter', () => {
      hovering = true;
      clearTimeout(hoverTimer);
      hoverTimer = setTimeout(startPetting, 380);
    });

    petWrap.addEventListener('mouseleave', () => {
      hovering = false;
      clearTimeout(hoverTimer);
      stopPetting();
    });

    petWrap.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      e.preventDefault();
      press = { sx: e.screenX, sy: e.screenY, moved: false };
      // 位移交给主进程轮询光标完成：鼠标甩得快、光标离开窗口也不会掉
      api.dragStart();
    });

    window.addEventListener('mousemove', e => {
      if (!press) return;
      const dx = e.screenX - press.sx;
      const dy = e.screenY - press.sy;
      if (!press.moved && Math.hypot(dx, dy) > 4) {
        press.moved = true;
        dragging = true;
        clearTimeout(hoverTimer);
        stopPetting();
        refresh();
      }
    });

    window.addEventListener('mouseup', () => {
      if (!press) return;
      const moved = press.moved;
      press = null;
      dragging = false;
      api.dragEnd();
      if (!moved) onPoke();
      refresh();
    });

    // 兜底：窗口失焦 / 页面隐藏时，确保不残留拖拽状态
    window.addEventListener('blur', () => {
      if (!press) return;
      press = null;
      dragging = false;
      api.dragEnd();
    });

    petWrap.addEventListener('dblclick', e => {
      e.preventDefault();
      api.openWindow('settings');
    });

    petWrap.addEventListener('contextmenu', e => {
      e.preventDefault();
      api.showPetMenu();
    });

    bubbleEl.addEventListener('contextmenu', e => { e.preventDefault(); api.showPetMenu(); });

    window.addEventListener('wheel', e => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      scale = Math.min(1.5, Math.max(0.75, +(scale + (e.deltaY > 0 ? -0.05 : 0.05)).toFixed(2)));
      applyScale();
      api.patchConfig({ scale });
    }, { passive: false });

    // 鼠标穿透：只有角色 / 气泡区域可点
    document.addEventListener('mousemove', e => {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const hit = !!(el && el.closest('[data-hit]'));
      stage.classList.toggle('hover', hit || hovering);
      if (press) return;
      const want = !hit;
      if (want !== ignoreMouse) {
        ignoreMouse = want;
        api.setIgnoreMouse(want);
      }
    });

    document.addEventListener('mouseleave', () => {
      // 拖拽途中绝不能切成穿透：一旦 ignoreMouse=true，窗口就收不到 mouseup，
      // dragState 会永久残留 → 宠物黏着光标跑 / 卡在屏外叫不回来。
      if (press) return;
      if (ignoreMouse) return;
      ignoreMouse = true;
      api.setIgnoreMouse(true);
    });

    /* ---- 主进程事件 ---- */
    api.on('scene:current', info => { lastScene = info.scene; });

    api.on('scene:update', ({ scene, text }) => {
      if (!cfg.scene.on) return;
      if (scene === 'game') setOverride('excited', 4200);
      else setOverride('peek', 2600);
      say(text, 5400);
    });

    api.on('remind:fire', ({ type, text, state }) => {
      currentRemind = type;
      if (live) live.setSign(text);
      setOverride(state || 'reminding', 13000);
      emitHearts(1);
      if (cfg.sound !== false) Sound.bell();
      say(text, 13000, [
        { label: '好的', primary: true, on: ackRemind },
        { label: '待会儿', on: snoozeRemind }
      ]);
    });

    api.on('activity:change', ({ sleeping }) => {
      if (sleeping) {
        stopPetting();
        setBase('sleepy');
        refresh();
      } else if (baseState === 'sleepy') {
        setBase('idle');
        say(D.pick(['你回来啦~', '醒了醒了！', '呼…我等你很久了。']), 3200);
      }
    });

    api.on('stats:update', s => updateStats(s, true));

    api.on('pet:say', ({ text, ms }) => say(text, ms || 4200));

    api.on('pet:hi', () => {
      setOverride(char.handClick ? 'happy' : 'clicking', 1500);
      sayRandom(char.greet || char.idle, 4200);
      emitHearts(1);
      if (live) { live.action('wave'); live.impulse('greet'); }
    });

    api.on('pet:character', ({ id }) => {
      const map = D.runtimeCharacters(cfg).map;
      if (!map[id]) return;
      charId = id;
      char = map[id];
      applyCharacter(char);
      visibleState = '';
      setSprite(computeState());
      D.STATE_LIST.forEach(s => { const i = new Image(); i.src = ASSET(s); });
      // 活体引擎随角色重建（自定义形象自动回退静态立绘）
      if (live || (cfg.livingPet !== false && !char.custom)) buildLive(char);
      if (!live) { visibleState = ''; setSprite(computeState()); }
    });

    api.on('pet:mode', () => { clearOverride(); setBase('idle'); });

    // 主进程驱动「自己散步」时切换成走动姿态
    api.on('pet:walk', ({ on } = {}) => {
      walking = !!on;
      if (walking) { clearTimeout(hoverTimer); stopPetting(); }
      if (live) live.setWalking(!!on);
      refresh();
    });

    api.on('cfg:changed', c => {
      cfg = c;
      Sound.setEnabled(c.sound !== false);
      statsEl.classList.toggle('always', !!c.showStats);
      if (c.scale && c.scale !== scale) { scale = c.scale; applyScale(); }
      // 自定义角色 / 台词覆盖可能已更新，刷新当前角色对象
      const map = D.runtimeCharacters(c).map;
      if (map[charId]) { char = map[charId]; applyCharacter(char); }
      // 活体 / 摄像头开关切换
      if (c.livingPet !== undefined) {
        if (c.livingPet === false && live) { live.destroy(); live = null; petWrap.classList.remove('living'); visibleState = ''; setSprite(computeState()); }
        else if (c.livingPet !== false && !live && !char.custom) { buildLive(char); }
      }
      if (c.cameraMirror !== undefined && live) live.setCameraMirror(!!c.cameraMirror);
    });

    // 摄像头手势：实时镜像
    api.on('hand:pose', g => { if (live) live.reactToHand(g); });
  }

  /* ---------------- 主动闲聊 / 打字 ---------------- */
  function startIdleChatter() {
    const loop = () => {
      const wait = 42000 + Math.random() * 58000;
      setTimeout(() => {
        const busy = bubbleEl.classList.contains('show') || petting || dragging || press ||
          visibleState === 'reminding';
        if (!busy) {
          // 场景感知：正在某个已知场景（且已开启场景感知）时，混入该场景的专属吐槽，
          // 让宠物说的话随你正在用的软件变化，而不是永远说同一句。
          if (cfg.scene && cfg.scene.on && lastScene && lastScene !== 'other' && char.scene) {
            const pool = (char.scene[lastScene] || char.scene.other || []);
            if (pool.length && Math.random() < 0.7) {
              sayRandom(pool, 4800);
              loop();
              return;
            }
          }
          sayRandom(char.idle, 4800);
        }
        loop();
      }, wait);
    };
    loop();
  }

  function startTypingFlashes() {
    setInterval(() => {
      if (override || petting || dragging || press) return;
      if (baseState !== 'idle') return;
      if (lastScene === 'code' || lastScene === 'office') {
        setOverride('typing', 8000 + Math.random() * 6000);
      }
    }, 22000);
  }

  init();
})();
