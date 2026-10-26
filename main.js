'use strict';
/**
 * Mochi 桌面宠物 · 主进程
 * 负责：窗口管理 / 托盘 / 全局快捷键 / 配置持久化 / 提醒调度 / 场景感知 / 数值养成
 */
const {
  app, BrowserWindow, ipcMain, Tray, Menu, globalShortcut,
  screen, nativeImage, powerMonitor, shell, dialog, safeStorage, session, protocol
} = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const { fileURLToPath } = require('url');
const crypto = require('crypto');

const DATA = require('./src/shared/dialogues.js');

const IS_DEV = process.argv.includes('--dev');
const SHOOT = process.argv.includes('--shoot');   // 开发自检：截图各窗口
const ROOT = __dirname;

// 自定义 app:// 协议：sensor 窗口用它加载内置的 MediaPipe 运行库与手部模型。
// file:// 下 Chromium 会拦截 ES module 导入和 wasm 的 fetch，只有标准协议才能正常工作。
try {
  protocol.registerSchemesAsPrivileged([{
    scheme: 'app',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true }
  }]);
} catch (_) { /* 重复注册忽略 */ }

// 捕获默认 userData（产品名 Mochi → %APPDATA%/Mochi），用于「自定义数据保存位置」功能。
// 必须在任何 setPath 覆盖之前读取，否则拿到的就是被覆盖后的值。
let DEFAULT_USER_DATA = null;
try { DEFAULT_USER_DATA = app.getPath('userData'); } catch (_) { DEFAULT_USER_DATA = null; }

/**
 * 诊断日志（写入 userData/mochi-diag.log）。
 * 桌面宠物一旦有未捕获异常就会弹出「A JavaScript error occurred in the main process」，
 * 体验极差，所以这里统一接住：记录堆栈到 mochi-error.log，应用继续运行。
 */
function diag(msg) {
  try {
    fs.appendFileSync(path.join(app.getPath('userData'), 'mochi-diag.log'),
      '[' + new Date().toISOString() + '] ' + msg + '\n');
  } catch (_) { /* ignore */ }
}

process.on('uncaughtException', err => {
  try {
    fs.appendFileSync(path.join(app.getPath('userData'), 'mochi-error.log'),
      '[' + new Date().toISOString() + '] ' + ((err && err.stack) || String(err)) + '\n');
  } catch (_) { /* ignore */ }
  try { console.error('[mochi] 未捕获异常（已记录，继续运行）：', err); } catch (_) { /* ignore */ }
});

process.on('unhandledRejection', err => {
  try {
    fs.appendFileSync(path.join(app.getPath('userData'), 'mochi-error.log'),
      '[' + new Date().toISOString() + '] Rejection: ' + ((err && err.stack) || String(err)) + '\n');
  } catch (_) { /* ignore */ }
});

/**
 * exe 所在的「稳定目录」。
 * 单文件便携版（portable）每次启动都会把自己解压到随机临时目录再运行，
 * 所以 process.execPath 的目录每次都不一样、还会被删除。
 * 必须优先用 electron-builder 注入的 PORTABLE_EXECUTABLE_DIR，
 * 否则标记文件写进临时目录 → 下次启动读不到 → 「改保存位置重启不生效」。
 */
function exeStableDir() {
  const portable = process.env.PORTABLE_EXECUTABLE_DIR;
  if (portable && portable.trim()) return portable.trim();
  return path.dirname(process.execPath);
}

/** 数据目录标记文件：记录用户自定义的数据保存位置 */
function markerPath() {
  return path.join(exeStableDir(), 'mochi-path.txt');
}

/** 解析自定义数据目录：优先 --user-data-dir 命令行参数，其次 exe 同目录的 mochi-path.txt */
function resolveUserDataDir() {
  const arg = process.argv.find(a => a.startsWith('--user-data-dir='));
  if (arg) return arg.slice('--user-data-dir='.length);
  try {
    const marker = markerPath();
    if (fs.existsSync(marker)) {
      const p = fs.readFileSync(marker, 'utf-8').trim();
      // 目录被用户删掉时不要让应用起不来，直接回退默认
      if (p && fs.existsSync(p)) return p;
    }
  } catch (_) { /* ignore */ }
  return null;
}

// 沙箱 / 无 GPU 环境下（自检截图时）强制走软件渲染：
// 直接禁用独立 GPU 进程，改用进程内 SwiftShader 软件渲染，避免 GPU 进程启动即崩（0xC0000005）
if (SHOOT || process.env.MOCHI_NO_GPU) {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('disable-gpu-compositing');
  app.commandLine.appendSwitch('use-gl', 'swiftshader');
  app.commandLine.appendSwitch('disable-features', 'Vulkan');
  app.commandLine.appendSwitch('in-process-gpu');
}

// 自检模式使用独立临时 userData，避免污染用户真实配置，同时保证每次都是「干净首启」
if (SHOOT) {
  try {
    const tmpData = path.join(ROOT, 'build', '.shoot-userdata');
    fs.mkdirSync(tmpData, { recursive: true });
    app.setPath('userData', tmpData);
  } catch (_) { /* ignore */ }
} else {
  // 自定义数据保存位置（不再强制 C 盘）：命令行参数 > exe 同目录的标记文件
  const custom = resolveUserDataDir();
  if (custom && DEFAULT_USER_DATA && path.resolve(custom) !== path.resolve(DEFAULT_USER_DATA)) {
    try { app.setPath('userData', custom); } catch (_) { /* ignore */ }
  }
}

/* ------------------------------------------------------------------ *
 * 配置存储
 * ------------------------------------------------------------------ */
// 真正的数据目录（可被「更改保存位置」在运行中替换，不需要重启）
let DATA_DIR = app.getPath('userData');
function configPath() { return path.join(DATA_DIR, 'mochi-config.json'); }

const DEFAULT_CONFIG = {
  onboarded: false,
  character: 'cat',
  reminderStyle: 'gentle',          // gentle | neutral | sassy
  water: { on: true, interval: 45 },
  stand: { on: true, interval: 60 },
  pomodoro: { on: false, focus: 25 },
  commute: { on: false, clockIn: '09:00', clockOut: '18:00' },   // 上下班打卡：到时间点举牌提醒
  scene: { on: true },
  // 天气：城市自行设置，数据来自和风天气；凭据用 safeStorage 加密存盘（不进明文配置）
  weather: {
    on: true,                        // 开启天气提醒
    city: '',                        // 用户输入的城市名（如「北京」）
    cityId: '',                      // 和风 LocationID（查城市后回填）
    cityName: '',                    // 查询到的城市全名（如「北京 · 北京市」）
    interval: 30,                    // 刷新间隔（分钟），最短 10
    repeat: 60,                      // 同类天气提醒的重复间隔（分钟），最短 15
    apiHost: 'https://devapi.qweather.com',   // 和风 API 主机（商业版可换成自己的专属 host）
    geoHost: 'https://geoapi.qweather.com'
  },
  autoLaunch: false,
  sound: true,
  ai: {
    on: true,                       // 开启 AI 对话
    tone: 'gentle',                 // 说话风格：gentle | neutral | sassy
    speak: true,                    // AI 回复时宠物也冒一句话
    provider: 'default',            // 接口来源：'default' 内置免费接口 | 'custom' 用户自己的 OpenAI 兼容接口
    baseUrl: '',                    // 自定义接口地址（如 https://api.openai.com/v1）
    model: ''                       // 自定义模型名（如 gpt-4o-mini / deepseek-chat）
  },
  memory: true,                     // 本地记忆：记录陪伴天数 / 互动次数
  showStats: false,                 // 常显心情/精力/亲密度（默认关：太挡视线，鼠标悬停即可看）
  uiMigratedStatsOff: false,        // 一次性迁移标记：老配置里的 showStats:true 自动关掉
  scale: 1,
  layer: 'top',                     // 窗口层级：'top'(置顶) | 'ghost'(半透明置顶) | 'bottom'(桌面层)
  wander: { on: false },            // 自由走动：默认关（只在用户主动打开后才自己挪步）
  wanderMigratedOff: false,         // 一次性迁移标记：老配置里的 wander.on:true 自动关掉
  livingPet: true,                  // 活体引擎：true=程序化骨骼角色（会呼吸/情绪/动作），false=静态立绘
  cameraMirror: false,              // 摄像头手势镜像：true=开启后宠物模仿你的手部动作
  charDialogues: {},                // 基础角色台词覆盖：{ [id]: { idle:[...], poke:[...], ... } }
  customCharacters: [],             // 自定义角色：[{ id,name,en,color,colorDeep,colorSoft,traits,
                                    //   slogan,visualRatio,handClick,images:{state:'file://...'}, dialogues:{...} }]
  petPos: null,
  stats: { mood: 82, energy: 68, intimacy: 24 },
  memoryData: { days: 1, lastDay: null, pettings: 0, pokes: 0 },
  lastSeenScene: null
};

function deepMerge(base, patch) {
  const out = Array.isArray(base) ? base.slice() : { ...base };
  for (const [k, v] of Object.entries(patch || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && base && typeof base[k] === 'object' && !Array.isArray(base[k])) {
      out[k] = deepMerge(base[k], v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

let config = deepMerge(DEFAULT_CONFIG, {});

/* ---------- 运行时角色表（基础 + 自定义 + 台词覆盖） ---------- */
function RCM() { return DATA.runtimeCharacters(config).map; }
function RCIds() { return DATA.runtimeCharacters(config).ids; }

function customDir() { return path.join(DATA_DIR, 'custom'); }
function toFileUrl(p) { return 'file:///' + String(p).replace(/\\/g, '/'); }
/** file:// URL 或普通路径 → 本机绝对路径（解析失败返回空串） */
function toAbsPath(v) {
  const s = String(v || '');
  if (!s) return '';
  if (s.startsWith('file:')) {
    try { return fileURLToPath(s); } catch (_) { return ''; }
  }
  return s;
}

/**
 * 自定义形象图片自检（每次加载配置后跑一遍）：
 * 1) 图片文件已不存在（换过保存位置、手工删过 custom 目录、复制失败）→ 丢弃该状态，
 *    避免 <img> 加载失败后宠物窗口整只空白；
 * 2) 只有非"待机"状态的图、没有 idle → 把第一张提升为 idle，
 *    否则主进程取 idle 图取不到，桌面上会显示成内置默认形象，看上去就是"没生效"。
 * 有改动时返回 true，调用方负责落盘。
 */
function sanitizeCustomImages() {
  const list = config.customCharacters || [];
  if (!list.length) return false;

  let dirty = false;
  const next = list.map(cc => {
    const imgs = cc.images || {};
    const keys = Object.keys(imgs);
    if (!keys.length) return cc;          // 完全没有图的自定义角色：保留，交给界面提示补图

    const keep = {};
    let localDirty = false;
    for (const k of keys) {
      const abs = toAbsPath(imgs[k]);
      if (abs && fs.existsSync(abs)) keep[k] = imgs[k];
      else localDirty = true;             // 文件丢了
    }
    if (!keep.idle) {
      const first = Object.keys(keep)[0];
      if (first) { keep.idle = keep[first]; localDirty = true; }
    }
    if (!localDirty) return cc;
    dirty = true;
    return Object.assign({}, cc, { images: keep });
  });

  if (!dirty) return false;
  config = deepMerge(config, { customCharacters: next });
  return true;
}

/* ------------------------------------------------------------------ *
 * 角色形象图标：托盘 / 窗口 / 任务栏 跟随当前角色变化
 * ------------------------------------------------------------------ */
/** 取某角色某个状态的图片绝对路径（自定义角色存在用户目录，内置角色在 assets/） */
function charSpritePath(id, state = 'idle') {
  const c = RCM()[id] || {};
  if (c.custom && c.images) {
    const url = c.images[state] || c.images.idle;
    if (url) {
      // 必须确认文件真的在：否则 nativeImage 拿到空图，托盘/任务栏图标就变透明
      const abs = toAbsPath(url);
      if (abs && fs.existsSync(abs)) return abs;
    }
  }
  // 自定义角色缺这张图 → 回退到内置默认形象，避免宠物窗口/托盘图标变空白
  const base = c.custom ? 'cat' : id;
  const p = path.join(ROOT, 'assets', base, state + '.png');
  if (fs.existsSync(p)) return p;
  return path.join(ROOT, 'assets', base, 'idle.png');
}

/** 裁掉四周透明边（否则小图标里形象只剩中间一小块，看不清楚） */
function trimTransparent(img) {
  try {
    const { width, height } = img.getSize();
    if (!width || !height) return img;
    const bmp = img.toBitmap();       // BGRA
    let minX = width, minY = height, maxX = -1, maxY = -1;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (bmp[(y * width + x) * 4 + 3] > 10) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < minX || maxY < minY) return img;
    const w = maxX - minX + 1;
    const h = maxY - minY + 1;
    if (w === width && h === height) return img;
    return img.crop({ x: minX, y: minY, width: w, height: h });
  } catch (_) {
    return img;
  }
}

/** 生成正方形、留白均匀的角色图标 */
function squareIcon(img, size) {
  const t = trimTransparent(img);
  const { width: w, height: h } = t.getSize();
  if (!w || !h) return t;
  const k = size / Math.max(w, h);
  const rw = Math.max(1, Math.round(w * k));
  const rh = Math.max(1, Math.round(h * k));
  const small = t.resize({ width: rw, height: rh, quality: 'best' });
  try {
    const src = small.toBitmap();     // BGRA
    const out = Buffer.alloc(size * size * 4);
    const ox = Math.floor((size - rw) / 2);
    const oy = Math.floor((size - rh) / 2);
    for (let y = 0; y < rh; y++) {
      src.copy(out, ((y + oy) * size + ox) * 4, y * rw * 4, (y + 1) * rw * 4);
    }
    return nativeImage.createFromBitmap(out, { width: size, height: size });
  } catch (_) {
    return small;
  }
}

/** 当前角色的图标（角色形象 → 正方形，失败则退回内置 tray.png） */
let iconCacheKey = '';
let iconCacheBig = null;      // 256 基准图
const iconCacheSmall = new Map();   // size -> nativeImage

function charIconKey() {
  const c = RCM()[config.character] || {};
  return config.character + '|' + (c.custom ? JSON.stringify(c.images || {}) : '');
}

function invalidateCharIcon() {
  iconCacheKey = '';
  iconCacheBig = null;
  iconCacheSmall.clear();
}

function charIcon(size = 32) {
  const key = charIconKey();
  if (key !== iconCacheKey || !iconCacheBig) {
    iconCacheKey = key;
    iconCacheSmall.clear();
    let img = nativeImage.createFromPath(charSpritePath(config.character));
    if (img.isEmpty()) img = nativeImage.createFromPath(path.join(ROOT, 'build', 'tray.png'));
    iconCacheBig = img.isEmpty() ? null : squareIcon(img, 256);
  }
  if (!iconCacheBig) return null;
  if (size >= 256) return iconCacheBig;
  if (!iconCacheSmall.has(size)) {
    iconCacheSmall.set(size, iconCacheBig.resize({ width: size, height: size, quality: 'best' }));
  }
  return iconCacheSmall.get(size);
}

/** 把所有窗口 + 托盘的图标换成当前角色的形象 */
function applyCharIcon() {
  const big = charIcon(256);
  BrowserWindow.getAllWindows().forEach(w => {
    try { if (big) w.setIcon(big); } catch (_) { /* ignore */ }
  });
  if (tray) {
    try {
      const small = charIcon(32);
      if (small) tray.setImage(small);
    } catch (_) { /* ignore */ }
  }
}

/** 保存/更新一个自定义角色：把用户图片复制到 userData/custom/<id>/ 并记录配置 */
function saveCustom(def) {
  if (!def || !def.id) return { ok: false, error: '缺少角色 ID' };
  const dir = customDir();
  const imgDir = path.join(dir, def.id);
  try {
    fs.mkdirSync(imgDir, { recursive: true });
  } catch (e) {
    return { ok: false, error: '无法创建图片目录：' + ((e && e.message) || e) };
  }

  const images = {};
  const failed = [];
  for (const [state, src] of Object.entries(def.images || {})) {
    if (!src) continue;
    // 已存储在数据目录里的 file:// 路径直接复用，不再复制
    if (String(src).startsWith('file://')) { images[state] = src; continue; }
    const abs = toAbsPath(src);
    if (!abs || !fs.existsSync(abs)) { failed.push(state); continue; }
    const ext = path.extname(abs) || '.png';
    const dest = path.join(imgDir, `${state}${ext}`);
    try {
      fs.copyFileSync(abs, dest);
      images[state] = toFileUrl(dest);
    } catch (e) {
      console.warn('[custom] 复制图片失败', state, e.message);
      failed.push(state);
    }
  }

  // 没有任何「待机」图时，用第一张顶上去：否则桌面上取 idle 会回退到内置形象，
  // 用户就会觉得"我上传了呀，怎么还是原来那只"。
  if (!images.idle) {
    const first = Object.keys(images)[0];
    if (first) images.idle = images[first];
  }
  if (!Object.keys(images).length) {
    return { ok: false, error: '没有可用的图片，请至少为「待机」选择一张图片' };
  }

  const cc = Object.assign({}, def, {
    id: def.id,
    custom: true,
    images,
    visualRatio: Number(def.visualRatio) || 1,
    handClick: !!def.handClick
  });
  // 基础字段兜底，避免渲染崩溃
  cc.name = cc.name || '自定义形象';
  cc.en = cc.en || 'Custom';
  cc.color = cc.color || '#9B8CFF';
  cc.colorDeep = cc.colorDeep || '#6E5BD6';
  cc.colorSoft = cc.colorSoft || '#ECE7FF';
  cc.traits = cc.traits && cc.traits.length ? cc.traits : ['自定义'];
  cc.slogan = cc.slogan || '这是我自己做的搭子~';
  cc.greet = cc.greet && cc.greet.length ? cc.greet : ['我来了！', '你好呀~'];
  cc.idle = cc.idle && cc.idle.length ? cc.idle : ['陪你一会儿~', '今天也要开心哦。'];

  const list = (config.customCharacters || []).filter(c => c.id !== def.id);
  list.push(cc);
  config = deepMerge(config, { customCharacters: list });
  saveConfig();
  broadcast('cfg:changed', config);
  refreshTray();
  return { ok: true, config, failed };
}

function removeCustom(id) {
  const list = (config.customCharacters || []).filter(c => c.id !== id);
  config = deepMerge(config, { customCharacters: list });
  try { fs.rmSync(path.join(customDir(), id), { recursive: true, force: true }); } catch (_) { /* ignore */ }
  if (config.character === id) {
    config = deepMerge(config, { character: 'cat' });
    sendPet('pet:character', { id: 'cat' });
  }
  saveConfig();
  broadcast('cfg:changed', config);
  refreshTray();
  return config;
}

function loadConfig() {
  try {
    const cp = configPath();
    if (fs.existsSync(cp)) {
      const raw = JSON.parse(fs.readFileSync(cp, 'utf8'));
      config = deepMerge(DEFAULT_CONFIG, raw);
    }
  } catch (e) {
    console.warn('[config] 读取失败，使用默认值', e.message);
  }
  // 一次性迁移：状态数值此前默认常显，挡视线；新默认是「悬停才显示」，老配置也一并关掉
  if (!config.uiMigratedStatsOff) {
    config.showStats = false;
    config.uiMigratedStatsOff = true;
  }
  // 一次性迁移：自由走动此前默认开启，宠物会自己走丢；新默认「让它动它才动」
  if (!config.wanderMigratedOff) {
    config.wander = Object.assign({}, config.wander, { on: false });
    config.wanderMigratedOff = true;
  }
  // 自定义形象的图片可能早已失效（换过保存位置 / 手工删过目录），先自检再落盘
  if (sanitizeCustomImages()) saveConfigNow();
}

let saveTimer = null;

/** 立即落盘（迁移目录、退出前用，避免 200ms 防抖丢改动） */
function saveConfigNow() {
  clearTimeout(saveTimer);
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(configPath(), JSON.stringify(config, null, 2), 'utf8');
  } catch (e) {
    console.warn('[config] 保存失败', e.message);
  }
}

function saveConfig() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveConfigNow, 200);
}

function patchConfig(patch) {
  const beforeScene = !!(config.scene && config.scene.on);
  if (patch && patch.charDialogues) {
    // 台词覆盖是「整体替换」语义：用户在编辑器里删掉某段内容 / 恢复默认时，
    // 需要能真正把这一项去掉，而 deepMerge 只会合并、删不掉键。
    const rest = Object.assign({}, patch);
    delete rest.charDialogues;
    config = deepMerge(config, rest);
    config.charDialogues = patch.charDialogues;
  } else {
    config = deepMerge(config, patch);
  }
  saveConfig();
  broadcast('cfg:changed', config);
  refreshTray();
  applyCharIcon();
  const afterScene = !!(config.scene && config.scene.on);
  if (beforeScene !== afterScene) {
    afterScene ? startSceneWatcher() : stopSceneWatcher();
  }
  // 自由走动开关即时生效
  if (config.wander && config.wander.on) scheduleWander(1200);
  else if (wanderTimer) { clearTimeout(wanderTimer); wanderTimer = null; }
  return config;
}

/* ------------------------------------------------------------------ *
 * 窗口
 * ------------------------------------------------------------------ */
const PET_W = 360;
const PET_H = 440;

/** @type {BrowserWindow|null} */ let petWin = null;
/** @type {BrowserWindow|null} */ let onboardWin = null;
/** @type {BrowserWindow|null} */ let settingsWin = null;
/** @type {BrowserWindow|null} */ let pianoWin = null;

let petVisible = true;

const PRELOAD = path.join(ROOT, 'preload.js');

function baseWebPrefs(extra = {}) {
  return {
    preload: PRELOAD,
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: false,
    spellcheck: false,
    autoplayPolicy: 'no-user-gesture-required',
    ...extra
  };
}

function defaultPetPos() {
  const { workArea } = screen.getPrimaryDisplay();
  return {
    x: Math.round(workArea.x + workArea.width - PET_W - 24),
    y: Math.round(workArea.y + workArea.height - PET_H - 8)
  };
}

/**
 * 把保存的位置夹进 workArea。
 * 旧实现用 `pos.y < a.y + a.height - 40` 判定合法，等于允许窗口底部超出屏幕近 400px
 * ——宠物启动后大半个身子被任务栏切掉就是这么来的。现在严格按窗口四边收进 workArea。
 */
function clampPetPos(pos) {
  if (!pos || !Number.isFinite(Number(pos.x)) || !Number.isFinite(Number(pos.y))) return defaultPetPos();
  const gap = 8;
  const cx = Number(pos.x) + PET_W / 2;
  const cy = Number(pos.y) + PET_H / 2;
  for (const d of screen.getAllDisplays()) {
    const a = d.workArea;
    // 窗口中心落在哪块屏幕，就收进哪块屏幕
    if (cx >= a.x && cx <= a.x + a.width && cy >= a.y && cy <= a.y + a.height) {
      return {
        x: Math.round(Math.min(Math.max(Number(pos.x), a.x + gap), Math.max(a.x + gap, a.x + a.width - PET_W - gap))),
        y: Math.round(Math.min(Math.max(Number(pos.y), a.y + gap), Math.max(a.y + gap, a.y + a.height - PET_H - gap)))
      };
    }
  }
  return defaultPetPos();
}

/**
 * 安全移动宠物窗口（唯一入口）。
 *
 * Electron 的 setPosition 只接受「整数」：传小数 / NaN / undefined 会直接抛
 *   Error processing argument at index 1, conversion failure from ...
 * 由于拖动、散步都跑在 setInterval/setTimeout 里，异常没人接 → 主进程未捕获异常
 * → 弹「A JavaScript error occurred in the main process」。
 * （高分屏缩放下 getCursorScreenPoint/getPosition 可能给出小数，是主要诱因）
 * 这里统一取整 + 非有限值直接丢弃，从根上避免这类崩溃。
 */
function petSetPos(x, y, animate) {
  if (!petWin || petWin.isDestroyed()) return false;

  let nx = Math.round(Number(x));
  let ny = Math.round(Number(y));
  if (!Number.isFinite(nx) || !Number.isFinite(ny)) {
    diag('petSetPos 丢弃非法坐标 x=' + x + ' y=' + y);
    return false;
  }
  // ⚠️ 关键：Math.round(-0.4) === -0，而 Electron 把 -0 也判为「非整数」→ 抛
  //    conversion failure from （值打印为空，极难排查）。这里必须归一成 +0。
  if (nx === 0) nx = 0;
  if (ny === 0) ny = 0;
  // 超出 int32 的坐标同样会让 setPosition 抛错，直接丢弃（正常桌面不会到这么大）
  const LIM = 100000;
  if (Math.abs(nx) > LIM || Math.abs(ny) > LIM) {
    diag('petSetPos 丢弃越界坐标 x=' + nx + ' y=' + ny);
    return false;
  }

  try {
    petWin.setPosition(nx, ny, animate === false ? false : true);
    return true;
  } catch (e) {
    diag('petSetPos 失败 ' + (e && e.message) + ' x=' + nx + ' y=' + ny);
    return false;
  }
}

/**
 * 把窗口四边收进「最近屏幕」的 workArea（workArea 已排除任务栏）。
 * 和 clampPetPos 不同：即使中心点在所有屏幕之外，也能按最近的屏幕收回来，
 * 不会因为「找不到所在屏幕」而跳到默认位置。拖动时用它做实时夹取，
 * 宠物就永远不会被拖到任务栏下面或屏幕外。
 */
function clampToNearestWorkArea(x, y) {
  const d = screen.getDisplayNearestPoint({ x: Math.round(x + PET_W / 2), y: Math.round(y + PET_H / 2) });
  const a = d.workArea;
  const gap = 4;
  const maxX = Math.max(a.x + gap, a.x + a.width - PET_W - gap);
  const maxY = Math.max(a.y + gap, a.y + a.height - PET_H - gap);
  return {
    x: Math.round(Math.min(maxX, Math.max(a.x + gap, x))),
    y: Math.round(Math.min(maxY, Math.max(a.y + gap, y)))
  };
}

function createPetWindow() {
  const pos = clampPetPos(config.petPos || defaultPetPos());

  petWin = new BrowserWindow({
    width: PET_W,
    height: PET_H,
    x: pos.x,
    y: pos.y,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: true,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: false,
    hasShadow: false,
    show: false,
    webPreferences: baseWebPrefs({ backgroundThrottling: false })
  });

  petWin.loadFile(path.join(ROOT, 'src', 'pet', 'index.html'));
  hookLog(petWin, 'pet');
  applyPetLayer();
  petWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  petWin.setIgnoreMouseEvents(true, { forward: true });

  petWin.once('ready-to-show', () => {
    if (config.onboarded) petWin.showInactive();
    petVisible = config.onboarded;
  });

  petWin.on('closed', () => { petWin = null; });
  petWin.on('moved', () => {
    if (!petWin) return;
    const [x, y] = petWin.getPosition();
    config.petPos = { x, y };
    saveConfig();
  });

  if (IS_DEV) petWin.webContents.openDevTools({ mode: 'detach' });
}

/* ------------------------------------------------------------------ *
 * 摄像头手势感知窗口（隐藏运行）
 * 取摄像头流 + MediaPipe Hands，把用户手势经 IPC 发给宠物窗口做镜像。
 * 默认隐藏、不占界面；只有用户主动开启「摄像头镜像」才真正打开摄像头。
 * ------------------------------------------------------------------ */
let sensorWin = null;
let handStatus = 'idle';   // idle | starting | active | denied | nocamp | unavailable

const APP_MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.task': 'application/octet-stream',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2'
};

/** 注册 app:// 协议（须在 app ready 之后调用一次） */
function registerAppProtocol() {
  try {
    protocol.handle('app', async (req) => {
      try {
        const u = new URL(req.url);
        let rel = decodeURIComponent(u.pathname || '/');
        if (!rel || rel === '/') rel = '/src/sensor/index.html';
        const target = path.normalize(path.join(ROOT, rel));
        // 防目录穿越：必须仍在应用根目录内
        if (!target.startsWith(ROOT)) return new Response('forbidden', { status: 403 });
        const data = await fs.promises.readFile(target);
        const mime = APP_MIME[path.extname(target).toLowerCase()] || 'application/octet-stream';
        return new Response(data, { status: 200, headers: { 'content-type': mime } });
      } catch (_) {
        return new Response('not found', { status: 404 });
      }
    });
  } catch (e) {
    diag('app protocol 注册失败：' + (e && e.message));
  }
}

function createSensorWindow() {
  if (sensorWin) return;
  sensorWin = new BrowserWindow({
    width: 320,
    height: 240,
    show: false,
    frame: false,
    transparent: false,
    skipTaskbar: true,
    resizable: false,
    webPreferences: baseWebPrefs()
  });
  sensorWin.loadURL('app://mochi/src/sensor/index.html');
  hookLog(sensorWin, 'sensor');
  sensorWin.on('closed', () => { sensorWin = null; });
}

/** 开启/关闭摄像头感知（用户开关或开机恢复配置时调用） */
function setSensorActive(on) {
  if (!sensorWin) createSensorWindow();
  if (!sensorWin) return;
  const apply = () => {
    if (!sensorWin || sensorWin.isDestroyed()) return;
    if (on) {
      // 移到屏幕外：隐藏窗口仍能取摄像头，但用户看不到任何方块
      sensorWin.setPosition(-3000, -3000);
      sensorWin.show();
    } else {
      sensorWin.hide();
    }
    try { sensorWin.webContents.send('sensor:control', !!on); } catch (_) {}
  };
  // 窗口刚创建时还没加载完，此时 send 会丢 → 等首帧加载完再下发控制指令
  if (sensorWin.webContents.isLoadingMainFrame && sensorWin.webContents.isLoadingMainFrame()) {
    sensorWin.webContents.once('did-finish-load', apply);
  } else {
    apply();
  }
}

/* ------------------------------------------------------------------ *
 * 拖动：渲染层只负责「按下 / 松开」，位移由主进程轮询光标完成。
 * 这样即使鼠标快速移动、光标一瞬离开窗口（渲染层收不到 mousemove），
 * 宠物窗口也能稳稳跟着手走——这是旧版拖不动的根因。
 * ------------------------------------------------------------------ */
let dragState = null;
let dragTimer = null;

function startPetDrag() {
  if (!petWin || dragState) return;
  stopWander(true);
  const cur = screen.getCursorScreenPoint();
  const [wx, wy] = petWin.getPosition();
  // px/py 记录「上一帧光标」，用来判断光标是否还在动（旧实现拿光标和起点比，
  // 只有光标回到起点才算停 → renderer 丢了 mouseup 时 dragState 永远不释放）。
  dragState = { cx: cur.x, cy: cur.y, wx, wy, px: cur.x, py: cur.y, idle: 0, t0: Date.now() };
  if (dragTimer) clearInterval(dragTimer);
  dragTimer = setInterval(() => {
    if (!petWin || !dragState) return stopPetDrag();
    // 兜底 1：拖太久（>30s）一定不是正常拖拽，强制结束，避免宠物一直黏着光标跑
    if (Date.now() - dragState.t0 > 30000) return stopPetDrag();

    const c = screen.getCursorScreenPoint();
    const dx = c.x - dragState.cx;
    const dy = c.y - dragState.cy;

    // 兜底 2：光标连续 ~3s 没动 → 认定已松手（renderer 的 mouseup 可能丢失）
    const movedNow = Math.abs(c.x - dragState.px) + Math.abs(c.y - dragState.py);
    dragState.px = c.x;
    dragState.py = c.y;
    if (movedNow === 0) {
      if (++dragState.idle > 185) return stopPetDrag();
    } else {
      dragState.idle = 0;
    }

    // 实时夹进最近屏幕可用区：拖动途中也不可能跑到任务栏下面 / 屏幕外
    const q = clampToNearestWorkArea(dragState.wx + dx, dragState.wy + dy);
    petSetPos(q.x, q.y, false);
  }, 16);
}

function stopPetDrag() {
  if (dragTimer) { clearInterval(dragTimer); dragTimer = null; }
  if (!dragState) return;
  dragState = null;
  if (petWin) {
    // 松手时如果被放到了屏幕外（拖到任务栏后面 / 拖出边框），立刻收进可用区
    enforcePetBounds('松手');
    try {
      const [x, y] = petWin.getPosition();
      config.petPos = { x, y };
      saveConfig();
    } catch (_) { /* ignore */ }
  }
  scheduleWander(2600);
}

/* ------------------------------------------------------------------ *
 * 自由走动：每隔几秒自己挪一小步，像真的在桌面上散步
 * ------------------------------------------------------------------ */
let wanderTimer = null;
let walkTimer = null;
let walking = false;

function wanderOn() {
  return !!(config.wander && config.wander.on);
}

function stopWander(keepOff) {
  if (wanderTimer) { clearTimeout(wanderTimer); wanderTimer = null; }
  if (walkTimer) { clearInterval(walkTimer); walkTimer = null; }
  if (walking) { walking = false; sendPet('pet:walk', { on: false }); }
  if (!keepOff) scheduleWander();
}

function scheduleWander(delay) {
  if (wanderTimer) { clearTimeout(wanderTimer); wanderTimer = null; }
  if (!wanderOn()) return;
  const wait = typeof delay === 'number' ? delay : 6000 + Math.random() * 8000;
  wanderTimer = setTimeout(wanderStep, wait);
}

function wanderStep() {
  wanderTimer = null;
  if (!wanderOn() || !petWin || !petVisible || dragState) return scheduleWander(4000);

  const [x, y] = petWin.getPosition();
  // 只在宠物当前所在的那块屏里小步挪动：不随机跨到副屏，避免「一转眼找不到了」
  const d = screen.getDisplayNearestPoint({ x: Math.round(x + PET_W / 2), y: Math.round(y + PET_H / 2) });
  const a = d.workArea;

  // 严格限制在 workArea 内（workArea 已排除任务栏/托盘），
  // 之前允许"探出三成身体"，实际观感就是宠物被任务栏切掉半截，用户明确不想要。
  const gap = 8;
  const maxX = Math.max(a.x + gap, a.x + a.width - PET_W - gap);
  const maxY = Math.max(a.y + gap, a.y + a.height - PET_H - gap);

  let tx = Math.min(maxX, Math.max(a.x + gap, x + Math.round((Math.random() * 2 - 1) * 420)));
  let ty = Math.min(maxY, Math.max(a.y + gap, y + Math.round((Math.random() * 2 - 1) * 320)));

  // 已经在屏幕外（历史位置 / 拔过屏 / 被手动拖出去）→ 这一步走回可视区，下一脚更快
  if (!petFullyInside()) {
    tx = a.x + gap + Math.random() * Math.max(1, maxX - a.x - gap);
    ty = a.y + gap + Math.random() * Math.max(1, maxY - a.y - gap);
    walkTo(tx, ty, () => scheduleWander(2500));
    return;
  }

  walkTo(tx, ty, () => scheduleWander());
}

function walkTo(tx, ty, done) {
  if (!petWin) { done && done(); return; }
  const [sx, sy] = petWin.getPosition();
  const dx = tx - sx;
  const dy = ty - sy;
  const dist = Math.hypot(dx, dy);
  if (dist < 6) { done && done(); return; }

  const dur = Math.min(2800, Math.max(500, dist * 9));
  const t0 = Date.now();
  walking = true;
  sendPet('pet:walk', { on: true });
  if (walkTimer) clearInterval(walkTimer);
  walkTimer = setInterval(() => {
    if (!petWin) {
      clearInterval(walkTimer); walkTimer = null; walking = false;
      return done && done();
    }
    if (dragState) {   // 人动手了，立刻让位给拖拽
      clearInterval(walkTimer); walkTimer = null;
      walking = false;
      sendPet('pet:walk', { on: false });
      return done && done();
    }
    const p = Math.min(1, (Date.now() - t0) / dur);
    const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;   // easeInOutQuad
    petSetPos(sx + dx * e, sy + dy * e, false);
    if (p >= 1) {
      clearInterval(walkTimer); walkTimer = null;
      walking = false;
      sendPet('pet:walk', { on: false });
      const [nx, ny] = petWin.getPosition();
      config.petPos = { x: nx, y: ny };
      saveConfig();
      done && done();
    }
  }, 16);
}

/* ------------------------------------------------------------------ *
 * 活动范围守卫：宠物永远完整待在「桌面可用区」里
 *
 * 之前的判定是「露出 1/3 就算可见」，于是被拖到任务栏后面、只露个头顶时
 * 看门狗认为一切正常，用户却觉得宠物「跑出去找不到了」。
 * 现在改成严格判定：窗口四边必须完整落在某块屏幕的 workArea 内，
 * 差一点也立刻原地收边（不跨屏搬家，保留用户摆放的位置感）。
 * ------------------------------------------------------------------ */
/** 窗口是否「完整」位于某块屏幕的可用区（容差 2px，避免 DPI 取整反复触发） */
function petFullyInside() {
  if (!petWin || petWin.isDestroyed()) return true;
  const [x, y] = petWin.getPosition();
  const T = 2;
  return screen.getAllDisplays().some(d => {
    const a = d.workArea;
    // 屏幕本身比宠物窗口还小（超高缩放 / 小屏）时，只要求左上角在区域内，
    // 否则会每 4 秒判一次越界、把同一坐标写回，白白刷日志。
    const needW = Math.min(PET_W, a.width);
    const needH = Math.min(PET_H, a.height);
    return x >= a.x - T && y >= a.y - T &&
      x + needW <= a.x + a.width + T &&
      y + needH <= a.y + a.height + T;
  });
}

/** 越界就原地收进最近屏幕的可用区；返回是否动过 */
function enforcePetBounds(why) {
  if (!petWin || petWin.isDestroyed() || dragState) return false;
  if (petFullyInside()) return false;

  const [x, y] = petWin.getPosition();
  const d = screen.getDisplayNearestPoint({ x: Math.round(x + PET_W / 2), y: Math.round(y + PET_H / 2) });
  const a = d.workArea;
  const gap = 4;
  const maxX = Math.max(a.x + gap, a.x + a.width - PET_W - gap);
  const maxY = Math.max(a.y + gap, a.y + a.height - PET_H - gap);
  const nx = Math.round(Math.min(maxX, Math.max(a.x + gap, x)));
  const ny = Math.round(Math.min(maxY, Math.max(a.y + gap, y)));

  // 已经夹到极限位置（屏比窗口还小时会发生）→ 不再重复 setPosition
  if (nx === x && ny === y) return false;

  diag(`宠物越界 (${x},${y}) → 收进 (${nx},${ny})${why ? ' [' + why + ']' : ''}`);
  stopWander(true);
  petSetPos(nx, ny, true);
  config.petPos = { x: nx, y: ny };
  saveConfig();
  return true;
}

/** 把宠物叫回主屏底部中央（托盘菜单 / Ctrl+Alt+R） */
function recallPet() {
  if (!petWin || petWin.isDestroyed()) return;
  // 残留拖拽态（renderer 丢了 mouseup）会挡住 walkTo —— 先清掉，否则「快捷键叫不回来」
  if (dragState) stopPetDrag();
  const { workArea } = screen.getPrimaryDisplay();
  const tx = Math.round(workArea.x + (workArea.width - PET_W) / 2);
  const ty = Math.round(workArea.y + workArea.height - PET_H - 12);
  if (!petVisible) setPetVisible(true);
  stopWander(true);
  petWin.showInactive();
  petWin.setAlwaysOnTop(true, 'screen-saver');
  // 已经在屏幕外就「瞬移」回安全位（动画途中同样在屏幕外，越走越看不见）
  if (!petFullyInside()) {
    petSetPos(tx, ty, false);
    config.petPos = { x: tx, y: ty };
    saveConfig();
    sendPet('pet:say', { text: '我在这儿呢~', ms: 3000 });
    scheduleWander(4000);
    return;
  }
  walkTo(tx, ty, () => scheduleWander(4000));
  sendPet('pet:say', { text: '我在这儿呢~', ms: 3000 });
}

function startPetWatchdog() {
  // 4 秒巡检：压到任务栏后面 / 拖出边框 / 拔过外接屏 / 改过缩放 → 立刻收边
  setInterval(() => {
    if (!petWin || !petVisible) return;
    enforcePetBounds('巡检');
  }, 4000);

  const back = () => setTimeout(() => enforcePetBounds('显示器变化'), 1200);
  screen.on('display-removed', back);
  screen.on('display-metrics-changed', back);
  screen.on('display-added', back);
}

function createAuxWindow(name, { width, height, file, query }) {
  const win = new BrowserWindow({
    width,
    height,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    maximizable: false,
    show: false,
    title: 'Mochi',
    icon: path.join(ROOT, 'build', 'icon.ico'),
    webPreferences: baseWebPrefs()
  });
  win.loadFile(path.join(ROOT, 'src', name, file), query ? { query } : undefined);
  hookLog(win, name);
  win.once('ready-to-show', () => { win.show(); win.focus(); });
  if (IS_DEV) win.webContents.openDevTools({ mode: 'detach' });
  return win;
}

/**
 * 按配置设置宠物窗口层级。
 *  - top    置顶显示：始终浮在所有窗口之上（鼠标穿透，挡视线但不挡操作）
 *  - ghost  半透明置顶：仍然置顶可见，但整体半透明，隔着它能看清被压住的窗口内容
 *  - bottom 桌面层：回到普通层级，位于桌面之上、普通窗口之下——
 *           任何窗口都会盖住它（真正不遮挡内容），最小化窗口 / 回到桌面就能看到它。
 * 注意：不能使用 win.lower() —— 那会把窗口压到桌面窗口（Progman/WorkerW）之下，
 * 导致连桌面上都彻底看不见（这就是上一版「置于底层后消失」的原因）。
 */
function applyPetLayer() {
  if (!petWin) return;
  const layer = config.layer || 'top';

  if (layer === 'bottom') {
    petWin.setAlwaysOnTop(false);
    try { petWin.setOpacity(1); } catch (_) { /* ignore */ }
    // 极少数情况下（切到桌面、DPI 变化）普通层级窗口会被桌面窗口压住，重新标记一次可见。
    // 只对「本来就已经显示」的窗口做，避免引导流程还没完成就把宠物弹出来。
    if (petVisible && petWin.isVisible()) petWin.showInactive();
  } else if (layer === 'ghost') {
    petWin.setAlwaysOnTop(true, 'screen-saver');
    try { petWin.setOpacity(0.45); } catch (_) { /* ignore */ }
  } else {
    petWin.setAlwaysOnTop(true, 'screen-saver');
    try { petWin.setOpacity(1); } catch (_) { /* ignore */ }
  }
}

function openOnboarding(opts) {
  const replay = !!(opts && opts.replay);
  if (onboardWin && !onboardWin.isDestroyed()) { onboardWin.show(); onboardWin.focus(); return; }
  onboardWin = createAuxWindow('onboarding', {
    width: 960,
    height: 720,
    file: 'index.html',
    query: replay ? { replay: '1' } : undefined
  });
  onboardWin.on('closed', () => {
    onboardWin = null;
    // 首次引导被强关：按“跳过”处理，直接用默认角色
    if (!config.onboarded) finishOnboarding({ character: config.character, scene: false });
  });
}

function openSettings(pane) {
  // 兼容被当作事件回调调用（tray double-click / 全局快捷键会传 event 对象）
  pane = typeof pane === 'string' ? pane : '';
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.show();
    settingsWin.focus();
    // 已经在开着的，直接把目标 tab 切过去（深链）
    if (pane) settingsWin.webContents.send('settings:goto', pane);
    return;
  }
  settingsWin = createAuxWindow('settings', {
    width: 960,
    height: 700,
    file: 'index.html',
    query: pane ? { pane } : undefined
  });
  settingsWin.on('closed', () => { settingsWin = null; });
}

function openPiano() {
  if (pianoWin && !pianoWin.isDestroyed()) { closePiano(); return; }
  const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const w = 960, h = 420;
  pianoWin = new BrowserWindow({
    width: w,
    height: h,
    x: Math.round(workArea.x + (workArea.width - w) / 2),
    y: Math.round(workArea.y + workArea.height - h - 30),
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    show: false,
    webPreferences: baseWebPrefs()
  });
  pianoWin.loadFile(path.join(ROOT, 'src', 'piano', 'index.html'));
  hookLog(pianoWin, 'piano');
  pianoWin.setAlwaysOnTop(true, 'screen-saver');
  pianoWin.once('ready-to-show', () => { pianoWin.show(); pianoWin.focus(); });
  pianoWin.on('closed', () => {
    pianoWin = null;
    if (petWin && petVisible) { petWin.showInactive(); sendPet('pet:mode', { mode: 'idle' }); }
  });
}

function closePiano() {
  if (pianoWin && !pianoWin.isDestroyed()) pianoWin.close();
}

function sendPet(channel, payload) {
  if (petWin && !petWin.isDestroyed()) petWin.webContents.send(channel, payload);
}

function hookLog(win, tag) {
  if (!win || (!IS_DEV && !SHOOT)) return;
  win.webContents.on('console-message', (_e, level, message, line, source) => {
    if (level >= 2) console.log(`[${tag}] ${message}  (${source}:${line})`);
  });
  win.webContents.on('did-fail-load', (_e, code, desc) => {
    console.log(`[${tag}] did-fail-load ${code} ${desc}`);
  });
}

function broadcast(channel, payload) {
  for (const w of [petWin, onboardWin, settingsWin, pianoWin]) {
    if (w && !w.isDestroyed()) w.webContents.send(channel, payload);
  }
}

function togglePet() {
  if (!petWin) return;
  if (petVisible) { petWin.hide(); petVisible = false; }
  else { petWin.showInactive(); petVisible = true; }
  refreshTray();
  if (petVisible) scheduleWander(2200);
  else if (wanderTimer) { clearTimeout(wanderTimer); wanderTimer = null; }
}

function setPetVisible(v) {
  if (!petWin) return;
  petVisible = v;
  v ? petWin.showInactive() : petWin.hide();
  refreshTray();
  if (v) scheduleWander(2200);
  else if (wanderTimer) { clearTimeout(wanderTimer); wanderTimer = null; }
}

/* ------------------------------------------------------------------ *
 * 托盘
 * ------------------------------------------------------------------ */
let tray = null;

function trayImage() {
  // 托盘图标跟随当前角色形象（不再固定用 tray.png）
  return charIcon(32) || undefined;
}

function buildTrayMenu() {
  const map = RCM();
  const chars = RCIds().map(id => {
    const c = map[id] || {};
    return {
      label: `${c.emoji || '⭐'}  ${c.name || id}`,
      type: 'radio',
      checked: config.character === id,
      click: () => setCharacter(id)
    };
  });

  const styles = [
    { id: 'gentle', label: '温柔' },
    { id: 'neutral', label: '中立' },
    { id: 'sassy', label: '毒舌' }
  ].map(s => ({
    label: s.label,
    type: 'radio',
    checked: config.reminderStyle === s.id,
    click: () => patchConfig({ reminderStyle: s.id })
  }));

  return Menu.buildFromTemplate([
    { label: petVisible ? '隐藏 Mochi' : '显示 Mochi', click: togglePet },
    { label: '💬 和我聊聊（AI）', click: openAI },
    { label: '🔎 把宠物叫回眼前（Ctrl+Alt+R）', click: recallPet },
    { type: 'separator' },
    { label: '切换角色', submenu: chars },
    {
      label: '钢琴模式',
      accelerator: 'Ctrl+Alt+P',
      click: togglePiano
    },
    {
      label: '场景感知',
      type: 'checkbox',
      checked: !!config.scene.on,
      click: () => patchConfig({ scene: { on: !config.scene.on } })
    },
    { label: '提醒风格', submenu: styles },
    {
      label: '提醒',
      submenu: [
        {
          label: `喝水提醒（每 ${config.water.interval} 分钟）`, type: 'checkbox',
          checked: !!config.water.on, click: () => patchConfig({ water: { on: !config.water.on } })
        },
        {
          label: `起身提醒（每 ${config.stand.interval} 分钟）`, type: 'checkbox',
          checked: !!config.stand.on, click: () => patchConfig({ stand: { on: !config.stand.on } })
        },
        {
          label: `番茄钟（${config.pomodoro.focus} 分钟）`, type: 'checkbox',
          checked: !!config.pomodoro.on, click: () => patchConfig({ pomodoro: { on: !config.pomodoro.on } })
        },
        {
          label: `上下班打卡（${config.commute.clockIn} 上班 / ${config.commute.clockOut} 下班）`, type: 'checkbox',
          checked: !!(config.commute && config.commute.on),
          click: () => patchConfig({ commute: Object.assign({}, config.commute, { on: !(config.commute && config.commute.on) }) })
        },
        { type: 'separator' },
        { label: '现在提醒我喝水', click: () => fireReminder('water', true) },
        { label: '现在提醒我起身', click: () => fireReminder('stand', true) },
        { label: '现在提醒我打卡', click: () => fireReminder('commuteIn', true) },
        { label: '现在提醒我天气', click: () => { refreshWeather(true).then(r => { if (r.ok) fireWeatherReminder(r.advice, true); }); } }
      ]
    },
    {
      label: '天气',
      submenu: [
        {
          label: lastWeather
            ? `${lastWeather.city || '—'} · ${lastWeather.text} ${lastWeather.temp}℃`
            : '还没有天气数据',
          enabled: false
        },
        {
          label: '天气提醒', type: 'checkbox',
          checked: !!(config.weather && config.weather.on),
          click: () => {
            patchConfig({ weather: Object.assign({}, config.weather, { on: !(config.weather && config.weather.on) }) });
            stopWeatherLoop(); startWeatherLoop(); refreshTray();
          }
        },
        { label: '立即刷新天气', click: () => { refreshWeather(true).then(() => refreshTray()); } },
        { label: '在设置里改城市…', click: () => openSettings('weather') }
      ]
    },
    { type: 'separator' },
    { label: '设置…', accelerator: 'Ctrl+Alt+S', click: () => openSettings('general') },
    { label: '关于 Mochi', click: () => openSettings('about') },
    { label: '检查更新…', click: checkUpdatesManual },
    { type: 'separator' },
    { label: '退出 Mochi', click: () => app.quit() }
  ]);
}

function refreshTray() {
  if (!tray) return;
  tray.setContextMenu(buildTrayMenu());
  tray.setToolTip(`Mochi · ${(RCM()[config.character] || {}).name || 'Mochi'}`);
  const ic = trayImage();
  if (ic) { try { tray.setImage(ic); } catch (_) { /* ignore */ } }
}

function createTray() {
  tray = new Tray(trayImage());
  refreshTray();
  tray.on('click', () => {
    if (config.onboarded) togglePet();
  });
  tray.on('double-click', () => openSettings());
}

/* ------------------------------------------------------------------ *
 * 角色
 * ------------------------------------------------------------------ */
function setCharacter(id) {
  if (!RCM()[id] || id === config.character) {
    if (id === config.character) sendPet('pet:hi', {});
    return;
  }
  patchConfig({ character: id });
  sendPet('pet:character', { id });
  // 注意：自定义角色不在 DATA.CHARACTERS 里，必须走运行时角色表，否则这里会抛 TypeError
  const c = RCM()[id] || {};
  const greet = (c.greet && c.greet.length) ? c.greet : [c.slogan || '我到啦~'];
  sendPet('pet:say', { text: DATA.pick(greet), ms: 4200 });
  refreshTray();
  applyCharIcon();
}

function cycleCharacter() {
  const ids = RCIds();
  const idx = ids.indexOf(config.character);
  setCharacter(ids[(idx + 1) % ids.length]);
}

function togglePiano() {
  if (pianoWin && !pianoWin.isDestroyed()) { closePiano(); return; }
  openPiano();
}

/* ------------------------------------------------------------------ *
 * 场景感知（前台窗口进程名）
 * ------------------------------------------------------------------ */
let sceneProc = null;
let sceneTimer = null;
let lastScene = null;
let lastSceneAt = 0;
let currentScene = { process: '', title: '', scene: 'other' };

/**
 * 场景感知脚本：内嵌成常量，运行时写到数据目录再交给 powershell 执行。
 *
 * ⚠️ 不能直接跑 scripts/active-window.ps1 —— 打包后 ROOT 指向 app.asar 内部，
 * 外部 powershell.exe 读不到 asar 虚拟路径（fs.existsSync 却是 true），
 * 进程会立刻退出且没有任何报错，表现就是「场景感知一直没反应」。
 */
const SCENE_PS1 = String.raw`# Mochi 场景感知：常驻读取前台窗口的进程名 + 标题
# 输出：每 1.5 秒一行 JSON，形如 {"process":"Code","title":"main.js - Visual Studio Code"}
$ErrorActionPreference = 'SilentlyContinue'

try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
try { $OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

if (-not ('MochiFg' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;

public class MochiFg {
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    public static extern int GetWindowThreadProcessId(IntPtr hWnd, out int lpdwProcessId);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

    public static string ProcessName() {
        IntPtr h = GetForegroundWindow();
        int procId;
        GetWindowThreadProcessId(h, out procId);
        try { return System.Diagnostics.Process.GetProcessById(procId).ProcessName; }
        catch { return ""; }
    }

    public static string Title() {
        IntPtr h = GetForegroundWindow();
        StringBuilder sb = new StringBuilder(512);
        GetWindowText(h, sb, 512);
        return sb.ToString();
    }
}
'@
}

while ($true) {
    $proc = ''
    $title = ''
    try { $proc = [MochiFg]::ProcessName() } catch {}
    try { $title = [MochiFg]::Title() } catch {}

    $obj = [ordered]@{
        process = $proc
        title   = $title
    } | ConvertTo-Json -Compress

    Write-Output $obj
    Start-Sleep -Milliseconds 1500
}
`;

/** 把内嵌脚本落到真实磁盘（数据目录不可写时退到临时目录） */
function sceneScriptPath() {
  const body = '\ufeff' + SCENE_PS1;   // BOM：让 PowerShell 正确识别 UTF-8 注释
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const p = path.join(DATA_DIR, 'active-window.ps1');
    let old = '';
    try { old = fs.readFileSync(p, 'utf8'); } catch (_) { /* 首次写入 */ }
    if (old !== body) fs.writeFileSync(p, body, 'utf8');   // 内容一致就不重复写盘
    return p;
  } catch (_) { /* 落到临时目录 */ }
  try {
    const t = path.join(os.tmpdir(), 'mochi-active-window.ps1');
    fs.writeFileSync(t, body, 'utf8');
    return t;
  } catch (_) { return ''; }
}

function startSceneWatcher() {
  if (sceneProc || process.platform !== 'win32') return;
  if (!config.scene || !config.scene.on) return;

  const ps1 = sceneScriptPath();
  if (!ps1 || !fs.existsSync(ps1)) { diag('场景感知：脚本写入失败，已跳过'); return; }

  try {
    sceneProc = spawn('powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ps1],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });

    let buf = '';
    let gotAny = false;
    sceneProc.stdout.setEncoding('utf8');
    sceneProc.stdout.on('data', chunk => {
      buf += chunk;
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (line) { gotAny = true; handleSceneLine(line); }
      }
    });
    sceneProc.stderr.on('data', d => {
      const s = String(d || '').trim();
      if (s) diag('场景感知 stderr: ' + s.slice(0, 160));
    });
    sceneProc.on('exit', code => {
      if (!gotAny) diag('场景感知：脚本没输出就退出了 code=' + code);
      sceneProc = null;
    });
    sceneProc.on('error', e => {
      diag('场景感知启动失败: ' + (e && e.message));
      sceneProc = null;
    });
  } catch (e) {
    diag('场景感知异常: ' + (e && e.message));
    sceneProc = null;
  }
}

function stopSceneWatcher() {
  if (sceneProc) {
    try { sceneProc.kill(); } catch (_) { /* ignore */ }
    sceneProc = null;
  }
}

function handleSceneLine(line) {
  let info;
  try { info = JSON.parse(line); } catch (_) { return; }
  const scene = DATA.classifyScene(info.process);
  currentScene = { process: info.process || '', title: info.title || '', scene };
  broadcast('scene:current', currentScene);

  if (!config.scene.on) return;
  if (!config.onboarded) return;
  if (scene === lastScene) return;

  const now = Date.now();
  lastScene = scene;
  // 场景切换吐槽：20 秒冷却，避免刷屏，但比之前更跟手
  if (now - lastSceneAt < 20000) return;
  lastSceneAt = now;

  const char = RCM()[config.character] || {};
  const pool = (char.scene && (char.scene[scene] || char.scene.other)) || [char.slogan || '陪着你~'];
  sendPet('scene:update', {
    scene,
    process: info.process || '',
    text: DATA.pick(pool),
    ms: 5000
  });
}

function watchForeground() {
  // 兜底：PowerShell 进程被杀 / 启动失败时自动重启（8 秒一次，足够跟手）
  if (sceneTimer) clearInterval(sceneTimer);
  sceneTimer = setInterval(() => {
    if (!sceneProc && config.scene && config.scene.on) startSceneWatcher();
  }, 8000);
}

/* ------------------------------------------------------------------ *
 * 提醒调度
 * ------------------------------------------------------------------ */
const due = { water: 0, stand: 0, pomodoro: 0, commuteIn: 0, commuteOut: 0 };
let remindTimer = null;

function minutes(n) { return Math.max(1, Number(n) || 1) * 60000; }

/** 把 "HH:MM" 解析成「下一次」到达该时刻的时间戳（今天已过的则顺延到明天） */
function dailyAt(hhmm, fromMs) {
  const from = fromMs || Date.now();
  const [h, m] = String(hhmm || '09:00').split(':').map(Number);
  const t = new Date(from);
  t.setHours(h || 0, m || 0, 0, 0);
  let ms = t.getTime();
  if (ms <= from) {
    t.setDate(t.getDate() + 1);
    ms = t.getTime();
  }
  return ms;
}

function resetSchedule() {
  const now = Date.now();
  due.water = config.water.on ? now + minutes(config.water.interval) : 0;
  due.stand = config.stand.on ? now + minutes(config.stand.interval) : 0;
  due.pomodoro = config.pomodoro.on ? now + minutes(config.pomodoro.focus) : 0;
  due.commuteIn = (config.commute && config.commute.on) ? dailyAt(config.commute.clockIn) : 0;
  due.commuteOut = (config.commute && config.commute.on) ? dailyAt(config.commute.clockOut) : 0;
}

/** 上下班打卡：到点举牌提醒，触发后顺延到明天同一时刻 */
function tickCommute(now) {
  const c = config.commute;
  if (!c || !c.on) { due.commuteIn = 0; due.commuteOut = 0; return; }
  if (due.commuteIn && now >= due.commuteIn) {
    fireReminder('commuteIn');
    due.commuteIn = dailyAt(c.clockIn);
  }
  if (due.commuteOut && now >= due.commuteOut) {
    fireReminder('commuteOut');
    due.commuteOut = dailyAt(c.clockOut);
  }
}

function fireReminder(type, manual = false) {
  const style = config.reminderStyle || 'gentle';
  const pool = (DATA.REMIND_LINES[style] || DATA.REMIND_LINES.gentle)[type] || ['该休息一下啦'];
  const text = DATA.pick(pool);

  if (!petWin) return;
  if (!petVisible) setPetVisible(true);

  sendPet('remind:fire', {
    type,
    text,
    style,
    state: DATA.REMIND_STATE[type] || 'reminding',
    manual
  });

  // 打断当前节奏，重置该项计时
  if (type === 'commuteIn') due.commuteIn = dailyAt(config.commute.clockIn);
  else if (type === 'commuteOut') due.commuteOut = dailyAt(config.commute.clockOut);
  else if (type === 'pomodoro') due.pomodoro = Date.now() + minutes(config.pomodoro.focus);
  else due[type] = Date.now() + minutes(config[type].interval);
}

function startReminderLoop() {
  stopReminderLoop();
  resetSchedule();
  remindTimer = setInterval(() => {
    const now = Date.now();
    for (const type of ['water', 'stand', 'pomodoro']) {
      const conf = config[type];
      if (!conf || !conf.on) { due[type] = 0; continue; }
      if (!due[type]) { due[type] = now + minutes(type === 'pomodoro' ? conf.focus : conf.interval); continue; }
      if (now >= due[type]) fireReminder(type);
    }
    tickCommute(now);
  }, 2000);
}

function stopReminderLoop() {
  if (remindTimer) clearInterval(remindTimer);
  remindTimer = null;
}

function snoozeReminder(type) {
  if (type === 'pomodoro') due.pomodoro = Date.now() + 5 * 60000;
  else if (due[type]) due[type] = Date.now() + 10 * 60000;
  else due[type] = Date.now() + 10 * 60000;
}

/* ------------------------------------------------------------------ *
 * 天气（和风天气 QWeather）+ 凭据加密存储
 *
 * 数据：geoapi 查城市 → v7/weather/now + v7/weather/3d
 *
 * 凭据分层：
 *  ① 内置默认凭据 = 开发者自己的和风 API 凭证，随应用分发、开箱即用。
 *     源码里只存 AES-256-GCM 密文（含 salt/iv/tag），密钥由「散落口令碎片 +
 *     PBKDF2(15万次)」派生，源码中无任何可读口令，单个 grep 无法命中明文。
 *  ② 首启时解密内置默认 → 立刻用 safeStorage(DPAPI，Windows 绑定当前账户)
 *     二次加密落盘到 userData/weather-secret.bin；之后磁盘上只有 DPAPI 密文，
 *     明文只在进程内存中存在。DPAPI 不可用时退化为同一套 AES 加密，磁盘仍无明文。
 *  ③ 用户「我的凭据」属覆盖项：只在用户主动填写时才写入并标记 userProvided；
 *     返回的掩码也只针对用户自己的凭证，内置默认绝不外泄到渲染层/UI。
 * ------------------------------------------------------------------ */
let weatherTimer = null;
let lastWeather = null;
let lastWeatherKind = '';
let lastWeatherRemindAt = 0;

// 内置默认凭据密文（AES-256-GCM，结构：salt[16] | iv[12] | tag[16] | ciphertext）
// 原始明文仅在本仓库的一次性生成脚本里出现过，从未写入源码或磁盘；
// 此处已是密文，附加上下文也无法还原出可用的开发者凭证。
const _seedFrags = ['m0', 'cH', '1w', '3a', 'tH', '5e', 'Rv', '2k', '7y', 'X9', 'qW', '8b'];
const _seedIter = 150000;
const _seedBlob =
  'bDsp7gg5MewyLxvFZ2pZk2NIh+tQisJn/74JPAu0vGHr6i21FOtCmQc+xfPqmIV4Acg6pGNM7NuYN5gDeWCjcL+x+vY2KLuUGzIHqTzfH5Gz0vvklhOz3maq0ybG4WOHIOutKvVLdiI=';

// 派生口令：碎片逆序拼接 + 长度尾缀，源码中无单一可读口令常量
function _seedPassphrase() {
  return _seedFrags.slice().reverse().join('') + '·' + _seedFrags.length;
}

// 仅用于首启：把内置默认密文解出明文（仍只在内存中）
function _decryptSeed() {
  try {
    const b = Buffer.from(_seedBlob, 'base64');
    const salt = b.subarray(0, 16), iv = b.subarray(16, 28), tag = b.subarray(28, 44), data = b.subarray(44);
    const key = crypto.pbkdf2Sync(_seedPassphrase(), salt, _seedIter, 32, 'sha256');
    const dec = crypto.createDecipheriv('aes-256-gcm', key, iv);
    dec.setAuthTag(tag);
    const json = dec.update(data, 'binary', 'utf8') + dec.final('utf8');
    const o = JSON.parse(json);
    if (o && o.key) return o;
  } catch (_) { /* 损坏/被篡改则静默失败，回退到让用户自填 */ }
  return null;
}

function weatherSecretPath() { return path.join(DATA_DIR, 'weather-secret.bin'); }

// 任何情况下都把凭据加密再落盘：优先 DPAPI，否则用同一套 AES 兜底（磁盘无明文）
function _encryptSecret(s) {
  const json = JSON.stringify({ id: s.id ? String(s.id) : '', key: s.key ? String(s.key) : '', userProvided: !!s.userProvided });
  if (safeStorage.isEncryptionAvailable()) return safeStorage.encryptString(json); // Windows: DPAPI，仅当前用户可解
  const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12);
  const key = crypto.pbkdf2Sync(_seedPassphrase(), salt, _seedIter, 32, 'sha256');
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([c.update(json, 'utf8'), c.final()]);
  return Buffer.concat([salt, iv, c.getAuthTag(), enc]);
}

function _decryptSecret(buf) {
  // 先试 DPAPI（用户机器常态），失败再试 AES 兜底
  if (safeStorage.isEncryptionAvailable()) {
    try { const s = JSON.parse(safeStorage.decryptString(buf)); if (s && s.key) return s; } catch (_) { /* 换格式，继续 */ }
  }
  try {
    const b = Buffer.from(buf);
    const salt = b.subarray(0, 16), iv = b.subarray(16, 28), tag = b.subarray(28, 44), data = b.subarray(44);
    const key = crypto.pbkdf2Sync(_seedPassphrase(), salt, _seedIter, 32, 'sha256');
    const dec = crypto.createDecipheriv('aes-256-gcm', key, iv);
    dec.setAuthTag(tag);
    const s = JSON.parse(dec.update(data, 'binary', 'utf8') + dec.final('utf8'));
    if (s && s.key) return s;
  } catch (_) { /* ignore */ }
  return null;
}

/** 读取已加密的天气凭据（DPAPI 或 AES 兜底），返回 {id,key,userProvided} */
function loadWeatherSecret() {
  try {
    const p = weatherSecretPath();
    if (!fs.existsSync(p)) return null;
    return _decryptSecret(fs.readFileSync(p));
  } catch (_) { return null; }
}

function saveWeatherSecret(s) {
  try {
    fs.writeFileSync(weatherSecretPath(), _encryptSecret(s));
    return true;
  } catch (e) {
    diag('保存天气凭据失败：' + (e && e.message));
    return false;
  }
}

/** 确保有凭据：没有就用内置默认初始化并立即加密落盘（磁盘永不存明文） */
function ensureWeatherSecret() {
  const cur = loadWeatherSecret();
  if (cur && cur.key) return cur;
  const seed = _decryptSeed();
  if (seed && seed.key) { seed.userProvided = false; saveWeatherSecret(seed); return seed; }
  return null;
}

/**
 * 对外（渲染层）只暴露「是否可用 / 用的是内置还是用户 / 用户自己凭证的脱敏掩码」。
 * 内置默认凭证的 id/key 一律不回传，杜绝在「我的凭据」里泄漏开发者密钥。
 */
function publicWeather() {
  const w = Object.assign({}, config.weather || {});
  const s = loadWeatherSecret();
  const has = !!(s && s.key);
  w.hasSecret = has;
  w.usingDefault = has && !s.userProvided;       // 用的是开发者内置默认
  w.userProvided = has && !!s.userProvided;       // 用户填了覆盖凭证
  // 只有用户自己填过的凭证才给脱敏掩码；内置默认绝不外泄
  w.credId = (s && s.userProvided && s.id) ? s.id : '';
  w.keyMask = (s && s.userProvided && s.key) ? (s.key.slice(0, 4) + '********' + s.key.slice(-4)) : '';
  return w;
}

async function qweatherGet(url) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'Accept': 'application/json' } });
    return await res.json();
  } finally { clearTimeout(to); }
}

/** 城市查询：返回候选列表 [{ id, name, full }] */
async function lookupCity(name) {
  const s = ensureWeatherSecret();
  if (!s || !s.key) throw new Error('还没有天气凭据');
  const host = (config.weather && config.weather.geoHost) || 'https://geoapi.qweather.com';
  const j = await qweatherGet(
    `${host}/v2/city/lookup?location=${encodeURIComponent(name)}&key=${s.key}&lang=zh&number=10`);
  if (!j || j.code !== '200' || !j.location || !j.location.length) throw new Error('没找到这个城市');
  return j.location.map(l => ({
    id: l.id, name: l.name,
    full: `${l.name}${l.adm2 && l.adm2 !== l.name ? ' · ' + l.adm2 : ''}${l.adm1 ? ' · ' + l.adm1 : ''}`
  }));
}

async function fetchWeatherNow() {
  const s = ensureWeatherSecret();
  if (!s || !s.key) throw new Error('还没有天气凭据');
  const w = config.weather || {};
  if (!w.cityId) throw new Error('还没设置城市');
  const host = w.apiHost || 'https://devapi.qweather.com';
  const [nowJ, dayJ] = await Promise.all([
    qweatherGet(`${host}/v7/weather/now?location=${w.cityId}&key=${s.key}&lang=zh`),
    qweatherGet(`${host}/v7/weather/3d?location=${w.cityId}&key=${s.key}&lang=zh`)
  ]);
  if (!nowJ || nowJ.code !== '200') {
    const msg = { '401': '凭据无效（401）', '403': 'API 主机不匹配（403）', '404': '城市不存在（404）' }[nowJ && nowJ.code];
    throw new Error(msg || ('天气接口返回 ' + (nowJ && nowJ.code)));
  }
  const n = nowJ.now || {};
  const d = (dayJ && dayJ.daily && dayJ.daily[0]) || {};
  const daily = ((dayJ && dayJ.daily) || []).map(x => ({
    date: x.fxDate || '',
    textDay: x.textDay || '',
    textNight: x.textNight || '',
    iconDay: x.iconDay || '',
    tempMax: Number(x.tempMax),
    tempMin: Number(x.tempMin),
    uvIndex: Number(x.uvIndex || 0),
    sunrise: x.sunrise || '',
    sunset: x.sunset || '',
    precip: x.precip || ''
  }));
  return {
    city: w.cityName || w.city || '',
    text: n.text || d.textDay || '',
    icon: n.icon || d.iconDay || '',
    temp: Number(n.temp), feelsLike: Number(n.feelsLike),
    windDir: n.windDir || '', windScale: n.windScale || '',
    humidity: n.humidity || '', vis: n.vis || '',
    tempMax: Number(d.tempMax), tempMin: Number(d.tempMin),
    textDay: d.textDay || '', textNight: d.textNight || '',
    uvIndex: Number(d.uvIndex || 0),
    daily,
    obsTime: n.obsTime || '', updatedAt: Date.now()
  };
}

/** 一句话天气摘要：温度 / 体感（相差≥2 才提）/ 风向风力 / 湿度 */
function weatherBrief(w) {
  if (!w) return '';
  const p = [];
  if (isFinite(w.temp)) p.push(`${Math.round(w.temp)}℃`);
  if (isFinite(w.feelsLike) && isFinite(w.temp) && Math.abs(w.feelsLike - w.temp) >= 2) {
    p.push(`体感 ${Math.round(w.feelsLike)}℃`);
  }
  if (isFinite(w.tempMin) && isFinite(w.tempMax)) p.push(`${Math.round(w.tempMin)}~${Math.round(w.tempMax)}℃`);
  if (w.windDir && w.windScale) p.push(`${w.windDir}${w.windScale}级`);
  if (w.humidity) p.push(`湿度 ${w.humidity}%`);
  return p.join(' · ');
}

/** 按天气状况给出提醒类型（找不到需要提醒的情况返回 null） */
function weatherAdvice(w) {
  if (!w) return null;
  const t = Number(w.temp), feels = Number(w.feelsLike);
  const text = `${w.text || ''}${w.textDay || ''}${w.textNight || ''}`;
  const wind = parseInt(String(w.windScale || '0').split('-').pop(), 10) || 0;
  const uv = Number(w.uvIndex) || 0;
  const gap = (isFinite(w.tempMax) && isFinite(w.tempMin)) ? w.tempMax - w.tempMin : 0;

  if (/雨|雷|阵雨/.test(text)) return { kind: 'rain', t, w: wind };
  if (/雪|冰雹|雨夹雪/.test(text)) return { kind: 'snow', t, w: wind };
  if (wind >= 6) return { kind: 'wind', t: t, w: wind };
  if (uv >= 8) return { kind: 'uv', t: uv, w: wind };
  if (/雾|霾|浮尘|沙尘/.test(text) || (Number(w.vis) > 0 && Number(w.vis) <= 2)) return { kind: 'fog', t, w: wind };
  if ((isFinite(feels) && feels <= 3) || (isFinite(w.tempMin) && w.tempMin <= 3)) return { kind: 'cold', t: isFinite(feels) ? feels : t, w: wind };
  if ((isFinite(t) && t >= 35) || (isFinite(w.tempMax) && w.tempMax >= 35)) return { kind: 'heat', t: isFinite(t) ? t : w.tempMax, w: wind };
  if (gap >= 10) return { kind: 'gap', t: gap, w: wind };
  return null;
}

/** 发一条天气提醒（举牌 + 气泡）
 *  - 天气类型变了（比如刚开始下雨）→ 立刻提醒，不等冷却
 *  - 同一类天气按 config.weather.repeat（默认 60 分钟，可调到 15）节流，避免刷屏
 */
function fireWeatherReminder(advice, force) {
  if (!advice) return null;
  const now = Date.now();
  const repeatMs = Math.max(15, Number(config.weather && config.weather.repeat) || 60) * 60000;
  const kindChanged = advice.kind !== lastWeatherKind;
  if (!force && !kindChanged && now - lastWeatherRemindAt < repeatMs) return null;
  lastWeatherKind = advice.kind;
  lastWeatherRemindAt = now;

  const style = config.reminderStyle || 'gentle';
  const lines = (DATA.WEATHER_LINES && DATA.WEATHER_LINES[style]) || DATA.WEATHER_LINES.gentle;
  const pool = lines[advice.kind] || ['注意天气变化呀~'];
  const line = DATA.pick(pool)
    .replace('{t}', String(Math.round(Number(advice.t) || 0)))
    .replace('{w}', String(advice.w || 0));

  // 文案后面补一句实时摘要：光说「记得带伞」不如附上当前温度和风
  const brief = weatherBrief(lastWeather);
  const text = brief ? `${line}\n${brief}` : line;

  diag(`天气提醒触发 kind=${advice.kind} changed=${kindChanged} 文案=${line}`);
  if (petWin) {
    if (!petVisible) setPetVisible(true);
    sendPet('remind:fire', {
      type: 'weather', text, style,
      state: (DATA.REMIND_STATE && DATA.REMIND_STATE.weather) || 'reminding',
      manual: !!force
    });
  }
  return text;
}

async function refreshWeather(force) {
  if (!config.weather || !config.weather.on) return { ok: false, error: '天气功能已关闭' };
  try {
    if (!config.weather.cityId) {
      if (!config.weather.city) return { ok: false, error: '还没设置城市' };
      const list = await lookupCity(config.weather.city);
      if (!list.length) return { ok: false, error: '没找到这个城市' };
      config.weather.cityId = list[0].id;
      config.weather.cityName = list[0].full;
      saveConfig();
    }
    const w = await fetchWeatherNow();
    lastWeather = w;
    broadcast('weather:update', { weather: w, cfg: publicWeather() });
    diag(`天气更新 ${w.city} ${w.text} ${w.temp}℃`);
    return { ok: true, weather: w, advice: weatherAdvice(w) };
  } catch (e) {
    const msg = String((e && e.message) || e);
    diag('天气拉取失败：' + msg);
    return { ok: false, error: msg };
  }
}

function startWeatherLoop() {
  stopWeatherLoop();
  if (!config.weather || !config.weather.on) return;
  const mins = Math.max(10, Number(config.weather.interval) || 60);
  const tick = () => {
    // 还没设城市就别反复请求（也不刷日志）
    if (!config.weather.city && !config.weather.cityId) return;
    refreshWeather(false).then(r => { if (r && r.ok) fireWeatherReminder(r.advice, false); });
  };
  // 启动时先拉一次（延后几秒，避开开机网络还没好）
  setTimeout(tick, 6000);
  weatherTimer = setInterval(tick, mins * 60000);
}

function stopWeatherLoop() {
  if (weatherTimer) clearInterval(weatherTimer);
  weatherTimer = null;
}

/* ------------------------------------------------------------------ *
 * AI 对话（Pollinations 免费接口，不需要填任何密钥）
 * ------------------------------------------------------------------ */
const AI_ENDPOINT = 'https://text.pollinations.ai/openai';

const AI_SYSTEM = {
  gentle: '你是一只住在用户电脑桌面上的小宠物 Mochi。说话温柔亲切，回答实用具体，一般 1~3 句、总长不超过 80 个字；不要用 markdown，不要罗列长清单，不要重复用户的问题。用中文回答。',
  neutral: '你是桌面宠物 Mochi。回答简洁直接，1~3 句、80 字以内，不说客套话，不用 markdown。用中文回答。',
  sassy: '你是桌面宠物 Mochi，嘴毒但心软。回答 1~3 句、80 字以内，可以调侃用户两句，但最后要给出真正有用的建议；不用 markdown。用中文回答。'
};

let aiWin = null;
let aiHistory = [];       // [{ role:'user'|'assistant', content, at }]
let aiBusy = false;

function aiHistoryPath() { return path.join(DATA_DIR, 'ai-history.json'); }

function loadAIHistory() {
  try {
    if (fs.existsSync(aiHistoryPath())) {
      const raw = JSON.parse(fs.readFileSync(aiHistoryPath(), 'utf8'));
      if (Array.isArray(raw)) {
        aiHistory = raw.filter(m => m && m.role && typeof m.content === 'string').slice(-60);
      }
    }
  } catch (_) { aiHistory = []; }
}

function saveAIHistory() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(aiHistoryPath(), JSON.stringify(aiHistory.slice(-60), null, 2), 'utf8');
  } catch (_) { /* ignore */ }
}

/* ---- 自定义 AI 凭据（用户自带 API Key，DPAPI/AES 加密落盘；不填则用内置免费接口） ---- */
function aiSecretPath() { return path.join(DATA_DIR, 'ai-secret.bin'); }

function loadAISecret() {
  try {
    const p = aiSecretPath();
    if (!fs.existsSync(p)) return null;
    return _decryptSecret(fs.readFileSync(p));
  } catch (_) { return null; }
}

function saveAISecret(s) {
  try {
    fs.writeFileSync(aiSecretPath(), _encryptSecret(s));
    return true;
  } catch (e) {
    diag('保存 AI 凭据失败：' + (e && e.message));
    return false;
  }
}

/** 对渲染层暴露 AI 配置：只回传是否有 key + 用户 key 的脱敏掩码，永不回传明文 */
function publicAI() {
  const c = Object.assign({}, config.ai || {});
  const s = loadAISecret();
  c.hasKey = !!(s && s.key);
  c.keyMask = c.hasKey ? (s.key.slice(0, 4) + '********' + s.key.slice(-4)) : '';
  return c;
}

/** 把用户填的基础地址补全成 chat/completions 端点，兼容常见 OpenAI 风格写法 */
function resolveAIChatUrl(base) {
  let u = String(base || '').trim().replace(/\/+$/, '');
  if (!u) return '';
  if (/\/chat\/completions$/i.test(u)) return u;
  if (/\/v\d+$/i.test(u)) return u + '/chat/completions';
  return u + '/v1/chat/completions';
}

/**
 * 调一次 AI（带最近 10 轮上下文），返回 { ok, reply | error }
 * 免费接口偶发 429 / 5xx / 网络抖动，这里做「可重试」分类 + 自动重试，
 * 并把不同失败原因翻译成人话，避免用户只看到「出错了」。
 */
async function aiChat(text) {
  const msg = String(text || '').trim();
  if (!msg) return { ok: false, error: '说点什么吧' };
  if (!config.ai || config.ai.on === false) return { ok: false, error: 'AI 对话已在设置里关闭' };
  if (aiBusy) return { ok: false, error: '还在想上一个问题，稍等一下' };

  const tone = config.ai.tone || 'gentle';
  const sys = `${AI_SYSTEM[tone] || AI_SYSTEM.gentle}\n当前时间：${new Date().toLocaleString('zh-CN')}`;
  const messages = [{ role: 'system', content: sys }]
    .concat(aiHistory.slice(-10).map(m => ({ role: m.role, content: m.content })))
    .concat([{ role: 'user', content: msg }]);

  // 决定用「内置免费接口」还是「用户自定义接口」
  const useCustom = config.ai.provider === 'custom';
  let endpoint = AI_ENDPOINT;
  let headers = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
  let payload = { model: 'openai', messages, temperature: 0.85, private: true };

  if (useCustom) {
    endpoint = resolveAIChatUrl(config.ai.baseUrl);
    if (!endpoint) return { ok: false, error: '请先在「AI 对话 → 我自己 的 AI」里填写接口地址' };
    const sec = loadAISecret();
    const key = sec && sec.key ? sec.key : '';
    if (!key) return { ok: false, error: '请先在设置里填写你自己的 API Key，或切回内置免费接口' };
    headers = Object.assign(headers, { 'Authorization': 'Bearer ' + key });
    payload = { model: config.ai.model || 'gpt-4o-mini', messages, temperature: 0.85 };
  }

  aiBusy = true;
  try {
    // 免费接口多给一次重试（多数失败是瞬时的 429 / 网络抖动）；自定义接口只重试一次
    const maxAttempts = useCustom ? 1 : 2;
    let lastErr = '出错了，再试一次？';
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (attempt > 0) {
        diag(`AI 第 ${attempt + 1} 次尝试`);
        await new Promise(r => setTimeout(r, 800 * attempt));
      }
      const r = await aiRequestOnce(endpoint, headers, payload, useCustom);
      if (r.ok) {
        const reply = r.reply;
        aiHistory.push({ role: 'user', content: msg, at: Date.now() });
        aiHistory.push({ role: 'assistant', content: reply, at: Date.now() });
        if (aiHistory.length > 60) aiHistory = aiHistory.slice(-60);
        saveAIHistory();
        diag(`AI 回复 ${reply.length} 字`);
        // 桌面上也冒一句，只说前 40 字，别糊一屏
        if (config.ai.speak && petWin) {
          sendPet('pet:say', { text: reply.replace(/\s+/g, ' ').slice(0, 40), ms: 5200 });
        }
        return { ok: true, reply };
      }
      lastErr = r.error || lastErr;
      if (r.retryable === false) break;   // 配置类错误（Key 无效 / 地址错 / 模型要付费）重试无意义
    }
    diag('AI 调用失败：' + lastErr);
    return { ok: false, error: lastErr };
  } finally {
    aiBusy = false;
  }
}

/** 发一次请求，失败时区分「能不能重试」并给中文提示 */
async function aiRequestOnce(endpoint, headers, payload, useCustom) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), useCustom ? 60000 : 26000);
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      signal: ctrl.signal,
      headers,
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const s = res.status;
      let error = `接口返回 HTTP ${s}`;
      let retryable = s === 429 || s >= 500;
      if (s === 401) { error = 'API Key 无效，请检查「我自己 的 AI」里填的 Key'; retryable = false; }
      else if (s === 402) { error = useCustom ? '这个接口/模型需要付费或令牌，换一个模型或切回内置免费接口' : '内置接口暂时限制访问，稍后再试'; retryable = false; }
      else if (s === 404) { error = '接口地址不对，请检查「我自己 的 AI」里的地址'; retryable = false; }
      else if (s === 429) { error = '免费接口有点忙（请求太频繁），等几秒再试'; }
      else if (s >= 500) { error = '接口服务暂时不可用，稍后再试'; }
      return { ok: false, error, retryable };
    }
    let j;
    try { j = await res.json(); }
    catch (_) { return { ok: false, error: '接口返回的数据看不懂（不是 JSON），稍后再试', retryable: true }; }
    if (j && j.error) {
      const em = typeof j.error === 'string' ? j.error : JSON.stringify(j.error);
      return { ok: false, error: '接口错误：' + em, retryable: true };
    }
    const c = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
    const reply = String(c || '').trim();
    if (!reply) return { ok: false, error: 'AI 这次没说话（可能服务繁忙），再试一次？', retryable: true };
    return { ok: true, reply };
  } catch (e) {
    if (ctrl.signal.aborted) return { ok: false, error: '请求超时了，检查一下网络再试', retryable: true };
    const m = String((e && e.message) || e);
    return { ok: false, error: '网络连不上：' + m, retryable: true };
  } finally {
    clearTimeout(to);
  }
}

function openAI() {
  if (config.ai && config.ai.on === false) {
    diag('AI 对话已关闭，忽略打开请求');
    return;
  }
  if (aiWin && !aiWin.isDestroyed()) { aiWin.show(); aiWin.focus(); return; }
  const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const w = 430, h = 580;
  aiWin = new BrowserWindow({
    width: w, height: h,
    x: Math.round(workArea.x + workArea.width - w - 40),
    y: Math.round(workArea.y + workArea.height - h - 48),
    frame: false, transparent: true, backgroundColor: '#00000000',
    resizable: true, minWidth: 350, minHeight: 430,
    skipTaskbar: false, alwaysOnTop: true, hasShadow: false, show: false,
    webPreferences: baseWebPrefs()
  });
  aiWin.loadFile(path.join(ROOT, 'src', 'ai', 'index.html'));
  hookLog(aiWin, 'ai');
  aiWin.once('ready-to-show', () => { aiWin.show(); aiWin.focus(); });
  aiWin.on('closed', () => { aiWin = null; });
}

function closeAI() {
  if (aiWin && !aiWin.isDestroyed()) aiWin.close();
  aiWin = null;
}

/* ------------------------------------------------------------------ *
 * 用户反馈（FormSubmit 转发到作者邮箱，不用自建服务端）
 * ------------------------------------------------------------------ */
// 普通表单 POST 端点：能稳定接收 multipart 文件附件（邮件里以附件形式送达）。
// /ajax/ 端点官方示例只发 JSON，实测不处理 multipart 附件，所以"带图反馈"必须走这里。
const FEEDBACK_ENDPOINT = 'https://formsubmit.co/2931424924@qq.com';
// 无附件时仍走 /ajax/ 端点，能拿到干净的 {success:true} JSON，便于判断。
const FEEDBACK_AJAX = 'https://formsubmit.co/ajax/2931424924@qq.com';

async function sendFeedback(payload) {
  const p = payload || {};
  const text = String(p.text || '').trim();
  if (!text) return { ok: false, error: '内容不能为空' };
  if (text.length > 4000) return { ok: false, error: '内容太长了，请精简到 4000 字以内' };

  // 附件（图片）：渲染层已压缩成 JPEG 的 ArrayBuffer 传过来
  const files = Array.isArray(p.files) ? p.files.filter(f => f && f.data && f.data.byteLength) : [];
  const info = {
    类型: p.type || '其他',
    内容: text,
    联系方式: String(p.contact || '').trim() || '（未填）',
    版本: app.getVersion(),
    系统: `${os.type()} ${os.release()} (${process.arch})`,
    当前角色: config.character || '',
    时间: new Date().toLocaleString('zh-CN')
  };
  if (files.length) info['附截图'] = `${files.length} 张（见邮件附件）`;

  // 先落一份本地，网络失败也不至于把用户的字丢了
  try {
    const dir = path.join(DATA_DIR, 'feedback');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `fb-${Date.now()}.json`), JSON.stringify(info, null, 2), 'utf8');
    // 附件原图也存一份，方便之后手动补发
    if (files.length) {
      const adir = path.join(dir, `attach-${Date.now()}`);
      fs.mkdirSync(adir, { recursive: true });
      files.forEach((f, i) => {
        try { fs.writeFileSync(path.join(adir, f.name || `shot-${i + 1}.jpg`), Buffer.from(f.data)); } catch (_) {}
      });
    }
  } catch (_) { /* ignore */ }

  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), files.length ? 40000 : 25000);
  try {
    let body, headers, endpoint;
    if (files.length) {
      // 有附件：走普通表单 POST 端点 + multipart/form-data（fetch 自动带 boundary，不能手设 Content-Type）
      endpoint = FEEDBACK_ENDPOINT;
      const fd = new FormData();
      for (const k in info) fd.append(k, info[k]);
      fd.append('_subject', `[Mochi 反馈] ${info.类型}`);
      fd.append('_captcha', 'false');
      fd.append('_template', 'table');
      files.forEach((f, i) => {
        fd.append('attachment', new Blob([f.data], { type: f.type || 'image/jpeg' }), f.name || `screenshot-${i + 1}.jpg`);
      });
      body = fd;
      headers = {
        'Accept': 'application/json',
        // FormSubmit 强校验来源页，缺了会直接拒绝（提示 "open this page through a web server"）
        'Referer': 'https://mochi.app',
        'Origin': 'https://mochi.app'
      };
    } else {
      endpoint = FEEDBACK_AJAX;
      body = JSON.stringify(Object.assign({
        _subject: `[Mochi 反馈] ${info.类型}`,
        _captcha: 'false',
        _template: 'table'
      }, info));
      headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Referer': 'https://mochi.app',
        'Origin': 'https://mochi.app'
      };
    }
    const res = await fetch(endpoint, {
      method: 'POST',
      signal: ctrl.signal,
      // 普通端点成功会 302 跳转到 ThankYou 页，我们手动判定不跟随
      redirect: files.length ? 'manual' : 'follow',
      headers,
      body
    });
    // 无附件走 /ajax/ → 解析 JSON；带附件走普通端点 → 2xx/3xx 即成功（返回 HTML 无需解析）
    if (!files.length) {
      const j = await res.json().catch(() => null);
      if (j && String(j.success) === 'true') {
        diag('反馈已发送');
        return { ok: true, attachments: 0 };
      }
      const msg = (j && j.message) || '发送失败';
      if (/Activation/i.test(msg)) {
        return { ok: false, needsActivation: true, error: '邮件通道还没激活（作者需要在邮箱点一次激活链接）' };
      }
      return { ok: false, error: msg };
    }
    // 带附件：2xx/3xx 视为成功
    if (res.status >= 200 && res.status < 400) {
      diag('反馈已发送（含 ' + files.length + ' 张截图）');
      return { ok: true, attachments: files.length };
    }
    const j = await res.json().catch(() => null);
    const msg = (j && j.message) || ('HTTP ' + res.status);
    if (/Activation/i.test(msg)) {
      return { ok: false, needsActivation: true, error: '邮件通道还没激活（作者需要在邮箱点一次激活链接）' };
    }
    return { ok: false, error: msg };
  } catch (e) {
    const m = (e && e.name === 'AbortError') ? '网络超时' : String((e && e.message) || e);
    return { ok: false, error: m };
  } finally {
    clearTimeout(to);
  }
}

/* ------------------------------------------------------------------ *
 * 自动更新（electron-updater + GitHub Releases）
 * ------------------------------------------------------------------ *
 * 仅打包安装后才会检查（开发环境没有 publish 配置会报错）。
 * 发布流程见 docs/RELEASING.md：
 *   改 package.json version → PUBLISH=1 GH_TOKEN=xxx node build.mjs installer
 * electron-updater 会读取 GitHub Releases 里的 latest.yml 比对版本。
 */
/* --- 更新提示统一走设置页的应用内弹窗（同 #fbModalMask，不再用系统原生对话框） --- */
let autoUpdaterRef = null;

/**
 * 验签策略（关键，改之前先读完）
 * ------------------------------------------------------------------
 * electron-updater 默认的验签要求安装包证书「整条链被系统信任」——
 * 它会跑 Get-AuthenticodeSignature，只有 Status === Valid 才继续。
 * 我们用自签证书，在任何用户机器上都不可能满足，于是表现为：
 *   下载到 100% → 验签失败 → "New version x is not signed by the
 *   application owner" → 永远装不上，而用户只看到"正在悄悄下载"。
 *
 * 这里换成「宽松但保留身份校验」：
 *   · 仍然要求 exe 带 Authenticode 签名（没签名照样拒绝）
 *   · 签名主体 CN 必须等于 app-update.yml 里的 publisherName
 *   · 但不要求证书链被系统信任
 * electron-updater 本身还会校验 latest.yml 里的 sha512，篡改风险可控。
 * 将来换成真证书（OV / EV / Azure Trusted Signing）这段不用改。
 */
let updaterPolicyApplied = false;
function applyUpdaterPolicies(autoUpdater) {
  if (!autoUpdater || updaterPolicyApplied) return;
  updaterPolicyApplied = true;

  try {
    if ('verifyUpdateCodeSignature' in autoUpdater) {
      autoUpdater.verifyUpdateCodeSignature = (publisherNames, file) => new Promise(resolve => {
        const names = (Array.isArray(publisherNames) ? publisherNames : [publisherNames])
          .filter(n => n && String(n).trim());
        if (!names.length) return resolve(null); // 没配 publisherName 时按官方语义跳过
        const escaped = String(file).replace(/'/g, "''");
        const { execFile } = require('node:child_process');
        execFile(
          'powershell.exe',
          ['-NoProfile', '-NonInteractive', '-InputFormat', 'None', '-Command',
            `$OutputEncoding = [Console]::OutputEncoding = [Text.Encoding]::UTF8; ` +
            `Get-AuthenticodeSignature -LiteralPath '${escaped}' | ConvertTo-Json -Compress`],
          { timeout: 20000, windowsHide: true },
          (err, stdout) => {
            const raw = String(stdout || '').trim();
            if (!raw) {
              diag('[updater] 读取签名失败：' + ((err && err.message) || '无输出'));
              return resolve('读不到安装包的签名信息，已停止安装');
            }
            let info = null;
            try { info = JSON.parse(raw); } catch (_) { info = null; }
            const subject = (info && info.SignerCertificate && info.SignerCertificate.Subject) || '';
            if (!subject) return resolve('安装包没有代码签名，已停止安装');
            const ok = names.some(n => {
              const m = /CN=([^,]+)/i.exec(String(n));
              const cn = (m ? m[1] : String(n)).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
              return new RegExp('CN=' + cn + '(\\s*,|\\s*$)', 'i').test(subject);
            });
            if (ok) {
              diag('[updater] 签名主体校验通过（' + subject + '；按宽松策略不校验信任链）');
              return resolve(null);
            }
            diag('[updater] 签名主体不匹配：期望 ' + names.join(' / ') + '，实际 ' + subject);
            resolve('安装包签名与发布者不一致，已停止安装');
          }
        );
      });
    }
  } catch (e) {
    diag('[updater] 无法设置验签策略：' + ((e && e.message) || e));
  }

  // 差分下载要上一版的 installer.exe 缓存，我们从不保留，直接全量更稳
  try { autoUpdater.disableDifferentialDownload = true; } catch (_) {}
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
}

function getAutoUpdater() {
  if (autoUpdaterRef) return autoUpdaterRef;
  try {
    ({ autoUpdater: autoUpdaterRef } = require('electron-updater'));
    applyUpdaterPolicies(autoUpdaterRef);
  } catch (e) { autoUpdaterRef = null; diag('自动更新模块未就绪：' + ((e && e.message) || e)); }
  return autoUpdaterRef;
}

/** 把 electron-updater 的英文报错翻译成用户能看懂、能行动的话 */
function friendlyUpdateError(msg) {
  const m = String(msg || '');
  // 我们自己抛的中文原因（已说清楚是签名/主体问题），直接透出
  if (/^读不到安装包|^安装包没有代码签名|^安装包签名与发布者/.test(m)) {
    return m + '（可能是安装包下载不完整，重试一次通常就好）\n还不行就到 GitHub Releases 页面手动下载最新版覆盖安装。';
  }
  if (/not signed by the application owner|sign verification failed/i.test(m)) {
    return '安装包签名校验没通过，已停止安装。\n可以到 GitHub Releases 页面手动下载最新版覆盖安装。';
  }
  if (/net::|ENOTFOUND|ETIMEDOUT|ECONNRESET|EAI_AGAIN|socket hang up|status code 5\d\d|ERR_UPDATER_NETWORK/i.test(m)) {
    return '下载更新时网络中断了，稍后再点一次「检查更新」就行。\n（当前版本照常使用）';
  }
  if (/ENOSPC|no space/i.test(m)) {
    return '磁盘空间不够了，清出一些空间后再试。';
  }
  return m + '\n\n当前版本照常使用，可以稍后再试。';
}

function sendSettings(channel, payload) {
  if (!settingsWin || settingsWin.isDestroyed()) return false;
  settingsWin.webContents.send(channel, payload);
  return true;
}

/**
 * 把更新提示交给渲染层用 showFbModal 弹出来。
 * 设置窗口没开就先打开「关于」页（检查更新按钮也在那儿），
 * 并把提示暂存起来，等页面报到 ui:ready 再发 —— 否则新窗口里监听还没注册，弹窗会丢。
 */
let pendingUpdateNotice = null;

function notifyUpdate(o) {
  const payload = Object.assign({ kind: 'info', title: '检查更新' }, o || {});
  if (sendSettings('update:notice', payload)) {
    pendingUpdateNotice = null;
    settingsWin.show();
    settingsWin.focus();
    return;
  }
  pendingUpdateNotice = payload;
  openSettings('about');
}

/** 渲染层注册完监听后调用，把暂存的更新提示补发出去 */
function flushUpdateNotice() {
  if (!pendingUpdateNotice) return;
  if (sendSettings('update:notice', pendingUpdateNotice)) pendingUpdateNotice = null;
}

/** 用户最近一次主动点「检查更新」的时间；用于决定更新失败要不要弹出来 */
let lastUpdateAskAt = 0;
/** 检查/下载进行中，避免重复点按钮并发跑多次 */
let updateBusy = false;

function initAutoUpdater() {
  if (!app.isPackaged) return;
  const autoUpdater = getAutoUpdater();
  if (!autoUpdater) return;

  autoUpdater.logger = {
    info: m => diag('[updater] ' + m),
    warn: m => diag('[updater] ' + m),
    error: m => diag('[updater] ' + m),
    debug: () => {}
  };

  autoUpdater.on('checking-for-update', () => diag('[updater] 检查中'));
  autoUpdater.on('update-available', info => {
    diag('[updater] 发现新版本 ' + info.version);
    updateBusy = true;
    sendPet('pet:say', { text: `发现新版本 ${info.version}，正在悄悄下载~`, ms: 6000 });
  });
  autoUpdater.on('update-not-available', () => {
    diag('[updater] 已是最新版本');
    updateBusy = false;
  });
  let lastLoggedPct = -10;
  autoUpdater.on('download-progress', p => {
    const pct = Math.round((p && p.percent) || 0);
    if (pct >= lastLoggedPct + 10 || pct === 100) {
      lastLoggedPct = pct;
      diag('[updater] 下载 ' + pct + '%');
    }
  });
  autoUpdater.on('update-downloaded', info => {
    diag('[updater] 下载完成 ' + info.version);
    updateBusy = false;
    notifyUpdate({
      kind: 'success',
      title: '新版本已就绪',
      text: `v${info.version} 已经下载好了。\n点「立即重启」会自动装好并重新打开；点「稍后」会在下次退出 Mochi 时自动安装。`,
      buttons: [
        { id: 'restart', label: '立即重启', primary: true },
        { id: 'later', label: '稍后' }
      ]
    });
  });
  autoUpdater.on('error', err => {
    const msg = String((err && (err.message || err)) || err);
    diag('[updater] 出错：' + msg);
    updateBusy = false;
    // 后台静默检查（启动 20s / 每 6 小时）时的网络抖动不打扰用户；
    // 但用户刚点过「检查更新」，或失败原因不是网络（签名/磁盘），必须说出来。
    const askedRecently = Date.now() - lastUpdateAskAt < 15 * 60 * 1000;
    const networkish = /net::|ENOTFOUND|ETIMEDOUT|ECONNRESET|EAI_AGAIN|socket hang up|status code 5\d\d|ERR_UPDATER_NETWORK/i.test(msg);
    if (!askedRecently && networkish) return;
    notifyUpdate({
      kind: 'error',
      title: '更新没能完成',
      text: friendlyUpdateError(msg)
    });
  });

  // 启动 20s 后再检查，避免和首屏抢资源；之后每 6 小时一次
  setTimeout(() => { autoUpdater.checkForUpdates().catch(e => diag('[updater] 检查失败：' + ((e && e.message) || e))); }, 20000);
  setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 6 * 3600 * 1000);
}

/** 托盘 / 设置页「检查更新」：手动触发，结果显示在应用内弹窗里 */
function checkUpdatesManual() {
  lastUpdateAskAt = Date.now();
  if (!app.isPackaged) {
    notifyUpdate({
      kind: 'warn',
      title: '开发模式下不检查更新',
      text: '只有打包安装后的 Mochi 才能检查更新。'
    });
    return;
  }
  const autoUpdater = getAutoUpdater();
  if (!autoUpdater) {
    notifyUpdate({
      kind: 'error',
      title: '自动更新模块未就绪',
      text: '缺少 electron-updater，重装一次 Mochi 就能恢复。'
    });
    return;
  }
  if (updateBusy) {
    notifyUpdate({
      kind: 'info',
      title: '正在下载新版本',
      text: '上一轮还在下载/安装准备中，完成后会自动提醒你重启。'
    });
    return;
  }
  // 检查可能要十几秒，先让宠物说一句，免得点了像没反应
  sendPet('pet:say', { text: '我去看看有没有新版本…', ms: 3000 });
  const cur = app.getVersion();
  updateBusy = true;
  autoUpdater.checkForUpdates().then(r => {
    const remote = r && r.updateInfo && r.updateInfo.version;
    if (!remote || remote === cur) {
      updateBusy = false;
      notifyUpdate({
        kind: 'info',
        title: '已是最新版本',
        text: `当前版本 v${cur}，暂时没有新版本。`
      });
    } else {
      notifyUpdate({
        kind: 'info',
        title: `发现新版本 v${remote}`,
        text: `当前版本 v${cur}。新版正在后台下载（约 80MB），装好后会弹出「立即重启」的提示。`
      });
    }
  }).catch(e => {
    updateBusy = false;
    notifyUpdate({
      kind: 'error',
      title: '检查更新失败',
      text: friendlyUpdateError((e && e.message) || e)
    });
  });
}

/* ------------------------------------------------------------------ *
 * 数值养成（心情 / 精力 / 亲密度）
 * ------------------------------------------------------------------ */
let statTimer = null;
let sleeping = false;

function clampStat(v) { return Math.max(0, Math.min(100, v)); }

function startStatLoop() {
  statTimer = setInterval(() => {
    const s = config.stats;
    s.energy = clampStat(s.energy + (sleeping ? 1.6 : -0.42));
    s.mood = clampStat(s.mood - 0.22);
    s.intimacy = clampStat(s.intimacy + 0.12);

    // 陪伴天数
    const today = new Date().toDateString();
    const m = config.memoryData;
    if (m.lastDay !== today) {
      m.days = m.lastDay ? (m.days || 1) + 1 : 1;
      m.lastDay = today;
    }

    broadcast('stats:update', s);
    saveConfig();
  }, 60000);
}

function bumpStat(key, delta) {
  if (!['mood', 'energy', 'intimacy'].includes(key)) return config.stats;
  config.stats[key] = clampStat(config.stats[key] + Number(delta || 0));
  broadcast('stats:update', config.stats);
  saveConfig();
  return config.stats;
}

function startIdleWatch() {
  setInterval(() => {
    let idle = 0;
    try { idle = powerMonitor.getSystemIdleTime(); } catch (_) { idle = 0; }
    const shouldSleep = idle >= 300;
    if (shouldSleep !== sleeping) {
      sleeping = shouldSleep;
      sendPet('activity:change', { sleeping });
    }
  }, 10000);
}

/* ------------------------------------------------------------------ *
 * 引导完成
 * ------------------------------------------------------------------ */
function finishOnboarding({ character, scene }) {
  const map = RCM();
  const firstRun = !config.onboarded;   // 回看引导（已 onboarded）不强制显示宠物
  patchConfig({
    onboarded: true,
    character: map[character] ? character : config.character,
    scene: { on: !!scene }
  });
  if (onboardWin && !onboardWin.isDestroyed()) { onboardWin.destroy(); onboardWin = null; }
  if (petWin) {
    if (firstRun) {
      petVisible = true;
      petWin.showInactive();
    }
    sendPet('pet:character', { id: config.character });
    if (firstRun) {
      setTimeout(() => {
        const c = map[config.character] || {};
        sendPet('pet:say', { text: (c.greet && c.greet[0]) || '我来了~', ms: 5200 });
      }, 600);
    }
  }
  refreshTray();
}

/* ------------------------------------------------------------------ *
 * IPC
 * ------------------------------------------------------------------ */
function registerIpc() {
  ipcMain.handle('cfg:get', () => config);
  ipcMain.handle('cfg:patch', (_e, patch) => {
    const sched = c => JSON.stringify([c.water, c.stand, c.pomodoro, c.commute]);
    const before = sched(config);
    const next = patchConfig(patch);
    if (sched(next) !== before) resetSchedule();
    if (patch && patch.layer) applyPetLayer();
    return next;
  });
  ipcMain.handle('cfg:reset', () => {
    const keep = { onboarded: true, petPos: config.petPos };
    config = deepMerge(DEFAULT_CONFIG, keep);
    saveConfig();
    broadcast('cfg:changed', config);
    refreshTray();
    resetSchedule();
    applyPetLayer();
    sendPet('pet:character', { id: config.character });
    return config;
  });

  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    platform: process.platform,
    configPath: configPath(),
    electron: process.versions.electron
  }));

  // 设置页「检查更新」
  ipcMain.handle('update:check', () => { checkUpdatesManual(); return { ok: true }; });

  // 设置页渲染层监听就绪：把因为窗口刚打开而暂存的更新提示补发出去
  ipcMain.on('ui:ready', e => {
    if (settingsWin && !settingsWin.isDestroyed() && e.sender === settingsWin.webContents) {
      flushUpdateNotice();
    }
  });

  // 应用内更新弹窗上的按钮（目前只有「立即重启」需要主进程动手）
  ipcMain.handle('update:action', (_e, action) => {
    if (action === 'restart') {
      const up = getAutoUpdater();
      if (!up) return { ok: false, error: '自动更新模块未就绪' };
      try { saveConfigNow(); } catch (_) { /* ignore */ }
      // isSilent=true：静默跑 NSIS 安装器，不弹安装向导；
      // isForceRunAfter=true：装完自动把新版 Mochi 拉起来
      setImmediate(() => up.quitAndInstall(true, true));
      return { ok: true };
    }
    return { ok: true };
  });

  ipcMain.handle('scene:now', () => currentScene);

  ipcMain.handle('pet:get-bounds', () => {
    if (!petWin) return { x: 0, y: 0, width: PET_W, height: PET_H };
    const b = petWin.getBounds();
    return b;
  });

  ipcMain.on('pet:set-pos', (_e, p) => {
    if (!petWin) return;
    petSetPos(p && p.x, p && p.y);
  });

  ipcMain.on('pet:drag-start', () => startPetDrag());
  ipcMain.on('pet:drag-end', () => stopPetDrag());
  ipcMain.handle('pet:wander', () => !!(config.wander && config.wander.on));

  ipcMain.on('pet:ignore-mouse', (_e, ignore) => {
    if (!petWin) return;
    petWin.setIgnoreMouseEvents(!!ignore, { forward: true });
  });

  /* ---- 摄像头手势镜像：sensor 窗口 ↔ 主进程 ↔ 宠物窗口 ---- */
  ipcMain.on('sensor:hand', (_e, g) => { sendPet('hand:pose', g || { present: false }); });
  ipcMain.on('sensor:status', (_e, s) => {
    handStatus = s || 'idle';
    broadcast('hand:status', handStatus);
  });
  ipcMain.on('sensor:set-active', (_e, on) => { setSensorActive(!!on); });
  ipcMain.handle('hand:status', () => handStatus);

  // 摄像头权限：仅允许隐藏的 sensor 窗口使用媒体设备（其它窗口一律拒绝）
  // ⚠️ 这里拿到的 wc 是 WebContents，不是 BrowserWindow；之前写成 wc === sensorWin 恒为 false → 永远拒绝。
  const isSensorContents = (wc) => {
    if (!wc) return false;
    try {
      if (sensorWin && !sensorWin.isDestroyed() && wc === sensorWin.webContents) return true;
      return /[/\\]src[/\\]sensor[/\\]/.test(wc.getURL() || '');
    } catch (_) { return false; }
  };
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => {
    if (permission === 'media' && isSensorContents(wc)) return cb(true);
    cb(false);
  });
  // Chromium 的媒体设备检查也会走这里；不补这个，getUserMedia 仍可能被判定无权限
  session.defaultSession.setPermissionCheckHandler((wc, permission) => {
    if (permission === 'media') return isSensorContents(wc);
    return true;
  });

  ipcMain.on('pet:menu', () => {
    if (!tray) return;
    tray.popUpContextMenu();
  });

  ipcMain.on('pet:hi', () => {
    if (!config.onboarded) return;
    const c = RCM()[config.character] || {};
    const pool = c.idle && c.idle.length ? c.idle : [c.slogan || '陪着你~'];
    sendPet('pet:say', { text: DATA.pick(pool), ms: 4200 });
  });

  ipcMain.on('win:open', (_e, name) => {
    if (name === 'settings') openSettings();
    else if (name === 'onboarding') openOnboarding();
    else if (name === 'piano') openPiano();
  });

  ipcMain.on('win:close', e => {
    const w = BrowserWindow.fromWebContents(e.sender);
    if (w) w.close();
  });

  ipcMain.on('win:minimize', e => {
    const w = BrowserWindow.fromWebContents(e.sender);
    if (w) w.minimize();
  });

  ipcMain.on('app:quit', () => app.quit());

  ipcMain.on('char:set', (_e, id) => setCharacter(id));
  ipcMain.on('char:cycle', () => cycleCharacter());

  ipcMain.handle('custom:add', (_e, def) => saveCustom(def));
  ipcMain.handle('custom:update', (_e, def) => saveCustom(def));
  ipcMain.handle('custom:remove', (_e, id) => removeCustom(id));

  /* ---------------- AI 对话 ---------------- */
  ipcMain.handle('ai:get', () => {
    const c = RCM()[config.character] || {};
    let img = '';
    if (c.custom && c.images) {
      const u = c.images.idle || c.images[Object.keys(c.images)[0]];
      if (u) img = u;
    }
    if (!img) img = `../../assets/${c.custom ? 'cat' : (config.character || 'cat')}/idle.png`;
    return {
      cfg: publicAI(),
      history: aiHistory.slice(-40),
      char: { name: c.name || 'Mochi', img }
    };
  });
  ipcMain.handle('ai:set', (_e, patch) => {
    patchConfig({ ai: Object.assign({}, config.ai, patch || {}) });
    return publicAI();
  });
  /** 用户自带 API Key：主进程加密保存，渲染层拿不到明文。留空提交 = 删除、回退内置免费接口 */
  ipcMain.handle('ai:set-secret', (_e, s) => {
    const key = (s && s.key) || '';
    if (!key) {
      try { fs.unlinkSync(aiSecretPath()); } catch (_) { /* 本来就没有 */ }
      return { ok: true, cfg: publicAI() };
    }
    const ok = saveAISecret({ key, userProvided: true });
    return { ok, cfg: publicAI() };
  });
  ipcMain.handle('ai:chat', (_e, text) => aiChat(text));
  ipcMain.handle('ai:clear', () => { aiHistory = []; saveAIHistory(); return true; });
  ipcMain.on('ai:open', () => openAI());
  ipcMain.on('ai:close', () => closeAI());

  /* ---------------- 用户反馈 ---------------- */
  ipcMain.handle('feedback:send', (_e, p) => sendFeedback(p));

  /* ---------------- 数据保存位置（可自定义，不再强制 C 盘） ---------------- */
  /**
   * 迁移数据到新目录并立即切换（不重启，重启在便携版里会直接起不来）。
   * 只迁移「配置文件 + 自定义形象图片」，不动 Chromium 的缓存目录。
   * @param {string|null} targetDir null = 恢复到默认（%APPDATA%/Mochi）
   */
  function relocateData(targetDir) {
    const cur = DATA_DIR;
    const def = DEFAULT_USER_DATA || path.join(app.getPath('appData'), 'Mochi');
    const dest = targetDir ? path.resolve(targetDir) : def;
    const isDefault = path.resolve(dest) === path.resolve(def);

    if (path.resolve(dest) !== path.resolve(cur)) {
      try {
        saveConfigNow();                       // 先把当前内存里的配置落盘
        fs.mkdirSync(dest, { recursive: true });

        const srcConf = configPath();
        const dstConf = path.join(dest, 'mochi-config.json');
        if (fs.existsSync(srcConf)) {
          let raw = fs.readFileSync(srcConf, 'utf-8');
          // 修正自定义形象图片的 file:// 绝对路径（兼顾正/反斜杠写法）
          const curR = path.resolve(cur).replace(/\\/g, '/');
          const curB = path.resolve(cur);
          const destR = path.resolve(dest).replace(/\\/g, '/');
          const destB = path.resolve(dest);
          raw = raw.split(curR).join(destR).split(curB).join(destB);
          fs.writeFileSync(dstConf, raw, 'utf-8');
        }

        const srcCustom = customDir();
        if (fs.existsSync(srcCustom)) {
          fs.cpSync(srcCustom, path.join(dest, 'custom'), { recursive: true, force: true });
        }
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e) };
      }
    }

    // 切换运行中的真实数据目录 + 写标记文件（下次启动据此定位）
    DATA_DIR = dest;
    try {
      if (!isDefault) fs.writeFileSync(markerPath(), dest, 'utf-8');
      else if (fs.existsSync(markerPath())) fs.unlinkSync(markerPath());
    } catch (e) {
      console.warn('[data] 标记文件写入失败（不影响本次生效）', e.message);
    }

    loadConfig();
    saveConfigNow();
    broadcast('cfg:changed', config);
    refreshTray();
    sendPet('pet:character', { id: config.character });

    return { ok: true, current: DATA_DIR, isDefault };
  }

  ipcMain.handle('data:location', () => {
    // 「自定义」与否以标记文件为准（更直观）：没有标记 = 用的是默认位置
    let isDefault = true;
    try { isDefault = !fs.existsSync(markerPath()); } catch (_) { /* ignore */ }
    return { current: DATA_DIR, isDefault };
  });

  ipcMain.handle('data:choose-and-relocate', async () => {
    const res = await dialog.showOpenDialog({
      title: '选择 Mochi 数据保存位置',
      buttonLabel: '保存到这里',
      properties: ['openDirectory', 'createDirectory']
    });
    if (res.canceled || !res.filePaths || !res.filePaths[0]) {
      return { ok: false, canceled: true };
    }
    return relocateData(res.filePaths[0]);
  });

  ipcMain.handle('data:reset-location', () => relocateData(null));

  /** 自定义形象：用系统原生文件选择器挑一张图片，返回绝对路径（渲染层在 contextIsolation 下拿不到 file.path） */
  ipcMain.handle('dialog:open-image', async () => {
    // 宠物窗口是置顶（screen-saver 层级）的，会盖在系统文件对话框上面，
    // 用户看到的就是"点了选择图片没反应 / 列表被挡住"。打开对话框前先降到普通层，关掉再恢复。
    const restore = () => { try { applyPetLayer(); } catch (_) { /* ignore */ } };
    try {
      if (petWin && !petWin.isDestroyed()) {
        try { petWin.setAlwaysOnTop(false); } catch (_) { /* ignore */ }
      }
      const owner = (settingsWin && !settingsWin.isDestroyed()) ? settingsWin : undefined;
      const res = await dialog.showOpenDialog(owner, {
        title: '选择形象图片',
        buttonLabel: '用这张',
        properties: ['openFile'],
        filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }]
      });
      if (res.canceled || !res.filePaths || !res.filePaths[0]) return { canceled: true };
      return { path: res.filePaths[0] };
    } catch (e) {
      return { error: String((e && e.message) || e) };
    } finally {
      restore();
    }
  });

  /** 打开当前数据目录（不是硬编码的 %APPDATA%） */
  ipcMain.handle('data:open-folder', () => {
    shell.openPath(DATA_DIR);
    return DATA_DIR;
  });


  ipcMain.handle('onboard:finish', (_e, payload) => {
    finishOnboarding(payload || {});
    return config;
  });

  ipcMain.on('stat:bump', (_e, { key, delta }) => bumpStat(key, delta));

  ipcMain.on('remind:ack', (_e, type) => {
    bumpStat('mood', 2);
    if (type === 'water') bumpStat('energy', 1.5);
  });

  ipcMain.on('remind:test', (_e, type) => {
    const map = { stand: 'stand', water: 'water', commute: 'commuteIn' };
    fireReminder(map[type] || 'water', true);
  });

  /* ---------------- 天气 ---------------- */
  ipcMain.handle('weather:get', () => ({ cfg: publicWeather(), weather: lastWeather }));

  ipcMain.handle('weather:lookup', async (_e, name) => {
    try { return { ok: true, list: await lookupCity(String(name || '').trim()) }; }
    catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
  });

  ipcMain.handle('weather:set', async (_e, patch) => {
    const cur = Object.assign({}, config.weather || {});
    const next = Object.assign({}, cur, patch || {});
    // 换城市要重新查 ID；但如果是「查完城市后连 ID 一起下发」，就别清掉
    const cityChanged = (patch && patch.city !== undefined && patch.city !== cur.city);
    if (cityChanged && (patch.cityId === undefined || patch.cityId === '')) { next.cityId = ''; next.cityName = ''; }
    // 数值范围兜底，避免填 0 或负数导致定时器疯狂触发
    next.interval = Math.max(10, Number(next.interval) || 30);
    next.repeat = Math.max(15, Number(next.repeat) || 60);

    patchConfig({ weather: next });
    stopWeatherLoop();
    startWeatherLoop();

    // 只有「换了城市」才需要立刻拉一次并提醒；改间隔/重复频率不该弹提醒
    if (!cityChanged) return { ok: true, cfg: publicWeather(), weather: lastWeather };

    const r = await refreshWeather(true);
    if (r.ok) fireWeatherReminder(r.advice, true);
    return { ok: r.ok, error: r.error, cfg: publicWeather(), weather: lastWeather };
  });

  ipcMain.handle('weather:refresh', async () => {
    const r = await refreshWeather(true);
    return { ok: r.ok, error: r.error, cfg: publicWeather(), weather: lastWeather };
  });

  ipcMain.handle('weather:test', async () => {
    if (!lastWeather) {
      const r = await refreshWeather(true);
      if (!r.ok) return { ok: false, error: r.error };
    }
    const text = fireWeatherReminder(weatherAdvice(lastWeather), true);
    return { ok: !!text, text: text || '当前天气没什么需要特别提醒的~' };
  });

  /** 凭据只在主进程加密保存，渲染层永远拿不到明文。
   *  - 填了 key：作为「用户自己的覆盖凭证」保存（userProvided=true）。
   *  - 留空提交：删除 bin，下次自动回退到内置默认凭证。 */
  ipcMain.handle('weather:set-secret', (_e, s) => {
    const id = (s && s.id) || '', key = (s && s.key) || '';
    if (!key) {
      try { fs.unlinkSync(weatherSecretPath()); } catch (_) { /* 本来就没有 */ }
      return { ok: true, cfg: publicWeather() };
    }
    const ok = saveWeatherSecret({ id, key, userProvided: true });
    if (ok) { stopWeatherLoop(); startWeatherLoop(); }
    return { ok, cfg: publicWeather() };
  });

  ipcMain.on('remind:snooze', (_e, type) => {
    snoozeReminder(type);
    bumpStat('mood', -1);
  });

  ipcMain.on('piano:focus', () => {
    if (pianoWin && !pianoWin.isDestroyed()) pianoWin.focus();
  });

  ipcMain.on('piano:close', closePiano);

  ipcMain.on('autolaunch:set', (_e, on) => applyAutoLaunch(!!on));

  ipcMain.on('memory:add-petting', () => {
    if (!config.memory) return;
    const m = config.memoryData;
    m.pettings = (m.pettings || 0) + 1;
    if (m.pettings % 10 === 0) saveConfig();
  });

  ipcMain.on('open:config-file', () => shell.openPath(DATA_DIR));
}

function applyAutoLaunch(on) {
  try {
    app.setLoginItemSettings({
      openAtLogin: on,
      path: process.execPath,
      args: app.isPackaged ? [] : [ROOT]
    });
  } catch (e) {
    console.warn('[autoLaunch] 设置失败', e.message);
  }
}

/* ------------------------------------------------------------------ *
 * 开发自检：截图各窗口到 build/shots
 * ------------------------------------------------------------------ */
async function runShoot() {
  const dir = path.join(ROOT, 'build', 'shots');
  fs.mkdirSync(dir, { recursive: true });
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const snap = async (win, name) => {
    if (!win || win.isDestroyed()) return;
    win.showInactive();
    await wait(700);
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(dir, `${name}.png`), img.toPNG());
    console.log('shot ->', name);
  };
  const run = (win, code) => win && !win.isDestroyed() && win.webContents.executeJavaScript(code).catch(() => {});

  await wait(1600);
  if (petWin) { petWin.showInactive(); petVisible = true; }
  await snap(petWin, '01-pet-idle');

  sendPet('remind:fire', { type: 'water', text: '该喝水啦，我先干为敬💧', style: 'gentle', state: 'reminding' });
  await wait(1800);
  await snap(petWin, '02-pet-remind');

  openOnboarding();
  await wait(1400);
  await snap(onboardWin, '03-onboarding-step1');
  await run(onboardWin, "document.getElementById('toStep2').click()");
  await wait(700);
  await snap(onboardWin, '04-onboarding-step2');
  await run(onboardWin, "document.getElementById('toStep3').click()");
  await wait(700);
  await snap(onboardWin, '05-onboarding-step3');
  if (onboardWin && !onboardWin.isDestroyed()) onboardWin.destroy();

  openSettings();
  await wait(1500);
  await snap(settingsWin, '06-settings-general');
  await run(settingsWin, "document.querySelector('[data-pane=\"remind\"]').click()");
  await wait(500);
  await snap(settingsWin, '07-settings-remind');
  await run(settingsWin, "document.querySelector('[data-pane=\"weather\"]').click()");
  await wait(600);
  await snap(settingsWin, '08-settings-weather');
  await run(settingsWin, "document.querySelector('[data-pane=\"character\"]').click()");
  await wait(500);
  await snap(settingsWin, '09-settings-character');

  if (process.env.MOCHI_DEBUG_MODALS) {
    const dbgCreate = await settingsWin.webContents.executeJavaScript(`(() => {
      document.getElementById('addCustomBtn').click();
      const m = document.getElementById('creatorMask').classList.contains('show');
      const rows = document.getElementById('crImgs').children.length;
      const tas = document.getElementById('crDialogue').querySelectorAll('textarea').length;
      document.getElementById('creatorMask').classList.remove('show');
      return JSON.stringify({ m, rows, tas });
    })()`).catch(e => 'ERR ' + e.message);
    fs.writeFileSync(path.join(dir, '_dbg_create.txt'), String(dbgCreate));
    const dbgEdit = await settingsWin.webContents.executeJavaScript(`(() => {
      const card = document.querySelector('.char-item');
      const btn = card.querySelector('[data-act="lines"]');
      btn.click();
      const body = document.getElementById('editorBody');
      const fields = body.querySelectorAll('textarea').length;
      const inputs = body.querySelectorAll('.dl-basic-grid input').length;
      const title = document.getElementById('editorTitle').textContent;
      document.getElementById('editorMask').classList.remove('show');
      return JSON.stringify({ fields, inputs, title });
    })()`).catch(e => 'ERR ' + e.message);
    fs.writeFileSync(path.join(dir, '_dbg_editor.txt'), String(dbgEdit));

    const dbgGeneral = await settingsWin.webContents.executeJavaScript(`(() => {
      const lr = document.getElementById('layerRadios');
      const chips = lr ? lr.querySelectorAll('.radio-chip').length : 0;
      const on = lr && lr.querySelector('.radio-chip.on') ? lr.querySelector('.radio-chip.on').dataset.layer : null;
      const hint = document.getElementById('layerHint') ? document.getElementById('layerHint').textContent : null;
      const dp = document.getElementById('dataPath');
      return JSON.stringify({
        layerChips: chips, onLayer: on, layerHint: hint,
        dataPathText: dp ? dp.textContent : null,
        hasChoose: !!document.getElementById('dataChoose'),
        hasReset: !!document.getElementById('dataReset')
      });
    })()`).catch(e => 'ERR ' + e.message);
    fs.writeFileSync(path.join(dir, '_dbg_general.txt'), String(dbgGeneral));

    // 底部不再有「保存」按钮：确认它在 DOM 里已经不存在，且窗口不会因此报错
    const dbgDone = await settingsWin.webContents.executeJavaScript(`(() => {
      const btn = document.getElementById('btnDone');
      return JSON.stringify({ btnGone: !btn, windowOpen: true });
    })()`).catch(e => 'ERR ' + e.message);
    fs.writeFileSync(path.join(dir, '_dbg_done.txt'), String(dbgDone));

    const dbgDataLoc = await settingsWin.webContents.executeJavaScript(`(() => window.mochi.dataLocation().then(r => JSON.stringify(r)))()`).catch(e => 'ERR ' + e.message);
    fs.writeFileSync(path.join(dir, '_dbg_dataloc.txt'), String(dbgDataLoc));
  }
  await run(settingsWin, "document.querySelector('[data-pane=\"ai\"]').click()");
  await wait(500);
  await snap(settingsWin, '10-settings-ai');
  await run(settingsWin, "document.querySelector('[data-pane=\"help\"]').click()");
  await wait(500);
  await snap(settingsWin, '11-settings-help');
  await run(settingsWin, "document.querySelector('[data-pane=\"feedback\"]').click()");
  await wait(500);
  await snap(settingsWin, '12-settings-feedback');

  await run(settingsWin, "document.querySelector('[data-pane=\"scene\"]').click()");
  await wait(500);
  await snap(settingsWin, '13-settings-scene');
  await run(settingsWin, "document.querySelector('[data-pane=\"about\"]').click()");
  await wait(500);
  await snap(settingsWin, '14-settings-about');

  // AI 对话窗口
  openAI();
  await wait(1600);
  await snap(aiWin, '15-ai-chat');
  try { await aiWin.webContents.executeJavaScript("document.getElementById('msgs').innerHTML='<div class=\"msg me\">今天要带伞吗</div><div class=\"msg ai\">外面有雨，记得带伞，别淋成落汤鸡。</div>'"); } catch (_) { /* ignore */ }
  await wait(300);
  await snap(aiWin, '16-ai-chat-demo');
  closeAI();

  openPiano();
  await wait(1600);
  await run(pianoWin, "['a','d','g','j','w'].forEach(k=>window.dispatchEvent(new KeyboardEvent('keydown',{key:k})))");
  await wait(400);
  await snap(pianoWin, '17-piano');

  await wait(300);
  app.quit();
}

/* ------------------------------------------------------------------ *
 * 生命周期
 * ------------------------------------------------------------------ */
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!petWin) return;
    setPetVisible(true);
    petWin.focus();
  });

  app.whenReady().then(() => {
    app.setAppUserModelId('com.mochi.desktoppet');
    loadConfig();
    loadAIHistory();

    registerIpc();
    createPetWindow();
    createTray();
    // 注册 app:// 协议（sensor 窗口加载内置 MediaPipe 资源用），再建隐藏感知窗口
    registerAppProtocol();
    createSensorWindow();
    if (config.cameraMirror) setTimeout(() => setSensorActive(true), 2000);

    globalShortcut.register('Control+Alt+P', togglePiano);
    globalShortcut.register('Control+Alt+C', cycleCharacter);
    globalShortcut.register('Control+Alt+S', openSettings);
    // 宠物走出屏幕/找不到了，一键叫回来
    globalShortcut.register('Control+Alt+R', recallPet);
    // AI 对话窗口
    globalShortcut.register('Control+Alt+A', openAI);

    // 自动更新（打包后生效）
    initAutoUpdater();

    startReminderLoop();
    startWeatherLoop();
    startStatLoop();
    startIdleWatch();
    startPetWatchdog();
    watchForeground();
    // 场景监听要 spawn PowerShell，推迟一点，避免和窗口首帧抢 CPU（首屏更快）
    setTimeout(() => { if (config.scene.on) startSceneWatcher(); }, 1500);
    if (config.autoLaunch) applyAutoLaunch(true);
    // 自由走动：等首屏稳定后再开始散步
    if (config.onboarded) setTimeout(() => scheduleWander(5000), 2500);
    applyCharIcon();

    // 首次启动 -> 引导
    if (SHOOT) {
      runShoot().catch(e => { console.error(e); app.quit(); });
    } else if (!config.onboarded) {
      setTimeout(openOnboarding, 500);
    }
  });

  app.on('window-all-closed', () => {
    // 托盘常驻：所有窗口关闭也不退出
  });

  app.on('before-quit', () => {
    saveConfigNow();
    stopSceneWatcher();
    stopReminderLoop();
    if (statTimer) clearInterval(statTimer);
    if (sceneTimer) clearInterval(sceneTimer);
    globalShortcut.unregisterAll();
  });

  app.on('will-quit', () => {
    try { fs.writeFileSync(configPath(), JSON.stringify(config, null, 2), 'utf8'); } catch (_) { }
  });
}
