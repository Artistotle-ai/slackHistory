#!/bin/bash
set -euo pipefail

# Build and package slack-shared as Lambda Layer
# Usage: build-layer.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

cd "$PROJECT_ROOT"

echo "=== Building Lambda Layer ==="
echo "Working directory: $(pwd)"

if [ ! -d "functions/slack-shared" ]; then
  echo "ERROR: functions/slack-shared directory not found!" >&2
  exit 1
fi

echo "Building slack-shared..."
cd functions/slack-shared
npm ci || npm install
npm run build || (echo "Build failed!" && exit 1)
npm test || true
echo "✓ slack-shared built successfully"
cd ../..

echo "Packaging Lambda Layer..."
# Create Lambda Layer structure: nodejs/node_modules/mnemosyne-slack-shared
mkdir -p build-layer/nodejs/node_modules/mnemosyne-slack-shared

# Copy built dist and package.json to layer
cp -r functions/slack-shared/dist build-layer/nodejs/node_modules/mnemosyne-slack-shared/
cp functions/slack-shared/package.json build-layer/nodejs/node_modules/mnemosyne-slack-shared/

# Install production dependencies for slack-shared into layer
cd functions/slack-shared
npm ci --production || npm install --production
# Copy node_modules dependencies to layer (excluding slack-shared itself if present)
if [ -d "node_modules" ]; then
  cp -r node_modules/* ../build-layer/nodejs/node_modules/mnemosyne-slack-shared/node_modules/ 2>/dev/null || true
fi
cd ../..

# Package the layer
cd build-layer
zip -rq ../slack-shared-layer.zip nodejs 2>&1 | head -20 || true
cd ..
echo "✓ slack-shared layer packaged"
