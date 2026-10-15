"""Real-mode readiness detection against a synthetic HF cache and torch hub dir."""
from sona_backend import components


def make_file(path, size):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("wb") as f:
        f.truncate(size)


def test_hf_partial_then_ready(tmp_path, monkeypatch):
    monkeypatch.setenv("HF_HUB_CACHE", str(tmp_path / "hub"))
    c = components.BY_ID["model:yue2-vae"]
    files = c["hf"][0][1]
    repo = tmp_path / "hub" / "models--m-a-p--YuE2-Vae"
    (repo / "refs").mkdir(parents=True)
    (repo / "refs" / "main").write_text("abc")
    snap = repo / "snapshots" / "abc"
    for name, size in files.items():
        if name != "model.safetensors":
            make_file(snap / name, size)
    make_file(repo / "blobs" / "deadbeef.incomplete", 1000)
    ready, done = components._disk(c)
    assert not ready and done == sum(s for n, s in files.items() if n != "model.safetensors") + 1000
    make_file(snap / "model.safetensors", files["model.safetensors"] - 1)   # truncated file is not ready
    assert not components._disk(c)[0]
    (repo / "blobs" / "deadbeef.incomplete").unlink()
    make_file(snap / "model.safetensors", files["model.safetensors"])
    assert components._disk(c) == (True, components.size_of(c))


def test_torch_hub_partial(tmp_path, monkeypatch):
    monkeypatch.setenv("TORCH_HOME", str(tmp_path / "torch"))
    c = components.BY_ID["model:htdemucs"]
    name, size = next(iter(c["torch"].items()))
    folder = tmp_path / "torch" / "hub" / "checkpoints"
    make_file(folder / (name[:-3] + ".part"), 500)
    assert components._disk(c) == (False, 500)
    make_file(folder / name, size)
    assert components._disk(c) == (True, size)


def test_env_marker(tmp_path, monkeypatch):
    monkeypatch.setenv("SONA_DATA_DIR", str(tmp_path))
    c = components.BY_ID["env:yue2"]
    assert not components._disk(c)[0]
    (tmp_path / "envs" / "yue2").mkdir(parents=True)
    (tmp_path / "envs" / "yue2" / "sona-env.json").write_text('{"deps": ["old"]}')
    assert not components._disk(c)[0]    # deps changed -> reinstall
    (tmp_path / "envs" / "yue2" / "sona-env.json").write_text(__import__("json").dumps({"deps": c["deps"]}))
    assert components._disk(c)[0]
