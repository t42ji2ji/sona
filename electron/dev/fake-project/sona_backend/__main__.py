# 假後端（python 版）：驗證 uv run 從唯讀目錄啟動的流程。
import http.server, json, os, sys, threading

class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        body = json.dumps({"ok": True, "version": "fake", "env": os.environ.get("VIRTUAL_ENV")}).encode()
        self.send_response(200 if self.path == "/api/health" else 404)
        self.end_headers()
        self.wfile.write(body)
    def log_message(self, *a): pass

s = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H)
threading.Thread(target=s.serve_forever, daemon=True).start()
print("SONA_READY " + json.dumps({"port": s.server_address[1], "token": "fake-token"}), flush=True)
sys.stdin.read()
