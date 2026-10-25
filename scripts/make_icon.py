#!/usr/bin/env python3
"""
生成 electron-builder 可用、且 rcedit 能嵌入的 icon.ico。

背景：
- electron-builder 要求图标至少 256x256；
- 但其内部用 rcedit 写入 exe 资源，rcedit 无法处理「PNG 编码的 256 帧」ICO
  （报 "Unable to commit changes"）。
- 因此这里手动构造 ICO：所有帧（含 256）都用 BMP（BGRA + AND 掩码）编码，
  256 帧在 ICONDIRENTRY 里用 0 表示，rcedit / Windows 均可正常处理。

用法：python scripts/make_icon.py  [源png]  [输出ico]
默认源为 build/icon.png，输出为 build/icon.ico。
"""
import os
import struct
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "build", "icon.png")
OUT = os.path.join(ROOT, "build", "icon.ico")
SIZES = [16, 24, 32, 48, 64, 128, 256]


def bmp_frame(rgba):
    """把 RGBA 图像编码为 ICO 用的 BMP 帧（XOR BGRA + AND 掩码），返回 bytes。"""
    w, h = rgba.size
    # 转 BGRA，bottom-up（行倒序）
    px = rgba.convert("RGBA").load()
    xor = bytearray()
    for y in range(h - 1, -1, -1):
        row = bytearray()
        for x in range(w):
            r, g, b, a = px[x, y]
            row += bytes((b, g, r, a))
        # 每行 4 字节对齐（32bpp 已对齐）
        xor += row
    # AND 掩码：1bpp，bottom-up，全 0（透明度由 alpha 通道表达）
    and_w = (w + 31) // 32 * 4
    and_mask = b"\x00" * (and_w * h)
    xor_bytes = bytes(xor)
    # BITMAPINFOHEADER + 像素 + AND 掩码；biHeight = h*2 表示后面跟着 AND 掩码
    dib = struct.pack("<IiiHHIIiiII", 40, w, h * 2, 1, 32, 0, 0, 0, 0, 0, 0)
    return dib + xor_bytes + and_mask


def build(src_img, out_path):
    src = src_img.convert("RGBA")
    frames = []
    for s in SIZES:
        img = src.resize((s, s), Image.LANCZOS)
        frames.append((s, bmp_frame(img)))

    entries = b""
    data = b""
    # ICONDIR = 6 字节，每个 ICONDIRENTRY 固定 16 字节（曾误写成 12，
    # 会让每帧数据偏移整体前移 28 字节，exe 里嵌入的就是错位数据，
    # 表现为「exe 没有图标」）。
    offset = 6 + 16 * len(frames)
    for s, fb in frames:
        bwidth = 0 if s >= 256 else s
        bheight = 0 if s >= 256 else s
        entries += struct.pack("<BBBBHHII", bwidth, bheight, 0, 0, 1, 32, len(fb), offset + len(data))
        data += fb
    header = struct.pack("<HHH", 0, 1, len(frames))
    with open(out_path, "wb") as f:
        f.write(header + entries + data)
    print("wrote", out_path, "frames:", SIZES)


def main():
    build(Image.open(SRC).convert("RGBA"), OUT)


if __name__ == "__main__":
    if len(os.sys.argv) > 1:
        SRC = os.sys.argv[1]
    if len(os.sys.argv) > 2:
        OUT = os.sys.argv[2]
    main()
