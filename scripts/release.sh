#!/bin/bash
# Release script for Koe Electron app

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ELECTRON_DIR="$(dirname "$SCRIPT_DIR")"
APP_NAME="Koe"

echo "🚀 Building $APP_NAME..."

cd "$ELECTRON_DIR"

# Clean previous builds
echo "🧹 Cleaning previous builds..."
rm -rf dist/

# Build the app
echo "🔨 Packaging app..."
npm run pack

# Get the output path
if [[ $(uname -m) == "arm64" ]]; then
    APP_PATH="dist/mac-arm64/$APP_NAME.app"
else
    APP_PATH="dist/mac/$APP_NAME.app"
fi

if [[ ! -d "$APP_PATH" ]]; then
    echo "❌ Build failed - app not found at $APP_PATH"
    exit 1
fi

echo "✅ Build complete: $APP_PATH"

# Ask if user wants to install
read -p "📲 Install to /Applications? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "🗑️  Removing old version..."
    rm -rf "/Applications/$APP_NAME.app"
    
    echo "📋 Copying to /Applications..."
    cp -r "$APP_PATH" /Applications/
    
    echo "✅ Installed to /Applications/$APP_NAME.app"
    
    read -p "🚀 Launch now? (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        open "/Applications/$APP_NAME.app"
    fi
fi

echo "🎉 Done!"
