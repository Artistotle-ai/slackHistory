# Infrastructure Architecture

AWS serverless architecture for Slack message archival.

## Stack Deployment Order

1. **BaseRolesStack** - Shared resources
2. **MainInfraStack** - Core application
3. **PipelineInfraStack** - Infrastructure CI/CD
4. **PipelineListenerStack** - message-listener CI/CD
5. **PipelineDdbStreamStack** - file-processor CI/CD

## BaseRolesStack

**Resources:**
- S3 bucket: `mnemosyne-artifacts-{account}-{region}`
- Secrets: `Mnemosyne/slack/bot-token`, `Mnemosyne/slack/signing-secret`
- CodeStar GitHub connection: `Mnemosyne-github`
- IAM role: `MnemosyneCiRole` (CodePipeline permissions)

**Exports:**
- `MnemosyneSlackBotTokenSecretArn`
- `MnemosyneSlackSigningSecretArn`
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

**Lambda Functions:**

`MnemosyneMessageListener`
- Runtime: Node.js 22, ARM64
- Memory: 256 MB
- Timeout: 30 seconds
- Trigger: Function URL (public, no auth)
- Code: Deployed via pipeline (placeholder inline code initially)
- Logs: `/aws/lambda/MnemosyneMessageListener` (7-day retention)

`MnemosyneFileProcessor`
- Runtime: Node.js 22, ARM64
- Memory: 512 MB
- Timeout: 5 minutes
- Trigger: DynamoDB stream (not yet configured)
- Code: Placeholder (not implemented)
- Logs: `/aws/lambda/MnemosyneFileProcessor` (7-day retention)

**IAM Role:** `MnemosyneLambdaExecutionRole`
- DynamoDB: Read/write on `MnemosyneSlackArchive`
- S3: Read/write on `mnemosyne-slack-files-*`
- Secrets Manager: `GetSecretValue` on `Mnemosyne/slack/*`
- CloudWatch Logs: Write permissions

## Pipeline Stacks

All pipelines:
- Source: GitHub (main branch, CodeStar connection)
- Build: CodeBuild ARM (Node.js 22)
- Artifact storage: S3 artifacts bucket
- Deployment: Lambda update-function-code

**PipelineInfraStack**
- Triggers: Changes to `infrastructure/`
- Buildspec: `infrastructure/buildspecs/infrastructure-buildspec.yml`
- Deploys: All CDK stacks

**PipelineListenerStack**
- Triggers: Changes to `message-listener/`
- Buildspec: `infrastructure/buildspecs/message-listener-buildspec.yml`
- Deploys: `MnemosyneMessageListener` function code

**PipelineDdbStreamStack**
- Triggers: Changes to `file-processor/`
- Buildspec: Inline in stack definition
- Deploys: `MnemosyneFileProcessor` function code

## Event Flow

```
Slack Events API
    ↓ POST (webhook)
Lambda Function URL
    ↓ verify signature
MnemosyneMessageListener
    ↓ write event
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
- [Cost Optimization](./cost-optimization.md)
- [Secrets Setup](./secrets-setup.md)
