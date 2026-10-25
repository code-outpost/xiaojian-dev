'use strict';
/* Mochi · 首次引导逻辑 */
(() => {
  const api = window.mochi;
  const D = window.MochiData;

  // 从设置里「重新看一遍」进入 = 回顾模式：不改文案语义、不强制唤起宠物
  const REPLAY = new URLSearchParams(location.search).get('replay') === '1';

  const grid = document.getElementById('charGrid');
  const stepper = document.getElementById('stepper');
  const winTitle = document.getElementById('winTitle');

  const state = { step: 1, character: 'cat', scene: true };
  let rcMap = D.CHARACTERS;   // 运行时角色表（init 后填充）

  /* ---------------- 角色卡片 ---------------- */
  function buildGrid() {
    grid.innerHTML = '';
    const { map, ids } = D.runtimeCharacters(state.__cfg || {});
    rcMap = map;
    ids.forEach(id => {
      const c = map[id];
      const card = document.createElement('button');
      card.className = 'char-card';
      card.dataset.id = id;
      card.style.setProperty('--theme', c.color);
      card.innerHTML = `
        <span class="check">✓</span>
        <div class="char-thumb" style="--c1:${c.colorSoft};--c2:#FFFFFF">
          <img src="${D.spriteUrl(c, 'idle')}" alt="${c.name}">
        </div>
        <div class="char-name">${c.name}<span>${c.en || ''}</span></div>
        <div class="char-traits">${(c.traits || []).join(' · ')}</div>
      `;
      card.addEventListener('click', () => selectCharacter(id));
      grid.appendChild(card);
    });
    markSelected(state.character);
  }

  function selectCharacter(id) {
    state.character = id;
    const c = rcMap[id] || D.CHARACTERS.cat;
    document.documentElement.style.setProperty('--theme', c.color);
    document.documentElement.style.setProperty('--theme-deep', c.colorDeep);
    document.documentElement.style.setProperty('--theme-soft', c.colorSoft);

    markSelected(id);

    document.getElementById('doneImg').src = D.spriteUrl(c, 'idle');
    document.getElementById('doneName').textContent = `${c.name} · ${c.en || ''}`;
    document.getElementById('doneTraits').textContent = (c.traits || []).join(' · ');
    document.getElementById('doneQuote').textContent = `“${c.slogan}”`;
    document.getElementById('doneChar').style.setProperty('--theme-soft', c.colorSoft);
    document.getElementById('doneChar').style.setProperty('--theme-deep', c.colorDeep);
  }

  function markSelected(id) {
    grid.querySelectorAll('.char-card').forEach(el => {
      el.classList.toggle('selected', el.dataset.id === id);
    });
  }

  /* ---------------- 步骤切换 ---------------- */
  function goto(step) {
    state.step = step;
    document.querySelectorAll('.pane').forEach(p => {
      p.classList.toggle('active', p.id === `pane${step}`);
    });
    stepper.querySelectorAll('.step-item').forEach(el => {
      const n = Number(el.dataset.step);
      el.classList.toggle('active', n === step);
      el.classList.toggle('done', n < step);
    });
    winTitle.textContent = REPLAY
      ? ['新手引导', '场景感知', '完成'][step - 1] || '新手引导'
      : (step === 1 ? '欢迎来到 Mochi' : step === 2 ? '场景感知' : '准备完成');
  }

  document.getElementById('toStep2').addEventListener('click', () => goto(2));
  document.getElementById('backTo1').addEventListener('click', () => goto(1));
  document.getElementById('toStep3').addEventListener('click', () => {
    state.scene = document.getElementById('sceneToggle').checked;
    goto(3);
  });
  document.getElementById('backTo2').addEventListener('click', () => goto(2));

  document.getElementById('sceneToggle').addEventListener('change', e => {
    state.scene = e.target.checked;
  });

  document.getElementById('finish').addEventListener('click', async () => {
    const btn = document.getElementById('finish');
    btn.disabled = true;
    btn.textContent = '正在唤醒…';
    try {
      await api.finishOnboarding({ character: state.character, scene: state.scene });
    } catch (e) {
      console.error(e);
    }
  });

  document.getElementById('btnClose').addEventListener('click', () => api.closeSelf());
  document.getElementById('btnMin').addEventListener('click', () => api.minimizeSelf());

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') api.closeSelf();
    if (e.key === 'Enter') {
      if (state.step === 1) goto(2);
      else if (state.step === 2) document.getElementById('toStep3').click();
      else document.getElementById('finish').click();
    }
  });

  /* ---------------- 初始化 ---------------- */
  (async () => {
    if (REPLAY) {
      // 回顾模式：文案贴合「再看一遍」场景，首次引导完全不受影响
      const t1 = document.querySelector('#pane1 .ob-title');
      const s1 = document.querySelector('#pane1 .ob-sub');
      const t3 = document.querySelector('#pane3 .ob-title');
      const s3 = document.querySelector('#pane3 .ob-sub');
      if (t1) t1.textContent = '挑一个桌面搭子';
      if (s1) s1.textContent = '这是首次打开时的引导，随时可以再看一遍。改完点「保存设置」就生效，其它设置不会被动到。';
      if (t3) t3.textContent = '确认一下';
      if (s3) s3.textContent = '点「保存设置」应用这次的选择；不点就直接关掉窗口，什么都不会变。';
      const fin = document.getElementById('finish');
      if (fin) fin.textContent = '保存设置';
    }

    const cfg = await api.getConfig();
    state.__cfg = cfg;
    state.character = cfg.character || 'cat';
    buildGrid();
    selectCharacter(state.character);
    document.getElementById('sceneToggle').checked = cfg.scene ? !!cfg.scene.on : true;
    state.scene = document.getElementById('sceneToggle').checked;
  })();
})();
