#!/usr/bin/env python3
"""Loopback-only System One bridge for the official Laya Python package.

Install:
    python -m pip install laya

Run:
    python scripts/laya-systemone-server.py --port 8765
"""

from __future__ import annotations

import argparse
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

from laya import Router


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Serve Laya behind a TypeSafe-compatible System One endpoint.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--preload", action="store_true")
    return parser.parse_args()


class Handler(BaseHTTPRequestHandler):
    router: Router

    def do_POST(self) -> None:
        if self.path.rstrip("/") != "/v1/systemone":
            self.send_error(404)
            return
        length = int(self.headers.get("content-length", "0"))
        if length <= 0 or length > 1024 * 1024:
            self.send_error(400, "invalid request size")
            return
        try:
            payload = json.loads(self.rfile.read(length))
            state = payload["state"]
            questions = payload["questions"]
            requested_model = payload.get("model")
            model = None if requested_model in (None, "", "typed-decisions") else str(requested_model)
            result = self.router.system_one(state, questions, model=model)
            self.respond(200, result)
        except (KeyError, TypeError, ValueError) as error:
            self.respond(400, {"error": str(error)})
        except Exception as error:  # Laya/runtime failures are surfaced to ND and contained there.
            self.respond(503, {"error": str(error)})

    def log_message(self, format: str, *args: Any) -> None:
        print("[laya-systemone] " + (format % args))

    def respond(self, status: int, body: Any) -> None:
        encoded = json.dumps(body, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)


def main() -> None:
    args = parse_args()
    if args.host not in {"127.0.0.1", "::1", "localhost"}:
        raise SystemExit("Laya bridge is loopback-only; use 127.0.0.1, ::1, or localhost.")
    Handler.router = Router(preload=args.preload)
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"[laya-systemone] http://{args.host}:{args.port}/v1/systemone")
    server.serve_forever()


if __name__ == "__main__":
    main()
