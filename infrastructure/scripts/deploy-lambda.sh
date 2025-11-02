#!/bin/bash
set -euo pipefail

# Deploy a Lambda function with the shared layer
# Usage: deploy-lambda.sh <function-name> [APP_PREFIX]

FUNCTION_NAME="$1"
APP_PREFIX="${2:-Mnemosyne}"

if [ -z "${FUNCTION_NAME:-}" ]; then
  echo "ERROR: Function name is required" >&2
  echo "Usage: $0 <function-name> [APP_PREFIX]" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

cd "$PROJECT_ROOT"

FULL_FUNCTION_NAME="${APP_PREFIX}${FUNCTION_NAME}"
FUNCTION_ZIP="${FUNCTION_NAME}-function.zip"
LAYER_NAME="${APP_PREFIX}SlackSharedLayer"

echo "=== Deploying ${FULL_FUNCTION_NAME} ==="
echo "Package: ${FUNCTION_ZIP}"
echo "Layer: ${LAYER_NAME}"

if [ ! -f "${FUNCTION_ZIP}" ]; then
  echo "ERROR: ${FUNCTION_ZIP} not found! Run package-lambda.sh first." >&2
  exit 1
fi

# Get latest layer version ARN
LAYER_ARN_OUTPUT=$(aws lambda list-layer-versions \
  --layer-name "${LAYER_NAME}" \
  --max-items 1 \
  --query 'LayerVersions[0].LayerVersionArn' \
  --output text 2>&1)

LAYER_EXIT_CODE=$?

# Validate layer ARN - must start with "arn:aws:" and not be empty
if [ $LAYER_EXIT_CODE -ne 0 ] || [ -z "$LAYER_ARN_OUTPUT" ] || [[ ! "$LAYER_ARN_OUTPUT" =~ ^arn:aws: ]]; then
  echo "ERROR: Failed to get latest layer ARN for ${LAYER_NAME}"
  echo "Exit code: $LAYER_EXIT_CODE"
  echo "Output: $LAYER_ARN_OUTPUT"
  exit 1
fi

LAYER_ARN="$LAYER_ARN_OUTPUT"

# Update function code
aws lambda update-function-code \
  --function-name "$FULL_FUNCTION_NAME" \
  --zip-file "fileb://${FUNCTION_ZIP}"

# Update function configuration to include layer
aws lambda update-function-configuration \
  --function-name "$FULL_FUNCTION_NAME" \
  --layers "$LAYER_ARN"

echo "✓ ${FULL_FUNCTION_NAME} deployed with layer ${LAYER_ARN}"
