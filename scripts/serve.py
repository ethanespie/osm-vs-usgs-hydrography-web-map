"""Dev-only static file server with HTTP Range support (needed for PMTiles).
Not part of the site itself; just used locally to serve this folder for testing.

Usage:
    python serve.py [--port 8766]
"""
import argparse
import http.server
import os
import re
import socketserver

SITE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class RangeRequestHandler(http.server.SimpleHTTPRequestHandler):
    """SimpleHTTPRequestHandler with HTTP Range (bytes=start-end) support, so PMTiles'
    range-based tile requests work against plain static files."""

    def send_head(self):
        """Handle a GET/HEAD request for self.path.

        Requests that don't resolve to a file (missing paths, directory listings) are
        delegated to the base handler untouched. For an actual file, returns a 206
        partial-content response if a Range header is present, otherwise the normal
        200 response.

        Returns:
            Whatever the base handler returns for non-file requests; otherwise a
            file-like object for copyfile() to stream to the client -- a plain file
            handle for full responses, or a _LimitedReader capped to the requested
            range for partial ones.
        """
        path = self.translate_path(self.path)
        if not os.path.isfile(path):
            return super().send_head()

        range_header = self.headers.get("Range")
        file_size = os.path.getsize(path)

        if range_header is None:
            self.send_response(200)
            self.send_header("Accept-Ranges", "bytes")
            ctype = self.guess_type(path)
            self.send_header("Content-type", ctype)
            self.send_header("Content-Length", str(file_size))
            self.end_headers()
            f = open(path, "rb")
            return f

        match = re.match(r"bytes=(\d*)-(\d*)", range_header)
        start_s, end_s = match.groups()
        start = int(start_s) if start_s else 0
        end = int(end_s) if end_s else file_size - 1
        end = min(end, file_size - 1)
        length = end - start + 1

        self.send_response(206)
        self.send_header("Accept-Ranges", "bytes")
        ctype = self.guess_type(path)
        self.send_header("Content-type", ctype)
        self.send_header("Content-Range", f"bytes {start}-{end}/{file_size}")
        self.send_header("Content-Length", str(length))
        self.end_headers()

        f = open(path, "rb")
        f.seek(start)
        return _LimitedReader(f, length)

    def copyfile(self, source, outputfile):
        """Stream source to outputfile, respecting _LimitedReader's byte cap for range responses."""
        if isinstance(source, _LimitedReader):
            remaining = source.length
            buf_size = 64 * 1024
            while remaining > 0:
                chunk = source.read(min(buf_size, remaining))
                if not chunk:
                    break
                outputfile.write(chunk)
                remaining -= len(chunk)
        else:
            super().copyfile(source, outputfile)


class _LimitedReader:
    """File-like wrapper around f that copyfile() uses to know when a range response's
    body (length bytes) has ended, since f itself has no such boundary."""

    def __init__(self, f, length):
        self.f = f
        self.length = length

    def read(self, n):
        """Read up to n bytes from the wrapped file."""
        return self.f.read(n)

    def close(self):
        """Close the wrapped file."""
        self.f.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8766)
    parser.add_argument("--directory", default=SITE_DIR)
    args = parser.parse_args()

    os.chdir(args.directory)
    with socketserver.TCPServer(("127.0.0.1", args.port), RangeRequestHandler) as httpd:
        print(f"Serving {args.directory} at http://127.0.0.1:{args.port}")
        httpd.serve_forever()
