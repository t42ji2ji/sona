"""Generate the voice demos on sona.dorara.app.

  ./make-demo.sh voices.json            # writes ../assets/demo/ and ../assets/demo.js
  ./make-demo.sh voices.json --out DIR  # somewhere else, for a trial run
  ./make-demo.sh voices.json --names    # only apply name/label/credit edits and removed voices; no regeneration

voices.json lists the voices (a recording each), the lines every voice says, and the tone before/after.
Each voice says every line, so visitors can mix and match. Runs locally with Qwen3-TTS (Sona's voice-mlx env).
"""
import argparse, json, re, shutil, subprocess, sys, tempfile, time
from pathlib import Path

MODEL = "mlx-community/Qwen3-TTS-12Hz-1.7B-Base-8bit"
ASR = "mlx-community/Qwen3-ASR-0.6B-8bit"
FFMPEG = shutil.which("ffmpeg") or "/opt/homebrew/bin/ffmpeg"
BARS = 72


def sh(*cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode:
        sys.exit("ffmpeg 失敗：" + r.stderr.strip()[-400:])


def chunks(text, limit=80):
    out, cur = [], ""
    for s in re.findall(r"[^。！？!?\n]+[。！？!?]*", text):
        s = s.strip()
        if not s:
            continue
        if cur and len(cur) + len(s) > limit:
            out.append(cur); cur = ""
        cur += (" " if cur and re.match(r"[A-Za-z]", s) else "") + s
    return out + ([cur] if cur else [])


def peaks(audio, n=BARS):
    import numpy as np
    seg = np.array_split(np.abs(audio), n)
    p = np.array([float(np.sqrt((s ** 2).mean())) if len(s) else 0 for s in seg])
    return [round(float(x), 3) for x in p / (p.max() or 1)]


def save(audio, sr, path):
    import soundfile as sf
    with tempfile.NamedTemporaryFile(suffix=".wav") as tmp:
        sf.write(tmp.name, audio, sr)
        sh(FFMPEG, "-y", "-loglevel", "error", "-i", tmp.name, "-ac", "1", "-b:a", "96k", str(path))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("config", type=Path)
    ap.add_argument("--out", type=Path, help="default: site/assets")
    ap.add_argument("--names", action="store_true", help="update names, labels and credit; drop voices no longer listed")
    a = ap.parse_args()
    cfg = json.loads(a.config.read_text())
    base = a.config.resolve().parent
    out = (a.out or Path(__file__).resolve().parent.parent / "assets").resolve()
    demo = out / "demo"
    if a.names:
        return update_names(cfg, out)
    shutil.rmtree(demo, ignore_errors=True)
    demo.mkdir(parents=True)

    import numpy as np, soundfile as sf
    from mlx_audio.tts.utils import load_model
    asr = None
    model = load_model(MODEL)
    sr = model.sample_rate
    gap = np.zeros(int(sr * 0.25), dtype=np.float32)

    def say(text, ref, ref_text):
        parts = []
        for c in chunks(text):
            for r in model.generate(text=c, ref_audio=str(ref), ref_text=ref_text, lang_code="auto"):
                parts.append(np.array(r.audio, dtype=np.float32))
            parts.append(gap)
        return np.concatenate(parts[:-1])

    manifest = {"voices": [], "lines": cfg["lines"], "tone": None, "credit": cfg.get("credit")}
    work = Path(tempfile.mkdtemp())
    for v in cfg["voices"]:
        src = Path(v["file"]).expanduser()
        src = src if src.is_absolute() else base / src
        if not src.is_file():
            sys.exit(f"找不到 {v['id']} 的錄音：{src}")
        ref = work / f"{v['id']}.wav"
        # the clip visitors hear first, and what the model clones from: one speaker, no music
        sh(FFMPEG, "-y", "-loglevel", "error", "-ss", str(v.get("start", 0)), "-t", str(v.get("seconds", 15)),
           "-i", str(src), "-ac", "1", "-ar", str(sr), str(ref))
        ref_text = v.get("text")
        if not ref_text:
            if asr is None:
                from mlx_audio.stt import load
                asr = load(ASR)
            ref_text = asr.generate(str(ref)).text.strip()
        clip, _ = sf.read(ref, dtype="float32")
        save(clip, sr, demo / f"{v['id']}-ref.mp3")
        entry = {"id": v["id"], "name": v["name"], "seconds": round(len(clip) / sr, 1), "peaks": peaks(clip), "says": {}}
        for line in cfg["lines"]:
            t0 = time.time()
            audio = say(line["text"], ref, ref_text)
            save(audio, sr, demo / f"{v['id']}-{line['id']}.mp3")
            entry["says"][line["id"]] = {"seconds": round(len(audio) / sr, 1), "peaks": peaks(audio)}
            print(f"{v['id']} {line['id']}: {len(audio)/sr:.1f}s audio in {time.time()-t0:.1f}s", file=sys.stderr)
        if cfg.get("tone", {}).get("voice") == v["id"]:
            tone = cfg["tone"]
            for k in ("before", "after"):
                audio = say(tone[k], ref, ref_text)
                save(audio, sr, demo / f"tone-{k}.mp3")
                tone = {**tone, f"{k}_peaks": peaks(audio), f"{k}_seconds": round(len(audio) / sr, 1)}
            manifest["tone"] = tone
        manifest["voices"].append(entry)
    shutil.rmtree(work, ignore_errors=True)
    (out / "demo.js").write_text("window.SONA_DEMO = " + json.dumps(manifest, ensure_ascii=False) + "\n")
    print(f"wrote {demo} and {out / 'demo.js'}", file=sys.stderr)


def update_names(cfg, out):
    js = out / "demo.js"
    m = json.loads(js.read_text().split("=", 1)[1].strip().rstrip(";"))
    keep = {v["id"]: v for v in cfg["voices"]}
    for v in m["voices"]:
        if v["id"] not in keep:
            for f in (out / "demo").glob(f"{v['id']}-*.mp3"):
                f.unlink()
    m["voices"] = [{**v, "name": keep[v["id"]]["name"]} for v in m["voices"] if v["id"] in keep]
    labels = {l["id"]: l for l in cfg["lines"]}
    m["lines"] = [{**l, "label": labels[l["id"]].get("label")} for l in m["lines"] if l["id"] in labels]
    m["credit"] = cfg.get("credit")
    js.write_text("window.SONA_DEMO = " + json.dumps(m, ensure_ascii=False) + "\n")
    print(f"updated {js}: " + ", ".join(v["id"] for v in m["voices"]), file=sys.stderr)


if __name__ == "__main__":
    main()
