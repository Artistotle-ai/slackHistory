# Slack Secrets Setup

Configure Slack credentials for Mnemosyne using the app manifest.

Part of [Deployment Guide](./deployment.md).

## Required Secrets

- **Signing Secret** - Webhook verification for request validation
- **Client ID** - OAuth app identifier
- **Client Secret** - OAuth app secret

**Note:** Bot token is stored in DynamoDB after OAuth installation - no manual secret needed.

## Create Slack App from Manifest

1. Go to [Slack API Dashboard](https://api.slack.com/apps)
2. Click **Create New App** → **From an app manifest**
3. Select your workspace
4. Paste the entire contents of `slack/manifest.json`
5. Click **Create**

The manifest includes all required permissions and event subscriptions.

## Get Credentials

1. Open your Slack app (Mnemosyne) in the [API Dashboard](https://api.slack.com/apps)
2. **Basic Information** → **App Credentials**:
   - Copy **Client ID**
   - Copy **Client Secret**
   - Copy **Signing Secret**

## Store Secrets in AWS

Store credentials in AWS Secrets Manager:

```bash
# Signing secret
aws secretsmanager put-secret-value \
  --secret-id Mnemosyne/slack/signing-secret \
  --secret-string "your-signing-secret"

# OAuth client ID
aws secretsmanager put-secret-value \
  --secret-id Mnemosyne/slack/client-id \
  --secret-string "your-client-id"

# OAuth client secret
aws secretsmanager put-secret-value \
  --secret-id Mnemosyne/slack/client-secret \
  --secret-string "your-client-secret"
```

## Update Manifest with Function URL

After AWS deployment, update the manifest:

1. Get your Function URL from CloudFormation outputs
2. Edit `slack/manifest.json`
3. Replace `REPLACE_WITH_FUNCTION_URL` with your actual Lambda Function URL
4. Recreate the Slack app with the updated manifest if needed

## Verify Setup

Test that your app is working:

```bash
# Check secrets exist
aws secretsmanager describe-secret --secret-id Mnemosyne/slack/signing-secret
aws secretsmanager describe-secret --secret-id Mnemosyne/slack/client-id
aws secretsmanager describe-secret --secret-id Mnemosyne/slack/client-secret
```

## Security


**IAM permissions:**
- Limit to `secretsmanager:GetSecretValue` on `Mnemosyne/slack/*`
- Enable CloudTrail logging
- Never commit tokens to git

## Troubleshooting

**Verification failed:**
```bash
# Check Lambda logs
aws logs tail /aws/lambda/MnemosyneMessageListener --follow

# Test URL
curl -X POST https://your-function-url.lambda-url.eu-west-1.on.aws/
```


## References

- [Slack API Docs](https://api.slack.com/docs)
- [OAuth Scopes](https://api.slack.com/scopes)
- [Event Types](https://api.slack.com/events)
