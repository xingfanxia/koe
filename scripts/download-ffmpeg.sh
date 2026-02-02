#!/usr/bin/env bash
# Download static ffmpeg + ffprobe binaries for macOS arm64.
# Places them in electron/bin/ for bundling via extraResources.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BIN_DIR="$SCRIPT_DIR/../bin"

FFMPEG_URL="https://evermeet.cx/ffmpeg/getrelease/ffmpeg/zip"
FFPROBE_URL="https://evermeet.cx/ffmpeg/getrelease/ffprobe/zip"

mkdir -p "$BIN_DIR"

echo "Downloading ffmpeg..."
curl -L "$FFMPEG_URL" -o "$BIN_DIR/ffmpeg.zip"
unzip -o "$BIN_DIR/ffmpeg.zip" -d "$BIN_DIR"
rm "$BIN_DIR/ffmpeg.zip"

echo "Downloading ffprobe..."
curl -L "$FFPROBE_URL" -o "$BIN_DIR/ffprobe.zip"
unzip -o "$BIN_DIR/ffprobe.zip" -d "$BIN_DIR"
rm "$BIN_DIR/ffprobe.zip"

chmod +x "$BIN_DIR/ffmpeg" "$BIN_DIR/ffprobe"

echo "Done. Binaries at:"
ls -lh "$BIN_DIR/ffmpeg" "$BIN_DIR/ffprobe"
