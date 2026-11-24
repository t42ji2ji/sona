"""Installable pieces: one venv per engine, plus model weights in the shared caches."""
from __future__ import annotations

import json
import os
import queue
import shutil
import subprocess
import sys
import threading
import time
from pathlib import Path

import httpx

from . import config, events
from .errors import ApiError

SHEETSAGE_PINS = ["torch==2.8.0", "torchaudio==2.8.0", "transformers==4.45.2", "huggingface-hub==0.36.0",
                  "safetensors==0.5.3", "numpy==1.24.3", "scipy==1.13.1", "mir_eval==0.8.2",
                  "pretty_midi==0.2.10", "mido==1.3.3", "setuptools==78.1.1"]
DEMUCS_URL = "https://dl.fbaipublicfiles.com/demucs/hybrid_transformer/"
SONG = ["song", "instrumental", "cover"]

COMPONENTS = [
    {"id": "env:yue2", "kind": "env", "name": "YuE2 執行環境",
     "description": "寫歌、純音樂與翻唱用的 Python 環境（PyTorch＋yue2-infer）",
     "needed_for": SONG, "size_bytes": 550_000_000, "size_cuda": 5_500_000_000,
     "deps": ["yue2-infer @ https://github.com/multimodal-art-projection/YuE/releases/download/yue2-v0.1.6/"
              "yue2_infer-0.1.6-py3-none-any.whl"
              "#sha256=129a015327a2eca530760ffd2163ccb8cb65f7e601715de1d9626a40c568e2e2"]},
    {"id": "env:yue2-mlx", "kind": "env", "name": "YuE2 執行環境（Apple Silicon）",
     "description": "寫歌、純音樂與翻唱用的 MLX 環境（mlx-Yue），比 PyTorch 版快、省記憶體",
     "needed_for": SONG, "size_bytes": 350_000_000, "python": "3.12",
     "deps": ["mlx-yue @ https://github.com/vanch007/mlx-Yue/archive/c5b5a8190f78c74aa671a4caa19dae8b8e04b3d8.zip"]},
    {"id": "env:demucs", "kind": "env", "name": "拆軌與轉譜執行環境",
     "description": "Demucs 拆軌，以及翻唱時用 SheetSage2 把歌轉成旋律譜",
     "needed_for": ["stems", "cover"], "size_bytes": 650_000_000, "size_cuda": 5_500_000_000,
     "deps": ["demucs==4.0.1", "soundfile==0.13.1", *SHEETSAGE_PINS]},
    {"id": "env:voice-mlx", "kind": "env", "name": "本機聲音複製執行環境",
     "description": "在 Apple Silicon 上跑 Fish Audio Drama 3 的 MLX 環境",
     "needed_for": ["voice_local"], "size_bytes": 460_000_000,
     "deps": ["mlx-audio @ https://github.com/stickerdaniel/mlx-audio/archive/refs/heads/fish-drama3.zip",
              "soundfile==0.13.1"]},
    {"id": "model:yue2-3b", "kind": "model", "name": "YuE2-3B",
     "description": "寫歌模型本體", "needed_for": SONG,
     "hf": [("m-a-p/YuE2-3B", {"model.safetensors": 7261441640, "qwen.tiktoken": 2561218, "config.json": 959,
                               "generation_config.json": 204, "yue2_generation_config.json": 466,
                               "weights_manifest.json": 179, "modeling_yue2.py": 32983})]},
    {"id": "model:yue2-vae", "kind": "model", "name": "YuE2 音訊解碼器",
     "description": "把模型輸出還原成 48kHz 立體聲", "needed_for": SONG,
     "hf": [("m-a-p/YuE2-Vae", {"model.safetensors": 530512720, "config.json": 1378,
                                "weights_manifest.json": 178, "modeling_vae.py": 25265})]},
    {"id": "model:yue2-mlx", "kind": "model", "name": "YuE2-3B（MLX）",
     "description": "寫歌模型與音訊解碼器，社群轉好的 Apple Silicon 版（mlx-Yue）", "needed_for": SONG,
     "local": ("vanch007/mlx-Yue2-3B", "5f7620e546fb3c6130a09a7e18172e3bb7aaeddb", {
         "ar-8bit.safetensors": 2656158264, "ar-bf16.safetensors": 4331951136, "nar-bf16.safetensors": 2929490456,
         "qwen.tiktoken": 2561218, "config.json": 959, "conversion.json": 3784, "LICENSE": 20309,
         "THIRD_PARTY_NOTICES.md": 793, "licenses/SnakeBeta-NVIDIA-MIT.txt": 1076,
         "licenses/stable-audio-tools-MIT.txt": 1069, "vae/model.safetensors": 530512720, "vae/config.json": 1378,
         "vae/weights_manifest.json": 178, "vae/LICENSE": 20309, "vae/THIRD_PARTY_NOTICES.md": 793,
         "vae/licenses/SnakeBeta-NVIDIA-MIT.txt": 1076, "vae/licenses/stable-audio-tools-MIT.txt": 1069})},
    {"id": "model:sheetsage2", "kind": "model", "name": "SheetSage2＋MERT-v2",
     "description": "翻唱用：把上傳的歌轉成旋律譜", "needed_for": ["cover"],
     "hf": [("m-a-p/SheetSage2", {"model.safetensors": 228738564, "config.json": 2060,
                                  "modeling_sheetsage2.py": 24664, "processor_config.json": 277},
             ["*.py", "*.json", "model.safetensors"]),
            ("m-a-p/MERT-v2-FullSong", {"model.safetensors": 2529812848, "config.json": 882,
                                        "modeling_mert2.py": 17081, "configuration_mert2.py": 3860,
                                        "preprocessor_config.json": 215, "weights_manifest.json": 241})]},
    {"id": "model:htdemucs", "kind": "model", "name": "Demucs htdemucs",
     "description": "標準拆軌模型，速度快", "needed_for": ["stems"],
     "torch": {"955717e8-8726e21a.th": 84141911}},
    {"id": "model:htdemucs-ft", "kind": "model", "name": "Demucs htdemucs_ft",
     "description": "精細拆軌模型（四個子模型），較慢但分得更乾淨", "needed_for": [],
     "torch": {"f7e0c4bc-ba3fe64a.th": 84141271, "d12395a8-e57c48e6.th": 84141271,
               "92cfc3b6-ef3bcb9c.th": 84141271, "04573f0d-f3cf25b2.th": 84141271}},
    {"id": "model:drama3-mlx", "kind": "model", "name": "Fish Audio Drama 3（4-bit MLX）",
     "description": "本機聲音複製模型，執行時約占 26GB 記憶體", "needed_for": ["voice_local"],
     "hf": [("mlx-community/fish-audio-drama-3-4bit", {
         "codec.safetensors": 1572080341, "model-00001.safetensors": 4354661374,
         "model-00002.safetensors": 4360386773, "model-00003.safetensors": 4304379853,
         "model-00004.safetensors": 4407528323, "model-00005.safetensors": 4425623733,
         "model-00006.safetensors": 335374378, "tokenizer.json": 20791070, "config.json": 53444,
         "tokenizer_config.json": 103580, "special_tokens_map.json": 102779, "chat_template.jinja": 7756})]},
    {"id": "model:qwen3-asr", "kind": "model", "name": "Qwen3-ASR-0.6B（8-bit MLX）",
     "description": "本機聲音複製用：自動把參考錄音轉成逐字稿", "needed_for": ["voice_local"],
     "hf": [("mlx-community/Qwen3-ASR-0.6B-8bit", {
         "model.safetensors": 1006229426, "model.safetensors.index.json": 71815, "config.json": 7187,
         "generation_config.json": 142, "chat_template.json": 1161, "preprocessor_config.json": 330,
         "tokenizer_config.json": 12487, "vocab.json": 2776833, "merges.txt": 1671853})]},
]
BY_ID = {c["id"]: c for c in COMPONENTS}
MLX_YUE2 = ["env:yue2-mlx", "model:yue2-mlx"]
TORCH_YUE2 = ["env:yue2", "model:yue2-3b", "model:yue2-vae"]
YUE2 = MLX_YUE2 if config.device() == "mps" else TORCH_YUE2
FEATURE_COMPONENTS = {
    "song": YUE2,
    "instrumental": YUE2,
    "cover": [*YUE2, "env:demucs", "model:sheetsage2"],
    "stems": ["env:demucs", "model:htdemucs"],
    "voice_local": ["env:voice-mlx", "model:drama3-mlx", "model:qwen3-asr"],
}

_lock = threading.Lock()
_status: dict[str, dict] = {}       # queued/installing/error overrides of the on-disk state
_queue: queue.Queue[str] = queue.Queue()
_current: dict = {"id": None, "proc": None, "cancel": False}
_fake_missing: set[str] = set()


def size_of(c: dict) -> int:
    if c["kind"] == "env":
        return c["size_cuda"] if config.device() == "cuda" and "size_cuda" in c else c["size_bytes"]
    if "torch" in c:
        return sum(c["torch"].values())
    if "local" in c:
        return sum(c["local"][2].values())
    return sum(sum(spec[1].values()) for spec in c["hf"])


def supported(c: dict) -> bool:
    if c["id"] in ("env:voice-mlx", "model:drama3-mlx", "model:qwen3-asr"):
        return config.capabilities()["voice_local"]["available"]
    if c["id"] in MLX_YUE2 + TORCH_YUE2:
        return c["id"] in YUE2
    return True


def env_dir(c: dict) -> Path:
    return config.data_dir() / "envs" / c["id"].split(":", 1)[1]


def _snapshot(repo: str) -> Path | None:
    root = config.hf_hub_dir() / ("models--" + repo.replace("/", "--"))
    ref = root / "refs" / "main"
    if ref.is_file():
        snap = root / "snapshots" / ref.read_text().strip()
        if snap.is_dir():
            return snap
    snaps = sorted((root / "snapshots").glob("*"), key=lambda p: p.stat().st_mtime) if (root / "snapshots").is_dir() else []
    return snaps[-1] if snaps else None


def local_dirs() -> tuple[Path, Path]:
    """mlx-Yue model and decoder dirs. It refuses symlinks and extra files, so these sit outside the HF cache."""
    root = config.data_dir() / "models"
    return root / "yue2-mlx", root / "yue2-mlx-vae"


def _local_path(name: str) -> Path:
    model, vae = local_dirs()
    return vae / name[4:] if name.startswith("vae/") else model / name


def hf_path(repo: str) -> Path | None:
    """Snapshot dir of a repo, for workers."""
    return _snapshot(repo)


def _disk(c: dict) -> tuple[bool, int]:
    """(ready, done_bytes) from what is on disk."""
    if c["kind"] == "env":
        marker = env_dir(c) / "sona-env.json"
        ready = marker.is_file() and json.loads(marker.read_text()).get("deps") == c["deps"]
        return ready, size_of(c) if ready else 0
    if "torch" in c:
        done, ready = 0, True
        for name, size in c["torch"].items():
            path = config.torch_checkpoint_dir() / name
            part = path.with_suffix(".part")
            if path.is_file() and path.stat().st_size == size:
                done += size
            else:
                ready = False
                done += part.stat().st_size if part.is_file() else 0
        return ready, done
    if "local" in c:
        ready = all(_local_path(n).is_file() and _local_path(n).stat().st_size == size for n, size in c["local"][2].items())
        part = local_dirs()[0].with_suffix(".part")
        return ready, size_of(c) if ready else min(_dir_size(part) if part.is_dir() else 0, size_of(c))
    done, ready = 0, True
    for repo, files, *_ in c["hf"]:
        snap = _snapshot(repo)
        for name, size in files.items():
            path = snap / name if snap else None
            if path and path.is_file() and path.stat().st_size == size:
                done += size
            else:
                ready = False
        blobs = config.hf_hub_dir() / ("models--" + repo.replace("/", "--")) / "blobs"
        if blobs.is_dir():
            done += sum(p.stat().st_size for p in blobs.glob("*.incomplete"))
    return ready, min(done, size_of(c))


def ready(id: str) -> bool:
    if config.FAKE:
        return id not in _fake_missing
    return _disk(BY_ID[id])[0]


def describe(id: str) -> dict:
    c = BY_ID[id]
    size = size_of(c)
    if config.FAKE:
        ok, done = id not in _fake_missing, 0
        done = size if ok else _status.get(id, {}).get("done", 0)
    else:
        ok, done = _disk(c)
    state = "ready" if ok else "missing"
    status = _status.get(id)
    if not supported(c) and not ok:     # still on disk: stays deletable
        state = "unsupported"
    elif status:
        state = status["state"]
    out = {"id": id, "kind": c["kind"], "name": c["name"], "description": c["description"],
           "size_bytes": size, "done_bytes": done, "state": state, "needed_for": c["needed_for"]}
    if c["kind"] == "env" and status and status["state"] == "installing":
        out["done_bytes"] = status.get("done", 0)
    if state == "error":
        out["error"] = status["error"]
    return out


def all_components() -> list[dict]:
    return [describe(c["id"]) for c in COMPONENTS]


def missing_for(feature: str) -> list[str]:
    return [BY_ID[i]["name"] for i in FEATURE_COMPONENTS[feature] if not ready(i)]


def _set(id: str, status: dict | None):
    with _lock:
        if status is None:
            _status.pop(id, None)
        else:
            _status[id] = status
    events.publish("component", describe(id))


def install(id: str):
    c = BY_ID.get(id)
    if not c:
        raise ApiError(404, "not_found", f"沒有叫 {id} 的元件。")
    if not supported(c):
        raise ApiError(400, "unsupported", "這台電腦不支援這個元件。")
    with _lock:
        if _status.get(id, {}).get("state") in ("queued", "installing") or ready(id):
            return
        _status[id] = {"state": "queued"}
    events.publish("component", describe(id))
    _queue.put(id)


def install_feature(feature: str):
    if feature not in FEATURE_COMPONENTS:
        raise ApiError(404, "not_found", f"沒有叫 {feature} 的功能。")
    for id in FEATURE_COMPONENTS[feature]:
        install(id)


def cancel(id: str):
    if id not in BY_ID:
        raise ApiError(404, "not_found", f"沒有叫 {id} 的元件。")
    state = _status.get(id, {}).get("state")
    if state == "installing" and _current["id"] == id:
        _current["cancel"] = True
        if _current["proc"]:
            _current["proc"].kill()
    elif state in ("queued", "error"):
        _set(id, None)


def remove(id: str):
    c = BY_ID.get(id)
    if not c:
        raise ApiError(404, "not_found", f"沒有叫 {id} 的元件。")
    if _status.get(id, {}).get("state") in ("queued", "installing"):
        raise ApiError(409, "busy", "這個元件正在安裝，請先取消安裝再刪除。")
    if config.FAKE:
        _fake_missing.add(id)
    elif c["kind"] == "env":
        shutil.rmtree(env_dir(c), ignore_errors=True)
    elif "local" in c:
        for path in (*local_dirs(), local_dirs()[0].with_suffix(".part")):
            shutil.rmtree(path, ignore_errors=True)
    elif "torch" in c:
        for name in c["torch"]:
            for path in (config.torch_checkpoint_dir() / name, (config.torch_checkpoint_dir() / name).with_suffix(".part")):
                path.unlink(missing_ok=True)
    else:
        for repo, *_ in c["hf"]:
            shutil.rmtree(config.hf_hub_dir() / ("models--" + repo.replace("/", "--")), ignore_errors=True)
    _set(id, None)


# ---- installer thread -------------------------------------------------------

class Cancelled(Exception):
    pass


def _run(cmd: list[str], id: str, on_tick=None, env=None) -> str:
    """Run a command killable by cancel(); returns stderr+stdout tail on failure."""
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                            text=True, encoding="utf-8", errors="replace", env=env)
    _current["proc"] = proc
    tail: list[str] = []

    def read():
        for line in proc.stdout:
            tail.append(line)
            del tail[:-40]
    reader = threading.Thread(target=read, daemon=True)
    reader.start()
    while proc.poll() is None:
        if on_tick:
            on_tick()
        time.sleep(1)
    reader.join(timeout=5)
    _current["proc"] = None
    if _current["cancel"]:
        raise Cancelled()
    if proc.returncode:
        raise RuntimeError(" ".join(" ".join(tail[-6:]).split()) or f"exit {proc.returncode}")
    return "".join(tail)


def _dir_size(path: Path) -> int:
    total = 0
    for root, _, files in os.walk(path):
        for f in files:
            try:
                total += os.lstat(os.path.join(root, f)).st_size
            except OSError:
                pass
    return total


def _install_env(c: dict):
    uv = config.uv_path()
    if not uv:
        raise RuntimeError("找不到 uv，無法建立 Python 環境。請重新安裝 Sona。")
    venv = env_dir(c)
    shutil.rmtree(venv, ignore_errors=True)
    # Electron points UV_PROJECT_ENVIRONMENT at the core venv; engine venvs must not inherit it.
    env = {k: v for k, v in os.environ.items() if k != "UV_PROJECT_ENVIRONMENT"}
    size = size_of(c)
    _set(c["id"], {"state": "installing", "done": int(size * 0.02)})
    _run([uv, "venv", "--python", c.get("python", "3.11"), "--python-preference", "only-managed", "--seed", str(venv)], c["id"], env=env)
    cmd = [uv, "pip", "install", "--python", str(config.env_python(c["id"].split(":", 1)[1])), *c["deps"]]
    if config.device() == "cuda":
        cmd += ["--torch-backend", "auto"]

    def tick():
        done = min(int(size * 0.95), max(int(size * 0.02), _dir_size(venv)))
        _set(c["id"], {"state": "installing", "done": done})
    _run(cmd, c["id"], tick, env)
    (venv / "sona-env.json").write_text(json.dumps({"deps": c["deps"]}))


def _install_hf(c: dict):
    # Exits on stdin EOF too, so a killed backend doesn't leave a download running.
    script = ("import sys, json, os, threading; from huggingface_hub import snapshot_download; "
              "threading.Thread(target=lambda: (sys.stdin.read(), os._exit(1)), daemon=True).start(); "
              "snapshot_download(sys.argv[1], allow_patterns=json.loads(sys.argv[2]))")
    # Xet transfers fill .incomplete only at the end; plain HTTP grows it, which is our byte progress.
    env = {**os.environ, "HF_HUB_DISABLE_XET": "1"}
    for repo, files, *patterns in c["hf"]:
        allow = patterns[0] if patterns else list(files)
        _run([sys.executable, "-c", script, repo, json.dumps(allow)], c["id"],
             lambda: _set(c["id"], {"state": "installing"}), env)


def _install_local(c: dict):
    repo, revision, files = c["local"]
    model, vae = local_dirs()
    part = model.with_suffix(".part")
    script = ("import sys, json, os, threading; from huggingface_hub import snapshot_download; "
              "threading.Thread(target=lambda: (sys.stdin.read(), os._exit(1)), daemon=True).start(); "
              "snapshot_download(sys.argv[1], revision=sys.argv[2], local_dir=sys.argv[3], allow_patterns=json.loads(sys.argv[4]))")
    env = {**os.environ, "HF_HUB_DISABLE_XET": "1"}
    _run([sys.executable, "-c", script, repo, revision, str(part), json.dumps(list(files))], c["id"],
         lambda: _set(c["id"], {"state": "installing"}), env)
    shutil.rmtree(part / ".cache", ignore_errors=True)
    for path in (model, vae):
        shutil.rmtree(path, ignore_errors=True)
    (part / "vae").rename(vae)
    part.rename(model)


def _install_torch(c: dict):
    folder = config.torch_checkpoint_dir()
    folder.mkdir(parents=True, exist_ok=True)
    last = 0.0
    for name, size in c["torch"].items():
        path, part = folder / name, (folder / name).with_suffix(".part")
        if path.is_file() and path.stat().st_size == size:
            continue
        start = part.stat().st_size if part.is_file() else 0
        headers = {"Range": f"bytes={start}-"} if start else {}
        with httpx.stream("GET", DEMUCS_URL + name, headers=headers, follow_redirects=True, timeout=60) as r:
            r.raise_for_status()
            with part.open("ab" if r.status_code == 206 else "wb") as f:
                for chunk in r.iter_bytes(1 << 20):
                    if _current["cancel"]:
                        raise Cancelled()
                    f.write(chunk)
                    if time.monotonic() - last > 0.5:
                        last = time.monotonic()
                        _set(c["id"], {"state": "installing"})
        if part.stat().st_size != size:
            raise RuntimeError(f"{name} 下載不完整")
        part.replace(path)


def _install_fake(c: dict):
    size = size_of(c)
    for step in range(1, 11):
        if _current["cancel"]:
            raise Cancelled()
        time.sleep(0.05)
        _set(c["id"], {"state": "installing", "done": size * step // 10})
    _fake_missing.discard(c["id"])


def _installer():
    while True:
        id = _queue.get()
        if _status.get(id, {}).get("state") != "queued":
            continue    # cancelled while queued
        c = BY_ID[id]
        _current.update(id=id, cancel=False)
        _set(id, {"state": "installing", "done": 0})
        try:
            if config.FAKE:
                _install_fake(c)
            elif c["kind"] == "env":
                _install_env(c)
            elif "torch" in c:
                _install_torch(c)
            elif "local" in c:
                _install_local(c)
            else:
                _install_hf(c)
            _set(id, None)
        except Cancelled:
            if c["kind"] == "env" and not config.FAKE:
                shutil.rmtree(env_dir(c), ignore_errors=True)
            _set(id, None)
        except Exception as exc:  # noqa: BLE001 - every failure must reach the UI
            what = "建立環境" if c["kind"] == "env" else "下載"
            _set(id, {"state": "error", "error": f"{what}「{c['name']}」失敗：{exc}。請確認網路連線與磁碟空間後重試。"})
        finally:
            _current.update(id=None, proc=None, cancel=False)


def start():
    threading.Thread(target=_installer, daemon=True, name="installer").start()


def kill_all():
    if _current["proc"]:
        _current["proc"].kill()
