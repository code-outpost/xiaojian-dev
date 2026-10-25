'use strict';
/**
 * 渲染进程 <-> 主进程 的安全桥（contextIsolation 开启，不暴露 Node）
 */
const { contextBridge, ipcRenderer } = require('electron');

const invoke = (ch, ...args) => ipcRenderer.invoke(ch, ...args);
const send = (ch, ...args) => ipcRenderer.send(ch, ...args);

const EVENTS = [
  'cfg:changed',
  'scene:current',
  'scene:update',
  'remind:fire',
  'activity:change',
  'stats:update',
  'pet:say',
  'pet:character',
  'pet:mode',
  'pet:walk',
  'pet:hi',
  'weather:update',
  'settings:goto',
  'update:notice'
];

contextBridge.exposeInMainWorld('mochi', {
  /* 配置 */
  getConfig: () => invoke('cfg:get'),
  patchConfig: patch => invoke('cfg:patch', patch),
  resetConfig: () => invoke('cfg:reset'),
  appInfo: () => invoke('app:info'),

  /* 场景 */
  sceneNow: () => invoke('scene:now'),

  /* 宠物窗口 */
  petBounds: () => invoke('pet:get-bounds'),
  setPetPos: (x, y) => send('pet:set-pos', { x, y }),
  dragStart: () => send('pet:drag-start'),
  dragEnd: () => send('pet:drag-end'),
  setIgnoreMouse: ignore => send('pet:ignore-mouse', !!ignore),
  showPetMenu: () => send('pet:menu'),

  /* 窗口 */
  openWindow: name => send('win:open', name),
  closeSelf: () => send('win:close'),
  minimizeSelf: () => send('win:minimize'),
  quit: () => send('app:quit'),

  /* 角色 */
  setCharacter: id => send('char:set', id),
  cycleCharacter: () => send('char:cycle'),
  finishOnboarding: payload => invoke('onboard:finish', payload),

  /* 自定义形象 */
  addCustom: def => invoke('custom:add', def),
  updateCustom: def => invoke('custom:update', def),
  removeCustom: id => invoke('custom:remove', id),
  pickImage: () => invoke('dialog:open-image'),

  /* AI 对话（默认免费接口；也支持用户自带 OpenAI 兼容接口，Key 只在主进程加密保存） */
  aiGet: () => invoke('ai:get'),
  aiSet: patch => invoke('ai:set', patch),
  aiSetSecret: s => invoke('ai:set-secret', s),
  aiChat: text => invoke('ai:chat', text),
  aiClear: () => invoke('ai:clear'),
  openAI: () => send('ai:open'),
  closeAI: () => send('ai:close'),

  /* 用户反馈（提交后发到作者邮箱） */
  sendFeedback: payload => invoke('feedback:send', payload),

  /* 检查更新（electron-updater） */
  checkUpdate: () => invoke('update:check'),
  updateAction: action => invoke('update:action', action),
  // 页面监听注册完成后报到，主进程据此补发暂存的提示（避免新窗口丢消息）
  uiReady: () => send('ui:ready'),

  /* 天气（和风天气；凭据只在主进程加密保存，这里只拿天气结果） */
  weatherGet: () => invoke('weather:get'),
  weatherLookup: name => invoke('weather:lookup', name),
  weatherSet: patch => invoke('weather:set', patch),
  weatherRefresh: () => invoke('weather:refresh'),
  weatherTest: () => invoke('weather:test'),
  weatherSetSecret: s => invoke('weather:set-secret', s),

  /* 数值与互动 */
  bumpStat: (key, delta) => send('stat:bump', { key, delta }),
  addPetting: () => send('memory:add-petting'),

  /* 提醒 */
  ackReminder: type => send('remind:ack', type),
  snoozeReminder: type => send('remind:snooze', type),
  testReminder: type => send('remind:test', type),

  /* 钢琴 */
  focusPiano: () => send('piano:focus'),
  closePiano: () => send('piano:close'),

  /* 系统 */
  setAutoLaunch: on => send('autolaunch:set', !!on),
  openConfigFolder: () => send('open:config-file'),

  /* 数据保存位置（可自定义，不再强制 C 盘） */
  dataLocation: () => invoke('data:location'),
  chooseAndRelocate: () => invoke('data:choose-and-relocate'),
  resetDataLocation: () => invoke('data:reset-location'),

  /* 事件订阅，返回取消函数 */
  on(channel, cb) {
    if (!EVENTS.includes(channel)) return () => {};
    const handler = (_e, payload) => cb(payload);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  }
});
