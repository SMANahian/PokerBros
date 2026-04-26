#!/usr/bin/env bash
# PokerBros launcher — macOS / Linux / WSL
# Usage: ./start.sh

PORT=${PORT:-3000}
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

GREEN='\033[0;32m'; CYAN='\033[0;36m'; YELLOW='\033[1;33m'; RESET='\033[0m'

echo ""
echo -e "  ${GREEN}♠ ♥ PokerBros ♦ ♣${RESET}"
echo "  ─────────────────────────────────────────"
echo ""

# ── 1. Check Node.js ──────────────────────────────────────────────────────────
if ! command -v node &>/dev/null; then
  echo "  ERROR: Node.js is not installed."
  if command -v brew &>/dev/null; then
    echo "  Run: brew install node"
  elif command -v apt-get &>/dev/null; then
    echo "  Run: sudo apt-get install -y nodejs npm"
  elif command -v dnf &>/dev/null; then
    echo "  Run: sudo dnf install nodejs"
  else
    echo "  Download from: https://nodejs.org/"
  fi
  echo ""; exit 1
fi

echo -e "  ${CYAN}Node.js $(node --version)${RESET}"

# ── 2. Install npm dependencies ───────────────────────────────────────────────
if [ ! -d "node_modules" ]; then
  echo "  Installing dependencies..."
  npm install --silent
  echo ""
fi

# ── 3. Free port if occupied ──────────────────────────────────────────────────
lsof -ti tcp:$PORT | xargs kill -9 2>/dev/null || true
sleep 0.5

# ── 4. Start game server ──────────────────────────────────────────────────────
echo "  Starting server on port $PORT..."
node server.js &
SERVER_PID=$!
echo -e "  Local:   ${CYAN}http://localhost:$PORT${RESET}"
echo ""
sleep 1

cleanup() {
  echo ""; echo "  Shutting down..."
  kill "$SERVER_PID"  2>/dev/null || true
  kill "$TUNNEL_PID"  2>/dev/null || true
  exit 0
}
trap cleanup INT TERM

# ── 5. Start tunnel ───────────────────────────────────────────────────────────
TUNNEL_PID=""

if command -v cloudflared &>/dev/null; then
  echo "  Starting cloudflared tunnel (free, no account needed)..."
  echo "  ─────────────────────────────────────────"
  echo -e "  ${GREEN}Your public URL will appear below:${RESET}"
  echo ""
  cloudflared tunnel --url "http://localhost:$PORT" 2>&1 &
  TUNNEL_PID=$!

else
  # Find localtunnel (installed as a dev-dep, so check node_modules first)
  if   [ -x "./node_modules/.bin/lt" ]; then  LT="./node_modules/.bin/lt"
  elif command -v lt  &>/dev/null;       then  LT="lt"
  elif command -v npx &>/dev/null;       then  LT="npx --yes localtunnel"
  else                                         LT=""
  fi

  if [ -n "$LT" ]; then
    echo "  cloudflared not found — using localtunnel instead."
    echo -e "  ${YELLOW}Note: friends may see a bypass page; they click 'Click to Continue'${RESET}"
    echo ""
    $LT --port "$PORT" 2>&1 &
    TUNNEL_PID=$!
  else
    echo -e "  ${YELLOW}No tunnel tool found. Only local access available.${RESET}"
    echo "  Install cloudflared for a public URL:"
    echo "    brew install cloudflared       (macOS)"
    echo "    https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/"
  fi
fi

echo ""
echo "  Press Ctrl+C to stop"
echo ""

wait "$SERVER_PID"
