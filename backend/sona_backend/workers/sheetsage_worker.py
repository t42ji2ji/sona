"""SheetSage2 melody transcription for covers. Runs in envs/demucs (its torch/transformers pins).

Request: {"audio": wav path, "out": folder, "device"} -> writes score.abc, returns {"abc"}.
Follows the yue2-instrumental skill's transcribe_cover.py with task melody-full.
"""
import tempfile
import traceback
from pathlib import Path

import common
from common import emit, stage

PROMPTS = ["timestamp", "downbeat_meter", "structure", "key", "melody_full"]


def transcribe(audio, device):
    from transformers import AutoModel
    model = AutoModel.from_pretrained("m-a-p/SheetSage2", trust_remote_code=True, local_files_only=True)
    model = model.eval().to(device)
    emit("engine", state="ready")
    stage("轉旋律譜")
    with tempfile.TemporaryDirectory() as tmp:
        return model.transcribe(str(audio), output_dir=tmp, prompts=PROMPTS,
                                dtype="bf16" if device == "cuda" else "fp32", preset="default",
                                max_seconds=None, melody_only=True)


def handle(request):
    emit("engine", state="loading")
    stage("載入轉譜模型")
    try:
        result = transcribe(request["audio"], request["device"])
    except Exception:
        if request["device"] != "mps":
            raise
        # SheetSage2 is not validated on MPS; CPU is slower but works.
        traceback.print_exc()
        stage("載入轉譜模型（改用 CPU）")
        result = transcribe(request["audio"], "cpu")
    if result.get("abc_error") or not result.get("abc"):
        raise RuntimeError(f"這首歌轉不出可用的旋律譜（{result.get('abc_error') or '結果是空的'}），請換一首旋律較清楚的歌。")
    out = Path(request["out"])
    out.mkdir(parents=True, exist_ok=True)
    (out / "score.abc").write_text(result["abc"], encoding="utf-8")
    return {"abc": result["abc"], "warnings": result.get("warnings", [])}


if __name__ == "__main__":
    common.run(handle)
