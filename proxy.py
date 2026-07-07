#!/usr/bin/env python3
"""Tiny CORS proxy for Loki, Tempo, and Phoenix APIs.

Prometheus already has permissive CORS, so this mainly exists so the
React/vanilla dashboards running in the browser can talk to Loki, Tempo and
Phoenix when telemetry is disabled or cannot add the required headers.
"""

import http.server
import urllib.request
import urllib.error
import json

PORT = 8090
LOKI = "http://localhost:3100"
TEMPO = "http://localhost:3200"
PHOENIX = "http://localhost:6006"


def target_for_path(path: str) -> str | None:
    if path.startswith("/loki/"):
        return LOKI + path[5:]
    if path.startswith("/tempo/"):
        return TEMPO + path[6:]
    if path.startswith("/phoenix/"):
        return PHOENIX + path[8:]
    return None


class Proxy(http.server.BaseHTTPRequestHandler):
    def _send_cors_headers(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS, HEAD")
        self.send_header("Access-Control-Allow-Headers", "*")

    def do_HEAD(self):
        if self.path == "/health":
            self.send_response(200)
            self._send_cors_headers()
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            return

        target = target_for_path(self.path)
        if target is None:
            self.send_error(404)
            return

        try:
            req = urllib.request.Request(target, method="HEAD")
            with urllib.request.urlopen(req, timeout=10) as resp:
                self.send_response(resp.status)
                self._send_cors_headers()
                self.send_header("Content-Type", resp.headers.get("Content-Type", "application/json"))
                self.end_headers()
        except urllib.error.HTTPError as e:
            self.send_response(e.code)
            self._send_cors_headers()
            self.end_headers()
        except Exception as e:
            self.send_error(502, str(e))

    def do_GET(self):
        if self.path == "/health":
            self.send_response(200)
            self._send_cors_headers()
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"status": "ok", "proxy": "claude-code-telemetry", "port": PORT}).encode())
            return

        target = target_for_path(self.path)
        if target is None:
            self.send_error(404)
            return

        try:
            req = urllib.request.Request(target)
            with urllib.request.urlopen(req, timeout=30) as resp:
                body = resp.read()
                self.send_response(resp.status)
                self._send_cors_headers()
                self.send_header("Content-Type", resp.headers.get("Content-Type", "application/json"))
                self.end_headers()
                self.wfile.write(body)
        except urllib.error.HTTPError as e:
            self.send_response(e.code)
            self._send_cors_headers()
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(e.read())
        except Exception as e:
            self.send_error(502, str(e))

    def do_POST(self):
        target = target_for_path(self.path)
        if target is None:
            self.send_error(404)
            return

        length_hdr = self.headers.get("Content-Length")
        try:
            length = int(length_hdr) if length_hdr else 0
        except ValueError:
            length = 0
        body = self.rfile.read(length) if length else b""

        try:
            req = urllib.request.Request(
                target,
                data=body,
                method="POST",
                headers={
                    "Content-Type": self.headers.get("Content-Type", "application/json"),
                    "Accept": self.headers.get("Accept", "application/json"),
                },
            )
            with urllib.request.urlopen(req, timeout=30) as resp:
                resp_body = resp.read()
                self.send_response(resp.status)
                self._send_cors_headers()
                self.send_header("Content-Type", resp.headers.get("Content-Type", "application/json"))
                self.end_headers()
                self.wfile.write(resp_body)
        except urllib.error.HTTPError as e:
            self.send_response(e.code)
            self._send_cors_headers()
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(e.read())
        except Exception as e:
            self.send_error(502, str(e))

    def do_OPTIONS(self):
        self.send_response(204)
        self._send_cors_headers()
        self.end_headers()

    def log_message(self, format, *args):
        pass  # silent


if __name__ == "__main__":
    print(f"CORS proxy on http://localhost:{PORT}")
    print(f"  Health: http://localhost:{PORT}/health")
    print(f"  Loki:   http://localhost:{PORT}/loki/...")
    print(f"  Tempo:  http://localhost:{PORT}/tempo/...")
    print(f"  Phoenix: http://localhost:{PORT}/phoenix/...")
    http.server.HTTPServer(("127.0.0.1", PORT), Proxy).serve_forever()
