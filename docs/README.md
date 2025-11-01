# Mnemosyne Documentation

Slack History MVP that bypasses free plan message retention limits by archiving all messages, channels, and files to AWS.

## Quick Links

- **[Deployment Guide](infrastructure/deployment.md)** - Deploy to AWS
- **[Secrets Setup](infrastructure/secrets-setup.md)** - Configure Slack credentials
- **[Slack App Manifest](../slack/manifest.json)** - Ready-to-use Slack app configuration
- **[Infrastructure Specs](requirements/infraRequirements.md)** - Architecture details
- **[Data Model](requirements/requirements.md)** - DynamoDB schema and events

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