# Get Started with Mnemosyne

This guide will help you deploy Mnemosyne and start archiving your Slack workspace messages, channels, and files to AWS.

## What is Mnemosyne?

Mnemosyne is a serverless Slack archiving solution that bypasses Slack's free plan 90-day message retention limit. Once deployed, it automatically captures all future messages, channel metadata, and file attachments, storing them permanently in AWS DynamoDB and S3.

**Key Features:**
- Automatic message archiving in real-time
- File attachment storage in S3
- Channel metadata tracking (name changes, purpose, topics)
- Thread support with efficient retrieval
- Serverless architecture with automatic scaling

See the [README](../README.md) for more details about the solution and its limitations.

## Prerequisites

Before you begin, ensure you have:

- **AWS Account** with deployment permissions
- **AWS CLI** configured (`aws configure`)
- **Node.js 22+** installed
- **CDK CLI** installed: `npm install -g aws-cdk`
- **GitHub Account** (for CI/CD pipeline)
- **Slack Workspace** where you have permission to create apps

## Overview

The deployment process consists of these steps:

1. **Deploy Infrastructure** - AWS resources (DynamoDB, Lambda, S3, pipelines)
2. **Create Slack App** - Configure Slack app with OAuth and event subscriptions
3. **Configure Secrets** - Store Slack credentials in AWS Secrets Manager
4. **Authorize GitHub Connection** - Enable CI/CD pipeline
5. **Install Slack App** - Complete OAuth flow to start archiving

## Step 1: Deploy Infrastructure

Deploy the AWS infrastructure using CDK. This creates all necessary resources including DynamoDB tables, Lambda functions, S3 buckets, and CI/CD pipelines.

**Time Required:** ~5-10 minutes

```bash
# Navigate to infrastructure directory
cd infrastructure
npm install

# Bootstrap CDK (one-time per account/region)
npx cdk bootstrap --profile default --region eu-west-1

# Deploy all stacks
npx cdk deploy --all --profile default --region eu-west-1 --require-approval never
```

**What Gets Created:**
- `MnemosyneBaseRolesStack` - S3 artifacts bucket, Secrets Manager, CodeStar connection
- `MnemosyneMainInfraStack` - DynamoDB table, Lambda functions, S3 bucket for files
- `MnemosynePipelineInfraStack` - CI/CD pipeline for infrastructure
- `MnemosynePipelineLambdasStack` - CI/CD pipeline for Lambda functions

See the [Infrastructure Architecture](infrastructure/architecture.md) documentation for detailed information about the resources created.

## Step 2: Get Function URLs

After deployment, retrieve the Lambda Function URLs needed for Slack configuration:

```bash
# Message Listener Function URL
aws cloudformation describe-stacks \
  --stack-name MnemosyneMainInfraStack \
  --query 'Stacks[0].Outputs[?OutputKey==`MessageListenerFunctionUrl`].OutputValue' \
  --output text

# OAuth Callback Function URL
aws cloudformation describe-stacks \
  --stack-name MnemosyneMainInfraStack \
  --query 'Stacks[0].Outputs[?OutputKey==`OAuthCallbackFunctionUrl`].OutputValue' \
  --output text
```

Save these URLs - you'll need them in the next steps.

## Step 3: Create Slack App

Create a Slack app and configure it with the Function URLs from Step 2.

### 3.1 Create App from Manifest

1. Go to [Slack API Dashboard](https://api.slack.com/apps)
2. Click **Create New App** → **From an app manifest**
3. Select your workspace
4. Open `slack/manifest.json` from this repository
5. Replace `yourMessageListenerFunctionUrl` with the Message Listener URL from Step 2
6. Replace `yourOAuthFunctionUrl` with the OAuth Callback URL from Step 2
7. Paste the updated manifest into Slack
8. Click **Create**

The manifest includes all required permissions and event subscriptions. See [Secrets Setup](infrastructure/secrets-setup.md) for more details.

### 3.2 Get Credentials

After creating the app, get the credentials:

1. In the [Slack API Dashboard](https://api.slack.com/apps), open your app
2. Navigate to **Basic Information** → **App Credentials**
3. Copy the following:
   - **Client ID**
   - **Client Secret**
   - **Signing Secret**

You'll use these in the next step.

## Step 4: Store Secrets in AWS

Store the Slack credentials in AWS Secrets Manager. These are used by Lambda functions to authenticate with Slack.

```bash
# Signing Secret
aws secretsmanager put-secret-value \
  --secret-id Mnemosyne/slack/signing-secret \
  --secret-string "your-signing-secret"

# OAuth Client ID
aws secretsmanager put-secret-value \
  --secret-id Mnemosyne/slack/client-id \
  --secret-string "your-client-id"

# OAuth Client Secret
aws secretsmanager put-secret-value \
  --secret-id Mnemosyne/slack/client-secret \
  --secret-string "your-client-secret"
```

Replace the placeholder values with the credentials from Step 3.2.

See [Secrets Setup](infrastructure/secrets-setup.md) for detailed instructions and security best practices.

## Step 5: Authorize GitHub Connection

The CodeStar connection enables CI/CD pipelines to automatically deploy code changes. Authorize it after the initial deployment:

1. Go to **AWS Console** → **Developer Tools** → **Connections**
2. Find the connection named `Mnemosyne-github` (status: PENDING)
3. Click **Update pending connection** → **Install a new app**
4. Authorize with GitHub and select your repository
5. Connection status will change to AVAILABLE

**Note:** The pipeline will automatically deploy Lambda functions when you push code to the `main` branch. See [Development Workflow](development/dev-workflow.md) for local development instructions.

## Step 6: Install Slack App

Install the Slack app in your workspace to start archiving:

1. Go to **Slack API Dashboard** → Your app
2. Navigate to **Install App** (or **OAuth & Permissions**)
3. Click **Install to Workspace**
4. Review permissions and click **Allow**
5. You'll be redirected to the OAuth callback URL
6. You should see a success message confirming installation

After installation, the bot token is automatically stored in DynamoDB. The app will start archiving messages immediately.

## Step 7: Verify Installation

Verify that everything is working:

### Check Lambda Logs

```bash
# Watch Message Listener logs
aws logs tail /aws/lambda/MnemosyneMessageListener --follow

# Watch File Processor logs
aws logs tail /aws/lambda/MnemosyneFileProcessor --follow
```

### Check DynamoDB

```bash
# Scan for recent messages
aws dynamodb scan \
  --table-name MnemosyneSlackArchive \
  --filter-expression "begins_with(itemId, :prefix)" \
  --expression-attribute-values '{":prefix":{"S":"message#"}}' \
  --max-items 5
```

### Test in Slack

1. Send a test message in a public channel
2. Check CloudWatch logs for processing activity
3. Verify the message appears in DynamoDB

See [API Endpoints](api/endpoints.md) for information about the Lambda Function URLs and their capabilities.

## Next Steps

Now that Mnemosyne is deployed and running:

- **Monitor Logs**: Watch CloudWatch logs to ensure messages are being processed
- **Query Data**: Use DynamoDB queries to retrieve archived messages (see [Data Schema](requirements/requirements.md))
- **Development**: Set up local development environment (see [Development Workflow](development/dev-workflow.md))
- **Troubleshooting**: Refer to [Deployment Guide Troubleshooting](infrastructure/deployment.md#troubleshooting) for common issues

## Understanding the Architecture

Mnemosyne uses a serverless architecture:

- **DynamoDB**: Stores messages, channels, and metadata in a single-table design
- **Lambda Functions**: Process Slack events and file downloads
- **S3**: Stores file attachments with lifecycle policies
- **CodePipeline**: Automatically deploys code changes

See [Infrastructure Architecture](infrastructure/architecture.md) for detailed information about the system design and event flow.

## Data Model

Messages and channels are stored in DynamoDB using a single-table design with key patterns:

- **Messages**: `message#{team_id}#{channel_id}` / `{ts}`
- **Channels**: `channel#{team_id}#{channel_id}` / `{event_ts}`
- **Threads**: Uses GSI `ThreadIndex` for efficient retrieval

See [Data Schema](requirements/requirements.md) for complete details about the data model and item structure.

## Troubleshooting

### Common Issues

**Function URL not responding:**
- Check Lambda logs for errors
- Verify signing secret in Secrets Manager
- Test URL: `curl -X POST https://your-function-url.lambda-url.eu-west-1.on.aws/`

**No messages being archived:**
- Verify Slack app is installed in workspace
- Check Event Subscriptions are enabled in Slack app settings
- Review Message Listener logs for errors

**Files not downloading:**
- Check File Processor logs
- Verify bot token is stored in DynamoDB
- Ensure S3 bucket permissions are correct

See [Deployment Guide](infrastructure/deployment.md) for more troubleshooting steps.

## Cost Management

Mnemosyne is designed to minimize costs:

- **DynamoDB**: PAY_PER_REQUEST billing (no provisioned capacity)
- **S3**: Lifecycle policies transition files to IA after 90 days
- **CloudWatch**: 7-day log retention
- **Artifacts**: 7-day expiration

Costs depend on Slack activity volume. Monitor AWS Cost Explorer for usage patterns.

## Cleanup

To remove all resources:

```bash
cd infrastructure
npx cdk destroy --all --profile default --region eu-west-1
```

⚠️ **Warning:** This permanently deletes all message history and files stored in DynamoDB and S3.

## Additional Resources

- [Infrastructure Architecture](infrastructure/architecture.md) - Detailed system design
- [Deployment Guide](infrastructure/deployment.md) - Complete deployment instructions
- [Lambda Functions](lambda-functions/) - Function-specific documentation
- [API Endpoints](api/endpoints.md) - Function URL specifications
- [Development Workflow](development/dev-workflow.md) - Local development setup

## Support

For issues or questions:
- Review the [troubleshooting section](#troubleshooting)
- Check CloudWatch logs for error details
- Review [Deployment Guide](infrastructure/deployment.md) for common solutions

