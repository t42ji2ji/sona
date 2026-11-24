import json
import threading
import time
from pathlib import Path

import httpx

from conftest import TOKEN, sine_wav, wait_component, wait_job
from sona_backend import components

SONG_MODEL = components.YUE2[1]   # model:yue2-mlx on Apple Silicon, model:yue2-3b elsewhere


def upload(api, tmp_path, seconds=5.0, name="song.wav"):
    path = sine_wav(tmp_path / name, seconds)
    r = api.post("/uploads", files={"file": (name, path.read_bytes(), "audio/wav")})
    assert r.status_code == 200, r.text
    return r.json()


def make_voice(api, tmp_path, seconds=5.0, transcript="你好"):
    path = sine_wav(tmp_path / "ref.wav", seconds)
    r = api.post("/voices", data={"name": "我", "transcript": transcript},
                 files={"file": ("ref.wav", path.read_bytes(), "audio/wav")})
    assert r.status_code == 200, r.text
    return r.json()


def submit(api, type, **params):
    r = api.post("/jobs", json={"type": type, "params": params})
    assert r.status_code == 200, r.text
    return r.json()


# ---- auth & system --------------------------------------------------------------

def test_token(server):
    url = server["url"] + "/api"
    assert httpx.get(url + "/health").json()["ok"] is True
    r = httpx.get(url + "/system")
    assert r.status_code == 401 and r.json()["error"]["code"] == "unauthorized"
    assert httpx.get(url + "/system", headers={"Authorization": "Bearer wrong"}).status_code == 401
    assert httpx.get(url + "/system", params={"token": TOKEN}).status_code == 200


def test_cors_preflight(server):
    r = httpx.options(server["url"] + "/api/jobs", headers={
        "Origin": "http://localhost:5173", "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "authorization,content-type"})
    assert r.status_code == 200
    assert r.headers["access-control-allow-origin"] == "http://localhost:5173"
    r = httpx.get(server["url"] + "/api/health", headers={"Origin": "null"})
    assert r.headers["access-control-allow-origin"] == "null"


def test_system(api):
    s = api.get("/system").json()
    assert s["platform"] in ("mac", "windows", "linux")
    assert s["accelerator"]["kind"] in ("mps", "cuda", "cpu")
    assert set(s["capabilities"]) == {"song", "instrumental", "cover", "stems", "voice_local", "voice_hq", "voice_api"}
    assert s["music_dir"]


# ---- components -----------------------------------------------------------------

def test_components_listed_ready(api):
    comps = api.get("/components").json()
    ids = {c["id"] for c in comps}
    assert {"env:yue2", "env:yue2-mlx", "env:demucs", "env:voice-mlx", "model:yue2-3b", "model:yue2-vae", "model:yue2-mlx",
            "model:sheetsage2",
            "model:htdemucs", "model:htdemucs-ft", "model:drama3-mlx", "model:qwen3-tts", "model:qwen3-asr"} == ids
    for c in comps:
        assert c["state"] in ("ready", "unsupported")
        assert c["size_bytes"] > 0


def test_component_install_progress_and_job_gate(api, tmp_path):
    api.delete(f"/components/{SONG_MODEL}").raise_for_status()
    assert wait_component(api, SONG_MODEL, ["missing"])["done_bytes"] == 0
    job = wait_job(api, submit(api, "song", style="pop", lyrics="[Verse]\nla")["id"])
    assert job["state"] == "failed" and "YuE2-3B" in job["error"]
    seen = []
    r = api.post(f"/components/{SONG_MODEL}/install")
    assert r.json()["state"] in ("queued", "installing", "ready")
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        c = next(c for c in api.get("/components").json() if c["id"] == SONG_MODEL)
        seen.append((c["state"], c["done_bytes"]))
        if c["state"] == "ready":
            break
    assert seen[-1][0] == "ready" and seen[-1][1] == c["size_bytes"]
    installing = [d for s, d in seen if s == "installing"]
    assert installing == sorted(installing)
    api.post(f"/components/{SONG_MODEL}/install").raise_for_status()   # idempotent
    assert wait_component(api, SONG_MODEL, ["ready"])


def test_component_cancel(api):
    api.delete("/components/model:sheetsage2").raise_for_status()
    api.post("/components/model:sheetsage2/install")
    api.post("/components/model:sheetsage2/cancel")
    assert wait_component(api, "model:sheetsage2", ["missing"])["state"] == "missing"
    api.post("/components/model:sheetsage2/install")
    wait_component(api, "model:sheetsage2", ["ready"])


def test_feature_install(api):
    for id in ("env:demucs", "model:htdemucs"):
        api.delete(f"/components/{id}").raise_for_status()
    r = api.post("/features/stems/install")
    assert {c["id"] for c in r.json()} == {"env:demucs", "model:htdemucs"}
    for id in ("env:demucs", "model:htdemucs"):
        wait_component(api, id, ["ready"])
    assert api.post("/features/nope/install").status_code == 404


# ---- jobs --------------------------------------------------------------------------

def check_track(api, job, kind):
    assert job["state"] == "done", job
    t = api.get(f"/tracks/{job['track_id']}").json()
    assert t["kind"] == kind and t["duration_s"] > 0 and 0 <= t["hue"] < 360 and t["liked"] is False
    assert Path(t["folder"], "audio.mp3").is_file() and Path(t["folder"], "request.json").is_file()
    r = api.get(t["audio_url"].removeprefix("/api"), headers={"Range": "bytes=0-99"})
    assert r.status_code == 206 and len(r.content) == 100
    return t


def test_song(api):
    t = check_track(api, wait_job(api, submit(api, "song", style="pop", lyrics="[Verse]\n你好世界", mode="melody")["id"]),
                    "song")
    assert t["style"] == "pop" and t["lyrics"].endswith("你好世界") and t["title"] == "你好世界"
    assert t["score_abc"].startswith("X:1")
    assert Path(t["folder"], "audio.flac").is_file()


def test_instrumental(api):
    t = check_track(api, wait_job(api, submit(api, "instrumental", style="warm piano", title="夜")["id"]), "instrumental")
    assert t["title"] == "夜"


def test_cover(api, tmp_path):
    up = upload(api, tmp_path)
    t = check_track(api, wait_job(api, submit(api, "cover", upload_id=up["upload_id"], style="jazz",
                                              instrumental=True)["id"]), "cover")
    assert t["title"] == "song 翻唱"
    r = api.post("/jobs", json={"type": "cover", "params": {"upload_id": up["upload_id"], "style": "jazz"}})
    assert r.status_code == 400 and "歌詞" in r.json()["error"]["message"]


def test_stems_from_upload_and_track(api, tmp_path):
    up = upload(api, tmp_path)
    t = check_track(api, wait_job(api, submit(api, "stems", upload_id=up["upload_id"])["id"]), "stems")
    assert [s["name"] for s in t["stems"]] == ["vocals", "drums", "bass", "other"]
    r = api.get(t["stems"][0]["url"].removeprefix("/api"))
    assert r.status_code == 200 and r.content[:4] == b"RIFF"
    t2 = check_track(api, wait_job(api, submit(api, "stems", track_id=t["id"])["id"]), "stems")
    assert t2["title"].endswith("拆軌")
    assert api.post("/jobs", json={"type": "stems", "params": {}}).status_code == 400


def test_voice_local(api, tmp_path):
    v = make_voice(api, tmp_path)
    t = check_track(api, wait_job(api, submit(api, "voice", voice_id=v["id"], text="今天天氣很好", backend="local")["id"]),
                    "voice")
    assert t["text"] == "今天天氣很好"


def test_voice_local_transcribes_reference(api, tmp_path):
    v = make_voice(api, tmp_path, transcript="")
    assert v["transcript"] == ""
    check_track(api, wait_job(api, submit(api, "voice", voice_id=v["id"], text="嗨", backend="local")["id"]), "voice")
    assert api.get("/voices").json()[0]["transcript"] == "我們去公園"


def test_voice_quality(api, tmp_path):
    v = make_voice(api, tmp_path)
    for q in ("fast", "high"):
        check_track(api, wait_job(api, submit(api, "voice", voice_id=v["id"], text="嗨", backend="local", quality=q)["id"]), "voice")
    r = api.post("/jobs", json={"type": "voice", "params": {"voice_id": v["id"], "text": "嗨", "backend": "local", "quality": "max"}})
    assert r.status_code == 400 and r.json()["error"]["code"] == "invalid_params"


def test_polish(api):
    assert api.post("/polish", json={"text": "今天好累"}).json() == {"text": "今天好累！", "tool": "claude"}
    assert api.post("/polish", json={"text": " "}).status_code == 400
    assert set(api.get("/system").json()["ai_tools"]) == {"claude", "codex"}


def test_voice_api_requires_key(api, tmp_path):
    v = make_voice(api, tmp_path)
    api.put("/settings", json={"fish_api_key": ""})
    r = api.post("/jobs", json={"type": "voice", "params": {"voice_id": v["id"], "text": "hi", "backend": "api"}})
    assert r.status_code == 400 and r.json()["error"]["code"] == "missing_api_key"


def test_invalid_jobs(api):
    for body in ({"type": "nope", "params": {}}, {"type": "song", "params": {"style": "x"}},
                 {"type": "song", "params": {"style": "x", "lyrics": "y", "mode": "bad"}},
                 {"type": "song", "params": {"style": "x", "lyrics": "y", "seed": -1}},
                 {"type": "voice", "params": {"voice_id": "missing", "text": "hi"}}):
        r = api.post("/jobs", json=body)
        assert r.status_code in (400, 404), body
        assert r.json()["error"]["message"]


def test_queue_order_and_cancel(api):
    slow = submit(api, "song", style="a", lyrics="one", fake_step_seconds=0.2)
    second = submit(api, "song", style="b", lyrics="two")
    third = submit(api, "instrumental", style="c")
    assert api.get(f"/jobs/{third['id']}").json()["queue_position"] == 2
    api.post(f"/jobs/{second['id']}/cancel").raise_for_status()
    assert api.get(f"/jobs/{second['id']}").json()["state"] == "cancelled"
    assert api.get(f"/jobs/{third['id']}").json()["queue_position"] == 1
    deadline = time.monotonic() + 5
    while api.get(f"/jobs/{slow['id']}").json()["state"] != "running":
        assert time.monotonic() < deadline
        time.sleep(0.02)
    r = api.post(f"/jobs/{slow['id']}/cancel")
    assert r.status_code == 200
    slow_job = wait_job(api, slow["id"])
    assert slow_job["state"] == "cancelled" and "track_id" not in slow_job
    third_job = wait_job(api, third["id"])
    assert third_job["state"] == "done"
    assert third_job["started_at"] >= slow_job["finished_at"]
    listed = [j["id"] for j in api.get("/jobs").json()]
    assert listed.index(third["id"]) < listed.index(second["id"]) < listed.index(slow["id"])   # newest first


def test_delete_job(api):
    job = wait_job(api, submit(api, "instrumental", style="x")["id"])
    assert api.delete(f"/jobs/{job['id']}").status_code == 200
    assert api.get(f"/jobs/{job['id']}").status_code == 404
    running = submit(api, "song", style="a", lyrics="b", fake_step_seconds=0.2)
    assert api.delete(f"/jobs/{running['id']}").status_code == 200
    assert api.get(f"/jobs/{running['id']}").status_code == 404


# ---- SSE -----------------------------------------------------------------------------

def read_events(server, until, timeout=15):
    """Collect SSE events in a thread until until(events) is true."""
    collected = []
    done = threading.Event()

    def run():
        with httpx.stream("GET", server["url"] + "/api/events", params={"token": TOKEN}, timeout=timeout) as r:
            assert r.headers["content-type"].startswith("text/event-stream")
            kind = None
            for line in r.iter_lines():
                if line.startswith("event: "):
                    kind = line[7:]
                elif line.startswith("data: "):
                    collected.append((kind, json.loads(line[6:])))
                    if until(collected):
                        break
        done.set()
    thread = threading.Thread(target=run, daemon=True)
    thread.start()
    return collected, done


def test_sse(api, server):
    job_id = {}
    events, done = read_events(server, lambda ev: any(
        k == "job" and d["id"] == job_id.get("id") and d["state"] == "done" for k, d in ev))
    time.sleep(0.5)
    assert sum(1 for k, _ in events if k == "component") == 13   # snapshot on connect
    job_id["id"] = submit(api, "song", style="pop", lyrics="hello")["id"]
    assert done.wait(20)
    job_events = [d for k, d in events if k == "job" and d["id"] == job_id["id"]]
    states = [d["state"] for d in job_events]
    assert states[0] == "queued" and states[-1] == "done" and "running" in states
    stages = [d["stage"] for d in job_events]
    for stage in ("載入模型", "規劃旋律", "生成聲音", "合成音訊", "完成"):
        assert stage in stages
    progress = [d["progress"] for d in job_events if d["state"] == "running" and d["progress"] >= 0]
    assert progress == sorted(progress)
    track_id = job_events[-1]["track_id"]
    assert any(k == "track" and d["action"] == "created" and d["track"]["id"] == track_id for k, d in events)
    engine = [d for k, d in events if k == "engine"]
    assert {"engine": "yue2", "state": "loading"} in engine and {"engine": "yue2", "state": "ready"} in engine


def test_sse_snapshot_includes_active_jobs(api, server):
    job = submit(api, "song", style="pop", lyrics="snap", fake_step_seconds=0.2)
    events, done = read_events(server, lambda ev: any(k == "engine" for k, _ in ev))
    assert done.wait(10)
    assert job["id"] in [d["id"] for k, d in events if k == "job"]
    wait_job(api, job["id"])


# ---- tracks / uploads / voices / settings --------------------------------------------

def test_track_patch_delete(api):
    job = wait_job(api, submit(api, "instrumental", style="x")["id"])
    id = job["track_id"]
    t = api.patch(f"/tracks/{id}", json={"title": "新名字", "liked": True}).json()
    assert t["title"] == "新名字" and t["liked"] is True
    assert api.patch(f"/tracks/{id}", json={"title": " "}).status_code == 400
    assert id in [x["id"] for x in api.get("/tracks").json()]
    folder = Path(t["folder"])
    assert api.delete(f"/tracks/{id}").status_code == 200
    assert not folder.exists() and api.get(f"/tracks/{id}").status_code == 404


def test_upload_formats(api, tmp_path):
    up = upload(api, tmp_path, seconds=2.5)
    assert up["filename"] == "song.wav" and abs(up["duration_s"] - 2.5) < 0.05
    r = api.post("/uploads", files={"file": ("x.txt", b"hello", "text/plain")})
    assert r.status_code == 400 and r.json()["error"]["code"] == "unsupported_format"
    r = api.post("/uploads", files={"file": ("x.mp3", b"not audio at all", "audio/mpeg")})
    assert r.status_code == 400 and r.json()["error"]["code"] == "unreadable_audio"


def test_voices(api, tmp_path):
    v = make_voice(api, tmp_path, seconds=40)
    assert v["duration_s"] == 30 and v["name"] == "我" and v["transcript"] == "你好"
    assert v in api.get("/voices").json()
    r = api.get(v["sample_url"].removeprefix("/api"))
    assert r.status_code == 200 and r.content[:4] == b"RIFF"
    assert api.delete(f"/voices/{v['id']}").status_code == 200
    assert api.get(f"/voices/{v['id']}/sample").status_code == 404


def test_settings(api, tmp_path):
    s = api.get("/settings").json()
    assert set(s) == {"music_dir", "voice_backend", "fish_api_key_set", "language"}
    s = api.put("/settings", json={"fish_api_key": "sk-123", "language": "en"}).json()
    assert s["fish_api_key_set"] is True and s["language"] == "en" and "fish_api_key" not in s
    new_dir = tmp_path / "elsewhere"
    assert api.put("/settings", json={"music_dir": str(new_dir)}).json()["music_dir"] == str(new_dir)
    assert api.get("/system").json()["music_dir"] == str(new_dir)
    job = wait_job(api, submit(api, "instrumental", style="x")["id"])
    assert Path(api.get(f"/tracks/{job['track_id']}").json()["folder"]).parent == new_dir
    assert api.put("/settings", json={"language": "fr"}).status_code == 400
    api.put("/settings", json={"language": "zh-TW", "fish_api_key": ""})
