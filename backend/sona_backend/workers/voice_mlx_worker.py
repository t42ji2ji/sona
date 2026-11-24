"""Local voice cloning in envs/voice-mlx: Qwen3-TTS 1.7B (default, ~3 GB) or Fish Audio Drama 3 4-bit (~22 GB).

Stays resident between requests and exits after 5 idle minutes; holds one model at a time.
Request: {"text", "ref_audio": wav path, "ref_text", "out", "model": "qwen3" | "drama3"} -> out/audio.wav
An empty ref_text is transcribed with Qwen3-ASR first and returned as result["ref_text"].
"""
import os
import queue
import re
import sys
import threading
from pathlib import Path

import common
from common import emit, progress, stage

MODELS = {"qwen3": "mlx-community/Qwen3-TTS-12Hz-1.7B-Base-8bit", "drama3": "mlx-community/fish-audio-drama-3-4bit"}
ASR_MODEL = "mlx-community/Qwen3-ASR-0.6B-8bit"
IDLE_SECONDS = 300


def transcribe(path):
    import mlx.core as mx
    from mlx_audio.stt import load

    stage("辨識參考錄音", 0.0)
    asr = load(ASR_MODEL)
    text = asr.generate(path).text.strip()
    del asr
    mx.clear_cache()
    return text


def sentences(text, limit=80):
    """Qwen3-TTS drifts on long input: split at sentence ends into chunks under ~limit chars."""
    out, cur = [], ""
    for s in re.findall(r"[^。！？!?\n]+[。！？!?]*", text):
        s = s.strip()
        if not s:
            continue
        if cur and len(cur) + len(s) > limit:
            out.append(cur)
            cur = ""
        cur += s
    return out + ([cur] if cur else [])


def generate(model, request):
    import numpy as np
    import soundfile as sf

    stage("生成語音", 0.05)
    rate = common.Rate()
    pieces = []
    if request.get("model", "qwen3") == "qwen3":
        chunks = sentences(request["text"]) or [request["text"]]
        gap = np.zeros(int(model.sample_rate * 0.25), dtype=np.float32)
        for i, chunk in enumerate(chunks):
            for result in model.generate(text=chunk, ref_audio=request["ref_audio"], ref_text=request["ref_text"],
                                         lang_code="auto"):
                pieces.append(np.asarray(result.audio, dtype=np.float32))
            if i < len(chunks) - 1:
                pieces.append(gap)
            progress(0.05 + 0.9 * (i + 1) / len(chunks), rate.eta(i + 1, len(chunks)))
    else:
        from mlx_audio.tts.models.fish_drama3.chunking import split_text

        total = max(1, len(split_text(request["text"])))
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
    model, loaded = None, None
    while True:
        try:
            request = requests.get(timeout=IDLE_SECONDS)
        except queue.Empty:
            return
        try:
            name = request.get("model", "qwen3")
            if model is not None and loaded != name:    # one model at a time: Drama 3 alone is ~22 GB
                import gc
                import mlx.core as mx
                model, loaded = None, None
                gc.collect()
                mx.clear_cache()
            ref_text = request["ref_text"] or transcribe(request["ref_audio"])   # first: freed before a cold model load
            request = {**request, "ref_text": ref_text, "model": name}
            if model is None:
                emit("engine", state="loading")
                stage("載入模型", 0.0)
                from mlx_audio.tts.utils import load_model
                model, loaded = load_model(MODELS[name]), name
                emit("engine", state="ready")
            emit("result", **generate(model, request), ref_text=ref_text)
        except Exception as exc:  # noqa: BLE001
            import traceback
            traceback.print_exc()
            emit("error", message=str(exc) or type(exc).__name__)


if __name__ == "__main__":
    sys.exit(main())
