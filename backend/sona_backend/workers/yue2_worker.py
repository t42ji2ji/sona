"""YuE2 worker: song / instrumental / cover. Runs in envs/yue2.

Request: {"job", "params", "out", "device", "memory_budget_gib", "abc"?}
`abc` is the SheetSage2 melody score for covers.
"""
import re
import sys
from pathlib import Path

import common
from common import emit, progress, stage

sys.path.insert(0, str(Path(__file__).parent / "yue2_skill"))
from abc_tools import parse_abc, report  # noqa: E402
from instrumentalize import convert_score  # noqa: E402

TOKENS_PER_SECOND = 25          # VAE downsampling 1920 at 48 kHz
SEMANTIC_MAX = 9000
PLANNING_LYRICS = "[Intro]\n\n[Verse]\n\n[Chorus]\n\n[Outro]\n"


def instrumental_style(style):
    """Same decoration as the yue2-instrumental skill's prepare()."""
    style = (style or "Expressive instrumental music").strip().rstrip(".,")
    if not re.match(r"^instrumental\b", style, re.I):
        style = "Instrumental, " + style
    for condition in ("no vocals", "no singing", "no choir", "no spoken words"):
        if condition not in style.lower():
            style += ", " + condition
    return style + "."


def lyric_tags(abc):
    labels = [line[2:] for line in abc.splitlines() if line.startswith("% ")]
    return "\n\n".join("[" + x.title() + "]" for x in labels) + ("\n" if labels else "")


def instrumental_request(SongRequest, abc, style, seed, keep_chords):
    converted, _ = convert_score(abc, keep_chords=keep_chords)
    cot = "full" if parse_abc(converted).voices["Vocal"].chords else "melody"
    return SongRequest(style=style, lyrics=lyric_tags(converted), abc=converted, cot=cot, seed=seed)


def load(request):
    import yue2.pipeline
    from yue2 import YuE2Pipeline

    # Identity hashes only feed run manifests we don't keep; hashing 7 GB costs ~20 s per job.
    yue2.pipeline.model_identity = lambda path, verify=True: {"files": {}, "config_sha256": ""}
    device = request["device"]
    return YuE2Pipeline.from_pretrained(
        "m-a-p/YuE2-3B", vae="m-a-p/YuE2-Vae", device=device, local_files_only=True,
        backend="torch" if device == "cuda" else "torch-eager",
        memory_budget_gib=request["memory_budget_gib"], verify_hashes=False, progress=False)


def handle(request):
    from yue2.protocol import SongRequest
    from yue2.nar import synthesize

    job, params = request["job"], request["params"]
    seed = int(params.get("seed") or 831001)
    out = Path(request["out"])

    emit("engine", state="loading")
    stage("載入模型", 0.0)
    pipe = load(request)
    emit("engine", state="ready")

    tokens = {"abc": 0, "semantic": 0}

    def count(phase, _token):
        tokens[phase] += 1

    if job == "song":
        song = SongRequest(style=params["style"], lyrics=params["lyrics"], cot=params.get("mode") or "full", seed=seed)
        if song.cot != "off":
            stage("規劃旋律")
        plan = pipe.plan(request=song, on_token=count)
    elif job == "instrumental":
        style = instrumental_style(params["style"])
        stage("規劃旋律")
        draft = pipe.plan(request=SongRequest(style=style, lyrics=PLANNING_LYRICS, cot="full", seed=seed), on_token=count)
        if draft.truncated or not draft.abc:
            raise RuntimeError("YuE2 寫出的譜被截斷或是空的，請換一個種子再試一次。")
        stage("整理樂譜")
        plan = pipe.plan(request=instrumental_request(SongRequest, draft.abc, style, seed, keep_chords=True))
    else:  # cover
        if params.get("instrumental"):
            style = instrumental_style(params["style"])
            song = instrumental_request(SongRequest, request["abc"], style, seed, keep_chords=False)
        else:
            song = SongRequest(style=params["style"], lyrics=params["lyrics"], abc=request["abc"], cot="melody", seed=seed)
        plan = pipe.plan(request=song)

    total = -1
    try:
        seconds = report(parse_abc(plan.abc))["nominal_duration_seconds"] if plan.abc else 0
        total = min(SEMANTIC_MAX, int(seconds * TOKENS_PER_SECOND) + 1) if seconds else -1
    except Exception:  # noqa: BLE001 - the estimate is only for progress
        pass
    stage("生成聲音", 0.05 if total > 0 else -1)
    rate = common.Rate()
    last = [0]

    def on_semantic(phase, token):
        count(phase, token)
        done = tokens["semantic"]
        if total > 0 and done - last[0] >= 25:
            last[0] = done
            progress(0.05 + 0.7 * min(done / total, 0.99), rate.eta(done, total))

    semantic = pipe.generate_semantic(plan, on_token=on_semantic)

    stage("合成音訊", 0.75)
    rate = common.Rate()
    model = pipe._load_model(for_nar=True)

    def on_nar(done, steps):
        progress(0.75 + 0.2 * done / steps, rate.eta(done, steps))

    latents = synthesize(model, semantic.plan.prefix, semantic.tokens, semantic.plan.request.seed,
                         steps=pipe.generation_config.ode_steps, context=pipe.generation_config.context,
                         offload_ar=pipe.offload_ar, on_progress=on_nar).detach().float().cpu().numpy()

    stage("解碼音訊", 0.95)
    audio = pipe.decode(latents)
    import soundfile as sf
    out.mkdir(parents=True, exist_ok=True)
    sf.write(out / "audio.flac", audio, 48000, subtype="PCM_24")
    if plan.abc:
        (out / "score.abc").write_text(plan.abc, encoding="utf-8")
    return {"score_abc": plan.abc, "truncated": bool(plan.truncated or semantic.truncated),
            "duration_s": len(audio) / 48000}


if __name__ == "__main__":
    common.run(handle)
