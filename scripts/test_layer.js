// 真机验证三种窗口层级：启动目录版 exe，预置配置，截图后检测宠物像素是否出现。
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const EXE = path.join(ROOT, 'dist', 'Mochi', 'Mochi.exe');
const PY = 'D:/Soft/Python/python.exe';
const TEMP = process.env.TEMP || os.tmpdir();

function base(level) {
  return {
    onboarded: true,
    character: 'cat',
    scene: { on: false },
    sound: false,
    water: { on: false },
    stand: { on: false },
    pomodoro: { on: false },
    layer: level,
    petPos: { x: 1100, y: 620 }
  };
}

function run(level) {
  const tmp = fs.mkdtempSync(path.join(TEMP, 'mochi-layer-'));
  fs.writeFileSync(path.join(tmp, 'mochi-config.json'), JSON.stringify(base(level), null, 2));
  const out = path.join(TEMP, `layer-${level}.png`);
  if (fs.existsSync(out)) fs.unlinkSync(out);

  const env = Object.assign({}, process.env);
  delete env.ELECTRON_RUN_AS_NODE;
  env.MOCHI_NO_GPU = '1'; // 沙箱无 GPU，强制软件渲染，否则 GPU 进程启动即崩

  const proc = require('child_process').spawn(EXE, [`--user-data-dir=${tmp}`], {
    env, stdio: 'ignore', detached: true
  });
  const pid = proc.pid;
  try {
    // 等 Electron 启动 + 窗口渲染完成（软件渲染较慢）
    execSync(`"${PY}" -c "import time; time.sleep(7)"`, { stdio: 'ignore' });
    execSync(`"${PY}" "${path.join(ROOT, 'scripts', 'screen_grab.py')}" "${out}"`, { stdio: 'ignore' });
  } catch (e) { /* ignore */ }
  // 关掉
  try { execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' }); } catch (e) {}
  return out;
}

// 裁剪右下区域并统计"非背景"的彩色像素（宠物通常偏粉/彩色）
function analyze(level) {
  const out = path.join(TEMP, `layer-${level}.png`);
  const crop = path.join(TEMP, `layer-crop-${level}.png`);
  try {
    execSync(`"${PY}" -c "
from PIL import Image
import os
im=Image.open(r'${out}').convert('RGB')
w,h=im.size
c=im.crop((int(w*0.62),int(h*0.45),w,h))
c.save(r'${crop}')
px=list(c.getdata())
# 统计饱和度高（彩色）的像素，宠物是彩色精灵，背景多为灰/白/单一色
import colorsys
colored=0
for (r,g,b) in px:
    mx=max(r,g,b); mn=min(r,g,b)
    if mx>60 and (mx-mn)>40: colored+=1
print('colored_ratio=%.4f' % (colored/len(px)))
"`);
  } catch (e) { console.log(level, 'analyze failed', e.message); }
}

const level = process.argv[2] || 'top';
console.log(`[${level}] 启动截图...`);
run(level);
analyze(level);
console.log(`[${level}] 完成 -> ${path.join(TEMP, `layer-${level}.png`)}`);
