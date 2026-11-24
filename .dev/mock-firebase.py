#!/usr/bin/env python3
"""수유 앱 테스트용 '가짜 Firebase Realtime Database' 서버.

실제 Firebase RTDB 의 REST + SSE 동작만 흉내 낸다.
  GET  /rooms/<room>/records.json            (Accept: text/event-stream → SSE 구독)
  GET  /rooms/<room>/records/<id>.json
  PUT  /rooms/<room>/records/<id>.json
  PATCH/DELETE /rooms/<room>/records/<id>.json
"""
import json
import queue
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

DB = {}                 # room -> {id: record}
LOCK = threading.Lock()
SUBS = {}               # room -> [queue.Queue]


def room_of(path):
    parts = [p for p in path.split('/') if p]
    return parts[1] if len(parts) > 1 and parts[0] == 'rooms' else None


def broadcast(room, node, value):
    with LOCK:
        qs = list(SUBS.get(room, []))
    msg = 'event: put\ndata: %s\n\n' % json.dumps(
        {'path': '/' + node, 'data': value}, ensure_ascii=False)
    for q in qs:
        q.put(msg)


class Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def log_message(self, *args):
        pass

    def cors(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, PUT, PATCH, DELETE, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.send_header('Access-Control-Max-Age', '600')

    def do_OPTIONS(self):
        self.send_response(204)
        self.cors()
        self.send_header('Content-Length', '0')
        self.end_headers()

    def _json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.cors()
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        url = urlparse(self.path)
        path = url.path
        if path == '/__dump':
            with LOCK:
                return self._json(200, DB)
        if path == '/__reset':
            with LOCK:
                DB.clear()
            return self._json(200, {'ok': True})
        room = room_of(path)
        if not room:
            return self._json(404, {'error': 'no room'})

        if path.endswith('/records.json'):
            accept = self.headers.get('Accept', '')
            if 'text/event-stream' in accept:
                return self.stream(room)
            with LOCK:
                return self._json(200, DB.get(room) or None)

        if path.endswith('.json'):
            rid = path.split('/')[-1][:-5]
            with LOCK:
                return self._json(200, (DB.get(room) or {}).get(rid))
        return self._json(404, {'error': 'not found'})

    def stream(self, room):
        q = queue.Queue()
        with LOCK:
            SUBS.setdefault(room, []).append(q)
            snapshot = json.loads(json.dumps(DB.get(room) or {}))
        self.send_response(200)
        self.cors()
        self.send_header('Content-Type', 'text/event-stream')
        self.send_header('Cache-Control', 'no-cache')
        self.send_header('Connection', 'keep-alive')
        self.end_headers()
        try:
            self.wfile.write(('event: put\ndata: %s\n\n' % json.dumps(
                {'path': '/', 'data': snapshot}, ensure_ascii=False)).encode())
            self.wfile.flush()
            last = time.time()
            while True:
                try:
                    msg = q.get(timeout=1.0)
                    self.wfile.write(msg.encode())
                    self.wfile.flush()
                    last = time.time()
                except queue.Empty:
                    if time.time() - last > 10:
                        self.wfile.write(b': keep-alive\n\n')
                        self.wfile.flush()
                        last = time.time()
        except (BrokenPipeError, ConnectionResetError):
            pass
        finally:
            with LOCK:
                if q in SUBS.get(room, []):
                    SUBS[room].remove(q)

    def do_PUT(self):
        url = urlparse(self.path)
        length = int(self.headers.get('Content-Length') or 0)
        raw = self.rfile.read(length) if length else b'null'
        try:
            value = json.loads(raw) if raw else None
        except json.JSONDecodeError:
            return self._json(400, {'error': 'bad json'})
        room = room_of(url.path)
        if not room or not url.path.endswith('.json'):
            return self._json(404, {'error': 'not found'})
        rid = url.path.split('/')[-1][:-5]
        with LOCK:
            DB.setdefault(room, {})
            if value is None:
                DB[room].pop(rid, None)
            else:
                DB[room][rid] = value
        broadcast(room, rid, value)
        return self._json(200, value)

    def do_PATCH(self):
        url = urlparse(self.path)
        length = int(self.headers.get('Content-Length') or 0)
        raw = self.rfile.read(length) if length else b'{}'
        try:
            value = json.loads(raw) or {}
        except json.JSONDecodeError:
            return self._json(400, {'error': 'bad json'})
        room = room_of(url.path)
        if not room or not url.path.endswith('.json'):
            return self._json(404, {'error': 'not found'})
        rid = url.path.split('/')[-1][:-5]
        with LOCK:
            DB.setdefault(room, {})
            cur = DB[room].get(rid) or {}
            if not isinstance(cur, dict):
                cur = {}
            merged = dict(cur)
            for k, v in value.items():
                if v is None:
                    merged.pop(k, None)
                else:
                    merged[k] = v
            DB[room][rid] = merged
        broadcast(room, rid, merged)
        return self._json(200, merged)

    def do_DELETE(self):
        url = urlparse(self.path)
        room = room_of(url.path)
        if not room or not url.path.endswith('.json'):
            return self._json(404, {'error': 'not found'})
        rid = url.path.split('/')[-1][:-5]
        with LOCK:
            DB.setdefault(room, {}).pop(rid, None)
        broadcast(room, rid, None)
        return self._json(200, None)


if __name__ == '__main__':
    import sys
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8766
    srv = ThreadingHTTPServer(('127.0.0.1', port), Handler)
    srv.daemon_threads = True
    print('mock firebase on', port, flush=True)
    srv.serve_forever()
