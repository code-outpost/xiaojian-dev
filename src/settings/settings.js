'use strict';
/* Mochi · 设置面板逻辑 */
(() => {
  const api = window.mochi;
  const D = window.MochiData;
  const $ = s => document.querySelector(s);

  let cfg = null;
  let currentFields = null;       // 编辑器当前字段集合 { tas, basic }
  let creatorFields = null;       // 创建器内字段集合
  let pendingImages = {};         // 创建器：状态 -> 真实路径 / file:// URL
  let creatorExistingId = null;   // 正在编辑的自定义角色 id（null=新增）
  let toastTimer = null;

  const LAYER_HINT = {
    top: '置顶：始终在你所有窗口之上（鼠标可穿透，不挡点击）',
    ghost: '半透明置顶：始终可见，但透过它能看清被压住的窗口内容',
    bottom: '桌面层：任何窗口都会盖住它，真正不遮挡内容；回到桌面 / 最小化窗口就能看到它'
  };

  function toast(msg) {
    const el2 = document.getElementById('toast');
    if (!el2) return;
    el2.textContent = msg;
    el2.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el2.classList.remove('show'), 2200);
  }

  const el = {
    styleRadios: $('#styleRadios'),
    autoLaunch: $('#autoLaunch'),
    wander: $('#wander'),
    sound: $('#sound'),
    memory: $('#memory'),
    showStats: $('#showStats'),
    scale: $('#scale'),
    scaleVal: $('#scaleVal'),
    charList: $('#charList'),
    waterOn: $('#waterOn'),
    waterInterval: $('#waterInterval'),
    waterSub: $('#waterSub'),
    standOn: $('#standOn'),
    standInterval: $('#standInterval'),
    standSub: $('#standSub'),
    pomoOn: $('#pomoOn'),
    pomoFocus: $('#pomoFocus'),
    pomoSub: $('#pomoSub'),
    commuteOn: $('#commuteOn'),
    commuteIn: $('#commuteIn'),
    commuteOut: $('#commuteOut'),
    commuteSub: $('#commuteSub'),
    sceneOn: $('#sceneOn'),
    liveProc: $('#liveProc'),
    liveScene: $('#liveScene'),
    brandImg: $('#brandImg'),
    brandName: $('#brandName'),
    brandSlogan: $('#brandSlogan'),
    aboutImg: $('#aboutImg'),
    aboutVer: $('#aboutVer'),
    memDays: $('#memDays'),
    memPets: $('#memPets'),
    layerRadios: $('#layerRadios'),
    dataPath: $('#dataPath'),
    dataChoose: $('#dataChoose'),
    dataReset: $('#dataReset'),

    /* 天气 */
    weatherOn: $('#weatherOn'),
    weatherInterval: $('#weatherInterval'),
    weatherRepeat: $('#weatherRepeat'),
    weatherDays: $('#weatherDays'),
    weatherSub: $('#weatherSub'),
    weatherCity: $('#weatherCity'),
    weatherLookup: $('#weatherLookup'),
    weatherCandidates: $('#weatherCandidates'),
    weatherCityNow: $('#weatherCityNow'),
    weatherNowText: $('#weatherNowText'),
    weatherNowMeta: $('#weatherNowMeta'),
    weatherNowTemp: $('#weatherNowTemp'),
    weatherRefresh: $('#weatherRefresh'),
    weatherTest: $('#weatherTest'),
    weatherCredId: $('#weatherCredId'),
    weatherKey: $('#weatherKey'),
    weatherSaveSecret: $('#weatherSaveSecret'),
    weatherCredHint: $('#weatherCredHint'),
    weatherResetSecret: $('#weatherResetSecret'),
    weatherSecretState: $('#weatherSecretState'),

    /* AI 对话 */
    aiOn: $('#aiOn'),
    aiSpeak: $('#aiSpeak'),
    aiToneChips: $('#aiToneChips'),
    aiOpen: $('#aiOpen'),
    aiClear: $('#aiClear'),
    aiProviderChips: $('#aiProviderChips'),
    aiCustomBox: $('#aiCustomBox'),
    aiBaseUrl: $('#aiBaseUrl'),
    aiModel: $('#aiModel'),
    aiKey: $('#aiKey'),
    aiSaveSecret: $('#aiSaveSecret'),
    aiResetSecret: $('#aiResetSecret'),
    aiCredHint: $('#aiCredHint'),
    aiSecretState: $('#aiSecretState'),

    /* 反馈 */
    fbTypeChips: $('#fbTypeChips'),
    fbText: $('#fbText'),
    fbContact: $('#fbContact'),
    fbSubmit: $('#fbSubmit'),
    fbCopy: $('#fbCopy'),
    fbAttach: $('#fbAttach'),
    fbAddImg: $('#fbAddImg'),
    fbFile: $('#fbFile'),

    /* 帮助 */
    replayGuide: $('#replayGuide')
  };

  /* ---------------- 反馈结果弹窗 ---------------- */
  const fbModalMask = $('#fbModalMask');
  const fbModalBox = $('#fbModal');
  const fbModalIco = $('#fbModalIco');
  const fbModalTitle = $('#fbModalTitle');
  const fbModalText = $('#fbModalText');
  const fbModalActions = $('#fbModalActions');

  let fbModalOnCancel = null;

  function hideFbModal(reason) {
    fbModalMask.classList.remove('show');
    const cb = fbModalOnCancel;
    fbModalOnCancel = null;
    // 点遮罩 / 按 Esc 关掉 = 取消；点按钮关掉走按钮自己的回调，不重复触发
    if (cb && reason !== 'action') cb();
  }

  /**
   * 显示反馈结果弹窗
   * @param {{kind?:'loading'|'success'|'error'|'warn', title:string, text?:string,
   *          onCancel?:Function,
   *          actions?:Array<{label:string, primary?:boolean, close?:boolean, onClick?:Function}>}} o
   */
  function showFbModal(o) {
    const kind = (o && o.kind) || 'loading';
    fbModalBox.dataset.kind = kind;
    fbModalIco.innerHTML = kind === 'loading'
      ? '<span class="fb-spin"></span>'
      : kind === 'success' ? '✓' : '!';
    fbModalTitle.textContent = (o && o.title) || '';
    fbModalText.textContent = (o && o.text) || '';
    fbModalActions.innerHTML = '';
    fbModalOnCancel = o && typeof o.onCancel === 'function' ? o.onCancel : null;
    ((o && o.actions) || []).forEach(a => {
      const b = document.createElement('button');
      b.className = 'btn ' + (a.primary ? 'btn-primary' : 'btn-ghost');
      b.textContent = a.label;
      b.addEventListener('click', () => {
        if (typeof a.onClick === 'function') a.onClick();
        if (a.close !== false) hideFbModal('action');
      });
      fbModalActions.appendChild(b);
    });
    fbModalMask.classList.add('show');
  }

  /** 统一确认框（替代原生 confirm，外观同反馈弹窗） */
  function appConfirm(text, opts) {
    const o = opts || {};
    return new Promise(resolve => {
      let settled = false;
      const done = v => { if (!settled) { settled = true; resolve(v); } };
      showFbModal({
        kind: o.kind || 'warn',
        title: o.title || '确认一下',
        text,
        onCancel: () => done(false),
        actions: [
          { label: o.cancelText || '取消', close: true, onClick: () => done(false) },
          { label: o.okText || '确定', primary: true, close: true, onClick: () => done(true) }
        ]
      });
    });
  }

  /** 统一提示框（替代原生 alert） */
  function appAlert(text, opts) {
    const o = opts || {};
    return new Promise(resolve => {
      let settled = false;
      const done = () => { if (!settled) { settled = true; resolve(true); } };
      showFbModal({
        kind: o.kind || 'warn',
        title: o.title || '提示',
        text,
        onCancel: done,
        actions: [{ label: o.okText || '知道了', primary: true, close: true, onClick: done }]
      });
    });
  }


  /* 点遮罩空白处关闭（发送中不允许关） */
  fbModalMask.addEventListener('click', e => {
    if (e.target === fbModalMask && fbModalBox.dataset.kind !== 'loading') hideFbModal();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && fbModalMask.classList.contains('show') && fbModalBox.dataset.kind !== 'loading') {
      hideFbModal();
    }
  });


  /* ---------------- 台词字段定义 ---------------- */
  const DIALOGUE_FIELDS = [
    { key: 'greet', label: '见面招呼', hint: '首次出现 / 切换角色时说的话' },
    { key: 'idle', label: '日常闲聊', hint: '空闲时随机冒出的话' },
    { key: 'poke', label: '被戳一下', hint: '点击宠物时的反应' },
    { key: 'petting', label: '被抚摸', hint: '鼠标悬停抚摸时' },
    { key: 'happy', label: '开心', hint: '开心 / 被夸时' },
    { key: 'typing', label: '你打字时', hint: '检测到你在写代码 / 办公时' },
    { key: 'sleepy', label: '犯困', hint: '你离开电脑时' }
  ];
  const SCENE_FIELDS = [
    { key: 'code', label: '写代码' }, { key: 'game', label: '玩游戏' },
    { key: 'browse', label: '逛网页' }, { key: 'chat', label: '聊天' },
    { key: 'meeting', label: '开会' }, { key: 'office', label: '办公' },
    { key: 'media', label: '看片听歌' }, { key: 'other', label: '其他' }
  ];
  const STATE_FIELDS = [
    { key: 'idle', label: '待机' }, { key: 'typing', label: '打字' },
    { key: 'clicking', label: '点击' }, { key: 'happy', label: '开心' },
    { key: 'sleepy', label: '睡觉' }, { key: 'excited', label: '兴奋' },
    { key: 'petting', label: '抚摸' }, { key: 'peek', label: '探头' },
    { key: 'reminding', label: '举牌' }
  ];

  /* ---------------- 主题 / 品牌 ---------------- */
  function applyTheme(id) {
    const map = D.runtimeCharacters(cfg).map;
    const c = map[id] || D.CHARACTERS.cat;
    const root = document.documentElement.style;
    root.setProperty('--theme', c.color);
    root.setProperty('--theme-deep', c.colorDeep);
    root.setProperty('--theme-soft', c.colorSoft);

    el.brandImg.src = D.spriteUrl(c, 'idle');
    el.brandName.textContent = c.name;
    el.brandSlogan.textContent = c.slogan;
    el.aboutImg.src = D.spriteUrl(c, 'idle');
    document.title = `Mochi 设置 · ${c.name}`;
  }

  /* ---------------- 角色列表 ---------------- */
  function buildCharacters() {
    el.charList.innerHTML = '';
    const { map, ids } = D.runtimeCharacters(cfg);
    // 自己做的形象排最前：之前一律追加在末尾，首屏只能看到内置角色，
    // 用户会以为"我加的形象根本没出来"。
    const ordered = ids.slice().sort((a, b) => {
      const ca = map[a] && map[a].custom ? 0 : 1;
      const cb = map[b] && map[b].custom ? 0 : 1;
      return ca - cb;
    });
    ordered.forEach(id => {
      const c = map[id];
      const missing = !!(c.custom && !Object.keys(c.images || {}).length);
      const card = document.createElement('div');
      card.className = 'char-item';
      card.dataset.id = id;
      card.style.setProperty('--c', c.color);
      card.style.setProperty('--c-deep', c.colorDeep);
      card.style.setProperty('--c-soft', c.colorSoft);
      card.innerHTML = `
        <img class="thumb" src="${D.spriteUrl(c, 'idle')}" alt="">
        <div class="meta">
          <div class="nm">${c.name}<span>${c.en || ''}</span></div>
          <div class="tr">${missing ? '<em class="miss-tip">还没有上传形象图片</em>' : (c.traits || []).join(' · ')}</div>
        </div>
        ${missing ? '<span class="tag-warn">缺图片</span>' : ''}
        <span class="tag-current">使用中</span>
        <div class="char-acts">
          ${c.custom
            ? `<button class="mini ${missing ? 'need-img' : ''}" data-act="edit">${missing ? '上传图片' : '编辑形象/台词'}</button><button class="mini danger" data-act="del">删除</button>`
            : '<button class="mini" data-act="lines">自定义内容</button>'}
        </div>
      `;
      // 自定义图片被删/换盘导致路径失效时，缩略图不要让 <img> 显示成裂图
      const thumb = card.querySelector('.thumb');
      if (thumb) {
        thumb.addEventListener('error', () => {
          thumb.onerror = null;
          thumb.src = D.spriteUrl(D.CHARACTERS.cat, 'idle');
        });
      }
      card.addEventListener('click', async e => {
        const btn = e.target.closest('[data-act]');
        if (btn) {
          e.stopPropagation();
          const act = btn.dataset.act;
          if (act === 'lines') openDialogueEditor(id);
          else if (act === 'edit') openCreator(id);
          else if (act === 'del') removeCustom(id);
          return;
        }
        if (missing) {
          // 没有图片的角色切过去，桌面只会回退成内置形象，用户会以为"我建的形象不见了"
          const go = await appConfirm(
            `「${c.name}」还没有形象图片，桌面会显示成内置形象。\n现在去上传一张？`,
            { kind: 'warn', title: '这张角色卡还没有图片', okText: '去上传', cancelText: '先不用' }
          );
          if (go) openCreator(id);
          return;
        }
        api.setCharacter(id);
        api.patchConfig({ character: id });
        cfg.character = id;
        markCharacter(id);
        applyTheme(id);
      });
      el.charList.appendChild(card);
    });
    markCharacter(cfg.character);
  }

  function markCharacter(id) {
    el.charList.querySelectorAll('.char-item').forEach(b => {
      const on = b.dataset.id === id;
      b.classList.toggle('on', on);
      const tag = b.querySelector('.tag-current');
      if (tag) tag.style.display = on ? '' : 'none';
    });
  }

  /* ---------------- 台词 / 角色内容编辑器 ---------------- */
  /** 单行输入字段 */
  function fieldInput(label, hint, value, placeholder) {
    const wrap = document.createElement('div');
    wrap.className = 'dl-field';
    const lab = document.createElement('div');
    lab.className = 'dl-label';
    lab.innerHTML = `<span>${label}</span>${hint ? `<span class="dl-hint">${hint}</span>` : ''}`;
    wrap.appendChild(lab);
    const input = document.createElement('input');
    input.className = 'dl-input';
    input.type = 'text';
    input.value = value || '';
    if (placeholder) input.placeholder = placeholder;
    wrap.appendChild(input);
    return { wrap, input };
  }

  /**
   * 渲染编辑器字段。
   * @param {HTMLElement} root 容器
   * @param {object} char 当前角色（已合并用户覆盖）
   * @param {{basic?: boolean}} opts basic=true 时渲染「名字 / 英文名 / 口头禅 / 标签」，
   *        用于内置角色的自定义；自定义形象的这些字段在创建器里已有独立输入框。
   * @returns {{tas: object, basic: object|null}}
   */
  function renderDialogueFields(root, char, opts = {}) {
    root.innerHTML = '';
    const tas = {};
    let basic = null;

    if (opts.basic) {
      const sec = document.createElement('div');
      sec.className = 'dl-group';
      const head = document.createElement('div');
      head.className = 'dl-label';
      head.innerHTML = '<span>基础信息</span><span class="dl-hint">改完保存，桌面和设置面板立刻生效</span>';
      sec.appendChild(head);
      const grid = document.createElement('div');
      grid.className = 'dl-basic-grid';
      const pairs = [
        ['name', '名字', char.name, '例如：团子猫'],
        ['en', '英文名', char.en, 'Momo'],
        ['slogan', '口头禅', char.slogan, '一句话名片，例如：又来肝代码了？'],
        ['traits', '性格标签', (char.traits || []).join('、'), '用、或逗号分隔']
      ];
      basic = {};
      pairs.forEach(([k, label, val, ph]) => {
        const f = fieldInput(label, '', val, ph);
        grid.appendChild(f.wrap);
        basic[k] = f.input;
      });
      sec.appendChild(grid);
      root.appendChild(sec);
    }

    const mk = (label, hint, value) => {
      const wrap = document.createElement('div');
      wrap.className = 'dl-field';
      const lab = document.createElement('div');
      lab.className = 'dl-label';
      lab.innerHTML = `<span>${label}</span>${hint ? `<span class="dl-hint">${hint}</span>` : ''}`;
      wrap.appendChild(lab);
      const ta = document.createElement('textarea');
      ta.className = 'dl-input';
      ta.rows = 2;
      ta.value = Array.isArray(value) ? value.join('\n') : (value || '');
      wrap.appendChild(ta);
      root.appendChild(wrap);
      return ta;
    };
    DIALOGUE_FIELDS.forEach(f => { tas[f.key] = mk(f.label, f.hint, char[f.key]); });

    const sceneWrap = document.createElement('div');
    sceneWrap.className = 'dl-group';
    const sl = document.createElement('div');
    sl.className = 'dl-label';
    sl.innerHTML = '<span>场景吐槽（按不同场景说不同的话）</span><span class="dl-hint">每行一句</span>';
    sceneWrap.appendChild(sl);
    const grid = document.createElement('div');
    grid.className = 'dl-scene-grid';
    SCENE_FIELDS.forEach(f => {
      const cell = document.createElement('div');
      cell.className = 'dl-scene-cell';
      const lab = document.createElement('div');
      lab.className = 'dl-scene-lab';
      lab.textContent = f.label;
      const ta = document.createElement('textarea');
      ta.className = 'dl-input';
      ta.rows = 2;
      ta.value = (char.scene && char.scene[f.key]) ? char.scene[f.key].join('\n') : '';
      cell.appendChild(lab);
      cell.appendChild(ta);
      grid.appendChild(cell);
      tas['scene.' + f.key] = ta;
    });
    sceneWrap.appendChild(grid);
    root.appendChild(sceneWrap);

    return { tas, basic };
  }

  function collectDialogueFields(fields) {
    const out = {};
    const tas = (fields && fields.tas) || {};
    DIALOGUE_FIELDS.forEach(f => {
      const ta = tas[f.key];
      if (!ta) return;
      const arr = ta.value.split('\n').map(s => s.trim()).filter(Boolean);
      if (arr.length) out[f.key] = arr;
    });
    const scene = {};
    SCENE_FIELDS.forEach(f => {
      const ta = tas['scene.' + f.key];
      if (!ta) return;
      const arr = ta.value.split('\n').map(s => s.trim()).filter(Boolean);
      if (arr.length) scene[f.key] = arr;
    });
    if (Object.keys(scene).length) out.scene = scene;

    const basic = fields && fields.basic;
    if (basic) {
      if (basic.name && basic.name.value.trim()) out.name = basic.name.value.trim();
      if (basic.en) out.en = basic.en.value.trim();
      if (basic.slogan) out.slogan = basic.slogan.value.trim();
      if (basic.traits) {
        const tr = basic.traits.value.split(/[、,，\s]+/).map(s => s.trim()).filter(Boolean);
        if (tr.length) out.traits = tr;
      }
    }
    return out;
  }

  let editorMode = { type: 'base', id: null };

  function openDialogueEditor(id) {
    const map = D.runtimeCharacters(cfg).map;
    const c = map[id];
    if (!c) return;
    $('#editorTitle').textContent = `自定义 · ${c.name}`;
    currentFields = renderDialogueFields($('#editorBody'), c, { basic: true });
    editorMode = { type: 'base', id };
    $('#editorMask').classList.add('show');
  }

  async function saveDialogueEditor() {
    const ov = collectDialogueFields(currentFields);
    if (editorMode.type === 'base') {
      const cd = Object.assign({}, cfg.charDialogues);
      cd[editorMode.id] = ov;
      cfg = await api.patchConfig({ charDialogues: cd });
      buildCharacters();
      fill();
      toast('已保存，桌面上的它马上换新说法');
    }
    $('#editorMask').classList.remove('show');
  }

  /** 清除某个角色所有自定义内容，回到出厂设定 */
  async function resetDialogueEditor() {
    if (!editorMode.id) return;
    const ok = await appConfirm('把这个角色改回默认？名字 / 口头禅 / 台词会全部恢复成出厂设定。',
      { kind: 'warn', title: '恢复默认内容', okText: '恢复', cancelText: '取消' });
    if (!ok) return;
    const cd = Object.assign({}, cfg.charDialogues);
    delete cd[editorMode.id];
    cfg = await api.patchConfig({ charDialogues: cd });
    $('#editorMask').classList.remove('show');
    buildCharacters();
    fill();
    api.setCharacter(cfg.character);
    toast('已恢复默认内容');
  }

  /* ---------------- 自定义形象创建器 ---------------- */
  function openCreator(existingId) {
    const customs = cfg.customCharacters || [];
    const existing = existingId ? customs.find(c => c.id === existingId) : null;
    creatorExistingId = existingId || null;
    $('#creatorTitle').textContent = existing ? `编辑形象 · ${existing.name}` : '添加自定义形象';
    $('#creatorDelete').style.display = existing ? '' : 'none';

    $('#creatorName').value = existing ? existing.name : '';
    $('#creatorEn').value = existing ? (existing.en || '') : '';
    $('#creatorTraits').value = existing && existing.traits ? existing.traits.join('、') : '';
    $('#creatorSlogan').value = existing ? (existing.slogan || '') : '';
    $('#crColor').value = existing ? existing.color : '#9B8CFF';
    $('#crColorDeep').value = existing ? existing.colorDeep : '#6E5BD6';
    $('#crColorSoft').value = existing ? existing.colorSoft : '#ECE7FF';
    $('#crHand').checked = existing ? !!existing.handClick : false;
    $('#crRatio').value = existing ? (existing.visualRatio || 1) : 1;
    $('#crRatioVal').textContent = `${Math.round(($('#crRatio').value) * 100)}%`;

    pendingImages = existing && existing.images ? Object.assign({}, existing.images) : {};
    buildImageSlots();
    // 编辑已有自定义角色时，台词框要显示「最终生效」的内容（含已保存的 dialogues）
    const merged = existingId ? (D.runtimeCharacters(cfg).map[existingId] || existing) : null;
    creatorFields = renderDialogueFields($('#crDialogue'), merged || {
      greet: ['你好呀~'], idle: ['陪你一会儿~'], poke: ['诶？'],
      petting: ['好舒服~'], happy: ['开心！'], typing: ['你在忙呀'], sleepy: ['困了…'],
      scene: { other: ['陪着你~'] }
    }, { basic: false });

    $('#creatorMask').classList.add('show');
  }

  function toPreviewUrl(p) {
    if (!p) return '';
    return p.startsWith('file://') ? p : 'file:///' + String(p).replace(/\\/g, '/');
  }
  function basename(p) {
    const parts = String(p || '').replace(/\\/g, '/').split('/');
    return parts[parts.length - 1] || '';
  }

  function buildImageSlots() {
    const wrap = $('#crImgs');
    wrap.innerHTML = '';
    STATE_FIELDS.forEach(s => {
      const row = document.createElement('div');
      row.className = 'cr-img-row';
      const img = document.createElement('img');
      img.className = 'cr-img-thumb';
      const existing = pendingImages[s.key];
      if (existing) { img.src = toPreviewUrl(existing); }
      else img.style.display = 'none';
      const lab = document.createElement('div');
      lab.className = 'cr-img-lab';
      lab.textContent = s.label;
      const nameEl = document.createElement('div');
      nameEl.className = 'cr-img-name';
      nameEl.textContent = existing ? basename(existing) : '';
      nameEl.title = existing || '';
      const pick = document.createElement('button');
      pick.className = 'mini';
      pick.textContent = '选择图片';
      pick.addEventListener('click', async () => {
        const r = await api.pickImage();
        if (!r || r.canceled || !r.path) return;
        pendingImages[s.key] = r.path;
        img.src = toPreviewUrl(r.path);
        img.style.display = '';
        nameEl.textContent = basename(r.path);
        nameEl.title = r.path;
      });
      const useMain = document.createElement('button');
      useMain.className = 'mini';
      useMain.textContent = '用主图';
      useMain.addEventListener('click', () => {
        if (!pendingImages.idle) { appAlert('请先选择「待机」主图', { title: '还没有主图' }); return; }
        pendingImages[s.key] = pendingImages.idle;
        img.src = toPreviewUrl(pendingImages.idle);
        img.style.display = '';
        nameEl.textContent = basename(pendingImages.idle);
        nameEl.title = pendingImages.idle;
      });
      const clr = document.createElement('button');
      clr.className = 'mini danger';
      clr.textContent = '清除';
      clr.addEventListener('click', () => {
        delete pendingImages[s.key];
        img.style.display = 'none';
        img.src = '';
        nameEl.textContent = '';
        nameEl.title = '';
      });
      row.appendChild(img);
      row.appendChild(lab);
      row.appendChild(nameEl);
      row.appendChild(pick);
      row.appendChild(useMain);
      row.appendChild(clr);
      wrap.appendChild(row);
    });
  }

  async function saveCreator() {
    const name = $('#creatorName').value.trim() || '自定义形象';
    const imgs = Object.assign({}, pendingImages);
    // 只传了非「待机」状态时，用第一张顶上：否则桌面上会退化成内置形象，看起来像"没生效"
    if (!imgs.idle) {
      const first = Object.keys(imgs)[0];
      if (first) imgs.idle = imgs[first];
    }
    if (!Object.keys(imgs).length) {
      await appAlert('还没有形象图片。\n请点「选择图片」至少上传一张（建议放在「待机」那一栏，其它状态不传会自动沿用待机图）。',
        { kind: 'warn', title: '至少需要一张图片' });
      return;
    }

    const def = {
      id: creatorExistingId || ('custom-' + Date.now()),
      name,
      en: $('#creatorEn').value.trim() || 'Custom',
      traits: $('#creatorTraits').value.split(/[、,，\s]+/).map(s => s.trim()).filter(Boolean),
      slogan: $('#creatorSlogan').value.trim() || '这是我自己做的搭子~',
      color: $('#crColor').value,
      colorDeep: $('#crColorDeep').value,
      colorSoft: $('#crColorSoft').value,
      handClick: $('#crHand').checked,
      visualRatio: Number($('#crRatio').value) || 1,
      images: imgs,
      dialogues: collectDialogueFields(creatorFields)
    };

    const res = creatorExistingId ? await api.updateCustom(def) : await api.addCustom(def);
    if (res && res.ok === false) {
      await appAlert('保存失败：' + (res.error || '未知错误'), { kind: 'error', title: '没能保存' });
      return;
    }
    const failed = (res && res.failed) || [];
    $('#creatorMask').classList.remove('show');

    cfg = await api.getConfig();
    buildCharacters();
    // 新建后直接切过去，桌面上立刻就能看到，不用再去点卡片
    if (!creatorExistingId) {
      api.setCharacter(def.id);
      cfg.character = def.id;
      markCharacter(def.id);
      applyTheme(def.id);
    } else {
      applyTheme(cfg.character);
    }

    // 新角色排在列表末尾，滚过去并高亮一下，免得用户找不到
    const card = el.charList.querySelector(`.char-item[data-id="${def.id}"]`);
    if (card) {
      card.scrollIntoView({ block: 'center', behavior: 'smooth' });
      card.classList.add('just-added');
      setTimeout(() => card.classList.remove('just-added'), 2600);
    }

    if (failed.length) toast(`已保存，但 ${failed.length} 张图片读取失败`);
    else toast(creatorExistingId ? '形象已更新' : '新形象已添加，已切换到它');
  }

  async function removeCustom(id) {
    const okDel = await appConfirm('删除这个自定义形象？已保存的图片也会一并清除。',
      { kind: 'error', title: '删除形象', okText: '删除', cancelText: '取消' });
    if (!okDel) return;
    await api.removeCustom(id);
    cfg = await api.getConfig();
    buildCharacters();
    applyTheme(cfg.character);
    toast('自定义形象已删除');
  }

  /* ---------------- 表单填充 ---------------- */
  function fill() {
    el.styleRadios.querySelectorAll('.radio-chip').forEach(b => {
      b.classList.toggle('on', b.dataset.style === cfg.reminderStyle);
    });
    el.autoLaunch.checked = !!cfg.autoLaunch;
    el.wander.checked = !!(cfg.wander && cfg.wander.on);
    el.sound.checked = cfg.sound !== false;
    el.memory.checked = cfg.memory !== false;
    el.showStats.checked = !!cfg.showStats;

    /* AI 对话 */
    const ai = cfg.ai || {};
    if (el.aiOn) el.aiOn.checked = ai.on !== false;
    if (el.aiSpeak) el.aiSpeak.checked = ai.speak !== false;
    if (el.aiToneChips) {
      el.aiToneChips.querySelectorAll('.radio-chip').forEach(b => {
        b.classList.toggle('on', (b.dataset.tone || 'gentle') === (ai.tone || 'gentle'));
      });
    }
    fillAI(ai);
    el.scale.value = cfg.scale || 1;
    el.scaleVal.textContent = `${Math.round((cfg.scale || 1) * 100)}%`;

    el.waterOn.checked = !!cfg.water.on;
    el.waterInterval.value = cfg.water.interval;
    el.waterSub.classList.toggle('disabled', !cfg.water.on);

    el.standOn.checked = !!cfg.stand.on;
    el.standInterval.value = cfg.stand.interval;
    el.standSub.classList.toggle('disabled', !cfg.stand.on);

    el.pomoOn.checked = !!cfg.pomodoro.on;
    el.pomoFocus.value = cfg.pomodoro.focus;
    el.pomoSub.classList.toggle('disabled', !cfg.pomodoro.on);

    const commute = cfg.commute || { on: false, clockIn: '09:00', clockOut: '18:00' };
    el.commuteOn.checked = !!commute.on;
    el.commuteIn.value = commute.clockIn || '09:00';
    el.commuteOut.value = commute.clockOut || '18:00';
    el.commuteSub.classList.toggle('disabled', !commute.on);

    el.sceneOn.checked = !!cfg.scene.on;

    fillWeather(cfg);

    el.layerRadios.querySelectorAll('.radio-chip').forEach(b => {
      b.classList.toggle('on', b.dataset.layer === (cfg.layer || 'top'));
    });
    const lh = document.getElementById('layerHint');
    if (lh) lh.textContent = LAYER_HINT[cfg.layer || 'top'] || LAYER_HINT.top;

    el.memDays.textContent = `${cfg.memoryData.days || 1} 天`;
    el.memPets.textContent = `${cfg.memoryData.pettings || 0} 次`;

    applyTheme(cfg.character);
    markCharacter(cfg.character);
    refreshDataPath();
  }

  function refreshDataPath() {
    api.dataLocation().then(info => {
      if (!info || !el.dataPath) return;
      el.dataPath.textContent = info.current + (info.isDefault ? '（默认）' : '（自定义）');
    }).catch(() => {});
  }

  /* ---------------- 天气 ---------------- */
  let weatherCfg = null;   // 由主进程下发（已剔除密钥明文）

  function renderWeather(w) {
    if (!w) {
      el.weatherNowText.textContent = '当前天气';
      el.weatherNowTemp.textContent = '—';
      el.weatherNowTemp.classList.add('empty');
      el.weatherNowMeta.textContent = '点「立即刷新」获取最新天气';
      renderWeatherDays(null);
      return;
    }
    el.weatherNowText.textContent = `${w.city || '—'} · ${w.text || ''}`;
    el.weatherNowTemp.textContent = isFinite(w.temp) ? `${w.temp}℃` : '—';
    el.weatherNowTemp.classList.toggle('empty', !isFinite(w.temp));
    const bits = [];
    if (isFinite(w.feelsLike)) bits.push(`体感 ${w.feelsLike}℃`);
    if (w.tempMax !== undefined && isFinite(w.tempMax) && isFinite(w.tempMin)) bits.push(`${w.tempMin}~${w.tempMax}℃`);
    if (w.windDir) bits.push(`${w.windDir} ${w.windScale || ''}级`);
    if (w.humidity) bits.push(`湿度 ${w.humidity}%`);
    if (w.textDay) bits.push(`白天 ${w.textDay}${w.textNight ? ' / 夜间 ' + w.textNight : ''}`);
    el.weatherNowMeta.textContent = bits.join(' · ') +
      (w.obsTime ? `（更新于 ${String(w.obsTime).slice(11, 16)}）` : '');
    renderWeatherDays(w.daily);
  }

  /** 未来几天预报 */
  function renderWeatherDays(list) {
    if (!el.weatherDays) return;
    if (!list || !list.length) { el.weatherDays.innerHTML = ''; return; }
    const WK = ['日', '一', '二', '三', '四', '五', '六'];
    el.weatherDays.innerHTML = list.map((d, i) => {
      let label = `周${WK[new Date(`${d.date}T00:00:00`).getDay()]}`;
      if (i === 0) label = '今天';
      else if (i === 1) label = '明天';
      const night = d.textNight && d.textNight !== d.textDay ? ` / ${d.textNight}` : '';
      const lo = isFinite(d.tempMin) ? Math.round(d.tempMin) : '–';
      const hi = isFinite(d.tempMax) ? Math.round(d.tempMax) : '–';
      return `<div class="wx-day">
        <div class="wx-d">${label}</div>
        <div class="wx-t">${d.textDay || ''}${night}</div>
        <div class="wx-temp">${lo}° / ${hi}°</div>
      </div>`;
    }).join('');
  }

  function fillWeather(c) {
    // 调用方有两种：整个 config（有 .weather）或已经是 weather 对象本身，都要能吃
    const w = (c && c.weather && typeof c.weather === 'object') ? c.weather : (c || {});
    if (!w || typeof w !== 'object') return;
    el.weatherOn.checked = w.on !== false;
    el.weatherInterval.value = String(w.interval || 30);
    if (el.weatherRepeat) el.weatherRepeat.value = String(w.repeat || 60);
    el.weatherSub.classList.toggle('disabled', w.on === false);
    if (el.weatherCity && document.activeElement !== el.weatherCity) el.weatherCity.value = w.city || '';
    el.weatherCityNow.textContent = w.cityId
      ? `当前城市：${w.cityName || w.city}（ID ${w.cityId}）`
      : (w.city ? `已填城市「${w.city}」，点查询确认` : '还没设置城市');
    // 注意：credId/keyMask 现在只对「用户自己填过的凭证」返回，内置默认不会回传，
    // 因此这里永远不会把开发者的默认 ID/密钥回填或泄漏到输入框里。
    if (w.credId && !el.weatherCredId.value) el.weatherCredId.value = w.credId;
    if (w.userProvided) {
      el.weatherKey.placeholder = w.keyMask || '已加密保存';
      setBadge(el.weatherSecretState, 'ok', '已使用你自己的凭证');
      el.weatherCredHint.textContent = '你现在用的是自己的和风凭证。';
    } else if (w.usingDefault) {
      el.weatherKey.placeholder = '内置默认凭证已启用（留空即沿用）';
      setBadge(el.weatherSecretState, 'ok', '已使用内置默认凭证');
      el.weatherCredHint.textContent = '默认已启用开发者内置凭证，无需填写；想用自己的就填上面两项。';
    } else {
      el.weatherKey.placeholder = '填写你自己的和风密钥';
      setBadge(el.weatherSecretState, 'off', '未设置凭据');
      el.weatherCredHint.textContent = '默认内置凭证不可用，请填写你自己的和风凭据。';
    }
  }

  /** 统一设置状态徽章的样式与文案（ok/warn/off） */
  function setBadge(node, kind, text) {
    if (!node) return;
    node.classList.remove('ok', 'warn', 'off');
    node.classList.add(kind || 'off');
    node.textContent = text || '';
  }

  function loadWeather() {
    api.weatherGet().then(r => {
      if (!r) return;
      weatherCfg = r.cfg;
      if (r.cfg) { const m = Object.assign({}, cfg, { weather: r.cfg }); cfg.weather = r.cfg; fillWeather(r.cfg); }
      renderWeather(r.weather);
    }).catch(() => {});
  }

  /** 渲染 AI 接口来源：内置免费 / 自定义，并显示状态徽章 */
  function fillAI(ai) {
    ai = ai || {};
    const provider = ai.provider === 'custom' ? 'custom' : 'default';
    if (el.aiProviderChips) el.aiProviderChips.querySelectorAll('.radio-chip').forEach(b => {
      b.classList.toggle('on', (b.dataset.provider || 'default') === provider);
    });
    if (el.aiCustomBox) el.aiCustomBox.hidden = provider !== 'custom';
    if (el.aiBaseUrl && document.activeElement !== el.aiBaseUrl) el.aiBaseUrl.value = ai.baseUrl || '';
    if (el.aiModel && document.activeElement !== el.aiModel) el.aiModel.value = ai.model || '';
    if (el.aiKey) el.aiKey.placeholder = ai.hasKey ? (ai.keyMask || '已保存') : 'sk-…（只存在你本机，加密保存）';
    if (provider === 'custom') {
      if (ai.hasKey) {
        setBadge(el.aiSecretState, 'ok', '已使用你自己的 AI');
        if (el.aiCredHint) el.aiCredHint.textContent = '当前使用你自己的 AI 接口。';
      } else {
        setBadge(el.aiSecretState, 'warn', '还没填 API Key');
        if (el.aiCredHint) el.aiCredHint.textContent = '填写下面的接口地址和 API Key 后即可使用。';
      }
    } else {
      setBadge(el.aiSecretState, 'ok', '已使用内置免费接口');
      if (el.aiCredHint) el.aiCredHint.textContent = '当前使用内置免费接口，开箱即用，无需配置。';
    }
  }

  function loadAIPublic() {
    api.aiGet().then(r => {
      if (!r || !r.cfg) return;
      cfg = cfg || {};
      cfg.ai = Object.assign({}, cfg.ai || {}, r.cfg);
      fillAI(cfg.ai);
    }).catch(() => {});
  }

  /* ---------------- 事件 ---------------- */
  function patch(p) { return api.patchConfig(p).then(next => { cfg = next; return next; }); }

  el.styleRadios.addEventListener('click', e => {
    const b = e.target.closest('.radio-chip');
    if (!b) return;
    cfg.reminderStyle = b.dataset.style;
    fill();
    patch({ reminderStyle: b.dataset.style });
  });

  el.autoLaunch.addEventListener('change', () => {
    const on = el.autoLaunch.checked;
    cfg.autoLaunch = on;
    patch({ autoLaunch: on });
    api.setAutoLaunch(on);
  });

  el.sound.addEventListener('change', () => patch({ sound: el.sound.checked }).then(fill));
  el.wander.addEventListener('change', () => {
    const on = el.wander.checked;
    cfg.wander = Object.assign({}, cfg.wander, { on });
    patch({ wander: { on } });
    toast(on ? '它会自己到处走走，按住就能抓回来' : '已停止自由走动');
  });
  el.memory.addEventListener('change', () => patch({ memory: el.memory.checked }));
  el.showStats.addEventListener('change', () => patch({ showStats: el.showStats.checked }));

  el.scale.addEventListener('input', () => {
    const v = Number(el.scale.value);
    el.scaleVal.textContent = `${Math.round(v * 100)}%`;
  });
  el.scale.addEventListener('change', () => patch({ scale: Number(el.scale.value) }));

  el.waterOn.addEventListener('change', () => patch({ water: { on: el.waterOn.checked } }).then(fill));
  el.waterInterval.addEventListener('change', () => patch({ water: { interval: Number(el.waterInterval.value) } }).then(fill));

  el.standOn.addEventListener('change', () => patch({ stand: { on: el.standOn.checked } }).then(fill));
  el.standInterval.addEventListener('change', () => patch({ stand: { interval: Number(el.standInterval.value) } }).then(fill));

  el.pomoOn.addEventListener('change', () => patch({ pomodoro: { on: el.pomoOn.checked } }).then(fill));
  el.pomoFocus.addEventListener('change', () => patch({ pomodoro: { focus: Number(el.pomoFocus.value) } }).then(fill));

  el.commuteOn.addEventListener('change', () => patch({ commute: Object.assign({}, cfg.commute, { on: el.commuteOn.checked }) }).then(fill));
  el.commuteIn.addEventListener('change', () => patch({ commute: Object.assign({}, cfg.commute, { clockIn: el.commuteIn.value }) }).then(fill));
  el.commuteOut.addEventListener('change', () => patch({ commute: Object.assign({}, cfg.commute, { clockOut: el.commuteOut.value }) }).then(fill));

  document.getElementById('testCommute').addEventListener('click', () => api.testReminder('commute'));

  el.sceneOn.addEventListener('change', () => patch({ scene: { on: el.sceneOn.checked } }).then(fill));

  /* AI 对话 */
  el.aiOn.addEventListener('change', async () => {
    cfg.ai = await api.aiSet({ on: el.aiOn.checked });
    toast(el.aiOn.checked ? 'AI 对话已开启（Ctrl+Alt+A 唤出）' : 'AI 对话已关闭');
  });
  el.aiSpeak.addEventListener('change', async () => {
    cfg.ai = await api.aiSet({ speak: el.aiSpeak.checked });
  });
  el.aiToneChips.addEventListener('click', async e => {
    const b = e.target.closest('.radio-chip');
    if (!b) return;
    cfg.ai = await api.aiSet({ tone: b.dataset.tone });
    fill();
    toast('说话风格已切换');
  });
  // 切换「内置免费接口 / 我自己的 AI」
  el.aiProviderChips.addEventListener('click', async e => {
    const b = e.target.closest('.radio-chip');
    if (!b) return;
    const provider = b.dataset.provider || 'default';
    cfg.ai = await api.aiSet({ provider });
    fillAI(cfg.ai);
    toast(provider === 'custom' ? '已切到自定义 AI（记得填接口地址和 Key）' : '已切回内置免费接口');
  });
  // 保存「我自己的 AI」：接口地址 + 模型名 + API Key（Key 走加密存储）
  el.aiSaveSecret.addEventListener('click', async () => {
    const baseUrl = el.aiBaseUrl.value.trim();
    const model = el.aiModel.value.trim();
    const key = el.aiKey.value.trim();
    if (!baseUrl) { toast('先填接口地址，比如 https://api.openai.com/v1'); return; }
    if (!key && !(cfg.ai && cfg.ai.hasKey)) { toast('请填写你自己的 API Key'); return; }
    cfg.ai = await api.aiSet({ provider: 'custom', baseUrl, model });
    if (key) {
      const r = await api.aiSetSecret({ key });
      if (r && r.cfg) cfg.ai = r.cfg;
      el.aiKey.value = '';
    }
    fillAI(cfg.ai);
    toast(key ? '你的 AI 已保存，之后就用它对话' : '接口地址已保存');
  });
  // 恢复默认：切回内置免费接口并删除本地 Key
  el.aiResetSecret.addEventListener('click', async () => {
    await api.aiSetSecret({ key: '' });
    cfg.ai = await api.aiSet({ provider: 'default', baseUrl: '', model: '' });
    el.aiKey.value = '';
    fillAI(cfg.ai);
    toast('已恢复内置免费接口');
  });
  el.aiOpen.addEventListener('click', () => {
    if (!el.aiOn.checked) { toast('先打开上面的「开启 AI 对话」'); return; }
    api.openAI();
  });
  el.aiClear.addEventListener('click', async () => {
    const okClear = await appConfirm('清空所有聊天记录？这个操作不可恢复。',
      { kind: 'warn', title: '清空聊天记录', okText: '清空', cancelText: '取消' });
    if (!okClear) return;
    await api.aiClear();
    toast('聊天记录已清空');
  });

  /* 用户反馈 */
  let fbType = '功能建议';

  async function copyFeedback() {
    const text = (el.fbText.value || '').trim();
    if (!text) { toast('还没有内容可以复制'); return; }
    const payload = `【${fbType}】${text}\n联系方式：${el.fbContact.value || '（未填）'}`;
    try {
      await navigator.clipboard.writeText(payload);
      toast('已复制，可以直接粘给作者');
    } catch (_) {
      toast('复制失败，请手动选中内容复制');
    }
  }

  el.fbTypeChips.addEventListener('click', e => {
    const b = e.target.closest('.radio-chip');
    if (!b) return;
    fbType = b.dataset.type || '功能建议';
    el.fbTypeChips.querySelectorAll('.radio-chip').forEach(x => x.classList.toggle('on', x === b));
  });

  el.fbSubmit.addEventListener('click', async () => {
    const text = (el.fbText.value || '').trim();
    if (text.length < 5) {
      toast('再多写几个字吧（至少 5 个字）');
      el.fbText.focus();
      return;
    }
    el.fbSubmit.disabled = true;
    showFbModal({
      kind: 'loading',
      title: '正在发送…',
      text: '正在把你的反馈送到作者邮箱，请稍候'
    });

    // 把已选图片转成 {name, type, data(ArrayBuffer)} 传给主进程
    const files = fbFiles.map(f => ({ name: f.name, type: f.type, data: f.data }));
    let r = null;
    try {
      r = await api.sendFeedback({ type: fbType, text, contact: el.fbContact.value, files });
    } catch (err) {
      r = { ok: false, error: (err && err.message) || '网络异常' };
    }
    el.fbSubmit.disabled = false;

    if (r && r.ok) {
      el.fbText.value = '';
      el.fbContact.value = '';
      clearFbFiles();
      showFbModal({
        kind: 'success',
        title: '已发送，谢谢你的反馈！',
        text: '作者已经收到啦' + (r.attachments ? `（含 ${r.attachments} 张截图）` : '') + '。如果留了联系方式，需要时会联系你。',
        actions: [{ label: '好的', primary: true }]
      });
    } else {
      showFbModal({
        kind: 'error',
        title: '没能发出去',
        text: '内容已经存到本地，不会丢。可以复制下来直接发给作者。'
          + ((r && r.error) ? `\n（${r.error}）` : ''),
        actions: [
          { label: '复制内容', close: false, onClick: copyFeedback },
          { label: '关闭', primary: true }
        ]
      });
    }
  });

  el.fbCopy.addEventListener('click', copyFeedback);

  /* 附件（图片）：选择 / 预览 / 删除 / 压缩 */
  let fbFiles = []; // { name, type, data:ArrayBuffer, url:objectURL }
  const FB_MAX = 3;

  function clearFbFiles() {
    fbFiles.forEach(f => { try { URL.revokeObjectURL(f.url); } catch (_) {} });
    fbFiles = [];
    renderFbAttach();
  }

  function renderFbAttach() {
    if (!el.fbAttach) return;
    el.fbAttach.innerHTML = '';
    fbFiles.forEach((f, i) => {
      const wrap = document.createElement('div');
      wrap.className = 'fb-thumb';
      const img = document.createElement('img');
      img.src = f.url;
      img.alt = f.name || '截图';
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'fb-thumb-del';
      del.textContent = '×';
      del.title = '移除';
      del.addEventListener('click', () => {
        try { URL.revokeObjectURL(f.url); } catch (_) {}
        fbFiles.splice(i, 1);
        renderFbAttach();
      });
      wrap.append(img, del);
      el.fbAttach.append(wrap);
    });
    if (el.fbAddImg) el.fbAddImg.style.display = fbFiles.length >= FB_MAX ? 'none' : '';
  }

  // 用 canvas 把图片压到最长边 max px 的 JPEG，控制体积
  async function downscaleImage(file, max, quality) {
    const bmp = await createImageBitmap(file);
    let w = bmp.width, h = bmp.height;
    if (w > max || h > max) {
      const r = Math.min(max / w, max / h);
      w = Math.max(1, Math.round(w * r));
      h = Math.max(1, Math.round(h * r));
    }
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.drawImage(bmp, 0, 0, w, h);
    if (bmp.close) try { bmp.close(); } catch (_) {}
    const blob = await new Promise(res => c.toBlob(res, 'image/jpeg', quality));
    const buf = await blob.arrayBuffer();
    return { blob, buf };
  }

  if (el.fbAddImg) {
    el.fbAddImg.addEventListener('click', () => { if (el.fbFile) el.fbFile.click(); });
  }
  if (el.fbFile) {
    el.fbFile.addEventListener('change', async () => {
      const picked = Array.from(el.fbFile.files || []);
      el.fbFile.value = ''; // 允许重复选同一张
      for (const file of picked) {
        if (fbFiles.length >= FB_MAX) { toast(`最多上传 ${FB_MAX} 张`); break; }
        if (!/^image\//.test(file.type)) { toast('只能上传图片文件'); continue; }
        try {
          const { blob, buf } = await downscaleImage(file, 1000, 0.82);
          const base = (file.name || 'screenshot').replace(/\.[^.]+$/, '');
          fbFiles.push({
            name: `${base}.jpg`,
            type: 'image/jpeg',
            data: buf,
            url: URL.createObjectURL(blob)
          });
        } catch (_) {
          toast('这张图片读取失败，换一张试试');
        }
      }
      renderFbAttach();
    });
  }

  /* 新手引导：随时再看一遍 */
  el.replayGuide.addEventListener('click', () => api.openWindow('onboarding'));

  /* 天气 */
  el.weatherOn.addEventListener('change', async () => {
    const r = await api.weatherSet({ on: el.weatherOn.checked });
    if (r && r.cfg) { cfg.weather = r.cfg; fillWeather(r.cfg); renderWeather(r.weather); }
  });
  el.weatherInterval.addEventListener('change', async () => {
    const r = await api.weatherSet({ interval: Number(el.weatherInterval.value) });
    if (r && r.cfg) { cfg.weather = r.cfg; fillWeather(r.cfg); }
    toast(`刷新间隔已改为 ${el.weatherInterval.value} 分钟`);
  });
  el.weatherRepeat.addEventListener('change', async () => {
    const r = await api.weatherSet({ repeat: Number(el.weatherRepeat.value) });
    if (r && r.cfg) { cfg.weather = r.cfg; fillWeather(r.cfg); }
    toast(`同一种天气每 ${el.weatherRepeat.value} 分钟最多提醒一次`);
  });
  el.weatherLookup.addEventListener('click', async () => {
    const name = (el.weatherCity.value || '').trim();
    if (!name) { toast('先输入城市名，比如「北京」'); return; }
    el.weatherCandidates.textContent = '查询中…';
    const r = await api.weatherLookup(name);
    if (!r || !r.ok || !r.list || !r.list.length) {
      el.weatherCandidates.textContent = (r && r.error) || '没找到这个城市';
      return;
    }
    el.weatherCandidates.innerHTML = '';
    r.list.forEach(c => {
      const b = document.createElement('button');
      b.className = 'radio-chip';
      b.textContent = c.full;
      b.addEventListener('click', async () => {
        const res = await api.weatherSet({ city: c.name, cityId: c.id, cityName: c.full });
        if (res && res.cfg) { cfg.weather = res.cfg; fillWeather(res.cfg); renderWeather(res.weather); }
        toast(res && res.ok ? `已设为 ${c.full}` : (res && res.error) || '设置失败');
      });
      el.weatherCandidates.appendChild(b);
    });
  });
  el.weatherRefresh.addEventListener('click', async () => {
    el.weatherNowMeta.textContent = '正在刷新…';
    const r = await api.weatherRefresh();
    renderWeather(r && r.weather);
    if (r && r.cfg) { cfg.weather = r.cfg; fillWeather(r.cfg); }
    toast(r && r.ok ? '天气已刷新' : (r && r.error) || '刷新失败');
  });
  el.weatherTest.addEventListener('click', async () => {
    const r = await api.weatherTest();
    toast((r && r.text) || (r && r.error) || '暂时没有需要提醒的天气');
  });
  el.weatherSaveSecret.addEventListener('click', async () => {
    const r = await api.weatherSetSecret({ id: el.weatherCredId.value.trim(), key: el.weatherKey.value.trim() });
    el.weatherKey.value = '';
    if (r && r.cfg) {
      cfg.weather = r.cfg; fillWeather(r.cfg);
      toast(r.ok ? '你的凭证已加密保存' : '保存失败');
    }
  });
  // 恢复默认：清空用户凭证 → 自动回退到内置默认（不泄漏默认密钥）
  el.weatherResetSecret.addEventListener('click', async () => {
    const r = await api.weatherSetSecret({ id: '', key: '' });
    el.weatherCredId.value = '';
    el.weatherKey.value = '';
    if (r && r.cfg) { cfg.weather = r.cfg; fillWeather(r.cfg); }
    toast('已恢复使用内置默认凭证');
  });

  api.on('weather:update', data => {
    if (!data) return;
    if (data.cfg) { cfg.weather = data.cfg; fillWeather(data.cfg); }
    renderWeather(data.weather);
  });

  el.layerRadios.addEventListener('click', e => {
    const b = e.target.closest('.radio-chip');
    if (!b) return;
    cfg.layer = b.dataset.layer;
    fill();
    patch({ layer: b.dataset.layer });
  });

  el.dataChoose.addEventListener('click', async () => {
    const okMove = await appConfirm('把 Mochi 的数据（配置文件 + 自定义形象图片）迁到你选择的位置？\n迁移后立即生效，不需要重启。',
      { kind: 'warn', title: '迁移数据保存位置', okText: '选择位置', cancelText: '取消' });
    if (!okMove) return;
    const r = await api.chooseAndRelocate();
    if (!r || r.canceled) return;
    if (r.error) { await appAlert('迁移失败：' + r.error, { kind: 'error', title: '迁移没成功' }); return; }
    cfg = await api.getConfig();
    refreshDataPath();
    fill();
    toast('保存位置已切换，立即生效');
  });

  el.dataReset.addEventListener('click', async () => {
    const okBack = await appConfirm('把数据保存位置恢复为默认（%APPDATA%/Mochi）？\n迁移后立即生效，不需要重启。',
      { kind: 'warn', title: '恢复默认保存位置', okText: '恢复', cancelText: '取消' });
    if (!okBack) return;
    const r = await api.resetDataLocation();
    if (!r) return;
    if (r.error) { await appAlert('操作失败：' + r.error, { kind: 'error', title: '没能完成' }); return; }
    cfg = await api.getConfig();
    refreshDataPath();
    fill();
    toast('已恢复到默认保存位置');
  });

  document.getElementById('testWater').addEventListener('click', () => api.testReminder('water'));
  document.getElementById('testStand').addEventListener('click', () => api.testReminder('stand'));

  document.getElementById('openConfig').addEventListener('click', () => api.openConfigFolder());

  /* 检查更新 */
  const btnCheckUpdate = document.getElementById('btnCheckUpdate');
  if (btnCheckUpdate) {
    btnCheckUpdate.addEventListener('click', async () => {
      const hint = document.getElementById('aboutUpdateHint');
      btnCheckUpdate.disabled = true;
      if (hint) hint.textContent = '正在检查…';
      try {
        await api.checkUpdate();
      } catch (e) {
        if (hint) hint.textContent = '检查失败：' + ((e && e.message) || e);
      } finally {
        btnCheckUpdate.disabled = false;
        if (hint) setTimeout(() => { hint.textContent = ''; }, 2600);
      }
    });
  }

  document.getElementById('btnReset').addEventListener('click', async () => {
    const okReset = await appConfirm('恢复默认设置？角色、提醒、天气、AI 都会回到出厂状态（自定义形象与宠物位置会保留）。',
      { kind: 'error', title: '恢复默认设置', okText: '恢复默认', cancelText: '取消' });
    if (!okReset) return;
    cfg = await api.resetConfig();
    fill();
  });

  // 所有改动本来就是即时生效，没有「保存」按钮；关窗口点标题栏红点 / Esc。
  document.getElementById('btnClose').addEventListener('click', () => api.closeSelf());
  document.getElementById('btnMin').addEventListener('click', () => api.minimizeSelf());
  window.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !document.querySelector('.modal-mask.show')) api.closeSelf();
  });

  document.getElementById('addCustomBtn').addEventListener('click', () => openCreator(null));

  // 台词编辑器弹窗
  document.getElementById('editorClose').addEventListener('click', () => $('#editorMask').classList.remove('show'));
  document.getElementById('editorCancel').addEventListener('click', () => $('#editorMask').classList.remove('show'));
  document.getElementById('editorSave').addEventListener('click', () => saveDialogueEditor());
  document.getElementById('editorReset').addEventListener('click', () => resetDialogueEditor());
  $('#editorMask').addEventListener('click', e => { if (e.target.id === 'editorMask') $('#editorMask').classList.remove('show'); });

  // 自定义形象弹窗
  document.getElementById('creatorClose').addEventListener('click', () => $('#creatorMask').classList.remove('show'));
  document.getElementById('creatorCancel').addEventListener('click', () => $('#creatorMask').classList.remove('show'));
  document.getElementById('creatorSave').addEventListener('click', () => saveCreator());
  document.getElementById('creatorDelete').addEventListener('click', () => { if (creatorExistingId) removeCustom(creatorExistingId); });
  $('#crRatio').addEventListener('input', () => { $('#crRatioVal').textContent = `${Math.round($('#crRatio').value * 100)}%`; });
  $('#crFillMain').addEventListener('click', () => {
    if (!pendingImages.idle) { appAlert('请先选择「待机」主图', { title: '还没有主图' }); return; }
    STATE_FIELDS.forEach(s => { if (s.key !== 'idle') pendingImages[s.key] = pendingImages.idle; });
    buildImageSlots();
  });
  $('#creatorMask').addEventListener('click', e => { if (e.target.id === 'creatorMask') $('#creatorMask').classList.remove('show'); });

  // 导航（点侧栏 / 深链 / 主进程跳转 都走这一个函数）
  const PANE_LIST = ['general', 'character', 'remind', 'weather', 'scene', 'ai', 'help', 'feedback', 'about'];
  function gotoPane(name) {
    if (!PANE_LIST.includes(name)) return false;
    document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.pane === name));
    document.querySelectorAll('.pane').forEach(p => p.classList.toggle('active', p.id === `pane-${name}`));
    const main = document.querySelector('.content');
    if (main) main.scrollTop = 0;
    return true;
  }
  document.querySelector('.nav').addEventListener('click', e => {
    const b = e.target.closest('.nav-item');
    if (!b) return;
    gotoPane(b.dataset.pane);
  });
  // 主进程通过右键菜单 / 托盘菜单深链跳过来的
  api.on('settings:goto', pane => gotoPane(pane));

  /* ---------------- 场景实时显示 ---------------- */
  function showScene(info) {
    if (!info) return;
    const p = info.process ? `${info.process}.exe` : '—';
    el.liveProc.textContent = p;
    el.liveScene.textContent = D.SCENE_LABEL[info.scene] || '其他';
  }

  /* ---------------- 初始化 ---------------- */
  (async () => {
    cfg = await api.getConfig();
    buildCharacters();
    fill();

    // 从右键菜单 / 托盘菜单深链进来的：?pane=weather 之类，直接切到对应 tab
    try {
      const pane = new URLSearchParams(location.search).get('pane');
      if (pane) gotoPane(pane);
    } catch (_) { /* ignore */ }

    loadWeather();
    loadAIPublic();

    const info = await api.sceneNow();
    showScene(info);
    api.on('scene:current', showScene);

    const app = await api.appInfo();
    el.aboutVer.textContent = `v${app.version} · Electron ${app.electron}`;

    api.on('cfg:changed', c => {
      cfg = c;
      if (document.activeElement && document.activeElement.tagName === 'SELECT') return;
      fill();
    });
  })();
})();
