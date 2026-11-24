"""Manual checks of the real engines, outside the HTTP server.

    uv run --project backend python -m sona_backend.smoke doctor
        imports + model paths in every engine env; loads no large weights
    uv run --project backend python -m sona_backend.smoke yue2 [--instrumental] [--out DIR]
        one real YuE2 generation (~12 GB, minutes)
    uv run --project backend python -m sona_backend.smoke cover AUDIO [--instrumental] [--lyrics TEXT]
        SheetSage2 transcription + YuE2 generation
    uv run --project backend python -m sona_backend.smoke voice --ref WAV [--ref-text TEXT] [--text TEXT] [--high]
        one real local voice generation: Qwen3-TTS (~3 GB), or Drama 3 with --high (~26 GB peak);
        without --ref-text the reference is transcribed first
"""
import argparse
import json
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path

from . import audio, config
from .engine import manager

CHECKS = {
    "yue2": """
import torch, yue2
from yue2.storage import resolve_model
from yue2.tokenization_yue2 import YuE2TextTokenizer
model = resolve_model("m-a-p/YuE2-3B", local_files_only=True)
vae = resolve_model("m-a-p/YuE2-Vae", local_files_only=True)
YuE2TextTokenizer(model / "qwen.tiktoken").encode("hello")
print("yue2", yue2.__version__, "torch", torch.__version__, "mps", torch.backends.mps.is_available(),
      "cuda", torch.cuda.is_available())
print("model", model); print("vae", vae)
""",
    "demucs": """
import inspect, torch
from demucs.pretrained import get_model
from transformers import AutoConfig
from transformers.dynamic_module_utils import get_class_from_dynamic_module
m = get_model("htdemucs")
print("demucs htdemucs sources", m.sources, "torch", torch.__version__, "mps", torch.backends.mps.is_available())
cfg = AutoConfig.from_pretrained("m-a-p/SheetSage2", trust_remote_code=True, local_files_only=True)
cls = get_class_from_dynamic_module(cfg.auto_map["AutoModel"], "m-a-p/SheetSage2", local_files_only=True)
print("sheetsage2", cls.__name__, "melody_only" in inspect.signature(cls.transcribe).parameters)
""",
    "voice-mlx": """
import mlx.core as mx
from huggingface_hub import snapshot_download
from mlx_audio.tts.utils import load_model
from mlx_audio.tts.models.fish_drama3.chunking import split_text
import os, tempfile, numpy as np, soundfile as sf
from mlx_audio.utils import load_audio
path = snapshot_download("mlx-community/fish-audio-drama-3-4bit", local_files_only=True)
ref = os.path.join(tempfile.mkdtemp(), "ref.wav")
sf.write(ref, np.zeros(44100, dtype=np.float32), 44100)
assert load_audio(ref, sample_rate=44100).shape[0] == 44100
print("mlx", mx.__version__, mx.default_device(), "drama3", path, "chunks", len(split_text("你好。今天天氣很好。")))
""",
}


def doctor():
    ok = True
    for env, code in CHECKS.items():
        python = config.env_python(env)
        if not python.is_file():
            print(f"[{env}] 環境還沒建立：{python}")
            ok = False
            continue
        r = subprocess.run([str(python), "-c", code], capture_output=True, text=True,
                           env={**os.environ, "HF_HUB_OFFLINE": "1"})
        print(f"[{env}] {'OK' if r.returncode == 0 else 'FAIL'}")
        print(r.stdout.strip() or r.stderr.strip()[-2000:])
        ok &= r.returncode == 0
    return 0 if ok else 1


def run(engine, request):
    start = time.monotonic()

    def show(event):
        print(f"{time.monotonic() - start:7.1f}s", json.dumps(event, ensure_ascii=False), flush=True)
    request = {"device": config.device(), "memory_budget_gib": 12.0, **request}
    result = manager.run(engine, request, show)
    show(result)
    return result


def main():
    cli = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    cli.add_argument("command", choices=["doctor", "yue2", "cover", "voice"])
    cli.add_argument("audio", nargs="?", type=Path)
    cli.add_argument("--instrumental", action="store_true")
    cli.add_argument("--high", action="store_true")
    cli.add_argument("--lyrics", default="[Verse]\n晚風吹過街角\n路燈一盞一盞亮起來\n\n[Chorus]\n我們慢慢走\n把今天唱完\n")
    cli.add_argument("--style", default="Mandarin, female vocal, warm acoustic pop, 90 BPM, piano, soft drums")
    cli.add_argument("--ref", type=Path)
    cli.add_argument("--ref-text")
    cli.add_argument("--text", default="你好，這是 Sona 的聲音複製測試。")
    cli.add_argument("--out", type=Path, default=Path(tempfile.mkdtemp(prefix="sona-smoke-")))
    args = cli.parse_args()
    if args.command == "doctor":
        return doctor()
    print("輸出資料夾：", args.out)
    if args.command == "yue2":
        job = "instrumental" if args.instrumental else "song"
        run("yue2", {"job": job, "params": {"style": args.style, "lyrics": args.lyrics}, "out": str(args.out)})
    elif args.command == "cover":
        wav = args.out / "input.wav"
        args.out.mkdir(parents=True, exist_ok=True)
        audio.convert(args.audio, wav)
        abc = run("sheetsage", {"audio": str(wav), "out": str(args.out / "transcription")})["abc"]
        run("yue2", {"job": "cover", "abc": abc, "out": str(args.out), "params": {
            "style": args.style, "lyrics": args.lyrics, "instrumental": args.instrumental}})
    else:
        if not args.ref:
            cli.error("voice 需要 --ref 參考錄音")
        wav = args.out / "ref.wav"
        args.out.mkdir(parents=True, exist_ok=True)
        audio.convert(args.ref, wav, max_seconds=30, mono=True, rate=44100)
        run("voice-mlx", {"text": args.text, "ref_audio": str(wav), "ref_text": args.ref_text or "", "out": str(args.out),
                          "model": "drama3" if args.high else "qwen3"})
        manager.kill()
    return 0


if __name__ == "__main__":
    sys.exit(main())
