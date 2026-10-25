#!/usr/bin/env python3
"""校验 exe 内嵌图标是否真的可用，并把最大帧导出成 PNG 方便肉眼确认。

判断标准（缺一不可）：
  1. 存在 RT_GROUP_ICON（id=14）与 RT_ICON（id=3）；
  2. GROUP_ICON 里每个条目指向的 RT_ICON 帧长度与条目声明一致；
  3. 每帧数据必须以合法的 BITMAPINFOHEADER（biSize=40）或 PNG 签名开头
     —— 曾经因为 ICO 目录步长算错，帧数据整体错位 28 字节，
     资源"看起来存在"但系统渲染不出图标。

用法：python scripts/verify_icon.py dist/Mochi-Standalone.exe [...]
"""
import io
import os
import struct
import sys

import pefile
from PIL import Image


def load_icon_bytes(pe):
    icons, group = {}, None
    if not hasattr(pe, 'DIRECTORY_ENTRY_RESOURCE'):
        return icons, group
    for e in pe.DIRECTORY_ENTRY_RESOURCE.entries:
        if e.struct.Id == 3:
            for d in e.directory.entries:
                for l in d.directory.entries:
                    icons[d.struct.Id] = pe.get_data(l.data.struct.OffsetToData, l.data.struct.Size)
        elif e.struct.Id == 14:
            for d in e.directory.entries:
                for l in d.directory.entries:
                    group = pe.get_data(l.data.struct.OffsetToData, l.data.struct.Size)
    return icons, group


def build_ico(group, icons):
    """按 GROUP_ICON 声明的顺序重新拼一个 .ico（不依赖资源里的偏移，只用帧数据）。"""
    count = struct.unpack('<H', group[4:6])[0]
    entries, datas = [], []
    for i in range(count):
        b = group[6 + i * 14: 6 + (i + 1) * 14]
        w, h, _cc, _r, _pl, bpp, size, idx = struct.unpack('<BBBBHHIH', b)
        data = icons.get(idx)
        if data is None:
            return None, f'缺少 RT_ICON id={idx}'
        entries.append((w or 256, h or 256, bpp, len(data), data))
    out = io.BytesIO()
    out.write(struct.pack('<HHH', 0, 1, len(entries)))
    offset = 6 + 16 * len(entries)
    for (w, h, bpp, size, data) in entries:
        out.write(struct.pack('<BBBBHHII', 0 if w >= 256 else w, 0 if h >= 256 else h,
                              0, 0, 1, bpp, size, offset))
        offset += size
        datas.append(data)
    for d in datas:
        out.write(d)
    return out.getvalue(), None


def check(path):
    ok = True
    pe = pefile.PE(path, fast_load=True)
    pe.parse_data_directories(directories=[pefile.DIRECTORY_ENTRY['IMAGE_DIRECTORY_ENTRY_RESOURCE']])
    icons, group = load_icon_bytes(pe)
    print(f'== {os.path.basename(path)}')
    if not icons or not group:
        print('   ✗ 没有任何图标资源')
        return False

    count = struct.unpack('<H', group[4:6])[0]
    print(f'   RT_ICON {len(icons)} 帧 / GROUP_ICON 声明 {count} 项')
    for i in range(count):
        b = group[6 + i * 14: 6 + (i + 1) * 14]
        w, h, _cc, _r, _pl, bpp, size, idx = struct.unpack('<BBBBHHIH', b)
        data = icons.get(idx, b'')
        head = data[:8].hex()
        if len(data) != size:
            print(f'   ✗ {w or 256}x{h or 256}: 长度不符 {len(data)} != {size}')
            ok = False
            continue
        if data[:4] == b'\x00\x00\x00\x00':
            print(f'   ✗ {w or 256}x{h or 256}: 帧数据错位（头部为 0），系统无法渲染')
            ok = False
            continue
        valid = data[:4] == struct.pack('<I', 40) or data[:8] == b'\x89PNG\r\n\x1a\n'
        if not valid:
            print(f'   ✗ {w or 256}x{h or 256}: 非 BMP/PNG 帧 {head}')
            ok = False
            continue
        print(f'   ✓ {w or 256:>3}x{h or 256:<3} bpp={bpp} {size:>7}B  {head}')

    ico, err = build_ico(group, icons)
    if err:
        print('   ✗', err)
        return False
    try:
        im = Image.open(io.BytesIO(ico))
        im.size = max(im.ico.sizes())
        im.load()
        out = os.path.join(os.environ.get('TEMP', '.'), f'exe-icon-{os.path.basename(path)}.png')
        im.convert('RGBA').save(out)
        print(f'   ✓ 最大帧可渲染 {im.size} → {out}')
    except Exception as e:  # noqa: BLE001
        print(f'   ✗ 渲染失败: {e}')
        ok = False
    return ok


if __name__ == '__main__':
    results = [check(p) for p in sys.argv[1:]]
    print('\n结论:', '全部通过' if all(results) else '存在问题')
    sys.exit(0 if all(results) else 1)
