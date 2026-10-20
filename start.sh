#!/usr/bin/env bash
# Start the YoutubeExplode bridge and the FastAPI app together (Render/Linux).
set -euo pipefail

PORT="${PORT:-8000}"
BRIDGE_PORT="${YOUTUBE_BRIDGE_PORT:-5001}"
export YOUTUBE_BRIDGE_URL="${YOUTUBE_BRIDGE_URL:-http://127.0.0.1:${BRIDGE_PORT}}"

BRIDGE_BIN="bridge-out/WebTube.YoutubeBridge"
if [ ! -x "$BRIDGE_BIN" ]; then
  echo "Bridge binary missing. Run 'bash build-bridge.sh' first." >&2
  exit 1
fi

"$BRIDGE_BIN" --urls "http://127.0.0.1:${BRIDGE_PORT}" &
BRIDGE_PID=$!
trap 'kill "$BRIDGE_PID" 2>/dev/null || true' EXIT

for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:${BRIDGE_PORT}/health" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

exec uvicorn server.app:app --host 0.0.0.0 --port "$PORT"
