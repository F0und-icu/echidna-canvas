#!/usr/bin/env python3
"""Serve the archived design prototype on loopback; no runtime or model access."""

import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

PROTOTYPE = Path(__file__).resolve().parents[1] / "design" / "prototype"
MARKER = "<!-- ECHIDNA_CANVAS_FRAGMENT -->"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=4173)
    args = parser.parse_args()

    shell = (PROTOTYPE / "shell.html").read_text(encoding="utf-8")
    if shell.count(MARKER) != 1:
        raise ValueError("prototype shell must contain exactly one fragment marker")
    fragment = (PROTOTYPE / "canvas.fragment.html").read_text(encoding="utf-8")
    routes = {
        "/": ("text/html; charset=utf-8", shell.replace(MARKER, fragment).encode()),
        "/vendor/lucide.min.js": (
            "text/javascript; charset=utf-8",
            (PROTOTYPE / "vendor" / "lucide.min.js").read_bytes(),
        ),
    }

    class PreviewHandler(BaseHTTPRequestHandler):
        def do_GET(self):
            resource = routes.get(urlsplit(self.path).path)
            if resource is None:
                self.send_error(404)
                return
            content_type, content = resource
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(content)))
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(content)

    server = ThreadingHTTPServer(("127.0.0.1", args.port), PreviewHandler)
    print(f"Echidna Canvas prototype: http://127.0.0.1:{server.server_port}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
