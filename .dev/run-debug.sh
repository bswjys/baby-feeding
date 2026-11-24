#!/usr/bin/env bash
set -e
cd "$(dirname "$0")/.."
python3 -m http.server 8765 --bind 127.0.0.1 >/tmp/http.log 2>&1 &
H=$!
trap 'kill $H 2>/dev/null' EXIT
sleep 1.2
export LD_LIBRARY_PATH=/workspace/tmp/libroot/usr/lib/x86_64-linux-gnu:${LD_LIBRARY_PATH}
python3 .dev/debug-latency.py
