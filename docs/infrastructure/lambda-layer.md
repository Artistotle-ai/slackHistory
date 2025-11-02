# Lambda Layer for Shared Code

This document describes the Lambda Layer implementation for sharing `slack-shared` code across all Lambda functions.

## Overview

Lambda Layers allow us to package shared dependencies and code separately from Lambda function code. This provides several benefits:

- **Smaller deployment packages**: Shared code is in the layer, not duplicated in each Lambda bundle
- **Faster deployments**: Layer changes less frequently, so Lambda code updates are smaller
- **Better code reuse**: All functions share the exact same `slack-shared` version
- **Reduced cold starts**: Layer can be cached by Lambda runtime
- **Cost savings**: Smaller bundles mean faster uploads and less storage

## Architecture

### Layer Structure

The Lambda Layer follows the Node.js layer structure:
```
nodejs/
  node_modules/
    mnemosyne-slack-shared/
      dist/              # Compiled TypeScript code
      package.json       # Package metadata
      node_modules/      # Production dependencies
```

When attached to a Lambda, the layer is mounted at `/opt/nodejs/`, making `mnemosyne-slack-shared` available via `require('mnemosyne-slack-shared')` or `import 'mnemosyne-slack-shared'`.

### Layer Contents

The layer contains:
- **slack-shared compiled code**: All TypeScript files compiled to JavaScript in `dist/`
- **Production dependencies**: Only production dependencies from `slack-shared/package.json`:
  - `@aws-sdk/client-dynamodb`
  - `@aws-sdk/client-secrets-manager`
  - `@aws-sdk/lib-dynamodb`
  - `@aws-sdk/node-http-handler`

### Lambda Functions Using the Layer

All Lambda functions use the same layer:
- `message-listener`: Processes Slack Events API webhooks
- `file-processor`: Processes DynamoDB stream events for file downloads
- `oauth-callback`: Handles Slack OAuth installation

Each Lambda function:
1. Excludes `slack-shared` from its own bundle
2. References the layer at `/opt/nodejs/node_modules/mnemosyne-slack-shared`
3. Imports `slack-shared` normally via `require()` or `import`

## Build Process

The build process is automated via CodePipeline (see `infrastructure/buildspecs/lambdas-buildspec.yml`):

### PHASE 0: Cleanup
- Removes old layer versions (keeps last 5 versions)
- Prevents layer version accumulation

### PHASE 1: Build slack-shared
- Runs `npm ci` to install dependencies
- Runs `npm run build` to compile TypeScript
- Runs `npm test` (optional, can be disabled in CI)

### PHASE 2: Package Layer
- Creates `build-layer/nodejs/node_modules/mnemosyne-slack-shared/` structure
- Copies `dist/` and `package.json` to layer
- Installs production dependencies
- Creates `slack-shared-layer.zip`

### PHASE 3: Deploy Layer
- Publishes new layer version to AWS Lambda
- Uses runtime `nodejs22.x` and architecture `arm64`
- Retrieves layer ARN for Lambda attachments

### PHASE 4-6: Build and Deploy Lambdas
- Builds each Lambda without `slack-shared` in bundle
- Packages smaller Lambda bundles
- Deploys each Lambda with layer attached via `update-function-configuration`

## Infrastructure as Code

### CDK Configuration

The layer is defined in `infrastructure/lib/main-infra-stack.ts`:

```typescript
const slackSharedLayer = new lambda.LayerVersion(this, 'SlackSharedLayer', {
  layerVersionName: `${appPrefix}SlackSharedLayer`,
  code: lambda.Code.fromInline('// Placeholder - actual layer published by pipeline'),
  compatibleRuntimes: [lambda.Runtime.NODEJS_22_X],
  compatibleArchitectures: [lambda.Architecture.ARM_64],
  description: 'Shared utilities and types for Mnemosyne Slack functions',
});
```

**Note**: The CDK creates a placeholder layer version. The pipeline publishes actual versions and updates Lambda functions to use the latest version.

### Lambda Function Configuration

All Lambda functions attach the layer:

```typescript
this.messageListenerFunction = new lambda.Function(this, 'MessageListenerFunction', {
  // ... other config
  layers: [slackSharedLayer],
});
```

## Deployment Workflow

### Initial Deployment

1. **Deploy Infrastructure**: `cdk deploy MainInfraStack`
   - Creates placeholder layer
   - Creates Lambda functions with layer attached

2. **Pipeline Build**: CodePipeline automatically:
   - Builds slack-shared
   - Publishes first layer version
   - Deploys Lambda functions with layer

### Subsequent Deployments

1. **Push to main**: Pipeline triggers automatically
2. **Layer Update**: If slack-shared changed, new layer version published
3. **Lambda Update**: Each Lambda updated with latest layer version
4. **Cleanup**: Old layer versions (beyond 5) are deleted

## Manual Operations

### Publish New Layer Version

The layer is automatically published by the pipeline. To publish manually:

```bash
# Build slack-shared
cd functions/slack-shared
npm ci
npm run build

# Package layer (from project root)
mkdir -p build-layer/nodejs/node_modules/mnemosyne-slack-shared
cp -r functions/slack-shared/dist build-layer/nodejs/node_modules/mnemosyne-slack-shared/
cp functions/slack-shared/package.json build-layer/nodejs/node_modules/mnemosyne-slack-shared/
cd functions/slack-shared && npm ci --production && cp -r node_modules/* ../../build-layer/nodejs/node_modules/mnemosyne-slack-shared/node_modules/
cd ../../build-layer
zip -rq ../slack-shared-layer.zip nodejs

# Publish
aws lambda publish-layer-version \
  --layer-name "MnemosyneSlackSharedLayer" \
  --description "Shared utilities and types for Mnemosyne Slack functions" \
  --zip-file fileb://slack-shared-layer.zip \
  --compatible-runtimes nodejs22.x \
  --compatible-architectures arm64
```

### Update Lambda Function to Use Latest Layer

```bash
# Get latest layer version ARN
LAYER_ARN=$(aws lambda list-layer-versions \
  --layer-name "MnemosyneSlackSharedLayer" \
  --max-items 1 \
  --query 'LayerVersions[0].LayerVersionArn' \
  --output text)

# Update Lambda function
aws lambda update-function-configuration \
  --function-name "MnemosyneMessageListener" \
  --layers "$LAYER_ARN"
```

### List Layer Versions

```bash
aws lambda list-layer-versions \
  --layer-name "MnemosyneSlackSharedLayer" \
  --query 'LayerVersions[*].[Version,CreatedDate]' \
  --output table
```

### Delete Old Layer Version

```bash
aws lambda delete-layer-version \
  --layer-name "MnemosyneSlackSharedLayer" \
  --version-number 3
```

## Troubleshooting

### Layer Not Found

**Error**: `Cannot find module 'mnemosyne-slack-shared'`

**Solutions**:
1. Verify layer is attached: `aws lambda get-function --function-name <function-name> --query 'Configuration.Layers'`
2. Check layer ARN is correct
3. Verify layer contains correct structure: `nodejs/node_modules/mnemosyne-slack-shared/`

### Layer Version Mismatch

**Error**: Lambda uses old layer version after update

**Solution**: The pipeline should automatically update Lambda functions. Verify:
1. Pipeline successfully published new layer version
2. Pipeline updated Lambda configuration with new layer ARN
3. Lambda function shows correct layer ARN in AWS Console

### Build Failures

**Error**: `--compatible-runtimes nodejs22 failed to satisfy constraint`

**Solution**: Runtime must be `nodejs22.x` (with `.x` suffix), not `nodejs22`. This is already fixed in the buildspec.

**Error**: `--version-number: invalid int value: ''`

**Solution**: This indicates layer publish failed but script continued. The buildspec now includes proper error handling:
- Checks publish exit code
- Validates version number is numeric
- Fails fast with error messages

### Layer Size Limits

**Warning**: Layer size exceeds limits

**Current Limits**:
- Uncompressed: 250 MB
- Compressed (zip): 50 MB

**If exceeded**:
1. Review dependencies in `slack-shared/package.json`
2. Use `npm prune --production` to remove dev dependencies
3. Consider splitting into multiple layers if needed

## Best Practices

1. **Version Management**: Always use latest layer version for new deployments
2. **Cleanup**: Pipeline automatically keeps last 5 versions (configurable in buildspec)
3. **Testing**: Test layer changes locally before deploying:
   ```bash
   # Test layer structure locally
   mkdir -p test-layer/nodejs/node_modules/mnemosyne-slack-shared
   cp -r functions/slack-shared/dist test-layer/nodejs/node_modules/mnemosyne-slack-shared/
   node -e "require('./test-layer/nodejs/node_modules/mnemosyne-slack-shared/dist/index.js')"
   ```
4. **Monitoring**: Watch CloudWatch Logs for Lambda import errors
5. **Rollback**: Keep old layer versions until you verify new version works

## References

- [AWS Lambda Layers Documentation](https://docs.aws.amazon.com/lambda/latest/dg/configuration-layers.html)
- [Node.js Layer Structure](https://docs.aws.amazon.com/lambda/latest/dg/configuration-layers.html#configuration-layers-path)
- Buildspec: `infrastructure/buildspecs/lambdas-buildspec.yml`
- CDK Stack: `infrastructure/lib/main-infra-stack.ts`

