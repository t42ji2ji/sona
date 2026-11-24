"""Paths, environment overrides and what this machine can run."""
from __future__ import annotations

import os
import platform
import shutil
import subprocess
import sys
from functools import cache
from pathlib import Path

VERSION = "0.1.0"
BACKEND_DIR = Path(__file__).resolve().parent.parent
WORKERS_DIR = Path(__file__).resolve().parent / "workers"
FAKE = os.environ.get("SONA_FAKE_ENGINES") == "1"


def data_dir() -> Path:
    if os.environ.get("SONA_DATA_DIR"):
        path = Path(os.environ["SONA_DATA_DIR"])
    elif sys.platform == "darwin":
        path = Path.home() / "Library/Application Support/Sona"
    elif sys.platform == "win32":
        path = Path(os.environ["APPDATA"]) / "Sona"
    else:
        path = Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local/share")) / "Sona"
    path.mkdir(parents=True, exist_ok=True)
    return path


def default_music_dir() -> Path:
    return Path(os.environ.get("SONA_MUSIC_DIR") or Path.home() / "Music" / "Sona")


def uv_path() -> str | None:
    return os.environ.get("SONA_UV") or shutil.which("uv")


def hf_hub_dir() -> Path:
    if os.environ.get("HF_HUB_CACHE"):
        return Path(os.environ["HF_HUB_CACHE"])
    return Path(os.environ.get("HF_HOME") or Path.home() / ".cache/huggingface") / "hub"


def torch_checkpoint_dir() -> Path:
    home = os.environ.get("TORCH_HOME") or Path(os.environ.get("XDG_CACHE_HOME") or Path.home() / ".cache") / "torch"
    return Path(home) / "hub" / "checkpoints"


def env_python(name: str) -> Path:
    venv = data_dir() / "envs" / name
    return venv / ("Scripts/python.exe" if sys.platform == "win32" else "bin/python")


def _run(cmd: list[str]) -> str:
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=10).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        return ""


def _ram_bytes() -> int:
    if sys.platform == "darwin":
        return int(_run(["sysctl", "-n", "hw.memsize"]) or 0)
    if sys.platform == "win32":
        import ctypes

        class Status(ctypes.Structure):
            _fields_ = [("dwLength", ctypes.c_ulong), ("dwMemoryLoad", ctypes.c_ulong),
                        ("ullTotalPhys", ctypes.c_ulonglong), ("ullAvailPhys", ctypes.c_ulonglong),
                        ("ullTotalPageFile", ctypes.c_ulonglong), ("ullAvailPageFile", ctypes.c_ulonglong),
                        ("ullTotalVirtual", ctypes.c_ulonglong), ("ullAvailVirtual", ctypes.c_ulonglong),
                        ("ullAvailExtendedVirtual", ctypes.c_ulonglong)]
        status = Status()
        status.dwLength = ctypes.sizeof(Status)
        ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(status))
        return status.ullTotalPhys
    for line in Path("/proc/meminfo").read_text().splitlines():
        if line.startswith("MemTotal:"):
            return int(line.split()[1]) * 1024
    return 0


@cache
def system() -> dict:
    plat = {"darwin": "mac", "win32": "windows"}.get(sys.platform, "linux")
    arch = platform.machine().lower()
    ram_gb = round(_ram_bytes() / 2**30, 1)
    accel = {"kind": "cpu", "name": platform.processor() or arch, "vram_gb": None}
    if plat == "mac" and arch == "arm64":
        accel = {"kind": "mps", "name": _run(["sysctl", "-n", "machdep.cpu.brand_string"]) or "Apple Silicon", "vram_gb": None}
    elif shutil.which("nvidia-smi"):
        line = _run(["nvidia-smi", "--query-gpu=name,memory.total", "--format=csv,noheader,nounits"]).splitlines()
        if line:
            name, mem = [x.strip() for x in line[0].rsplit(",", 1)]
            accel = {"kind": "cuda", "name": name, "vram_gb": round(float(mem) / 1024, 1)}
    return {"platform": plat, "arch": arch, "ram_gb": ram_gb, "accelerator": accel}


def capabilities() -> dict:
    info = system()
    kind = info["accelerator"]["kind"]
    if kind == "mps" and info["ram_gb"] < 16:
        yue = {"available": False, "reason": "這台 Mac 記憶體不到 16GB，跑不動 YuE2。"}
    elif kind == "mps":
        yue = {"available": True, "speed_hint": "快速模式約需歌曲長度的 2 倍時間，高品質約 5 倍"}
    elif kind == "cuda" and (info["accelerator"]["vram_gb"] or 0) < 12:
        yue = {"available": False, "reason": "顯示卡記憶體不到 12GB，跑不動 YuE2。"}
    elif kind == "cuda":
        yue = {"available": True}
    else:
        yue = {"available": True, "speed_hint": "沒有可用的 GPU，只能用 CPU，會非常慢"}
    local_ok = kind == "mps" and info["ram_gb"] >= 16
    hq_ok = kind == "mps" and info["ram_gb"] >= 32
    return {
        "song": yue, "instrumental": yue, "cover": yue,
        "stems": {"available": True} if kind != "cpu" else {"available": True, "speed_hint": "沒有可用的 GPU，會比較慢"},
        "voice_local": {"available": True} if local_ok else
        {"available": False, "reason": "本機聲音複製只支援記憶體 16GB 以上的 Apple Silicon Mac，請改用 Fish Audio API。"},
        "voice_hq": {"available": True} if hq_ok else
        {"available": False, "reason": "高品質模式要 32GB 以上記憶體的 Apple Silicon Mac。"},
        "voice_api": {"available": True},
    }


def device() -> str:
    return system()["accelerator"]["kind"]
