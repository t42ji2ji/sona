"""HTTP API (see CONTRACT.md)."""
from __future__ import annotations

import asyncio
import json
import shutil
import subprocess
import sys
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, File, Form, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from starlette.exceptions import HTTPException

from . import audio, components, config, db, events, jobs, settings
from .engine import manager
from .errors import ApiError

AUDIO_TYPES = {".mp3", ".wav", ".flac", ".m4a"}
VOICE_MAX_SECONDS = 30


def create_app(token: str) -> FastAPI:
    @asynccontextmanager
    async def lifespan(_app):
        events.bind(asyncio.get_running_loop())
        db.connect()
        components.start()
        jobs.start()
        yield

    app = FastAPI(lifespan=lifespan)

    def error(status: int, code: str, message: str) -> JSONResponse:
        return JSONResponse({"error": {"code": code, "message": message}}, status_code=status)

    @app.exception_handler(ApiError)
    async def _api_error(_req, exc: ApiError):
        return error(exc.status, exc.code, exc.message)

    @app.exception_handler(HTTPException)
    async def _http_error(_req, exc: HTTPException):
        return error(exc.status_code, "http_error", "找不到這個頁面。" if exc.status_code == 404 else str(exc.detail))

    @app.exception_handler(RequestValidationError)
    async def _validation_error(_req, exc: RequestValidationError):
        fields = "、".join(".".join(str(x) for x in e["loc"][1:]) or "body" for e in exc.errors())
        return error(422, "invalid_request", f"請求格式不對：{fields}。")

    @app.middleware("http")
    async def auth(request: Request, call_next):
        path = request.url.path
        if request.method != "OPTIONS" and path.startswith("/api") and path != "/api/health":
            header = request.headers.get("authorization", "")
            if header != f"Bearer {token}" and request.query_params.get("token") != token:
                return error(401, "unauthorized", "驗證失敗，請重新啟動 Sona。")
        return await call_next(request)

    app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173", "null"],
                       allow_origin_regex=r"(file|app)://.*", allow_methods=["*"], allow_headers=["*"])

    # ---- system --------------------------------------------------------------

    @app.get("/api/health")
    def health():
        return {"ok": True, "version": config.VERSION}

    @app.get("/api/system")
    def system():
        return {**config.system(), "capabilities": config.capabilities(), "music_dir": settings.load()["music_dir"]}

    # ---- components ------------------------------------------------------------

    @app.get("/api/components")
    def list_components():
        return components.all_components()

    @app.post("/api/components/{id}/install")
    def install_component(id: str):
        components.install(id)
        return components.describe(id)

    @app.post("/api/components/{id}/cancel")
    def cancel_component(id: str):
        components.cancel(id)
        return components.describe(id)

    @app.delete("/api/components/{id}")
    def delete_component(id: str):
        components.remove(id)
        return components.describe(id)

    @app.post("/api/features/{feature}/install")
    def install_feature(feature: str):
        components.install_feature(feature)
        return [components.describe(i) for i in components.FEATURE_COMPONENTS[feature]]

    # ---- jobs ------------------------------------------------------------------

    @app.post("/api/jobs")
    def create_job(body: dict):
        return jobs.create(body.get("type"), body.get("params") or {})

    @app.get("/api/jobs")
    def list_jobs():
        return [jobs.with_position(j) for j in db.all("jobs")]

    def job_or_404(id: str) -> dict:
        job = db.get("jobs", id)
        if not job:
            raise ApiError(404, "job_not_found", "找不到這個任務。")
        return job

    @app.get("/api/jobs/{id}")
    def get_job(id: str):
        return jobs.with_position(job_or_404(id))

    @app.post("/api/jobs/{id}/cancel")
    def cancel_job(id: str):
        return jobs.cancel(id)

    @app.delete("/api/jobs/{id}")
    def delete_job(id: str):
        jobs.delete(id)
        return {"ok": True}

    # ---- tracks ----------------------------------------------------------------

    def track_or_404(id: str) -> dict:
        track = db.get("tracks", id)
        if not track:
            raise ApiError(404, "track_not_found", "找不到這首作品。")
        return track

    @app.get("/api/tracks")
    def list_tracks():
        return [jobs.track_view(t) for t in db.all("tracks")]

    @app.get("/api/tracks/{id}")
    def get_track(id: str):
        return jobs.track_view(track_or_404(id))

    @app.patch("/api/tracks/{id}")
    def patch_track(id: str, body: dict):
        track = track_or_404(id)
        if "title" in body:
            if not isinstance(body["title"], str) or not body["title"].strip():
                raise ApiError(400, "invalid_title", "標題不能是空的。")
            track["title"] = body["title"].strip()[:80]
        if "liked" in body:
            track["liked"] = bool(body["liked"])
        db.put("tracks", track)
        view = jobs.track_view(track)
        events.publish("track", {"action": "updated", "track": view})
        return view

    @app.delete("/api/tracks/{id}")
    def delete_track(id: str):
        track = track_or_404(id)
        shutil.rmtree(track["folder"], ignore_errors=True)
        db.delete("tracks", id)
        events.publish("track", {"action": "deleted", "track": jobs.track_view(track)})
        return {"ok": True}

    @app.get("/api/tracks/{id}/audio")
    def track_audio(id: str):
        path = Path(track_or_404(id)["folder"]) / "audio.mp3"
        if not path.is_file():
            raise ApiError(404, "file_missing", f"音檔不見了：{path}。可能被移動或刪除。")
        return FileResponse(path, media_type="audio/mpeg")

    @app.get("/api/tracks/{id}/stems/{name}")
    def track_stem(id: str, name: str):
        track = track_or_404(id)
        if name not in (track.get("stems") or []):
            raise ApiError(404, "stem_not_found", "這首作品沒有這個音軌。")
        path = Path(track["folder"]) / "stems" / f"{name}.wav"
        if not path.is_file():
            raise ApiError(404, "file_missing", f"音檔不見了：{path}。可能被移動或刪除。")
        return FileResponse(path, media_type="audio/wav")

    @app.post("/api/tracks/{id}/reveal")
    def reveal_track(id: str):
        folder = Path(track_or_404(id)["folder"])
        target = folder / "audio.mp3" if (folder / "audio.mp3").exists() else folder
        if sys.platform == "darwin":
            subprocess.Popen(["open", "-R", str(target)])
        elif sys.platform == "win32":
            subprocess.Popen(["explorer", f"/select,{target}"])
        else:
            subprocess.Popen(["xdg-open", str(folder)])
        return {"ok": True}

    # ---- uploads & voices ------------------------------------------------------

    def store_audio(file: UploadFile, folder: Path, id: str, **convert) -> tuple[Path, float]:
        """Save the upload, normalize to wav so workers never see m4a/mp3."""
        suffix = Path(file.filename or "").suffix.lower()
        if suffix not in AUDIO_TYPES:
            raise ApiError(400, "unsupported_format", "只接受 mp3、wav、flac、m4a 音檔。")
        folder.mkdir(parents=True, exist_ok=True)
        raw = folder / f"{id}.orig{suffix}"
        with raw.open("wb") as f:
            shutil.copyfileobj(file.file, f)
        wav = folder / f"{id}.wav"
        try:
            if not audio.readable(raw):
                raise ApiError(400, "unreadable_audio", "讀不出這個音檔，檔案可能損壞或格式不對。")
            seconds = audio.convert(raw, wav, **convert)
        finally:
            raw.unlink(missing_ok=True)
        return wav, round(seconds, 2)

    @app.post("/api/uploads")
    def upload(file: UploadFile = File(...)):
        id = jobs.new_id()
        path, seconds = store_audio(file, config.data_dir() / "uploads", id)
        db.put("uploads", {"id": id, "created_at": jobs.now(), "filename": file.filename, "path": str(path),
                           "duration_s": seconds})
        return {"upload_id": id, "filename": file.filename, "duration_s": seconds}

    def voice_view(v: dict) -> dict:
        return {k: v[k] for k in ("id", "name", "transcript", "duration_s", "created_at")} | \
            {"sample_url": f"/api/voices/{v['id']}/sample"}

    @app.get("/api/voices")
    def list_voices():
        return [voice_view(v) for v in db.all("voices")]

    @app.post("/api/voices")
    def create_voice(name: str = Form(...), transcript: str = Form(""), file: UploadFile = File(...)):
        if not name.strip():
            raise ApiError(400, "invalid_params", "聲音名稱要填。")
        id = jobs.new_id()
        path, seconds = store_audio(file, config.data_dir() / "voices", id, max_seconds=VOICE_MAX_SECONDS,
                                    mono=True, rate=44100)
        voice = {"id": id, "name": name.strip(), "transcript": transcript.strip(), "duration_s": seconds,
                 "created_at": jobs.now(), "path": str(path)}
        db.put("voices", voice)
        return voice_view(voice)

    def voice_or_404(id: str) -> dict:
        voice = db.get("voices", id)
        if not voice:
            raise ApiError(404, "voice_not_found", "找不到這個聲音。")
        return voice

    @app.delete("/api/voices/{id}")
    def delete_voice(id: str):
        Path(voice_or_404(id)["path"]).unlink(missing_ok=True)
        db.delete("voices", id)
        return {"ok": True}

    @app.get("/api/voices/{id}/sample")
    def voice_sample(id: str):
        return FileResponse(voice_or_404(id)["path"], media_type="audio/wav")

    # ---- settings ----------------------------------------------------------------

    @app.get("/api/settings")
    def get_settings():
        return settings.public()

    @app.put("/api/settings")
    def put_settings(body: dict):
        return settings.update(body)

    # ---- events ------------------------------------------------------------------

    @app.get("/api/events")
    async def stream(request: Request):
        queue = events.subscribe()

        def frame(type: str, data: dict) -> str:
            return f"event: {type}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"

        async def generate():
            try:
                for job in db.all("jobs"):
                    if job["state"] in ("queued", "running"):
                        yield frame("job", jobs.with_position(job))
                for component in components.all_components():
                    yield frame("component", component)
                yield frame("engine", manager.state())
                while not await request.is_disconnected():
                    try:
                        yield await asyncio.wait_for(queue.get(), timeout=15)
                    except asyncio.TimeoutError:
                        yield ": ping\n\n"
            finally:
                events.unsubscribe(queue)

        return StreamingResponse(generate(), media_type="text/event-stream",
                                 headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

    return app
