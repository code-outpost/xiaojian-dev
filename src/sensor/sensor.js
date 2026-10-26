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
  const dbg = document.getElementById('dbg');

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

  function sendStatus(s) { ipc.sendSensorStatus(s); dbg.textContent = s; }

  async function loadLandmarker(src, delegate) {
    const vision = await import(/* @vite-ignore */ src.lib);
    const { HandLandmarker, FilesetResolver } = vision;
    const fileset = await FilesetResolver.forVisionTasks(src.wasm);
    return await HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: src.model, delegate },
      runningMode: 'VIDEO',
      numHands: 1
    });
  }

  async function ensureModel() {
    if (landmarker) return true;
    const attempts = [
      { src: LOCAL, delegate: 'GPU' }, { src: LOCAL, delegate: 'CPU' },
      { src: CDN, delegate: 'GPU' }, { src: CDN, delegate: 'CPU' }
    ];
    for (const a of attempts) {
      try {
        landmarker = await loadLandmarker(a.src, a.delegate);
        console.log('[sensor] 模型就绪：', a.src === LOCAL ? '内置' : 'CDN', a.delegate);
        return true;
      } catch (e) {
        console.warn('[sensor] 模型加载失败', a.src === LOCAL ? '内置' : 'CDN', a.delegate, e && e.message);
      }
    }
    sendStatus('unavailable');
    return false;
  }

  async function ensureCamera() {
    if (stream) return true;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 240 }, audio: false });
      video.srcObject = stream;
      await video.play().catch(() => {});
      return true;
    } catch (e) {
      console.error('[sensor] 摄像头打开失败', e);
      sendStatus(e && e.name === 'NotAllowedError' ? 'denied' : 'nocamp');
      return false;
    }
  }

  async function loop() {
    if (!running) return;
    if (landmarker && video.readyState >= 2) {
      try {
        const res = landmarker.detectForVideo(video, performance.now());
        const hands = res && res.landmarks ? res.landmarks : [];
        const g = window.LiveGesture.analyze(hands);
        const now = performance.now();
        if (now - lastSent > 60) { // ~16fps
          lastSent = now;
          ipc.sendSensorHand(g);
        }
      } catch (_) { /* 单帧失败忽略 */ }
    }
    requestAnimationFrame(loop);
  }

  async function start() {
    if (active) return;
    active = true;
    sendStatus('starting');
    const okCam = await ensureCamera();
    if (!okCam) return;
    const okModel = await ensureModel();
    if (!okModel) return;
    sendStatus('active');
    if (!running) { running = true; loop(); }
  }

  function stop() {
    active = false;
    running = false;
    if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
    ipc.sendSensorHand({ present: false });
    sendStatus('idle');
  }

  ipc.onSensorControl((on) => { if (on) start(); else stop(); });
  // 启动即询问状态（便于设置页显示）
  sendStatus('idle');
})();
