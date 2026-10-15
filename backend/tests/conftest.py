"""Runs the real backend process in fake-engine mode and talks to it over HTTP."""
import json
import math
import os
import struct
import subprocess
import sys
import time
import wave
from pathlib import Path

import httpx
import pytest

TOKEN = "test-token"


@pytest.fixture(scope="session")
def server(tmp_path_factory):
    root = tmp_path_factory.mktemp("sona")
    env = {**os.environ, "SONA_FAKE_ENGINES": "1", "SONA_TOKEN": TOKEN, "SONA_PORT": "",
           "SONA_DATA_DIR": str(root / "data"), "SONA_MUSIC_DIR": str(root / "music"),
           "SONA_FAKE_STEP_SECONDS": "0.03"}
    proc = subprocess.Popen([sys.executable, "-m", "sona_backend"], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                            env=env, cwd=Path(__file__).parent.parent, text=True)
    line = proc.stdout.readline()
    assert line.startswith("SONA_READY "), line
    ready = json.loads(line.split(" ", 1)[1])
    yield {"url": f"http://127.0.0.1:{ready['port']}", "root": root, "proc": proc}
    proc.stdin.close()      # parent "exits": backend must quit on stdin EOF
    proc.wait(timeout=10)


@pytest.fixture(scope="session")
def api(server):
    with httpx.Client(base_url=server["url"] + "/api", headers={"Authorization": f"Bearer {TOKEN}"},
                      timeout=30) as client:
        yield client


def sine_wav(path: Path, seconds: float, rate=44100) -> Path:
    with wave.open(str(path), "wb") as f:
        f.setnchannels(1)
        f.setsampwidth(2)
        f.setframerate(rate)
        f.writeframes(b"".join(struct.pack("<h", int(5000 * math.sin(i / 20))) for i in range(int(seconds * rate))))
    return path


def wait_job(api, id, timeout=20):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        job = api.get(f"/jobs/{id}").json()
        if job["state"] in ("done", "failed", "cancelled"):
            return job
        time.sleep(0.05)
    raise AssertionError(f"job {id} did not finish: {job}")


def wait_component(api, id, states, timeout=10):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        c = next(c for c in api.get("/components").json() if c["id"] == id)
        if c["state"] in states:
            return c
        time.sleep(0.02)
    raise AssertionError(f"component {id} stuck: {c}")
