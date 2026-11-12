import ctypes
from ctypes import wintypes

user32 = ctypes.windll.user32

windows = []
def enum_cb(hwnd, lparam):
    if user32.IsWindowVisible(hwnd):
        length = user32.GetWindowTextLengthW(hwnd)
        if length > 0:
            buf = ctypes.create_unicode_buffer(length + 1)
            user32.GetWindowTextW(hwnd, buf, length + 1)
            title = buf.value
            if "chrome" in title.lower() or "flow" in title.lower():
                rect = wintypes.RECT()
                user32.GetWindowRect(hwnd, ctypes.byref(rect))
                windows.append((hwnd, title, (rect.left, rect.top, rect.right, rect.bottom)))
    return True

WNDENUMPROC = ctypes.WINFUNCTYPE(ctypes.c_bool, wintypes.HWND, wintypes.LPARAM)
user32.EnumWindows(WNDENUMPROC(enum_cb), 0)

print(f"Found {len(windows)} Chrome/Flow windows:")
for w in windows:
    print(" ", w)
