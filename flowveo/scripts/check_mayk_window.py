import subprocess
import time
import ctypes
from ctypes import wintypes
from PIL import ImageGrab

# Open Flow project URL in Profile 18
subprocess.Popen([
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    "--profile-directory=Profile 18",
    "--new-window",
    "https://flow.google.com/project/560389d6-0558-4e65-8946-e48a2b12b453"
])

time.sleep(6)

user32 = ctypes.windll.user32
windows = []
def enum_cb(hwnd, lparam):
    if user32.IsWindowVisible(hwnd):
        length = user32.GetWindowTextLengthW(hwnd)
        if length > 0:
            buf = ctypes.create_unicode_buffer(length + 1)
            user32.GetWindowTextW(hwnd, buf, length + 1)
            title = buf.value
            rect = wintypes.RECT()
            user32.GetWindowRect(hwnd, ctypes.byref(rect))
            windows.append((hwnd, title, (rect.left, rect.top, rect.right, rect.bottom)))
    return True

WNDENUMPROC = ctypes.WINFUNCTYPE(ctypes.c_bool, wintypes.HWND, wintypes.LPARAM)
user32.EnumWindows(WNDENUMPROC(enum_cb), 0)

for hwnd, title, rect in windows:
    if any(k in title.lower() for k in ["flow", "chrome", "google"]):
        print("Window:", hwnd, title, rect)

# Grab full screen screenshot to inspect
shot_path = r"C:\Users\brend\.gemini\antigravity\brain\867cb782-904b-4b01-94d3-9e25fcbc7a95\mayk_live_screen.png"
img = ImageGrab.grab()
img.save(shot_path)
print("Saved live screen:", shot_path, img.size)
