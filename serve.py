# Dev server that disables caching, so a normal refresh always loads the latest code.
# Always serves the folder this file lives in, wherever it's launched from.
import functools
import http.server
import os
import socket
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
PORT = 5173

class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, format, *args):
        pass  # keep the console quiet; errors still show

class ExclusiveServer(http.server.ThreadingHTTPServer):
    # By default Windows lets a second server grab the same port, and the two then fight
    # over requests. Claim the port exclusively so a second copy fails with a clear message.
    allow_reuse_address = False

    def server_bind(self):
        if hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()

handler = functools.partial(NoCacheHandler, directory=ROOT)
try:
    server = ExclusiveServer(("", PORT), handler)
except OSError:
    print(f"Port {PORT} is already in use - the game server is probably already running.")
    print(f"Just open http://localhost:{PORT} in your browser.")
    sys.exit(1)

print(f"Movement Shooter is running at http://localhost:{PORT}")
print("Keep this window open while you play. Close it (or press Ctrl+C) to stop the server.")
server.serve_forever()
