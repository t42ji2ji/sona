"""Shared by every worker. Runs under an engine venv: stdlib only here.

Protocol: the backend writes one JSON request per line to stdin; the worker
prints one JSON event per line to stdout. Library output goes to stderr.
"""
import json
import os
import sys
import threading
import time
import traceback

OUT = sys.stdout
sys.stdout = sys.stderr


def emit(type, **fields):
    OUT.write(json.dumps({"type": type, **fields}, ensure_ascii=False) + "\n")
    OUT.flush()


def stage(name, progress=-1.0):
    emit("stage", stage=name, progress=progress)


def progress(value, eta=None):
    emit("progress", progress=round(value, 4), eta=None if eta is None else round(eta))


def read_request():
    line = sys.stdin.readline()
    return json.loads(line) if line else None


def exit_when_parent_gone():
    """The backend holds our stdin open; EOF means it died, so don't linger holding GBs of memory."""
    def watch():
        while sys.stdin.readline():
            pass
        os._exit(1)
    threading.Thread(target=watch, daemon=True).start()


def run(handler):
    """One-shot worker: handle a single request, then exit (frees all memory)."""
    request = read_request()
    exit_when_parent_gone()
    try:
        emit("result", **handler(request))
    except Exception as exc:  # noqa: BLE001
        traceback.print_exc()
        emit("error", message=str(exc) or type(exc).__name__)
        sys.exit(1)


class Rate:
    """ETA from observed throughput within one stage."""

    def __init__(self):
        self.start = time.monotonic()

    def eta(self, done, total):
        elapsed = time.monotonic() - self.start
        if done <= 0 or elapsed < 2:
            return None
        return max(0.0, (total - done) * elapsed / done)
