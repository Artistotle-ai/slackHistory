#!/bin/bash
set -euo pipefail

# Build a Lambda function
# Usage: build-lambda.sh <function-name>

FUNCTION_NAME="$1"

if [ -z "${FUNCTION_NAME:-}" ]; then
  echo "ERROR: Function name is required" >&2
  echo "Usage: $0 <function-name>" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

cd "$PROJECT_ROOT"

if [ ! -d "functions/${FUNCTION_NAME}" ]; then
  echo "ERROR: functions/${FUNCTION_NAME} directory not found!" >&2
  exit 1
fi

echo "=== Building ${FUNCTION_NAME} ==="
echo "Working directory: $(pwd)"
cd "functions/${FUNCTION_NAME}"

# Remove slack-shared from node_modules (will come from layer)
rm -rf node_modules/mnemosyne-slack-shared || true

npm ci || npm install
npm run build || (echo "Build failed!" && exit 1)
# Tests temporarily disabled in CI - running locally
# npm test || true

echo "✓ ${FUNCTION_NAME} built successfully"
cd ../..
