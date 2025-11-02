#!/bin/bash
set -euo pipefail

# Package a Lambda function
# Usage: package-lambda.sh <function-name>

FUNCTION_NAME="$1"

if [ -z "${FUNCTION_NAME:-}" ]; then
  echo "ERROR: Function name is required" >&2
  echo "Usage: $0 <function-name>" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

cd "$PROJECT_ROOT"

FUNCTION_ZIP="${FUNCTION_NAME}-function.zip"

echo "=== Packaging ${FUNCTION_NAME} ==="
echo "Output: ${FUNCTION_ZIP}"
cd "functions/${FUNCTION_NAME}"
npm prune --production || true

if [ -d "dist" ]; then
  cd dist
  zip -rq "../../../${FUNCTION_ZIP}" * 2>&1 | head -20 || true
  cd ..
fi

if [ -d "node_modules" ]; then
  zip -rq "../../${FUNCTION_ZIP}" node_modules 2>&1 | head -20 || true
fi

cd ../..
echo "✓ ${FUNCTION_NAME} package created: ${FUNCTION_ZIP}"
