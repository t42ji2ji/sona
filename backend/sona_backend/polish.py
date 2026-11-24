"""Rewrites voice text with more spoken tone, using the user's own Claude Code or Codex CLI (no API key)."""
from __future__ import annotations

import getpass
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

from . import config
from .errors import ApiError

PROMPT = """下面這段文字會用語音合成唸出來。請把它改得更有說話的語氣和情緒：
- 適當加入語氣詞（例如欸、啦、喔、吧、耶、嘛），用驚嘆號、問號、刪節號和逗號表現停頓與抑揚
- 聽起來像真人自然地說話，不要像念稿
- 保留原意和所有資訊，不加新內容，長度大致不變
- 不要加括號說明、表演指示或引號
- 維持原文的語言；中文一律用繁體、台灣用語
只輸出改好的文字，不要任何說明。

文字：
"""
# Finder-launched apps get a bare PATH; look where these CLIs are usually installed.
EXTRA_PATH = [Path.home() / ".local/bin", Path.home() / ".claude/local", Path("/opt/homebrew/bin"),
              Path("/usr/local/bin"), Path.home() / ".npm-global/bin", Path.home() / ".bun/bin"]


def _which(name: str) -> str | None:
    path = os.pathsep.join([os.environ.get("PATH", ""), *map(str, EXTRA_PATH)])
    return shutil.which(name, path=path)


def tools() -> dict:
    return {"claude": bool(_which("claude")), "codex": bool(_which("codex"))}


def polish(text: str, tool: str | None) -> dict:
    if not text.strip():
        raise ApiError(400, "invalid_params", "沒有要修飾的文字。")
    if config.FAKE:
        return {"text": text.strip() + "！", "tool": tool or "claude"}
    available = [t for t, ok in tools().items() if ok]
    tool = tool or (available[0] if available else None)
    if tool not in available:
        raise ApiError(400, "no_ai_cli", "找不到本機的 Claude Code 或 Codex，請先安裝並登入其中一個。")
    env = {**os.environ, "PATH": os.pathsep.join([os.environ.get("PATH", ""), *map(str, EXTRA_PATH)])}
    env.setdefault("USER", getpass.getuser())     # claude reads its keychain login by user name
    env.setdefault("LOGNAME", env["USER"])
    with tempfile.TemporaryDirectory() as tmp:
        if tool == "claude":
            cmd = [_which("claude"), "-p", "--model", "sonnet", "--tools", "", "--permission-mode", "default",
                   "--output-format", "text", "--no-session-persistence",
                   "--setting-sources", ""]   # skip the user's hooks, status line and plugins for this one-shot call
            out_file = None
        else:
            out_file = Path(tmp) / "out.txt"
            cmd = [_which("codex"), "exec", "--skip-git-repo-check", "--sandbox", "read-only",
                   "--output-last-message", str(out_file), "-"]
        try:
            r = subprocess.run(cmd, input=PROMPT + text, capture_output=True, text=True, timeout=120, cwd=tmp, env=env)
        except subprocess.TimeoutExpired:
            raise ApiError(504, "ai_timeout", "AI 超過兩分鐘沒有回應，請再試一次。") from None
        if r.returncode:
            raise ApiError(502, "ai_failed", f"{tool} 執行失敗：{(r.stderr + r.stdout).strip()[-300:]}")
        result = (out_file.read_text() if out_file and out_file.is_file() else r.stdout).strip()
    if not result:
        raise ApiError(502, "ai_failed", f"{tool} 沒有回傳文字。")
    return {"text": result, "tool": tool}
