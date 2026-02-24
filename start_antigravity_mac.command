#!/bin/bash
# Launcher to start Antigravity with a CDP debugging port
# Automatically detects and uses an available port

PORTS=(9222 9333 9444 9555 9666)
SELECTED_PORT=""

for port in "${PORTS[@]}"; do
    if ! lsof -i :$port > /dev/null 2>&1; then
        SELECTED_PORT=$port
        break
    fi
done

if [ -z "$SELECTED_PORT" ]; then
    echo "[ERROR] No available ports were found (${PORTS[*]})"
    echo "   Please stop any process using one of these ports."
    read -p "Press Enter to close..."
    exit 1
fi

echo "[INFO] Starting Antigravity on port $SELECTED_PORT..."
open -a Antigravity --args --remote-debugging-port=$SELECTED_PORT
echo "[OK] Launch complete! CDP port: $SELECTED_PORT"
sleep 2
exit
