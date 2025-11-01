# Mnemosyne Documentation

Slack History MVP that bypasses free plan message retention limits by archiving all messages, channels, and files to AWS.

## Quick Links

### Infrastructure
- **[Architecture](infrastructure/architecture.md)** - Stacks, resources, event flow
- **[Deployment Guide](infrastructure/deployment.md)** - Deploy to AWS
- **[Secrets Setup](infrastructure/secrets-setup.md)** - Configure Slack credentials
- **[Cost Optimization](infrastructure/cost-optimization.md)** - S3 lifecycle, log retention, cost breakdown

### Requirements
- **[Data Model](requirements/requirements.md)** - DynamoDB schema and events
- **[Infrastructure Specs](requirements/infraRequirements.md)** - Architecture details
- **[Message Listener](requirements/message-listener-requirements.md)** - Lambda event handlers

### Slack Integration
- **[Slack App Manifest](../slack/manifest.json)** - Ready-to-use app configuration

## Architecture

- **DynamoDB** - Single-table design for messages, channels, metadata
- **Lambda** - Message listener (Function URL) + file processor (DynamoDB Stream)
- **S3** - File storage with automatic downloads
- **CodePipeline** - CI/CD for infrastructure and Lambda code

## Quick Start

```bash
cd infrastructure
npm install
npx cdk bootstrap --profile default --region eu-west-1
npx cdk deploy --all --profile default --region eu-west-1 --require-approval never
```

Complete steps: [Deployment Guide](infrastructure/deployment.md)

## Key Features

- Real-time Slack event capture
- Thread tracking with GSI
- Automatic file archival
- Serverless and scalable
- No backfill (forward-looking only)