# Deployment Guide

Deploy Mnemosyne infrastructure to AWS using CDK.

See [Architecture](./architecture.md) for stack details.

## Prerequisites

- AWS account with deployment permissions
- AWS CLI configured (`aws configure`)
- Node.js 22+
- CDK CLI: `npm install -g aws-cdk`
- Slack app created ([secrets setup](./secrets-setup.md))

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

**4. Authorize GitHub CodeStar Connection (required for CI/CD):**

The CodeStar connection is created automatically during deployment. You just need to authorize it:

1. Go to AWS Console → Developer Tools → Connections
2. Find the connection named `Mnemosyne-github` (status: PENDING)
3. Click **Update pending connection** → **Install a new app**
4. Authorize with GitHub and select your repository
5. Connection status will change to AVAILABLE

Note: The connection ARN is automatically output after deployment and used by all pipelines.

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

## Cost Management

Infrastructure includes lifecycle policies to minimize costs:
- S3 artifacts: 7-day expiration
- S3 files: 90-day transition to Infrequent Access
- CloudWatch logs: 7-day retention
- DynamoDB: PITR disabled

See [Cost Optimization](./cost-optimization.md) for details.

**Estimated cost:** $19-22/month (scales with usage)

## Cleanup

```bash
npx cdk destroy --all --profile default --region eu-west-1
```

⚠️ **Permanently deletes all message history and files**
