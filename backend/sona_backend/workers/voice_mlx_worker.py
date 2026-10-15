"""Fish Audio Drama 3 (4-bit MLX) voice cloning. Runs in envs/voice-mlx.

Stays resident between requests (the model is ~22 GB to load) and exits after
5 idle minutes. Request: {"text", "ref_audio": wav path, "ref_text", "out"} -> out/audio.wav
"""
import os
import queue
import sys
import threading
from pathlib import Path

import common
from common import emit, progress, stage

MODEL = "mlx-community/fish-audio-drama-3-4bit"
IDLE_SECONDS = 300


def generate(model, request):
    import numpy as np
    import soundfile as sf
    from mlx_audio.tts.models.fish_drama3.chunking import split_text

    stage("生成語音", 0.05)
    total = max(1, len(split_text(request["text"])))
    rate = common.Rate()
    pieces = []
    for result in model.generate(text=request["text"], ref_audio=request["ref_audio"], ref_text=request["ref_text"]):
        pieces.append(np.asarray(result.audio, dtype=np.float32))
        done = result.segment_idx + 1
        progress(0.05 + 0.9 * done / total, rate.eta(done, total))
    out = Path(request["out"])
    out.mkdir(parents=True, exist_ok=True)
    audio = np.concatenate(pieces) if pieces else np.zeros(0, dtype=np.float32)
    sf.write(out / "audio.wav", audio, model.sample_rate, subtype="PCM_16")
    return {"duration_s": len(audio) / model.sample_rate}


def main():
    requests = queue.Queue()

    def read():
        while (request := common.read_request()) is not None:
            requests.put(request)
        os._exit(0)     # backend closed stdin or died

    threading.Thread(target=read, daemon=True).start()
    model = None
    while True:
        try:
            request = requests.get(timeout=IDLE_SECONDS)
        except queue.Empty:
            return
        try:
            if model is None:
                emit("engine", state="loading")
                stage("載入模型", 0.0)
                from mlx_audio.tts.utils import load_model
                model = load_model(MODEL)
                emit("engine", state="ready")
            emit("result", **generate(model, request))
        except Exception as exc:  # noqa: BLE001
            import traceback
            traceback.print_exc()
            emit("error", message=str(exc) or type(exc).__name__)


if __name__ == "__main__":
    sys.exit(main())
