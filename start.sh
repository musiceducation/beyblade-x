#!/bin/bash
# Run HTTP (8080) for main PC + HTTPS (8443) for phone camera
cd "$(dirname "$0")"
python3 serve-https.py &
HTTPS_PID=$!
python3 -m http.server 8080 &
HTTP_PID=$!
echo "Main app (recommended): https://YOUR_LAN_IP:8443/"
echo "Main app (local only):  http://localhost:8080"
echo "Phone cam page:           https://YOUR_LAN_IP:8443/remote-cam.html"
echo "Press Ctrl+C to stop both."
trap "kill $HTTPS_PID $HTTP_PID 2>/dev/null" EXIT
wait
