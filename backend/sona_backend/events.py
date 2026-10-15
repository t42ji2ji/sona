"""Fan-out of SSE events; publish() is safe to call from any thread."""
from __future__ import annotations

import asyncio
import json

_subscribers: set[asyncio.Queue] = set()
_loop: asyncio.AbstractEventLoop | None = None


def bind(loop: asyncio.AbstractEventLoop):
    global _loop
    _loop = loop


def publish(type: str, data: dict):
    if _loop is None:
        return
    message = f"event: {type}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"
    for queue in list(_subscribers):
        _loop.call_soon_threadsafe(queue.put_nowait, message)


def subscribe() -> asyncio.Queue:
    queue = asyncio.Queue()
    _subscribers.add(queue)
    return queue


def unsubscribe(queue: asyncio.Queue):
    _subscribers.discard(queue)
