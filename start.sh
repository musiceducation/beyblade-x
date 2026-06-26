#!/bin/bash
# Beyblade X arena — HTTPS server (required for phone camera)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR" || exit 1
echo "啟動競賽伺服器…"
echo "網址：https://$(hostname -s 2>/dev/null || echo localhost):8443"
echo "（路徑含空格時請用引號：\"$SCRIPT_DIR/start.sh\"）"
exec python3 "$SCRIPT_DIR/serve-https.py"
