# The prototypes' static server, with no-cache so every reload shows the latest files.
# python3 serve.py 4420
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

class NoCache(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()
    def log_message(self, *args):
        pass

port = int(sys.argv[1]) if len(sys.argv) > 1 else 4420
ThreadingHTTPServer(("127.0.0.1", port), partial(NoCache, directory=str(Path(__file__).parent))).serve_forever()
