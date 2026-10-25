# -*- coding: utf-8 -*-
"""
Mochi 素材预处理
1. 白底 -> 透明（从边框泛洪，保护角色内部的白色区域）
2. 边缘去白边（un-white 复原），避免深色壁纸下出现白描边
3. 近景帧归一化 + 底部对齐，保证 9 个状态切换时不跳动
4. 输出 512x512 透明 PNG，生成托盘/应用图标
"""
import os
import json

import cv2
import numpy as np
from PIL import Image, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))          # Mochi/
PACK = os.path.dirname(ROOT)                                                # 素材包根目录
SRC = os.path.join(PACK, "Assets")
DST = os.path.join(ROOT, "assets")

CHARS = ["cat", "dog", "blob", "xin", "sweet", "yu"]
STATES = {
    "01": "idle", "02": "typing", "03": "clicking", "04": "happy", "05": "sleepy",
    "06": "excited", "07": "petting", "08": "peek", "09": "reminding",
}

OUT = 512
CLOSEUP_RATIO = 1.20   # 超过中位数 1.2 倍视为近景帧，缩回中位大小


def bg_mask(rgb: np.ndarray) -> np.ndarray:
    """背景掩码：与画面四边连通的「白 / 浅灰」区域（含投影）"""
    f = rgb.astype(np.int16)
    mx = f.max(2)
    mn = f.min(2)
    sat = mx - mn
    cand = ((mn >= 202) & (sat <= 14)) | ((mn >= 238) & (sat <= 30))

    num, labels = cv2.connectedComponents(cand.astype(np.uint8), connectivity=8)
    border = set(labels[0, :].tolist()) | set(labels[-1, :].tolist()) \
        | set(labels[:, 0].tolist()) | set(labels[:, -1].tolist())
    border.discard(0)
    if not border:
        return np.zeros(cand.shape, dtype=bool)

    lut = np.zeros(num, dtype=bool)
    for lb in border:
        lut[lb] = True
    return lut[labels]


def build_rgba(rgb: np.ndarray) -> np.ndarray:
    bg = bg_mask(rgb)
    f = rgb.astype(np.int16)
    mx, mn = f.max(2), f.min(2)
    sat = mx - mn

    alpha = np.where(bg, 0.0, 255.0)

    # 靠近背景的低饱和浅色像素 -> 半透明（吃掉残影/白边/投影碎屑）
    nearbg = np.array(
        Image.fromarray((bg * 255).astype(np.uint8), "L").filter(ImageFilter.MaxFilter(11))
    ) > 0
    ring = nearbg & ~bg
    neutral = ring & (sat <= 50)
    # 明显偏白的边界像素：判定为背景残留，直接透明
    alpha[neutral & (mn >= 222)] = 0.0
    # 中间调：按亮度给半透明，保留柔和边缘
    mid = neutral & (mn < 222) & (mn >= 180)
    alpha[mid] = 255.0 * np.clip((222.0 - mn[mid]) / 42.0, 0.0, 1.0)

    alpha = np.array(
        Image.fromarray(np.clip(alpha, 0, 255).astype(np.uint8), "L")
        .filter(ImageFilter.GaussianBlur(1.0))
    )

    # 兜底：贴着轮廓的白/浅灰残留（原图投影碎屑）——邻近大量透明像素时视为背景
    transp = (alpha < 18).astype(np.float32)
    frac = np.array(
        Image.fromarray((transp * 255).astype(np.uint8), "L").filter(ImageFilter.BoxBlur(3))
    ) / 255.0
    res = (alpha > 0) & (mn >= 198) & (sat <= 34) & (frac > 0.34)
    alpha[res] = 0

    # 贴边浅色残留（原图投影/白边）：不硬抠，用周围身体颜色内扩染色，任何壁纸下都不露白点
    light = (alpha > 0) & (mn >= 205) & (sat <= 55) & nearbg
    if light.any():
        bgr = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
        inpainted = cv2.inpaint(bgr, (light.astype(np.uint8) * 255), 4, cv2.INPAINT_TELEA)
        rgb = cv2.cvtColor(inpainted, cv2.COLOR_BGR2RGB)

    # 形态学开运算：剪掉剪影边缘的细尖刺（原图投影残留），保留胡须等有厚度的细节
    binm = (alpha > 60).astype(np.uint8)
    opened = cv2.morphologyEx(binm, cv2.MORPH_OPEN,
                              cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)))
    alpha = np.where(opened == 0, 0.0, alpha)

    # 边缘去白：observed = a*c + (1-a)*255  =>  c = (obs-(1-a)*255)/a
    a = (alpha.astype(np.float32) / 255.0)[..., None]
    obs = rgb.astype(np.float32)
    safe = np.clip(a, 1e-3, 1.0)
    c = (obs - (1.0 - a) * 255.0) / safe
    c = np.clip(c, 0, 255)
    out_rgb = np.where(a < 0.98, c, obs)      # 只修正半透明边缘像素
    return np.dstack([out_rgb, alpha]).astype(np.uint8)


def bbox(alpha: np.ndarray):
    ys, xs = np.where(alpha > 8)
    if len(xs) == 0:
        return None
    return int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())


def main():
    os.makedirs(DST, exist_ok=True)
    manifest = {}

    for ch in CHARS:
        src_dir = os.path.join(SRC, ch)
        out_dir = os.path.join(DST, ch)
        os.makedirs(out_dir, exist_ok=True)

        frames = []
        for fname in sorted(os.listdir(src_dir)):
            if not fname.lower().endswith(".png"):
                continue
            state = STATES.get(fname.split("-")[0])
            if not state:
                continue
            rgb = np.array(Image.open(os.path.join(src_dir, fname)).convert("RGB"))
            rgba = build_rgba(rgb)
            frames.append({"state": state, "rgba": rgba, "bb": bbox(rgba[..., 3])})

        heights = sorted([f["bb"][3] - f["bb"][1] for f in frames if f["bb"]])
        med = heights[len(heights) // 2]

        # 逐帧归一化：近景帧缩回中位高度
        norm = []
        for f in frames:
            x0, y0, x1, y1 = f["bb"]
            h = y1 - y0
            img = Image.fromarray(f["rgba"], "RGBA")
            if h > med * CLOSEUP_RATIO:
                s = med / h
                img = img.crop((x0, y0, x1 + 1, y1 + 1)).resize(
                    (max(1, int(img.width * s)), max(1, int(img.height * s))), Image.LANCZOS
                )
                a = np.array(img)[..., 3]
                nbb = bbox(a)
                full = Image.new("RGBA", (f["rgba"].shape[1], f["rgba"].shape[0]), (0, 0, 0, 0))
                full.paste(img, (x0, y0 + (h - img.height)), img)
                img = full
                norm.append({"state": f["state"], "img": img, "bb": (x0, y0 + h - img.height, x0 + img.width, y0 + h)})
                print(f"    normalize {ch}/{f['state']} h={h} -> {img.height} (med {med})")
            else:
                norm.append({"state": f["state"], "img": img, "bb": f["bb"]})

        boxes = [n["bb"] for n in norm]
        x0 = min(b[0] for b in boxes); x1 = max(b[2] for b in boxes)
        y0 = min(b[1] for b in boxes); y1 = max(b[3] for b in boxes)
        side = int(max(x1 - x0, y1 - y0) * 1.04)
        left = (x0 + x1) // 2 - side // 2
        top = y1 - side + int(side * 0.02)       # 底部留 2%，脚不贴边

        for n in norm:
            canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
            canvas.paste(n["img"].crop((left, top, left + side, top + side)), (0, 0))
            canvas.resize((OUT, OUT), Image.LANCZOS).save(
                os.path.join(out_dir, f"{n['state']}.png"), optimize=True
            )

        manifest[ch] = {
            "states": sorted(n["state"] for n in norm),
            "file": f"assets/{ch}/{{state}}.png",
            "crop": [left, top, side],
        }
        print(f"[{ch}] {len(norm)} states  crop={left},{top},{side}")

    with open(os.path.join(DST, "manifest.json"), "w", encoding="utf-8") as fp:
        json.dump(manifest, fp, ensure_ascii=False, indent=2)
    # 补充：每个角色 idle 帧的内容高度占比，供前端统一视觉高度
    for ch in CHARS:
        a = np.array(Image.open(os.path.join(DST, ch, "idle.png")).split()[-1])
        ys, xs = np.where(a > 40)
        ratio = (ys.max() - ys.min() + 1) / OUT
        manifest[ch]["visualRatio"] = round(float(ratio), 4)
    with open(os.path.join(DST, "manifest.json"), "w", encoding="utf-8") as fp:
        json.dump(manifest, fp, ensure_ascii=False, indent=2)
    make_icons()
    print("done ->", DST)


def make_icons():
    src = Image.open(os.path.join(DST, "cat", "idle.png")).convert("RGBA")
    src = src.crop(src.split()[3].getbbox())
    tray = Image.new("RGBA", (256, 256), (0, 0, 0, 0))
    s = 248 / max(src.size)
    r = src.resize((int(src.width * s), int(src.height * s)), Image.LANCZOS)
    tray.paste(r, ((256 - r.width) // 2, (256 - r.height) // 2), r)
    b = os.path.join(ROOT, "build")
    os.makedirs(b, exist_ok=True)
    tray.save(os.path.join(b, "tray.png"))
    tray.save(os.path.join(b, "icon.png"))
    # 生成 icon.ico：手动构造 BMP 编码帧（含 256），避免 PIL 把 256 帧编码为
    # PNG 导致 electron-builder 的 rcedit 写入失败（"Unable to commit changes"）。
    import make_icon
    make_icon.build(tray, os.path.join(b, "icon.ico"))
    print("icons ->", b)


if __name__ == "__main__":
    main()
