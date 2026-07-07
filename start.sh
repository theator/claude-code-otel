#!/bin/bash
# Start Claude Code telemetry dashboard + CORS proxy
# Prerequisite: docker compose up -d (LGTM + Phoenix)

DIR="$(cd "$(dirname "$0")" && pwd)"

# Start proxy if not running
if ! pgrep -f "python3 proxy.py" > /dev/null; then
  echo "Starting CORS proxy..."
  cd "$DIR" && python3 proxy.py &
  sleep 1
fi

echo ""
echo "Legacy dashboard: file://$DIR/dashboard.html"
echo "React UI (dev):   cd ui && npm install && npm run dev"
echo "React UI (build): cd ui && npm install && npm run build"
echo "Proxy:            http://localhost:8090  (health: http://localhost:8090/health)"
echo "Grafana:          http://localhost:3000 (existing dashboard)"
echo "Phoenix:          http://localhost:6006 (trace waterfall)"
echo ""
open "$DIR/dashboard.html" 2>/dev/null || echo "Open dashboard.html in your browser"