import subprocess
import json

out = subprocess.check_output(
    ["powershell", "-NoProfile", "-Command", "Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | Select-Object ProcessId, CommandLine | ConvertTo-Json"],
    text=True,
    errors="ignore"
)
procs = json.loads(out) if out.strip() else []
if isinstance(procs, dict):
    procs = [procs]
for p in procs:
    cmd = p.get("CommandLine") or ""
    if "--type=" not in cmd or "user-data-dir" in cmd:
        print(p.get("ProcessId"), "->", cmd[:250])
