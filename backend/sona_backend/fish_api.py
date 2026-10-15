"""Fish Audio hosted TTS with model drama-3. Inline reference audio requires MessagePack."""
from __future__ import annotations

from pathlib import Path
from typing import Callable

import httpx
import msgpack

URL = "https://api.fish.audio/v1/tts"
MESSAGES = {
    401: "Fish Audio API key 無效，請到設定重新填寫。",
    402: "Fish Audio 帳戶餘額不足，請到 fish.audio 儲值後再試。",
    429: "Fish Audio 請求太頻繁，請稍等一下再試。",
}


class FishError(Exception):
    pass


def tts(api_key: str, text: str, ref_audio: Path, ref_text: str, out: Path,
        cancelled: Callable[[], bool], on_bytes: Callable[[int], None]) -> None:
    body = msgpack.packb({"text": text, "references": [{"audio": ref_audio.read_bytes(), "text": ref_text}],
                          "format": "mp3", "normalize": True, "latency": "normal"})
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/msgpack", "model": "drama-3"}
    try:
        with httpx.stream("POST", URL, content=body, headers=headers, timeout=httpx.Timeout(30, read=300)) as r:
            if r.status_code != 200:
                r.read()
                detail = ""
                try:
                    detail = r.json().get("message", "")
                except ValueError:
                    pass
                raise FishError(MESSAGES.get(r.status_code, f"Fish Audio 回傳錯誤 {r.status_code}：{detail or r.text[:200]}"))
            total = 0
            with out.open("wb") as f:
                for chunk in r.iter_bytes():
                    if cancelled():
                        return
                    f.write(chunk)
                    total += len(chunk)
                    on_bytes(total)
    except httpx.TransportError as exc:
        raise FishError(f"連不上 Fish Audio（{exc}），請確認網路連線。") from None
