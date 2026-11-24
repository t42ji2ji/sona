"""Job queue: one job at a time, oldest first. Each finished job becomes a Track."""
from __future__ import annotations

import json
import random
import re
import shutil
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

from opencc import OpenCC

from . import audio, components, config, db, events, fish_api, settings
from .engine import Cancelled, EngineError, manager
from .errors import ApiError

FEATURE = {"song": "song", "instrumental": "instrumental", "cover": "cover", "stems": "stems"}
_wake = threading.Event()
_running: dict = {"id": None, "cancel": False}
_traditional = OpenCC("s2tw").convert   # ASR answers in simplified Chinese


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


def new_id() -> str:
    return uuid.uuid4().hex[:12]


# ---- serialization ----------------------------------------------------------

def with_position(job: dict) -> dict:
    if job["state"] != "queued":
        return {k: v for k, v in job.items() if k != "queue_position"}
    queued = sorted((j for j in db.all("jobs") if j["state"] == "queued"), key=lambda j: j["created_at"])
    ids = [j["id"] for j in queued]
    return {**job, "queue_position": ids.index(job["id"]) + 1 if job["id"] in ids else None}


def save(job: dict):
    db.put("jobs", job)
    events.publish("job", with_position(job))


def publish_queue():
    for job in db.all("jobs"):
        if job["state"] == "queued":
            events.publish("job", with_position(job))


def track_view(t: dict) -> dict:
    view = {k: v for k, v in t.items() if not k.startswith("_")}
    view["audio_url"] = f"/api/tracks/{t['id']}/audio"
    if t.get("stems"):
        view["stems"] = [{"name": n, "url": f"/api/tracks/{t['id']}/stems/{n}"} for n in t["stems"]]
    return view


# ---- creation ---------------------------------------------------------------

def _str(params: dict, key: str, required=True) -> str:
    value = params.get(key)
    if value is None or (isinstance(value, str) and not value.strip()):
        if required:
            raise ApiError(400, "invalid_params", f"缺少「{key}」。")
        return ""
    if not isinstance(value, str):
        raise ApiError(400, "invalid_params", f"「{key}」必須是文字。")
    return value.strip()


def _title(type: str, params: dict) -> str:
    if params.get("title"):
        return str(params["title"]).strip()[:80]
    if type == "song":
        lines = [l.strip() for l in params["lyrics"].splitlines() if l.strip() and not l.strip().startswith("[")]
        return (lines[0] if lines else params["style"])[:30]
    if type == "instrumental":
        return params["style"][:30]
    if type == "cover":
        return Path(db.get("uploads", params["upload_id"])["filename"]).stem[:30] + " 翻唱"
    if type == "stems":
        source = Path(db.get("uploads", params["upload_id"])["filename"]).stem if params.get("upload_id") \
            else db.get("tracks", params["track_id"])["title"]
        return source[:30] + " 拆軌"
    return params["text"][:30]


def validate(type: str, params: dict) -> dict:
    if not isinstance(params, dict):
        raise ApiError(400, "invalid_params", "params 必須是物件。")
    p = dict(params)
    seed = p.get("seed")
    if seed is not None and (not isinstance(seed, int) or isinstance(seed, bool) or not 0 <= seed < 2**63):
        raise ApiError(400, "invalid_params", "seed 必須是 0 以上的整數。")
    if type == "song":
        p["style"], p["lyrics"] = _str(p, "style"), _str(p, "lyrics")
        if p.setdefault("mode", "full") not in ("full", "melody", "off"):
            raise ApiError(400, "invalid_params", "mode 只能是 full、melody 或 off。")
    elif type == "instrumental":
        p["style"] = _str(p, "style")
    elif type == "cover":
        p["style"] = _str(p, "style")
        p["lyrics"] = _str(p, "lyrics", required=False)
        p["instrumental"] = bool(p.get("instrumental"))
        if not db.get("uploads", _str(p, "upload_id")):
            raise ApiError(404, "upload_not_found", "找不到上傳的歌曲，請重新上傳。")
        if not p["instrumental"] and not p["lyrics"]:
            raise ApiError(400, "invalid_params", "人聲翻唱需要歌詞；不想填歌詞請打開「純音樂」。")
    elif type == "stems":
        if bool(p.get("upload_id")) == bool(p.get("track_id")):
            raise ApiError(400, "invalid_params", "拆軌要指定 upload_id 或 track_id 其中一個。")
        if p.get("upload_id") and not db.get("uploads", p["upload_id"]):
            raise ApiError(404, "upload_not_found", "找不到上傳的歌曲，請重新上傳。")
        if p.get("track_id") and not db.get("tracks", p["track_id"]):
            raise ApiError(404, "track_not_found", "找不到這首作品。")
        if p.setdefault("model", "htdemucs") not in ("htdemucs", "htdemucs_ft"):
            raise ApiError(400, "invalid_params", "model 只能是 htdemucs 或 htdemucs_ft。")
    elif type == "voice":
        p["text"] = _str(p, "text")
        if not db.get("voices", _str(p, "voice_id")):
            raise ApiError(404, "voice_not_found", "找不到這個聲音，請重新建立。")
        p["backend"] = p.get("backend") or settings.load()["voice_backend"]
        if p["backend"] not in ("local", "api"):
            raise ApiError(400, "invalid_params", "backend 只能是 local 或 api。")
        if p["backend"] == "local" and not config.capabilities()["voice_local"]["available"]:
            raise ApiError(400, "unsupported", config.capabilities()["voice_local"]["reason"])
        if p.setdefault("quality", "fast") not in ("fast", "high"):
            raise ApiError(400, "invalid_params", "quality 只能是 fast 或 high。")
        if p["backend"] == "local" and p["quality"] == "high" and not config.capabilities()["voice_hq"]["available"]:
            raise ApiError(400, "unsupported", config.capabilities()["voice_hq"]["reason"])
        if p["backend"] == "api" and not settings.load()["fish_api_key"]:
            raise ApiError(400, "missing_api_key", "還沒填 Fish Audio API key，請先到設定填寫。")
    else:
        raise ApiError(400, "invalid_type", "type 只能是 song、instrumental、cover、stems 或 voice。")
    if type in ("song", "instrumental", "cover") and p.setdefault("quality", "fast") not in ("fast", "high"):
        raise ApiError(400, "invalid_params", "quality 只能是 fast 或 high。")
    if type in FEATURE and not config.capabilities()[FEATURE[type]]["available"]:
        raise ApiError(400, "unsupported", config.capabilities()[FEATURE[type]]["reason"])
    return p


def create(type: str, params: dict) -> dict:
    params = validate(type, params)
    job = {"id": new_id(), "type": type, "params": params, "title": _title(type, params),
           "state": "queued", "stage": "排隊中", "progress": 0, "eta_seconds": None,
           "created_at": now(), "started_at": None, "finished_at": None}
    save(job)
    _wake.set()
    return with_position(job)


def cancel(id: str) -> dict:
    job = db.get("jobs", id)
    if not job:
        raise ApiError(404, "job_not_found", "找不到這個任務。")
    if job["state"] == "queued":
        job.update(state="cancelled", stage="已取消", finished_at=now())
        save(job)
        publish_queue()
    elif job["state"] == "running" and _running["id"] == id:
        _running["cancel"] = True
        manager.kill()
    return with_position(db.get("jobs", id))


def delete(id: str):
    job = db.get("jobs", id)
    if not job:
        raise ApiError(404, "job_not_found", "找不到這個任務。")
    if job["state"] in ("queued", "running"):
        cancel(id)
        deadline = time.monotonic() + 10
        while _running["id"] == id and time.monotonic() < deadline:
            time.sleep(0.05)
    db.delete("jobs", id)
    publish_queue()


# ---- running ----------------------------------------------------------------

def _folder(title: str, id: str) -> Path:
    safe = re.sub(r'[\\/:*?"<>|\x00-\x1f]', "", title).strip(" .") or "untitled"
    folder = Path(settings.load()["music_dir"]) / f"{safe[:60]}-{id[:6]}"
    folder.mkdir(parents=True, exist_ok=True)
    return folder


def _memory_budget() -> float:
    info = config.system()
    if info["accelerator"]["kind"] == "cuda":
        return min(24.0, info["accelerator"]["vram_gb"])
    return 12.0


def _run_engine(job: dict, engine: str, request: dict, span=(0.0, 1.0)) -> dict:
    if _running["cancel"]:
        raise Cancelled()
    lo, hi = span
    last = [0.0]

    def on_event(event):
        changed = False
        if event["type"] == "stage":
            job["stage"] = event["stage"]
            job["eta_seconds"] = None
            changed = True
        if event.get("progress", -1) >= 0:
            job["progress"] = round(lo + (hi - lo) * event["progress"], 4)
        elif event["type"] == "stage":
            job["progress"] = -1
        if "eta" in event:
            job["eta_seconds"] = event["eta"]
        if changed or time.monotonic() - last[0] > 0.5:
            last[0] = time.monotonic()
            save(job)
    request = {"device": config.device(), "memory_budget_gib": _memory_budget(),
               "models_dir": str(config.data_dir() / "models"), **request}
    return manager.run(engine, request, on_event)


def _source_audio(params: dict) -> Path:
    if params.get("upload_id"):
        return Path(db.get("uploads", params["upload_id"])["path"])
    track = db.get("tracks", params["track_id"])
    folder = Path(track["folder"])
    return folder / "audio.flac" if (folder / "audio.flac").is_file() else folder / "audio.mp3"


def _execute(job: dict, folder: Path) -> dict:
    """Run the engines; returns extra track fields."""
    type, p = job["type"], job["params"]
    if type in ("song", "instrumental"):
        result = _run_engine(job, "yue2", {"job": type, "params": p, "out": str(folder)})
        return {"score_abc": result.get("score_abc")}
    if type == "cover":
        source = _source_audio(p)
        result = _run_engine(job, "sheetsage", {"audio": str(source), "out": str(folder / "transcription")},
                             (0.0, 0.15))
        result = _run_engine(job, "yue2", {"job": "cover", "params": p, "out": str(folder), "abc": result["abc"]},
                             (0.15, 1.0))
        return {"score_abc": result.get("score_abc")}
    if type == "stems":
        source = _source_audio(p)
        audio.convert(source, folder / "audio.mp3")
        result = _run_engine(job, "demucs", {"audio": str(source), "out": str(folder), "model": p["model"]})
        return {"stems": result["stems"]}
    voice = db.get("voices", p["voice_id"])
    if p["backend"] == "local" or config.FAKE:
        result = _run_engine(job, "voice-mlx", {"text": p["text"], "ref_audio": voice["path"],
                                                "ref_text": voice["transcript"], "out": str(folder),
                                                "model": "drama3" if p.get("quality") == "high" else "qwen3"})
        if not voice["transcript"] and result.get("ref_text"):
            db.put("voices", {**voice, "transcript": _traditional(result["ref_text"])})
    else:
        key = settings.load()["fish_api_key"]
        if not voice["transcript"]:
            job.update(stage="辨識參考錄音", progress=-1)
            save(job)
            voice = {**voice, "transcript": _traditional(fish_api.asr(key, Path(voice["path"])))}
            db.put("voices", voice)
        job.update(stage="生成語音", progress=-1)
        save(job)
        fish_api.tts(key, p["text"], Path(voice["path"]), voice["transcript"],
                     folder / "audio.mp3", lambda: _running["cancel"], lambda n: None)
        if _running["cancel"]:
            raise Cancelled()
    return {}


def _finish_audio(folder: Path) -> float:
    wav, flac, mp3 = folder / "audio.wav", folder / "audio.flac", folder / "audio.mp3"
    if wav.is_file():
        audio.convert(wav, flac)
        wav.unlink()
    if flac.is_file() and not mp3.is_file():
        audio.convert(flac, mp3)
    return round(audio.duration(mp3), 2)


def _run(job: dict):
    _running.update(id=job["id"], cancel=False)
    job.update(state="running", stage="準備中", progress=0, started_at=now())
    save(job)
    publish_queue()
    folder = None
    try:
        missing = [] if job["type"] == "voice" and job["params"]["backend"] == "api" else \
            components.missing_for(job["type"] if job["type"] != "voice" else
                                   "voice_hq" if job["params"].get("quality") == "high" else "voice_local")
        if job["type"] == "stems" and job["params"]["model"] == "htdemucs_ft":
            missing = [m for m in missing if m != components.BY_ID["model:htdemucs"]["name"]]
            if not components.ready("model:htdemucs-ft"):
                missing.append(components.BY_ID["model:htdemucs-ft"]["name"])
        if missing:
            raise EngineError(f"還沒安裝：{'、'.join(missing)}。請先到安裝頁安裝。")
        folder = _folder(job["title"], job["id"])
        extra = _execute(job, folder)
        if _running["cancel"]:
            raise Cancelled()
        job.update(stage="儲存作品", progress=0.99)
        save(job)
        duration = _finish_audio(folder)
        p = job["params"]
        (folder / "request.json").write_text(json.dumps({"type": job["type"], "params": p}, ensure_ascii=False,
                                                        indent=2), encoding="utf-8")
        track = {"id": new_id(), "title": job["title"], "kind": job["type"], "created_at": now(),
                 "duration_s": duration, "params": p, "liked": False, "hue": random.randint(0, 359),
                 "folder": str(folder), "score_abc": extra.get("score_abc"), "stems": extra.get("stems")}
        for key in ("style", "lyrics", "text"):
            if p.get(key):
                track[key] = p[key]
        track = {k: v for k, v in track.items() if v is not None}
        db.put("tracks", track)
        events.publish("track", {"action": "created", "track": track_view(track)})
        job.update(state="done", stage="完成", progress=1, eta_seconds=0, track_id=track["id"], finished_at=now())
    except Cancelled:
        job.update(state="cancelled", stage="已取消", eta_seconds=None, finished_at=now())
    except (EngineError, fish_api.FishError) as exc:
        job.update(state="failed", stage="失敗", eta_seconds=None, error=str(exc), finished_at=now())
    except Exception as exc:  # noqa: BLE001 - the UI must always learn the job ended
        job.update(state="failed", stage="失敗", eta_seconds=None, finished_at=now(),
                   error=f"發生未預期的錯誤：{exc}。詳細記錄在 {config.data_dir() / 'logs'}")
    if job["state"] != "done" and folder is not None:
        shutil.rmtree(folder, ignore_errors=True)
    _running.update(id=None, cancel=False)
    if db.get("jobs", job["id"]):   # may have been deleted meanwhile
        save(job)


def _loop():
    while True:
        queued = sorted((j for j in db.all("jobs") if j["state"] == "queued"), key=lambda j: j["created_at"])
        if not queued:
            _wake.wait()
            _wake.clear()
            continue
        _run(queued[0])


def start():
    for job in db.all("jobs"):
        if job["state"] == "running":
            job.update(state="failed", stage="失敗", finished_at=now(),
                       error="Sona 關閉時這個任務還沒完成，請重新送出。")
            db.put("jobs", job)
    threading.Thread(target=_loop, daemon=True, name="jobs").start()
