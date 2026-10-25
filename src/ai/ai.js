'use strict';
/**
 * AI 对话窗口（渲染层）
 * 走主进程的 ai:chat，主进程再转发 Pollinations 免费接口。这里不碰任何密钥。
 */
const api = window.mochi;
const $ = s => document.querySelector(s);

const TONE_LABEL = { gentle: '温柔', neutral: '简洁', sassy: '毒舌' };

let busy = false;

/* ---------------- 渲染 ---------------- */
function scrollBottom() {
  const box = $('#msgs');
  box.scrollTop = box.scrollHeight;
}

function bubble(kind, text) {
  const box = $('#msgs');
  const d = document.createElement('div');
  d.className = `msg ${kind}`;
  d.textContent = text;
  box.appendChild(d);
  scrollBottom();
  return d;
}

function typing() {
  const box = $('#msgs');
  const d = document.createElement('div');
  d.className = 'msg typing';
  d.innerHTML = '<i></i><i></i><i></i>';
  box.appendChild(d);
  scrollBottom();
  return d;
}

function emptyState() {
  $('#msgs').innerHTML = '<div class="empty"><b>想聊点什么？</b>可以问我今天穿什么、帮你想台词<br>或者纯粹吐槽一下工作。</div>';
}

function renderHistory(list) {
  const box = $('#msgs');
  box.innerHTML = '';
  if (!list || !list.length) { emptyState(); return; }
  list.forEach(m => bubble(m.role === 'user' ? 'me' : 'ai', m.content));
  scrollBottom();
}

/* ---------------- 发送 ---------------- */
async function send(text) {
  const msg = String(text || '').trim();
  if (!msg || busy) return;

  busy = true;
  $('#btnSend').disabled = true;
  $('#chips').style.display = 'none';
  const e = $('#msgs').querySelector('.empty');
  if (e) e.remove();

  bubble('me', msg);
  const t = typing();

  let r = null;
  try {
    r = await api.aiChat(msg);
  } catch (err) {
    r = { ok: false, error: String((err && err.message) || err) };
  }

  t.remove();
  if (r && r.ok) bubble('ai', r.reply);
  else bubble('err', (r && r.error) || '出错了，再试一次？');

  busy = false;
  $('#btnSend').disabled = false;
  $('#input').focus();
}

/* ---------------- 初始化 ---------------- */
async function init() {
  const data = await api.aiGet().catch(() => null);
  if (data && data.cfg) {
    $('#whoTone').textContent = TONE_LABEL[data.cfg.tone] || '温柔';
  }
  if (data && data.char) {
    if (data.char.name) $('#whoName').textContent = data.char.name;
    if (data.char.img) $('#avatar').src = data.char.img;
  }
  renderHistory(data && data.history);

  // 头像挂了就退回内置图
  $('#avatar').addEventListener('error', () => {
    $('#avatar').onerror = null;
    $('#avatar').src = '../../assets/cat/idle.png';
  });

  const input = $('#input');
  input.focus();

  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(96, input.scrollHeight) + 'px';
  });

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const v = input.value;
      input.value = '';
      input.style.height = 'auto';
      send(v);
    }
  });

  $('#btnSend').addEventListener('click', () => {
    const v = input.value;
    input.value = '';
    input.style.height = 'auto';
    send(v);
  });

  $('#chips').addEventListener('click', e => {
    const b = e.target.closest('button[data-q]');
    if (b) send(b.dataset.q);
  });

  $('#btnClear').addEventListener('click', async () => {
    await api.aiClear();
    emptyState();
    $('#chips').style.display = '';
    $('#whoTone').textContent = TONE_LABEL[(await api.aiGet().catch(() => null))?.cfg?.tone] || '温柔';
  });

  $('#btnClose').addEventListener('click', () => api.closeAI());

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') api.closeAI();
  });
}

init();
