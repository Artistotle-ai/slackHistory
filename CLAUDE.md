# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Mnemosyne** is a Slack message archiving MVP that preserves unlimited message history for free-tier Slack workspaces by capturing real-time events and storing them in AWS. The system captures messages, channel metadata, and file attachments from the point of deployment forward (no historical backfill).

**Critical**: This application stores ALL workspace messages including private channels. Requires explicit consent from all workspace members. May violate Slack's Terms of Service.

## Architecture

### Event Flow
```
Slack Events API → Lambda Function URL → message-listener Lambda → DynamoDB →
DynamoDB Stream → file-processor Lambda → S3
```

### Core Components

1. **message-listener** - Lambda function with public Function URL that receives Slack Events API webhooks
2. **file-processor** - Lambda function triggered by DynamoDB streams to download and archive file attachments
3. **slack-shared** - Shared utilities and types (TypeScript)
4. **infrastructure** - AWS CDK infrastructure as code

### Infrastructure Stacks

The CDK application defines 5 stacks deployed in this order:

1. **BaseRolesStack** - Shared resources (S3 artifacts bucket, Secrets Manager, CodeStar GitHub connection, IAM roles)
2. **MainInfraStack** - Core application (DynamoDB table, S3 files bucket, Lambda functions)
3. **PipelineInfraStack** - CI/CD for infrastructure deployments
4. **PipelineListenerStack** - CI/CD for message-listener Lambda
5. **PipelineDdbStreamStack** - CI/CD for file-processor Lambda

## Data Model (DynamoDB Single-Table Design)

Table: `MnemosyneSlackArchive`

**Primary Keys:**
- `itemId` (partition key) - string with prefixed patterns
- `timestamp` (sort key) - string

**Item Type Patterns:**

Messages:
```
PK = "message#{team_id}#{channel_id}"
SK = "ts#{ts}"
```

Channels:
```
PK = "channel#{team_id}#{channel_id}"
SK = "evt#{event_ts}"
```

Channel Index:
```
PK = "channelindex#{team_id}"
SK = "{shard_number}"
```

**GSI (ThreadIndex)** - Sparse index for thread retrieval:
- `parent` (partition key) = `"thread#{team_id}#{thread_ts}"`
- `timestamp` (sort key) = message timestamp

### Storage Optimization Rules

- NEVER write explicit `false` booleans - omit attributes when false
- Use `REMOVE` for attributes like `archived` on unarchive events instead of setting to false
- Cap `names_history` arrays at 20 entries to bound item sizes
- Shard ChannelIndex items when approaching 200KB limit

## Development Commands

### Infrastructure (CDK)

From `infrastructure/` directory:

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Watch mode for development
npm run watch

# Run tests
npm test

# CDK commands
npm run cdk -- <command>

# Bootstrap (first time only)
npx cdk bootstrap --profile default --region eu-west-1

# Deploy all stacks
npx cdk deploy --all --profile default --region eu-west-1 --require-approval never

# Deploy specific stack
DEPLOY_STACK=MainInfraStack npx cdk deploy --profile default --region eu-west-1

# Synthesize CloudFormation
npx cdk synth

# Destroy all stacks
npx cdk destroy --all --profile default --region eu-west-1
```

### Lambda Functions

Each Lambda package (message-listener, file-processor, slack-shared):

```bash
# Install dependencies
npm ci

# Build TypeScript
npm run build

# Watch mode
npm run watch

# Run tests
npm test
```

## CI/CD Pipeline Architecture

The project uses AWS CodePipeline with GitHub integration via CodeStar Connection:

- **Infrastructure Pipeline**: Triggers on changes to `infrastructure/` folder, runs buildspec at `infrastructure/buildspecs/infrastructure-buildspec.yml`, deploys all CDK stacks
- **Lambda Pipelines**: Trigger on changes to respective Lambda folders, build TypeScript, create deployment package, update Lambda function code

All pipelines use Node.js 22 runtime.

## Key Environment Variables

Lambda functions expect:

- `SLACK_ARCHIVE_TABLE` - DynamoDB table name
- `SLACK_FILES_BUCKET` - S3 bucket for file storage
- Secrets ARNs for Slack bot token and signing secret (configured in Secrets Manager)

## Configuration

- **Region**: `eu-west-1` (hardcoded in `infrastructure/bin/infra.ts:14`)
- **App Prefix**: `Mnemosyne` (used for resource naming)
- **GitHub Repo**: `Artistotle-ai/slackHistory`
- **Branch**: `main`

## Secrets Management

After deploying BaseRolesStack, manually populate these Secrets Manager secrets:

1. `Mnemosyne/slack/bot-token` - Slack Bot User OAuth Token
2. `Mnemosyne/slack/signing-secret` - Slack Signing Secret for request verification

The Lambda functions need IAM permissions to read these secrets (currently TODO in infrastructure).

## Event Handling Specifics

### Message Events
- `message` - Create new message item with files array if present
- `message_changed` - Update existing message, set `updated_ts`
- `message_deleted` - Set `deleted = true` attribute (do NOT remove item)

### Channel Events
- `channel_created` - Create channel item with initial name
- `channel_rename` - Append to `names_history` (max 20), update ChannelIndex
- `channel_deleted` - Set `deleted = true`, prefix name with `deleted_` in ChannelIndex
- `channel_archive` - Set `archived = true`
- `channel_unarchive` - `REMOVE archived` attribute
- `channel_convert_to_private/public` - Update `visibility` field (app continues storing events regardless)

### File Processing (DynamoDB Stream)
- Triggered on INSERT/MODIFY where `files` exists and `files_s3` is absent
- Downloads files from Slack using bot token Authorization header
- Stores in S3 at `slack/{team_id}/{channel_id}/{ts}/{file_id}`
- Updates DynamoDB item with `files_s3` array of S3 URIs
- On failures, sets `files_fetch_failed = true` after retries

## Important Implementation Notes

1. **Thread Handling**: Messages with `thread_ts` get `parent` attribute set to `"thread#{team_id}#{thread_ts}"` for GSI querying
2. **Public Channels Only**: Event handlers should filter and only process public channel events (though app continues archiving channels that become private)
3. **No Backfill**: System only captures events from deployment forward
4. **Idempotency**: Use conditional writes and file_id in S3 keys to prevent duplicates
5. **Function URL**: message-listener uses public Function URL with `NONE` auth type (TODO: restrict CORS to Slack domains)
6. **DynamoDB Stream**: Not yet configured on the table (TODO in main-infra-stack.ts:139)

## Testing Strategy

Tests are configured with Jest and ts-jest for all TypeScript packages. Test files should follow the pattern `*.test.ts`.

## Common Gotchas

- Lambda code paths in CDK currently point to `src/` folders but should point to built `dist/` folders
- GitHub CodeStar connection requires manual authorization in AWS Console after first deployment
- Pipeline buildspecs expect specific directory structure and npm scripts
- Boolean attributes must be omitted (not set to false) per storage optimization rules
- Item size limit is 400KB - monitor and shard as needed
