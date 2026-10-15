"""sqlite storage: each table keeps its row as JSON plus the columns we sort on."""
from __future__ import annotations

import json
import sqlite3
import threading

from . import config

TABLES = ("jobs", "tracks", "uploads", "voices")
_lock = threading.Lock()
_conn: sqlite3.Connection | None = None


def connect():
    global _conn
    _conn = sqlite3.connect(config.data_dir() / "db.sqlite", check_same_thread=False)
    for table in TABLES:
        _conn.execute(f"CREATE TABLE IF NOT EXISTS {table} (id TEXT PRIMARY KEY, created_at TEXT, data TEXT)")
    _conn.commit()


def put(table: str, row: dict):
    with _lock:
        _conn.execute(f"INSERT OR REPLACE INTO {table} VALUES (?, ?, ?)",
                      (row["id"], row["created_at"], json.dumps(row, ensure_ascii=False)))
        _conn.commit()


def get(table: str, id: str) -> dict | None:
    with _lock:
        row = _conn.execute(f"SELECT data FROM {table} WHERE id = ?", (id,)).fetchone()
    return json.loads(row[0]) if row else None


def all(table: str) -> list[dict]:
    """Newest first."""
    with _lock:
        rows = _conn.execute(f"SELECT data FROM {table} ORDER BY created_at DESC, rowid DESC").fetchall()
    return [json.loads(r[0]) for r in rows]


def delete(table: str, id: str):
    with _lock:
        _conn.execute(f"DELETE FROM {table} WHERE id = ?", (id,))
        _conn.commit()
