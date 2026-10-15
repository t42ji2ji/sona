"""settings.json in the data directory. The Fish API key is write-only to clients."""
from __future__ import annotations

import json
import threading
from pathlib import Path

from . import config
from .errors import ApiError

_lock = threading.Lock()


def _path() -> Path:
    return config.data_dir() / "settings.json"


def load() -> dict:
    defaults = {"music_dir": str(config.default_music_dir()),
                "voice_backend": "local" if config.capabilities()["voice_local"]["available"] else "api",
                "fish_api_key": "", "language": "zh-TW"}
    if _path().is_file():
        defaults.update(json.loads(_path().read_text(encoding="utf-8")))
    return defaults


def public() -> dict:
    s = load()
    return {"music_dir": s["music_dir"], "voice_backend": s["voice_backend"],
            "fish_api_key_set": bool(s["fish_api_key"]), "language": s["language"]}


def update(changes: dict) -> dict:
    with _lock:
        s = load()
        if "music_dir" in changes:
            path = Path(changes["music_dir"]).expanduser()
            try:
                path.mkdir(parents=True, exist_ok=True)
            except OSError:
                raise ApiError(400, "invalid_music_dir", f"無法建立或寫入作品資料夾 {path}，請換一個位置。")
            s["music_dir"] = str(path)
        if "voice_backend" in changes:
            if changes["voice_backend"] not in ("local", "api"):
                raise ApiError(400, "invalid_voice_backend", "聲音後端只能是 local 或 api。")
            if changes["voice_backend"] == "local" and not config.capabilities()["voice_local"]["available"]:
                raise ApiError(400, "unsupported", config.capabilities()["voice_local"]["reason"])
            s["voice_backend"] = changes["voice_backend"]
        if "fish_api_key" in changes:
            s["fish_api_key"] = (changes["fish_api_key"] or "").strip()
        if "language" in changes:
            if changes["language"] not in ("zh-TW", "en"):
                raise ApiError(400, "invalid_language", "語言只能是 zh-TW 或 en。")
            s["language"] = changes["language"]
        _path().write_text(json.dumps(s, ensure_ascii=False, indent=2), encoding="utf-8")
    return public()
