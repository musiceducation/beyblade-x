#!/bin/bash
# Beyblade X arena — HTTPS server (required for phone camera)
cd "$(dirname "$0")"
echo "啟動競賽伺服器…"
python3 serve-https.py
