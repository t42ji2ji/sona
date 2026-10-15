"""Demucs stem separation. Runs in envs/demucs.

Request: {"audio": wav path, "out": folder, "device", "model": "htdemucs"|"htdemucs_ft"}
Writes out/stems/{vocals,drums,bass,other}.wav.
"""
from pathlib import Path

import common
from common import emit, progress, stage


def handle(request):
    import soundfile as sf
    import torch
    import tqdm
    from demucs.apply import BagOfModels, apply_model
    from demucs.audio import convert_audio
    from demucs.pretrained import get_model

    emit("engine", state="loading")
    stage("載入模型", 0.0)
    model = get_model(request["model"])
    model.eval()
    emit("engine", state="ready")

    n_models = len(model.models) if isinstance(model, BagOfModels) else 1
    state = {"model": -1}
    rate = common.Rate()
    original_tqdm = tqdm.tqdm

    def tracked(iterable, **_):
        # apply_model wraps its chunk list in tqdm.tqdm once per sub-model.
        state["model"] += 1
        items = list(iterable)
        for i, item in enumerate(items, 1):
            yield item
            done = (state["model"] + i / len(items)) / n_models
            progress(0.05 + 0.9 * done, rate.eta(done, 1.0))
    tqdm.tqdm = tracked

    data, sr = sf.read(request["audio"], dtype="float32", always_2d=True)
    wav = convert_audio(torch.from_numpy(data.T), sr, model.samplerate, model.audio_channels)
    ref = wav.mean(0)
    wav = (wav - ref.mean()) / ref.std()
    stage("分離音軌", 0.05)
    with torch.no_grad():
        sources = apply_model(model, wav[None], device=request["device"], shifts=1, split=True,
                              overlap=0.25, progress=True)[0]
    tqdm.tqdm = original_tqdm
    sources = sources * ref.std() + ref.mean()

    stage("寫入檔案", 0.97)
    folder = Path(request["out"]) / "stems"
    folder.mkdir(parents=True, exist_ok=True)
    for name, source in zip(model.sources, sources):
        sf.write(folder / f"{name}.wav", source.clamp(-1, 1).numpy().T, model.samplerate, subtype="PCM_16")
    return {"stems": list(model.sources)}


if __name__ == "__main__":
    common.run(handle)
