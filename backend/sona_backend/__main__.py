"""Start the backend: print SONA_READY once listening; exit when the parent closes stdin."""
import json
import os
import secrets
import socket
import sys
import threading

import uvicorn

from . import components
from .app import create_app
from .engine import manager


def shutdown():
    manager.kill()
    components.kill_all()


def watch_stdin():
    while sys.stdin.buffer.read(4096):
        pass
    shutdown()
    os._exit(0)


def main():
    port = int(os.environ.get("SONA_PORT") or 0)
    token = os.environ.get("SONA_TOKEN") or secrets.token_urlsafe(24)
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    if sys.platform != "win32":
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.bind(("127.0.0.1", port))
    sock.listen(128)
    port = sock.getsockname()[1]
    server = uvicorn.Server(uvicorn.Config(create_app(token), log_level="warning"))
    threading.Thread(target=watch_stdin, daemon=True).start()
    print("SONA_READY " + json.dumps({"port": port, "token": token}), flush=True)
    try:
        server.run(sockets=[sock])
    finally:
        shutdown()


if __name__ == "__main__":
    main()
