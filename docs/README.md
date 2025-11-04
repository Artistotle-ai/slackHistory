# Mnemosyne Documentation

Slack History Archiver - bypasses free plan message retention limits by archiving messages, channels, and files to AWS.

## Getting Started

**New to Mnemosyne?** Start here: **[Get Started Guide](GET_STARTED.md)**

The Get Started guide walks you through the complete setup process from deployment to verification, with links to detailed documentation at each step.

## Quick Links

### API
- **[Endpoints](api/endpoints.md)** - Lambda Function URLs and methods

### Lambda Functions
- **[Message Listener](lambda-functions/message-listener.md)** - Slack Events API webhook handler
- **[OAuth Callback](lambda-functions/oauth-callback.md)** - OAuth installation handler
- **[File Processor](lambda-functions/file-processor.md)** - DynamoDB stream file downloader
- **[Token Refresh](lambda-functions/token-refresh.md)** - Token refresh handler (if rotation enabled)

### Infrastructure
- **[Architecture](infrastructure/architecture.md)** - Stacks, resources, event flow
- **[Deployment Guide](infrastructure/deployment.md)** - Deploy to AWS
- **[Secrets Setup](infrastructure/secrets-setup.md)** - Configure Slack credentials
- **[Lambda Layer](infrastructure/lambda-layer.md)** - Shared code layer implementation

### Data Model
- **[Data Schema](requirements/requirements.md)** - DynamoDB item structure and key patterns

### Development
- **[Build Architecture](development/BUILD_EXPLAINED.md)** - Build system and TypeScript configuration
- **[Development Workflow](development/dev-workflow.md)** - Watch mode and local development

### Slack Integration
- **[Slack App Manifest](../slack/manifest.json)** - App configuration

## Architecture

- **DynamoDB** - Single-table design for messages, channels, OAuth tokens
- **Lambda Functions** - [Message Listener](lambda-functions/message-listener.md) (Function URL), [OAuth Callback](lambda-functions/oauth-callback.md) (Function URL), [File Processor](lambda-functions/file-processor.md) (DynamoDB Stream)
- **S3** - File storage with lifecycle policies
- **CodePipeline** - CI/CD for infrastructure and Lambda code

## Quick Start

For a complete step-by-step guide, see **[Get Started](GET_STARTED.md)**.

Quick deployment commands:

```bash
cd infrastructure
npm install
npx cdk bootstrap --profile default --region eu-west-1
npx cdk deploy --all --profile default --region eu-west-1 --require-approval never
```

See [Deployment Guide](infrastructure/deployment.md) for detailed deployment instructions.