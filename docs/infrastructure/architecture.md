# Infrastructure Architecture

AWS serverless architecture for Slack message archival.

## Stack Deployment Order

1. **BaseRolesStack** - Shared resources
2. **MainInfraStack** - Core application
3. **PipelineInfraStack** - Infrastructure CI/CD
4. **PipelineLambdasStack** - Unified Lambda functions CI/CD

## BaseRolesStack

**Resources:**
- S3 bucket: `mnemosyne-artifacts-{account}-{region}`
  - Lifecycle: Delete artifacts after 7 days
  - Versioning: Disabled
  - Encryption: S3-managed
- Secrets Manager: `Mnemosyne/slack/signing-secret`, `Mnemosyne/slack/client-id`, `Mnemosyne/slack/client-secret`
- CodeStar GitHub connection: `Mnemosyne-github`
  - Provider: GitHub
  - Status: PENDING (requires manual authorization in AWS Console)

**Exports:**
- `MnemosyneSlackSigningSecretArn`
- `MnemosyneSlackClientIdSecretArn`
- `MnemosyneSlackClientSecretArn`
- `MnemosyneGitHubConnectionArn`
- `MnemosyneCdkFilePublishingRoleArn`
- `MnemosyneCdkDeployRoleArn`
- `MnemosyneCdkLookupRoleArn`

## MainInfraStack

**DynamoDB Table:** `MnemosyneSlackArchive`
- Partition key: `itemId` (string)
- Sort key: `timestamp` (string)
- Billing: PAY_PER_REQUEST
- GSI: `ThreadIndex` (partition: `parent`, sort: `timestamp`) - Sparse index for thread replies
- Stream: NEW_AND_OLD_IMAGES (enabled for file-processor and ChannelIndex updates)

**S3 Bucket:** `mnemosyne-slack-files-{account}-{region}`
- Versioning: Suspended
- Lifecycle: Transition to IA after 90 days
- Encryption: S3-managed

**Lambda Functions:**

See [Lambda Functions](../lambda-functions/) documentation:
- [Message Listener](../lambda-functions/message-listener.md) - `MnemosyneMessageListener`
- [OAuth Callback](../lambda-functions/oauth-callback.md) - `MnemosyneOAuthCallback`
- [File Processor](../lambda-functions/file-processor.md) - `MnemosyneFileProcessor`

**Lambda Specifications:**
- Runtime: Node.js 20, ARM64
- Memory: 512 MB (all functions)
- Message Listener: 30s timeout, Dead Letter Queue (14-day retention)
- OAuth Callback: 10s timeout
- File Processor: 5min timeout, Reserved Concurrency: 1 (for ChannelIndex serialization), Max Event Age: 6 minutes, Retry Attempts: 2

**IAM Roles:**
- `MnemosyneLambdaExecutionRole` (message-listener, file-processor)
  - DynamoDB: Read/write on `MnemosyneSlackArchive`
  - S3: Read/write on `mnemosyne-slack-files-*`
  - Secrets Manager: `GetSecretValue` on `Mnemosyne/slack/*`
  - CloudWatch Logs: Write permissions
- `MnemosyneOAuthLambdaExecutionRole` (oauth-callback)
  - DynamoDB: Write on `MnemosyneSlackArchive`
  - Secrets Manager: `GetSecretValue` on `Mnemosyne/slack/*`
  - Lambda: `GetFunctionUrlConfig` on own function
  - CloudWatch Logs: Write permissions

## Pipeline Stacks

All pipelines:
- Source: GitHub (main branch, CodeStar connection)
- Build: CodeBuild
- Artifact storage: S3 artifacts bucket
- Deployment: Lambda update-function-code

**PipelineInfraStack**
- Triggers: Changes to `infrastructure/` folder in main branch
- Buildspec: `infrastructure/buildspecs/infrastructure-buildspec.yml`
- CodeBuild: Linux Standard 7.0 (x86_64), Medium compute
- Deploys: All CDK stacks sequentially

**PipelineLambdasStack**
- Triggers: Changes to `functions/` folder in main branch
- Buildspec: `infrastructure/buildspecs/lambdas-buildspec.yml`
- CodeBuild: Amazon Linux 2023 Standard 3.0 (ARM64), Medium compute
- Deploys: All Lambda functions sequentially
  - Builds all functions with dependencies included
  - Deploys: `MnemosyneMessageListener`, `MnemosyneFileProcessor`, `MnemosyneOAuthCallback`
  - Uses `update-function-code` to deploy function bundles

## Event Flow

```
OAuth Installation:
    ↓ GET (redirect)
MnemosyneOAuthCallback (Function URL)
    ↓ exchange code for tokens
DynamoDB (MnemosyneSlackArchive) - store tokens

Slack Events API
    ↓ POST (webhook)
MnemosyneMessageListener (Function URL)
    ↓ verify signature → write event
DynamoDB (MnemosyneSlackArchive)
    ↓ DynamoDB Stream (NEW_AND_OLD_IMAGES)
MnemosyneFileProcessor (Reserved Concurrency: 1)
    ↓ download files / maintain ChannelIndex
S3 (mnemosyne-slack-files-*)
```

## Network

**No VPC required** - All services use public AWS endpoints:
- Lambda: Function URL (public internet)
- DynamoDB: AWS endpoint
- S3: AWS endpoint
- Secrets Manager: AWS endpoint

## Region

Default: `eu-west-1` (configurable via `AWS_REGION` environment variable)

All resources deployed to single region.

## References

- [Deployment Guide](./deployment.md)
- [Secrets Setup](./secrets-setup.md)
