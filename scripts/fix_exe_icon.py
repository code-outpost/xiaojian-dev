#!/usr/bin/env python3
"""修正 exe 里 RT_GROUP_ICON 的帧长度，使其与真实 RT_ICON 数据一致。

背景：rcedit 在写图标时，会把 GROUP_ICON 条目里的 bytesInRes 写成「压缩后」的长度
（128/256 帧常见），但实际写入 RT_ICON 的仍是原始 BMP 数据 —— 两边长度不一致，
Windows 按 GROUP_ICON 声明的长度去取数据，取到的就是被截断的帧，
表现为「小图标正常、大图标变成空白/默认图标」。

本脚本做的事很单纯：按 RT_ICON 的真实长度回填 GROUP_ICON 的 bytesInRes。
用法：python scripts/fix_exe_icon.py <exe> [更多exe...]
"""
import struct
import sys

import pefile

RT_ICON = 3
RT_GROUP_ICON = 14


def resource_data(pe):
    """返回 {rt: [(name_id, rva, size)]} 与 group 数据定位信息"""
    entries = {}
    if not hasattr(pe, 'DIRECTORY_ENTRY_RESOURCE'):
        return entries
    for e in pe.DIRECTORY_ENTRY_RESOURCE.entries:
        if e.struct.Id not in (RT_ICON, RT_GROUP_ICON):
            continue
        for d in e.directory.entries:
            for l in d.directory.entries:
                entries.setdefault(e.struct.Id, []).append(
                    (d.struct.Id, l.data.struct.OffsetToData, l.data.struct.Size))
    return entries


def fix(path):
    pe = pefile.PE(path)
    res = resource_data(pe)
    icons = res.get(RT_ICON, [])
    groups = res.get(RT_GROUP_ICON, [])
    if not icons or not groups:
        print(f'{path}: 没有图标资源，跳过')
        return False

    with open(path, 'r+b') as fh:
        changed = 0
        for (_gid, rva, size) in groups:
            off = pe.get_offset_from_rva(rva)
            fh.seek(off)
            blob = fh.read(size)
            count = struct.unpack('<H', blob[4:6])[0]
            icon_sizes = {iid: sz for (iid, _rva, sz) in icons}
            for i in range(count):
                rec = 6 + i * 14
                if rec + 14 > len(blob):
                    break
                declared = struct.unpack('<I', blob[rec + 8:rec + 12])[0]
                icon_id = struct.unpack('<H', blob[rec + 12:rec + 14])[0]
                actual = icon_sizes.get(icon_id)
                if actual is None:
                    print(f'{path}: ⚠ 找不到 RT_ICON id={icon_id}')
                    continue
                if declared != actual:
                    fh.seek(off + rec + 8)
                    fh.write(struct.pack('<I', actual))
                    changed += 1
                    print(f'{path}: id={icon_id} 帧长度 {declared} → {actual}')
        fh.flush()
    print(f'{path}: 修正 {changed} 项' if changed else f'{path}: 已一致，无需修正')
    return True


if __name__ == '__main__':
    ok = True
    for p in sys.argv[1:]:
        try:
            ok = fix(p) and ok
        except Exception as e:  # noqa: BLE001
            print(f'{p}: 失败 {e}')
            ok = False
    sys.exit(0 if ok else 1)
