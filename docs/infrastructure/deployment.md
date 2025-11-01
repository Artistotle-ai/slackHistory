# Deployment Guide

Deploy Mnemosyne infrastructure to AWS using CDK.

## Prerequisites

- AWS account with deployment permissions
- AWS CLI configured
- Node.js 22+
- CDK CLI: `npm install -g aws-cdk`
- Slack bot credentials ([setup guide](./secrets-setup.md))

## Deploy

```bash
# Setup
cd infrastructure
npm install

# Bootstrap (one-time)
npx cdk bootstrap --profile default --region eu-west-1

# Deploy all stacks (~5-10 minutes)
npx cdk deploy --all --profile default --region eu-west-1 --require-approval never
```

**Stacks Created:**
- `MnemosyneBaseRolesStack` - S3, secrets, IAM
- `MnemosyneMainInfraStack` - DynamoDB, Lambda
- `Mnemosyne*PipelineStack` - CI/CD pipelines (3)

## Post-Deployment

**1. Get Function URL:**
```bash
aws cloudformation describe-stacks \
  --stack-name MnemosyneMainInfraStack \
  --query 'Stacks[0].Outputs[?OutputKey==`MessageListenerFunctionUrl`].OutputValue' \
  --output text
```

**2. Add Slack Secrets** ([full guide](./secrets-setup.md)):
```bash
aws secretsmanager put-secret-value \
  --secret-id Mnemosyne/slack/bot-token \
  --secret-string "xoxb-your-token"

aws secretsmanager put-secret-value \
  --secret-id Mnemosyne/slack/signing-secret \
  --secret-string "your-secret"
```

**3. Configure Slack App:**
- Update `slack/manifest.json`: Replace `REPLACE_WITH_FUNCTION_URL` with your actual Function URL
- Recreate app from manifest, or manually configure Event Subscriptions
- Subscribe to: `message.channels`, `message.groups`, `channel_*`, `file_shared`

**4. Configure GitHub (optional for CI/CD):**
- AWS Console → CodePipeline → Connections → Create GitHub connection

## Verify

```bash
# Watch logs
aws logs tail /aws/lambda/MnemosyneMessageListener --follow

# Check data
aws dynamodb scan --table-name MnemosyneSlackArchive --max-items 5
```

## Update

```bash
npx cdk diff  # Review changes
npx cdk deploy --all --profile default --region eu-west-1
```

## Troubleshooting

**Bootstrap conflict:**
```bash
npx cdk bootstrap --force --profile default --region eu-west-1
```

**NPM cache issues:**
```bash
sudo chown -R $(whoami) ~/.npm
```

**Stack failure:**
```bash
# Check events
aws cloudformation describe-stack-events --stack-name MnemosyneMainInfraStack --max-items 20

# Destroy and redeploy
npx cdk destroy MnemosyneMainInfraStack
npx cdk deploy MnemosyneMainInfraStack
```

**Function URL not working:**
- Check Lambda logs for errors
- Verify signing secret in Secrets Manager
- Test URL: `curl -X POST https://your-function-url.lambda-url.eu-west-1.on.aws/`

## Cleanup

```bash
npx cdk destroy --all --profile default --region eu-west-1
```

⚠️ **Permanently deletes all message history and files**
