"""用 Windows Shell API 取 exe 的「实际显示图标」并渲染成 PNG。
用于验证 exe 内嵌图标是否真的能被系统读取（等价于资源管理器看到的图标）。"""
import ctypes
from ctypes import wintypes
import sys, os

shell32 = ctypes.WinDLL('shell32', use_last_error=True)
user32 = ctypes.WinDLL('user32', use_last_error=True)
gdi32 = ctypes.WinDLL('gdi32', use_last_error=True)


class SHFILEINFOW(ctypes.Structure):
    _fields_ = [
        ('hIcon', wintypes.HICON),
        ('iIcon', ctypes.c_int),
        ('dwAttributes', wintypes.DWORD),
        ('szDisplayName', wintypes.WCHAR * 260),
        ('szTypeName', wintypes.WCHAR * 80),
    ]


SHGFI_ICON = 0x000000100
SHGFI_LARGEICON = 0x000000000
SHGFI_SMALLICON = 0x000000001


def shell_icon(path, large=True):
    info = SHFILEINFOW()
    flags = SHGFI_ICON | (SHGFI_LARGEICON if large else SHGFI_SMALLICON)
    r = shell32.SHGetFileInfoW(ctypes.c_wchar_p(path), 0, ctypes.byref(info),
                               ctypes.sizeof(info), flags)
    if not r or not info.hIcon:
        return None
    return info.hIcon


def hicon_to_png(hicon, out):
    from PIL import Image
    # 取图标尺寸
    class ICONINFO(ctypes.Structure):
        _fields_ = [('fIcon', wintypes.BOOL), ('xHotspot', wintypes.DWORD),
                    ('yHotspot', wintypes.DWORD), ('hbmMask', wintypes.HBITMAP),
                    ('hbmColor', wintypes.HBITMAP)]
    ii = ICONINFO()
    user32.GetIconInfo(hicon, ctypes.byref(ii))
    size = 256
    hdc = user32.GetDC(None)
    mdc = gdi32.CreateCompatibleDC(hdc)
    bmp = gdi32.CreateCompatibleBitmap(hdc, size, size)
    gdi32.SelectObject(mdc, bmp)
    # 白色背景
    brush = gdi32.CreateSolidBrush(0x00FFFFFF)
    rect = wintypes.RECT(0, 0, size, size)
    user32.FillRect(mdc, ctypes.byref(rect), brush)
    ok = user32.DrawIconEx(mdc, 0, 0, hicon, size, size, 0, None, 0x0003)

    class BITMAPINFOHEADER(ctypes.Structure):
        _fields_ = [('biSize', wintypes.DWORD), ('biWidth', ctypes.c_long),
                    ('biHeight', ctypes.c_long), ('biPlanes', wintypes.WORD),
                    ('biBitCount', wintypes.WORD), ('biCompression', wintypes.DWORD),
                    ('biSizeImage', wintypes.DWORD), ('biXPelsPerMeter', ctypes.c_long),
                    ('biYPelsPerMeter', ctypes.c_long), ('biClrUsed', wintypes.DWORD),
                    ('biClrImportant', wintypes.DWORD)]

    bi = BITMAPINFOHEADER()
    bi.biSize = ctypes.sizeof(bi)
    bi.biWidth = size
    bi.biHeight = -size
    bi.biPlanes = 1
    bi.biBitCount = 32
    bi.biCompression = 0
    buf = ctypes.create_string_buffer(size * size * 4)
    got = gdi32.GetDIBits(mdc, bmp, 0, size, buf, ctypes.byref(bi), 0)
    img = Image.frombuffer('RGBA', (size, size), buf, 'raw', 'BGRA', 0, 1)
    img.save(out)
    gdi32.DeleteObject(brush)
    gdi32.DeleteObject(bmp)
    gdi32.DeleteDC(mdc)
    user32.ReleaseDC(None, hdc)
    return bool(ok), got


if __name__ == '__main__':
    for p in sys.argv[1:]:
        if not os.path.exists(p):
            print('MISSING', p)
            continue
        hi = shell_icon(p)
        tag = os.path.basename(p)
        if not hi:
            print(f'{tag}: SHELL ICON = None（系统读不到图标）')
            continue
        out = os.path.join(os.path.expanduser('~'), 'AppData', 'Local', 'Temp', f'shellicon-{tag}.png')
        ok, got = hicon_to_png(hi, out)
        print(f'{tag}: shell icon = {hi}, draw={ok}, dib={got} -> {out}')
