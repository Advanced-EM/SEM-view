"""How calls reach the simulator. Each transport has call(name, args) -> result, close(), and a name.
Results are plain JSON values; byte results (the .npz from acquire) arrive as bytes."""
from __future__ import annotations

import base64
import itertools
import json
import os
import re
import shutil
import subprocess
import threading
from pathlib import Path


class SemviewError(RuntimeError):
    """The simulator refused or failed a call; the message says why."""


def _decode(v):
    if isinstance(v, dict):
        if set(v) == {"$bytes"}:
            return base64.b64decode(v["$bytes"])
        return {k: _decode(x) for k, x in v.items()}
    if isinstance(v, list):
        return [_decode(x) for x in v]
    return v


class Headless:
    """The simulator in a Node.js process (semview/driver.mjs), talking JSON lines over stdin and stdout."""

    name = "headless"

    def __init__(self, node: str | None = None, root: str | None = None):
        node = node or shutil.which("node")
        if not node:
            raise SemviewError("Node.js 20 or later is needed for the headless backend: https://nodejs.org")
        env = dict(os.environ)
        if root:
            env["SEMVIEW_ROOT"] = str(root)
        driver = Path(__file__).with_name("driver.mjs")
        self._p = subprocess.Popen([node, str(driver)], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=env, bufsize=1)
        self._ids = itertools.count(1)
        self._lock = threading.Lock()
        hello = self._read()
        if hello.get("error"):
            raise SemviewError(hello["error"])

    def _read(self) -> dict:
        line = self._p.stdout.readline()
        if not line:
            err = self._p.stderr.read()[-2000:]
            raise SemviewError(f"the headless simulator stopped. {err}")
        return json.loads(line)

    def call(self, name: str, args: dict | None = None):
        with self._lock:
            i = next(self._ids)
            self._p.stdin.write(json.dumps({"id": i, "call": name, "args": args or {}}) + "\n")
            self._p.stdin.flush()
            while True:
                m = self._read()
                if m.get("id") == i:
                    break
        if "error" in m:
            raise SemviewError(m["error"])
        return _decode(m.get("result"))

    def close(self):
        if self._p.poll() is None:
            self._p.stdin.close()
            try:
                self._p.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self._p.kill()


class Live:
    """An exhibit open in a browser. This starts a WebSocket server on 127.0.0.1 (the port semview-mcp uses);
    select "Connect agent" in the exhibit (Controls → Voice and agent) and the exhibit connects to it."""

    name = "live"
    ORIGINS = ("https://advanced-em.github.io",)

    def __init__(self, port: int = 8792, timeout: float = 120, origins: tuple[str, ...] = ()):
        try:
            from websockets.sync.server import serve
            from websockets.http11 import Response  # noqa: F401  (websockets 13+)
        except ImportError as e:
            raise SemviewError('the live backend needs websockets 13 or later: pip install "websockets>=13"') from e
        self._allowed = set(self.ORIGINS) | set(origins) | set(filter(None, os.environ.get("SEMVIEW_ORIGINS", "").split(",")))
        self._conn = None
        self._ready = threading.Event()
        self._pending: dict[int, list] = {}
        self._ids = itertools.count(1)
        self._lock = threading.Lock()

        def check(connection, request):
            origin = request.headers.get("Origin", "")
            ok = not origin or origin in self._allowed or re.match(r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$", origin)
            return None if ok else connection.respond(403, "origin not allowed\n")

        def handler(conn):
            if self._conn is not None:
                conn.close(4000, "another exhibit is already connected")
                return
            self._conn = conn
            self._ready.set()
            try:
                for msg in conn:
                    m = json.loads(msg)
                    slot = self._pending.get(m.get("id"))
                    if slot is not None:
                        slot.append(m)
                        slot[0].set()
            finally:
                self._conn = None
                self._ready.clear()
                for slot in self._pending.values():  # wake anyone waiting
                    slot.append({"error": "the exhibit disconnected"})
                    slot[0].set()

        try:
            self._server = serve(handler, "127.0.0.1", port, process_request=check)
        except OSError as e:
            raise SemviewError(f"port {port} is in use (an AI client running semview-mcp?). Close it, or use connect('live', port=8793).") from e
        threading.Thread(target=self._server.serve_forever, daemon=True).start()
        print(f'Waiting for the exhibit on ws://127.0.0.1:{port}: open it and select "Connect agent" (Controls → Voice and agent).')
        if not self._ready.wait(timeout):
            self.close()
            raise SemviewError(f"no exhibit connected within {timeout:.0f} s")
        print("Exhibit connected.")

    def call(self, name: str, args: dict | None = None, timeout: float = 600):
        if self._conn is None:
            raise SemviewError("the exhibit is not connected")
        i = next(self._ids)
        slot = [threading.Event()]
        self._pending[i] = slot
        try:
            with self._lock:
                self._conn.send(json.dumps({"id": i, "method": "script", "params": {"call": name, "args": args or {}}}))
            if not slot[0].wait(timeout):
                raise SemviewError(f"the exhibit did not answer {name} in time")
        finally:
            self._pending.pop(i, None)
        m = slot[1]
        if m.get("error"):
            raise SemviewError(m["error"])
        return _decode(m.get("result"))

    def close(self):
        try:
            if self._conn is not None:
                self._conn.close()
        finally:
            self._server.shutdown()


class Browser:
    """Inside the exhibit's Python IDE: calls go straight to the page (Pyodide)."""

    name = "browser"

    def __init__(self):
        from js import semviewScript  # set up by the exhibit's IDE

        self._js = semviewScript

    def call(self, name: str, args: dict | None = None):
        r = self._js.call(name, json.dumps(args or {}))
        if r.error:
            raise SemviewError(r.error)
        out = json.loads(r.json)
        if r.bytes is not None:
            out["npz"] = r.bytes.to_bytes()
        return out

    def close(self):
        pass
