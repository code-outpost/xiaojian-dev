'use strict';
/**
 * 摄像头手势感知窗口（隐藏运行）
 * 取摄像头流 → 用 MediaPipe Hands 实时得到 21 个手部关键点 → 压缩成语义手势
 * → 经 IPC 发给主进程，再由主进程转发给宠物窗口，实现「你手怎么动它就怎么动」。
 * MediaPipe 运行时从 CDN 动态加载；若离线/加载失败，自动降级（不阻塞宠物存活）。
 */
(() => {
  const ipc = window.mochi;
  const video = document.getElementById('cam');
  // ⚠️ 别改名回 dbg：Emscripten 的 wasm 加载器用 `typeof dbg !== "undefined"` 判断是否调用调试钩子，
  // 而带 id 的元素会自动成为 window.dbg → 它会把 DOM 元素当函数调 → "dbg is not a function"。
  const dbg = document.getElementById('sensorDbg');

  let stream = null;
  let landmarker = null;
  let active = false;
  let running = false;
  let lastSent = 0;

  // 优先内置资源（经 app:// 协议加载，彻底离线、不受墙/CDN 影响）；失败再回退 CDN
  const LOCAL = {
    lib: './vendor/vision_bundle.mjs',
    wasm: './vendor/wasm',
    model: './vendor/hand_landmarker.task'
  };
  const CDN = {
    lib: 'https://unpkg.com/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs',
    wasm: 'https://unpkg.com/@mediapipe/tasks-vision@0.10.14/wasm',
    model: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task'
  };

  let curStatus = '';
  function sendStatus(s) {
    if (s === curStatus) return;   // 状态没变就别每帧刷 IPC
    curStatus = s;
    ipc.sendSensorStatus(s);
    dbg.textContent = s;
  }

  async function loadLandmarker(src, delegate) {
    const vision = await import(/* @vite-ignore */ src.lib);
    const { HandLandmarker, FilesetResolver } = vision;
    const fileset = await FilesetResolver.forVisionTasks(src.wasm);
    return await HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: src.model, delegate },
      runningMode: 'VIDEO',
      numHands: 1,
      // ⚠️ 高敏感：默认 0.5 太保守，光线一般 / 手稍远 / 半遮挡就检测不到。
      // 降到 0.3 让模型更「愿意」认定这是一只手。
      minHandDetectionConfidence: 0.3,
      minHandPresenceConfidence: 0.3,
      minTrackingConfidence: 0.3
    });
  }

  // 顺序：内置 CPU → 内置 GPU → CDN CPU → CDN GPU。
  // ⚠️ 先试 CPU 而不是 GPU：这个窗口藏在屏幕外，WebGL 上下文随时可能丢失，
  // GPU delegate 会在运行中突然全部报错；CPU 没有这个问题，1 只手 30fps 完全够。
  const ATTEMPTS = [
    { src: LOCAL, delegate: 'CPU' }, { src: LOCAL, delegate: 'GPU' },
    { src: CDN, delegate: 'CPU' }, { src: CDN, delegate: 'GPU' }
  ];
  let usedAttempt = 0;

  async function ensureModel() {
    if (landmarker) return true;
    for (let i = 0; i < ATTEMPTS.length; i++) {
      const a = ATTEMPTS[i];
      try {
        landmarker = await loadLandmarker(a.src, a.delegate);
        usedAttempt = i;
        console.log('[sensor] 模型就绪：', a.src === LOCAL ? '内置' : 'CDN', a.delegate);
        return true;
      } catch (e) {
        console.warn('[sensor] 模型加载失败', a.src === LOCAL ? '内置' : 'CDN', a.delegate, e && e.message);
      }
    }
    sendStatus('unavailable');
    return false;
  }

  /** 连续多帧失败 → 多半是 GPU 上下文丢了，换下一种组合重建一次 */
  let rebuilding = false;
  async function rebuildModel() {
    if (rebuilding) return;
    rebuilding = true;
    try {
      try { if (landmarker && landmarker.close) landmarker.close(); } catch (_) {}
      landmarker = null;
      const rest = ATTEMPTS.filter((_, i) => i !== usedAttempt);
      for (const a of rest) {
        try {
          landmarker = await loadLandmarker(a.src, a.delegate);
          errors = 0;
          console.log('[sensor] 已重建模型：', a.src === LOCAL ? '内置' : 'CDN', a.delegate);
          return;
        } catch (e) { console.warn('[sensor] 重建失败', a.delegate, e && e.message); }
      }
      sendStatus('unavailable');
    } finally {
      rebuilding = false;
    }
  }

  async function ensureCamera() {
    if (stream) return true;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio: false });
      video.srcObject = stream;
      await video.play().catch(() => {});
      return true;
    } catch (e) {
      console.error('[sensor] 摄像头打开失败', e);
      sendStatus(e && e.name === 'NotAllowedError' ? 'denied' : 'nocamp');
      return false;
    }
  }

  /**
   * 识别循环。
   * ⚠️ 用 setInterval 而不是 requestAnimationFrame：这个窗口被主进程移到 -3000,-3000 藏起来，
   * Chromium 会认为它被遮挡而**停止 rAF**（合成器不产帧），模型再好也一帧都跑不了。
   * setInterval 配合窗口的 backgroundThrottling:false 才能稳定出帧。
   */
  let timer = 0;
  let wdTimer = 0;
  let frames = 0;      // 已成功识别的帧数
  let errors = 0;      // 连续失败帧数
  let lastFrameAt = 0;
  let lastHandAt = 0;
  let startAt = 0;

  function tick() {
    if (!running) return;
    // 窗口被藏到屏幕外，Chromium 有可能把 video 当「不可见」而暂停解码 → 主动拉起来
    if (video.paused) { try { video.play().catch(() => {}); } catch (_) {} }
    if (landmarker && video.readyState >= 2 && video.videoWidth > 0) {
      try {
        const res = landmarker.detectForVideo(video, performance.now());
        const hands = res && res.landmarks ? res.landmarks : [];
        const g = window.LiveGesture.analyze(hands);
        frames++;
        errors = 0;
        lastFrameAt = performance.now();
        const now = lastFrameAt;
        if (now - lastSent > 60 || (g.present && now - lastSent > 30)) { // 有手时跟得更紧
          lastSent = now;
          ipc.sendSensorHand(g);
        }
        // 让用户能一眼看出「它看见我的手了」：识别到手 → tracking；
        // 手离开 1.2s 才回到 active（留点缓冲，避免手一抖就闪）
        if (g.present) { lastHandAt = now; sendStatus('tracking'); }
        else if (now - lastHandAt > 1200) sendStatus('active');
      } catch (e) {
        errors++;
        if (errors === 10) console.warn('[sensor] 连续识别失败：', e && e.message);
        if (errors >= 20) { errors = 0; rebuildModel(); }
      }
    }
  }

  /** 看门狗：摄像头开着却一直没画面 / 一直没识别，要如实告诉用户，别一直挂着「已连接」 */
  function watchdog() {
    if (!running) return;
    const now = performance.now();
    if (frames === 0 && now - startAt > 4000) {
      sendStatus(video.readyState >= 2 ? 'noface' : 'noframe');
    } else if (frames > 0 && now - lastFrameAt > 3000) {
      sendStatus('noframe');   // 之前能动，现在卡住了
    }
  }

  async function start() {
    if (active) return;
    active = true;
    sendStatus('starting');
    const okCam = await ensureCamera();
    if (!okCam) { active = false; return; }
    const okModel = await ensureModel();
    if (!okModel) { active = false; return; }
    frames = 0;
    startAt = performance.now();
    lastFrameAt = startAt;
    sendStatus('active');
    if (!running) {
      running = true;
      timer = setInterval(tick, 33);      // ~30fps
      wdTimer = setInterval(watchdog, 1500);
    }
  }

  function stop() {
    active = false;
    running = false;
    if (timer) { clearInterval(timer); timer = 0; }
    if (wdTimer) { clearInterval(wdTimer); wdTimer = 0; }
    if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
    ipc.sendSensorHand({ present: false });
    sendStatus('idle');
  }

  ipc.onSensorControl((on) => { if (on) start(); else stop(); });
  // 启动即询问状态（便于设置页显示）
  sendStatus('idle');
})();
