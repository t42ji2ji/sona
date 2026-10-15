"""Engine worker processes. At most one is alive; switching engines stops the previous one."""
from __future__ import annotations

import json
import os
import subprocess
import sys
import threading
from typing import Callable

from . import config, events

# engine -> venv. sheetsage shares envs/demucs (same torch 2.8 pins), but counts as its own engine.
ENVS = {"yue2": "yue2", "demucs": "demucs", "sheetsage": "demucs", "voice-mlx": "voice-mlx"}
PERSISTENT = {"voice-mlx"}
EVENT_ENGINE = {"sheetsage": "demucs"}   # contract's engine names: yue2 | demucs | voice-mlx


class EngineError(Exception):
    pass


class Cancelled(Exception):
    pass


class Worker:
    def __init__(self, engine: str):
        self.engine = engine
        log_dir = config.data_dir() / "logs"
        log_dir.mkdir(exist_ok=True)
        self.log_path = log_dir / f"{engine}.log"
        self.log = self.log_path.open("w", encoding="utf-8")
        if config.FAKE:
            cmd = [sys.executable, "-u", str(config.WORKERS_DIR / "fake.py")]
        else:
            cmd = [str(config.env_python(ENVS[engine])), "-u", str(config.WORKERS_DIR / f"{engine.replace('-', '_')}_worker.py")]
        env = {k: v for k, v in os.environ.items() if k not in ("PYTHONPATH", "VIRTUAL_ENV", "PYTHONHOME")}
        env.update(PYTHONUNBUFFERED="1", PYTHONIOENCODING="utf-8", PYTHONNOUSERSITE="1",
                   HF_HUB_OFFLINE="1", PYTORCH_ENABLE_MPS_FALLBACK="1", TOKENIZERS_PARALLELISM="false")
        self.proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=self.log,
                                     text=True, encoding="utf-8", env=env)

    def alive(self) -> bool:
        return self.proc.poll() is None

    def request(self, request: dict, on_event: Callable[[dict], None]) -> dict:
        self.proc.stdin.write(json.dumps({**request, "engine": self.engine}, ensure_ascii=False) + "\n")
        self.proc.stdin.flush()
        for line in self.proc.stdout:
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                continue
            if event["type"] == "result":
                return event
            if event["type"] == "error":
                raise EngineError(event["message"])
            on_event(event)
        raise EngineError(None)


class Manager:
    def __init__(self):
        self.worker: Worker | None = None
        self.lock = threading.Lock()
        self.cancelled = False

    def _publish(self, engine: str | None, state: str):
        events.publish("engine", {"engine": EVENT_ENGINE.get(engine, engine), "state": state})

    def _stop(self):
        worker, self.worker = self.worker, None
        if worker and worker.alive():
            self._publish(worker.engine, "unloading")
            worker.proc.kill()
            worker.proc.wait()
            self._publish(None, "idle")

    def _watch(self, worker: Worker):
        worker.proc.wait()
        worker.log.close()
        if self.worker is worker:      # exited on its own (idle timeout or crash)
            self.worker = None
            self._publish(None, "idle")

    def run(self, engine: str, request: dict, on_event: Callable[[dict], None]) -> dict:
        """Blocking; raises Cancelled after kill(), EngineError on worker failure."""
        with self.lock:
            self.cancelled = False
            if self.worker and (self.worker.engine != engine or not self.worker.alive()):
                self._stop()
            if self.worker is None:
                self.worker = Worker(engine)
                threading.Thread(target=self._watch, args=(self.worker,), daemon=True).start()
            worker = self.worker

        def forward(event):
            if event["type"] == "engine":
                self._publish(engine, event["state"])
            else:
                on_event(event)
        try:
            result = worker.request(request, forward)
        except (EngineError, BrokenPipeError, OSError) as exc:
            if self.cancelled:
                raise Cancelled() from None
            message = exc.args[0] if isinstance(exc, EngineError) and exc.args[0] else (
                f"引擎意外結束（常見原因是記憶體不足）。詳細記錄在 {worker.log_path}")
            with self.lock:
                if self.worker is worker:
                    self._stop()
            raise EngineError(message) from None
        if engine not in PERSISTENT:
            worker.proc.wait()
        return result

    def kill(self):
        self.cancelled = True
        worker = self.worker
        if worker and worker.alive():
            self._publish(worker.engine, "unloading")
            worker.proc.kill()

    def state(self) -> dict:
        worker = self.worker
        if worker and worker.alive():
            return {"engine": EVENT_ENGINE.get(worker.engine, worker.engine), "state": "ready"}
        return {"engine": None, "state": "idle"}


manager = Manager()
