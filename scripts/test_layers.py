"""真机验证「窗口层级」三档是否真的看得见（会真的把宠物显示在你的桌面上）。

流程：为每种层级写一份临时配置 → 启动应用 → 等它就绪 → 截屏 → 关闭。
只写临时目录（系统 TEMP 下），不碰真实配置。
"""
import json
import os
import subprocess
import sys
import tempfile
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ELECTRON = os.path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe')
GRAB = os.path.join(ROOT, 'scripts', 'screen_grab.py')
PY = 'D:/Soft/Python/python.exe'

env = dict(os.environ)
env.pop('ELECTRON_RUN_AS_NODE', None)

BASE = {
    'onboarded': True,
    'character': 'cat',
    'scene': {'on': False},
    'sound': False,
    'showStats': True,
    'scale': 1,
    'autoLaunch': False,
    'water': {'on': False, 'interval': 45},
    'stand': {'on': False, 'interval': 60},
    'pomodoro': {'on': False, 'focus': 25},
    'petPos': None
}


def kill_ours(tmp):
    """按命令行里的临时目录名杀掉本次启动的实例（避免误杀用户自己开的 Mochi）"""
    out = subprocess.run(
        ['wmic', 'process', 'where', "name='Mochi.exe'", 'get', 'processid,commandline'],
        capture_output=True, text=True)
    for line in out.stdout.splitlines():
        if tmp.replace('/', '\\') in line or tmp in line:
            pid = line.strip().rsplit(' ', 1)[-1]
            if pid.isdigit():
                subprocess.run(['taskkill', '/F', '/T', '/PID', pid],
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1.5)


def run(layer):
    tmp = tempfile.mkdtemp(prefix='mochi-layer-')
    cfg = dict(BASE, layer=layer)
    with open(os.path.join(tmp, 'mochi-config.json'), 'w', encoding='utf-8') as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)

    out = os.path.join(os.environ.get('TEMP', tempfile.gettempdir()),
                       f'layer-{layer}.png')
    if os.path.exists(out):
        os.remove(out)

    proc = subprocess.Popen(
        [ELECTRON, ROOT, f'--user-data-dir={tmp}'],
        env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        time.sleep(6)
        alive = subprocess.run(
            ['wmic', 'process', 'where', f"name='Mochi.exe' and commandline like '%{os.path.basename(tmp)}%'",
             'get', 'processid'],
            capture_output=True, text=True).stdout.count('ProcessId')
        print(f'[{layer}] 运行中的实例进程数: {alive}')
        subprocess.run([PY, GRAB, out], check=True)
        print(f'[{layer}] 截图 -> {out}')
    finally:
        kill_ours(tmp)
        try:
            proc.wait(timeout=5)
        except Exception:  # noqa: BLE001
            pass
    return out


if __name__ == '__main__':
    layers = sys.argv[1:] or ['top', 'ghost', 'bottom']
    for layer in layers:
        run(layer)
