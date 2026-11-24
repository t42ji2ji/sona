"""SONA_FAKE_ENGINES=1 stand-in for every engine: same events, a sine wave instead of a model.

Runs under the core interpreter. Request is whatever the real worker would get, plus "engine".
SONA_FAKE_STEP_SECONDS sets the pause between progress events (default 0.3);
a job param "fake_step_seconds" overrides it (tests use it to keep one job running).
"""
import math
import os
import struct
import time
import wave
from pathlib import Path

import common
from common import emit, progress, stage

STAGES = {
    "yue2": ["規劃旋律", "生成聲音", "合成音訊", "解碼音訊"],
    "sheetsage": ["轉旋律譜"],
    "demucs": ["分離音軌"],
    "voice-mlx": ["生成語音"],
}
STEP = float(os.environ.get("SONA_FAKE_STEP_SECONDS", "0.3"))


def sine(path, seconds=3.0, freq=440.0, rate=44100):
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as f:
        f.setnchannels(2)
        f.setsampwidth(2)
        f.setframerate(rate)
        frames = bytearray()
        for i in range(int(seconds * rate)):
            v = int(8000 * math.sin(2 * math.pi * freq * i / rate))
            frames += struct.pack("<hh", v, v)
        f.writeframes(bytes(frames))


def handle(request):
    global STEP
    engine = request["engine"]
    out = Path(request["out"])
    STEP = float(request.get("params", {}).get("fake_step_seconds", STEP))
    emit("engine", state="loading")
    stage("載入模型", 0.0)
    time.sleep(STEP)
    emit("engine", state="ready")
    stages = STAGES[engine]
    for i, name in enumerate(stages):
        stage(name, i / len(stages))
        for k in range(1, 3):
            time.sleep(STEP)
            progress((i + k / 2) / len(stages), STEP * (len(stages) - i) * 2)
    if engine == "demucs":
        for n, name in enumerate(["vocals", "drums", "bass", "other"]):
            sine(out / "stems" / f"{name}.wav", freq=220 * (n + 1))
        return {"stems": ["vocals", "drums", "bass", "other"]}
    if engine == "sheetsage":
        abc = "X:1\nT:\nM:4/4\nL:1/8\nQ:1/4=100\nV: Vocal\nV: Ins\nK:C\n% verse\nV: Vocal\nCDEF GABc|\nV: Ins\nZ|\n"
        out.mkdir(parents=True, exist_ok=True)
        (out / "score.abc").write_text(abc, encoding="utf-8")
        return {"abc": abc}
    sine(out / "audio.wav")
    abc = "X:1\nT:\nM:4/4\nL:1/8\nK:C\nV: Vocal\nCDEF GABc|\n" if engine == "yue2" else None
    if abc:
        (out / "score.abc").write_text(abc, encoding="utf-8")
    if engine == "voice-mlx":
        return {"duration_s": 3.0, "ref_text": request["ref_text"] or "我们去公园"}
    return {"score_abc": abc, "duration_s": 3.0}


if __name__ == "__main__":
    common.run(handle)
