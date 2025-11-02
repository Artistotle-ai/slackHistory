#!/bin/bash
set -euo pipefail

# Deploy Lambda Layer
# Usage: deploy-layer.sh <APP_PREFIX>

APP_PREFIX="${1:-Mnemosyne}"
LAYER_NAME="${APP_PREFIX}SlackSharedLayer"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

cd "$PROJECT_ROOT"

echo "=== Deploying Lambda Layer ==="
echo "Layer name: ${LAYER_NAME}"
echo "Working directory: $(pwd)"

if [ ! -f "slack-shared-layer.zip" ]; then
  echo "ERROR: slack-shared-layer.zip not found! Run build-layer.sh first." >&2
  exit 1
fi

# Publish new layer version
PUBLISH_OUTPUT=$(aws lambda publish-layer-version \
  --layer-name "${LAYER_NAME}" \
  --description "Shared utilities and types for Mnemosyne Slack functions" \
  --zip-file fileb://slack-shared-layer.zip \
  --compatible-runtimes nodejs20.x \
  --compatible-architectures arm64 \
  --output json 2>&1)

PUBLISH_EXIT_CODE=$?

if [ $PUBLISH_EXIT_CODE -ne 0 ]; then
  echo "ERROR: Failed to publish layer version:"
  echo "$PUBLISH_OUTPUT"
  exit 1
fi

# Extract version number from JSON
LAYER_VERSION=$(echo "$PUBLISH_OUTPUT" | grep -oE '"Version"[[:space:]]*:[[:space:]]*[0-9]+' | grep -oE '[0-9]+' | head -1)

# Verify layer version is a valid number
if [ -z "$LAYER_VERSION" ] || ! [[ "$LAYER_VERSION" =~ ^[0-9]+$ ]]; then
  echo "ERROR: Invalid layer version returned from publish"
  echo "Publish output: $PUBLISH_OUTPUT"
  exit 1
fi

# Get layer ARN for the published version
LAYER_ARN=$(aws lambda get-layer-version \
  --layer-name "${LAYER_NAME}" \
  --version-number "${LAYER_VERSION}" \
  --query 'LayerVersionArn' --output text 2>&1)

if [ $? -ne 0 ] || [ -z "$LAYER_ARN" ]; then
  echo "ERROR: Failed to get layer ARN for version ${LAYER_VERSION}"
  exit 1
fi

echo "✓ Layer version ${LAYER_VERSION} published: ${LAYER_ARN}"
echo "LAYER_ARN=${LAYER_ARN}" >> layer-arn.env
