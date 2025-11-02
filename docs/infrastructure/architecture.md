# Infrastructure Architecture

AWS serverless architecture for Slack message archival.

## Stack Deployment Order

1. **BaseRolesStack** - Shared resources
2. **MainInfraStack** - Core application
3. **PipelineInfraStack** - Infrastructure CI/CD
4. **PipelineListenerStack** - message-listener CI/CD
5. **PipelineOAuthCallbackStack** - oauth-callback CI/CD
6. **PipelineDdbStreamStack** - file-processor CI/CD

## BaseRolesStack

**Resources:**
- S3 bucket: `mnemosyne-artifacts-{account}-{region}`
- Secrets: `Mnemosyne/slack/signing-secret`, `Mnemosyne/slack/client-id`, `Mnemosyne/slack/client-secret`
- CodeStar GitHub connection: `Mnemosyne-github`
- IAM role: `MnemosyneCiRole` (CodePipeline permissions)

**Exports:**
- `MnemosyneSlackSigningSecretArn`
- `MnemosyneSlackClientIdSecretArn`
- `MnemosyneSlackClientSecretArn`
- `MnemosyneGitHubConnectionArn`

## MainInfraStack

**DynamoDB Table:** `MnemosyneSlackArchive`
- Partition key: `itemId` (string)
- Sort key: `timestamp` (string)
- Billing: PAY_PER_REQUEST
- GSI: `ThreadIndex` (partition: `parent`, sort: `timestamp`)
- Stream: Not enabled (file-processor not implemented)

**S3 Bucket:** `mnemosyne-slack-files-{account}-{region}`
- Versioning: Suspended
- Lifecycle: Transition to IA after 90 days
- Encryption: S3-managed

**Lambda Layer:** `MnemosyneSlackSharedLayer`
- Contains shared `slack-shared` code and dependencies
- Attached to all Lambda functions to reduce bundle sizes
- See [Lambda Layer Documentation](lambda-layer.md) for details

**Lambda Functions:**

See [Lambda Functions](../lambda-functions/) documentation:
- [Message Listener](../lambda-functions/message-listener.md) - `MnemosyneMessageListener`
- [OAuth Callback](../lambda-functions/oauth-callback.md) - `MnemosyneOAuthCallback`
- [File Processor](../lambda-functions/file-processor.md) - `MnemosyneFileProcessor`

All Lambda functions use the shared layer for `slack-shared` code.

**IAM Role:** `MnemosyneLambdaExecutionRole`
- DynamoDB: Read/write on `MnemosyneSlackArchive`
- S3: Read/write on `mnemosyne-slack-files-*`
- Secrets Manager: `GetSecretValue` on `Mnemosyne/slack/*`
- CloudWatch Logs: Write permissions

## Pipeline Stacks

All pipelines:
- Source: GitHub (main branch, CodeStar connection)
- Build: CodeBuild
- Artifact storage: S3 artifacts bucket
- Deployment: Lambda update-function-code

**PipelineInfraStack**
- Triggers: Changes to `infrastructure/`
- Buildspec: `infrastructure/buildspecs/infrastructure-buildspec.yml`
- Deploys: All CDK stacks

**PipelineListenerStack**
- Triggers: Changes to `functions/message-listener/`
- Buildspec: `infrastructure/buildspecs/message-listener-buildspec.yml`
- Deploys: `MnemosyneMessageListener` function code

**PipelineOAuthCallbackStack**
- Triggers: Changes to `functions/oauth-callback/`
- Buildspec: `infrastructure/buildspecs/oauth-callback-buildspec.yml`
- Deploys: `MnemosyneOAuthCallback` function code

**PipelineDdbStreamStack**
- Triggers: Changes to `functions/file-processor/`
- Buildspec: `infrastructure/buildspecs/file-processor-buildspec.yml`
- Deploys: `MnemosyneFileProcessor` function code

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
    ↓ stream (not configured)
MnemosyneFileProcessor (not implemented)
    ↓ download files
S3 (mnemosyne-slack-files-*)
```

## Network

**No VPC required** - All services use public AWS endpoints:
- Lambda: Function URL (public internet)
- DynamoDB: AWS endpoint
- S3: AWS endpoint
- Secrets Manager: AWS endpoint

## Region

Hardcoded: `eu-west-1`

All resources deployed to single region.

## References

- [Deployment Guide](./deployment.md)
- [Secrets Setup](./secrets-setup.md)
