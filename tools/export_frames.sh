#!/bin/bash
# Extract training frames from a match recording
# Usage: ./tools/export_frames.sh replay.webm [fps]
set -euo pipefail
IN="${1:?Usage: export_frames.sh video.webm [fps]}"
FPS="${2:-5}"
OUT="training-frames/$(basename "${IN%.*}")"
mkdir -p "$OUT"
ffmpeg -i "$IN" -vf "fps=${FPS}" "${OUT}/frame_%04d.jpg"
echo "Saved frames to ${OUT}/"
