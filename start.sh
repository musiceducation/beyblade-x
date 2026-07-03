#!/bin/bash
# Beyblade X arena — HTTPS server (required for phone camera)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR" || exit 1
echo "啟動競賽伺服器…"
LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)"
echo "本機：https://localhost:8443"
if [ -n "$LAN_IP" ]; then
  echo "手機/其他裝置：https://${LAN_IP}:8443"
else
  echo "手機/其他裝置：請在 serve-https 啟動後查看終端機顯示的 IP"
fi
echo "（路徑含空格時請用引號：\"$SCRIPT_DIR/start.sh\"）"
exec python3 "$SCRIPT_DIR/serve-https.py"
