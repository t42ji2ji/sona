"""Music prompt assistant: chats about the feel the user wants and proposes style / lyrics / title,
using the user's own Claude Code or Codex CLI. Streams NDJSON lines: {"delta"}, then {"done"} or {"error"}."""
from __future__ import annotations

import json
import subprocess
import tempfile
import time
from pathlib import Path
from typing import Iterator

from . import config
from .polish import _which, cli_env, pick_tool

SYSTEM = """You help someone write the inputs for YuE, a local AI music generator. They describe a feeling, a scene or a reference; you turn it into inputs the generator understands.

Reply in the language the user writes in (Chinese: Traditional characters, Taiwan usage). Plain text, no Markdown. Keep the chat short and warm. If the request is too vague to write anything, ask one question; otherwise propose right away and let them refine.

Inputs for the current mode:
- style: comma-separated English tags: genre, mood, key instruments, vocal (e.g. "female vocal, airy") unless instrumental, tempo in bpm. About 6-12 tags. Example: "indie pop, female vocal, dreamy, warm synth pads, 92 bpm".
- lyrics (only when the mode has lyrics): section labels on their own line, such as [verse], [chorus], [bridge], [outro], a blank line between sections, nothing else besides the sung lines. Around two to three minutes of song, e.g. verse, chorus, verse, chorus, bridge, chorus. Lyrics language follows what the user wants (default: the language they write in).
- title: short.

Whenever you propose or revise inputs, end your reply with exactly one block:
```sona
{"style": "...", "lyrics": "...", "title": "..."}
```
JSON only inside it, include only the fields this mode uses, and always give complete values (not diffs). Do not mention the block in your text."""

MODES = {"song": "song with vocals: style, lyrics, title",
         "instrumental": "instrumental (no vocals, no lyrics): style, title",
         "cover": "restyle an uploaded song with new lyrics: style, lyrics, title",
         "cover-instrumental": "restyle an uploaded song as instrumental: style, title"}


def prompt(messages: list[dict], mode: str, form: dict) -> str:
    fields = "\n".join(f"{k}: {v}" for k, v in form.items() if v) or "(empty)"
    chat = "\n\n".join(f"{'User' if m.get('role') == 'user' else 'Assistant'}: {m.get('text', '')}" for m in messages)
    return (f"{SYSTEM}\n\nMode: {MODES.get(mode, MODES['song'])}\n\nCurrent inputs in the form (the user may have edited them):\n"
            f"{fields}\n\nConversation so far:\n\n{chat}\n\nWrite the assistant's next reply.")


def _line(obj: dict) -> str:
    return json.dumps(obj, ensure_ascii=False) + "\n"


def stream(messages: list[dict], mode: str, form: dict, tool: str) -> Iterator[str]:
    text = prompt(messages, mode, form)
    if config.FAKE:
        reply = '好，先給你一版。\n```sona\n{"style": "lo-fi, chill, piano, 80 bpm", "title": "雨天"}\n```'
        for i in range(0, len(reply), 8):
            yield _line({"delta": reply[i:i + 8]})
            time.sleep(0.01)
        yield _line({"done": True})
        return
    with tempfile.TemporaryDirectory() as tmp:
        if tool == "claude":
            cmd = [_which("claude"), "-p", "--model", "sonnet", "--tools", "", "--permission-mode", "default",
                   "--output-format", "stream-json", "--verbose", "--include-partial-messages",
                   "--no-session-persistence", "--setting-sources", ""]
        else:
            out_file = Path(tmp) / "out.txt"
            cmd = [_which("codex"), "exec", "--skip-git-repo-check", "--sandbox", "read-only",
                   "--output-last-message", str(out_file), "-"]
        proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                text=True, cwd=tmp, env=cli_env())
        try:
            proc.stdin.write(text)
            proc.stdin.close()
            raw = []
            for line in proc.stdout:
                if tool != "claude":
                    raw.append(line)
                    continue
                try:
                    ev = json.loads(line)
                except ValueError:
                    continue
                delta = ev.get("event", {}).get("delta", {}) if ev.get("type") == "stream_event" else {}
                if delta.get("type") == "text_delta":
                    yield _line({"delta": delta["text"]})
            proc.wait()
            if proc.returncode:
                err = (proc.stderr.read() + "".join(raw)).strip()[-300:]
                yield _line({"error": f"{tool} 執行失敗：{err}"})
                return
            if tool != "claude":
                yield _line({"delta": out_file.read_text().strip() if out_file.is_file() else ""})
            yield _line({"done": True})
        finally:
            if proc.poll() is None:
                proc.kill()


def start(body: dict) -> Iterator[str]:
    """Validates before the response starts so errors come back as normal JSON errors."""
    messages = [m for m in body.get("messages") or [] if isinstance(m, dict)]
    tool = "claude" if config.FAKE else pick_tool(body.get("tool"))
    return stream(messages, str(body.get("mode") or "song"), dict(body.get("form") or {}), tool)
