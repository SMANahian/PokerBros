#!/bin/bash

PORT=${PORT:-3000}
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo ""
echo "  ♠ ♥ PokerBros ♦ ♣"
echo "  ─────────────────────────────────────────"
echo ""

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
  echo "  Installing dependencies..."
  npm install --silent
  echo ""
fi

# Free the port if something is already on it
lsof -ti tcp:$PORT | xargs kill -9 2>/dev/null || true
sleep 0.5

# Start the game server in the background
echo "  Starting server on port $PORT..."
node server.js &
SERVER_PID=$!
echo "  Local URL:  http://localhost:$PORT"
echo ""
sleep 1

cleanup() {
  echo ""
  echo "  Shutting down..."
  kill $SERVER_PID 2>/dev/null
  kill $TUNNEL_PID 2>/dev/null
  exit 0
}
trap cleanup INT TERM

# ── Tunnel ────────────────────────────────────────────────────────────────────
if command -v cloudflared &>/dev/null; then
  echo "  Starting cloudflared tunnel (free, no account needed)..."
  echo "  ─────────────────────────────────────────"
  echo "  Your shareable URL will appear below:"
  echo ""
  # cloudflared prints the URL to stderr
  cloudflared tunnel --url http://localhost:$PORT 2>&1 &
  TUNNEL_PID=$!
else
  echo "  Starting localtunnel..."
  echo "  ─────────────────────────────────────────"
  echo "  Note: Friends may see a bypass page — they click 'Click to Continue'"
  echo ""
  lt --port $PORT 2>&1 &
  TUNNEL_PID=$!
fi

echo ""
echo "  Press Ctrl+C to stop"
echo ""

wait $SERVER_PID
