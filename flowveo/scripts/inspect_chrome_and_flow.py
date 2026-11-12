import subprocess
import json
import os

# 1. Delete the fake slideshow 60s video immediately so we don't leave garbage around
bad_mp4 = r"D:\CANAL 9\storage_local\episodios\teste_60s_mochileiro_tempo_ptbr_master.mp4"
if os.path.exists(bad_mp4):
    os.remove(bad_mp4)
    print("Deleted fake slideshow video:", bad_mp4)

# 2. Check running Chrome processes and their command lines
out = subprocess.check_output(
    ["powershell", "-NoProfile", "-Command", "Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | Select-Object ProcessId, CommandLine | ConvertTo-Json"],
    text=True,
    errors="ignore"
)
procs = json.loads(out) if out.strip() else []
if isinstance(procs, dict):
    procs = [procs]
print(f"Running chrome.exe processes: {len(procs)}")
for p in procs[:10]:
    cmd = p.get("CommandLine") or ""
    if "--type=" not in cmd:
        print("  Main Chrome PID:", p.get("ProcessId"), "CMD:", cmd[:200])
