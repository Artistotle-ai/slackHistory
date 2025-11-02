#!/bin/bash
set -euo pipefail

# Clean up old Lambda Layer versions (keep last 5)
# Usage: cleanup-layer.sh [APP_PREFIX]

APP_PREFIX="${1:-Mnemosyne}"
LAYER_NAME="${APP_PREFIX}SlackSharedLayer"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

cd "$PROJECT_ROOT"

echo "=== Cleaning up old layer versions ==="
echo "Layer name: ${LAYER_NAME}"

LIST_OUTPUT=$(aws lambda list-layer-versions --layer-name "$LAYER_NAME" --query 'LayerVersions[].Version' --output text 2>&1)
LIST_EXIT_CODE=$?

if [ $LIST_EXIT_CODE -eq 0 ] && [ -n "$LIST_OUTPUT" ]; then
  OLD_VERSIONS=$(aws lambda list-layer-versions --layer-name "$LAYER_NAME" --query 'LayerVersions[5:].Version' --output text 2>/dev/null || echo "")
  if [ -n "$OLD_VERSIONS" ]; then
    echo "Cleaning up old layer versions: $OLD_VERSIONS"
    for version in $OLD_VERSIONS; do
      echo "Deleting layer version: $version"
      aws lambda delete-layer-version --layer-name "$LAYER_NAME" --version-number "$version" || true
    done
  else
    echo "No old layer versions to clean up"
  fi
else
  echo "Layer does not exist yet or access denied (will be created on first publish)"
fi
